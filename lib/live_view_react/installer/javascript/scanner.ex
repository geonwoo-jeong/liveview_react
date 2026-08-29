defmodule LiveViewReact.Installer.JavaScript.Scanner do
  @moduledoc false

  defmodule Token do
    @moduledoc false

    @enforce_keys [:kind, :value, :start, :stop]
    defstruct [:kind, :value, :start, :stop]
  end

  @type token :: %Token{
          kind: :identifier | :number | :punctuation | :string | :template | :regex,
          value: binary(),
          start: non_neg_integer(),
          stop: non_neg_integer()
        }

  @spec scan(binary()) :: {:ok, [token()]} | {:error, binary()}
  def scan(source) when is_binary(source) do
    cond do
      not String.valid?(source) ->
        {:error, "JavaScript source must be valid UTF-8"}

      :binary.match(source, <<0>>) != :nomatch ->
        {:error, "JavaScript source must not contain NUL bytes"}

      true ->
        scan(source, byte_size(source), 0, [], nil)
    end
  end

  def scan(_source), do: {:error, "JavaScript source must be a string"}

  @spec delimiter_pairs([token()]) ::
          {:ok, %{non_neg_integer() => non_neg_integer()}} | {:error, binary()}
  def delimiter_pairs(tokens) do
    tokens
    |> Enum.with_index()
    |> Enum.reduce_while({[], %{}}, fn {token, index}, {stack, pairs} ->
      case token.value do
        opening when opening in ["(", "[", "{"] ->
          {:cont, {[{opening, index} | stack], pairs}}

        closing when closing in [")", "]", "}"] ->
          close_delimiter(stack, pairs, closing, index)

        _other ->
          {:cont, {stack, pairs}}
      end
    end)
    |> case do
      {:error, message} ->
        {:error, message}

      {[], pairs} ->
        {:ok, pairs}

      {[{opening, _index} | _rest], _pairs} ->
        {:error, "unclosed JavaScript delimiter #{inspect(opening)}"}
    end
  end

  @spec normalize([token()]) :: [{atom(), binary()}]
  def normalize(tokens) do
    Enum.map(tokens, fn token -> {token.kind, token.value} end)
  end

  @spec split_top_level([token()]) :: {:ok, [[token()]]} | {:error, binary()}
  def split_top_level(tokens) do
    tokens
    |> Enum.reduce_while({[], [], []}, fn token, {parts, current, stack} ->
      case token.value do
        opening when opening in ["(", "[", "{"] ->
          {:cont, {parts, [token | current], [opening | stack]}}

        closing when closing in [")", "]", "}"] ->
          case stack do
            [opening | rest] ->
              if matching_delimiters?(opening, closing) do
                {:cont, {parts, [token | current], rest}}
              else
                {:halt,
                 {:error,
                  "mismatched JavaScript delimiters #{inspect(opening)} and #{inspect(closing)}"}}
              end

            [] ->
              {:halt, {:error, "unexpected JavaScript delimiter #{inspect(closing)}"}}
          end

        "," when stack == [] ->
          {:cont, {[Enum.reverse(current) | parts], [], stack}}

        _other ->
          {:cont, {parts, [token | current], stack}}
      end
    end)
    |> case do
      {:error, message} -> {:error, message}
      {_parts, _current, [_opening | _rest]} -> {:error, "unclosed JavaScript delimiter"}
      {parts, current, []} -> {:ok, Enum.reverse([Enum.reverse(current) | parts])}
    end
  end

  defp scan(_source, size, offset, tokens, _previous) when offset >= size,
    do: {:ok, Enum.reverse(tokens)}

  defp scan(source, size, offset, tokens, previous) do
    byte = :binary.at(source, offset)

    cond do
      whitespace?(byte) ->
        scan(source, size, offset + 1, tokens, previous)

      offset == 0 and starts_with?(source, offset, "#!") ->
        scan(source, size, skip_line(source, size, offset + 2), tokens, previous)

      starts_with?(source, offset, "//") ->
        scan(source, size, skip_line(source, size, offset + 2), tokens, previous)

      starts_with?(source, offset, "/*") ->
        with {:ok, next_offset} <- skip_block_comment(source, size, offset + 2) do
          scan(source, size, next_offset, tokens, previous)
        end

      byte in [?\", ?'] ->
        with {:ok, next_offset} <- skip_quoted(source, size, offset + 1, byte) do
          value = binary_part(source, offset + 1, next_offset - offset - 2)
          token = %Token{kind: :string, value: value, start: offset, stop: next_offset}
          scan(source, size, next_offset, [token | tokens], token)
        end

      byte == ?` ->
        with {:ok, next_offset} <- skip_template(source, size, offset + 1) do
          value = binary_part(source, offset, next_offset - offset)
          token = %Token{kind: :template, value: value, start: offset, stop: next_offset}
          scan(source, size, next_offset, [token | tokens], token)
        end

      byte == ?/ and regex_start?(previous) ->
        with {:ok, next_offset} <- skip_regex(source, size, offset + 1, false) do
          value = binary_part(source, offset, next_offset - offset)
          token = %Token{kind: :regex, value: value, start: offset, stop: next_offset}
          scan(source, size, next_offset, [token | tokens], token)
        end

      identifier_start?(byte) ->
        next_offset = take_while(source, size, offset + 1, &identifier_continue?/1)
        value = binary_part(source, offset, next_offset - offset)
        token = %Token{kind: :identifier, value: value, start: offset, stop: next_offset}
        scan(source, size, next_offset, [token | tokens], token)

      digit?(byte) ->
        next_offset = take_while(source, size, offset + 1, &number_continue?/1)
        value = binary_part(source, offset, next_offset - offset)
        token = %Token{kind: :number, value: value, start: offset, stop: next_offset}
        scan(source, size, next_offset, [token | tokens], token)

      true ->
        {value, next_offset} = punctuation(source, size, offset)

        token = %Token{
          kind: :punctuation,
          value: value,
          start: offset,
          stop: next_offset
        }

        scan(source, size, next_offset, [token | tokens], token)
    end
  end

  defp close_delimiter([{opening, opening_index} | rest], pairs, closing, closing_index) do
    if matching_delimiters?(opening, closing) do
      {:cont,
       {rest,
        pairs
        |> Map.put(opening_index, closing_index)
        |> Map.put(closing_index, opening_index)}}
    else
      {:halt,
       {:error, "mismatched JavaScript delimiters #{inspect(opening)} and #{inspect(closing)}"}}
    end
  end

  defp close_delimiter([], _pairs, closing, _closing_index),
    do: {:halt, {:error, "unexpected JavaScript delimiter #{inspect(closing)}"}}

  defp matching_delimiters?("(", ")"), do: true
  defp matching_delimiters?("[", "]"), do: true
  defp matching_delimiters?("{", "}"), do: true
  defp matching_delimiters?(_opening, _closing), do: false

  defp skip_line(source, size, offset) do
    take_until(source, size, offset, fn byte -> byte in [?\n, ?\r] end)
  end

  defp skip_block_comment(_source, size, offset) when offset >= size,
    do: {:error, "unclosed JavaScript block comment"}

  defp skip_block_comment(source, size, offset) do
    if starts_with?(source, offset, "*/") do
      {:ok, offset + 2}
    else
      skip_block_comment(source, size, offset + 1)
    end
  end

  defp skip_quoted(_source, size, offset, quote) when offset >= size,
    do: {:error, "unclosed JavaScript string literal #{<<quote>>}"}

  defp skip_quoted(source, size, offset, quote) do
    byte = :binary.at(source, offset)

    cond do
      byte == quote -> {:ok, offset + 1}
      byte in [?\n, ?\r] -> {:error, "unclosed JavaScript string literal #{<<quote>>}"}
      byte == ?\\ -> skip_escape(source, size, offset + 1, &skip_quoted(&1, &2, &3, quote))
      true -> skip_quoted(source, size, offset + 1, quote)
    end
  end

  defp skip_template(_source, size, offset) when offset >= size,
    do: {:error, "unclosed JavaScript template literal"}

  defp skip_template(source, size, offset) do
    cond do
      starts_with?(source, offset, "${") ->
        with {:ok, next_offset} <- skip_template_expression(source, size, offset + 2, 1, true) do
          skip_template(source, size, next_offset)
        end

      :binary.at(source, offset) == ?` ->
        {:ok, offset + 1}

      :binary.at(source, offset) == ?\\ ->
        skip_escape(source, size, offset + 1, &skip_template/3)

      true ->
        skip_template(source, size, offset + 1)
    end
  end

  defp skip_template_expression(_source, size, offset, _depth, _regex_allowed)
       when offset >= size,
       do: {:error, "unclosed JavaScript template interpolation"}

  defp skip_template_expression(source, size, offset, depth, regex_allowed) do
    byte = :binary.at(source, offset)

    cond do
      whitespace?(byte) ->
        skip_template_expression(source, size, offset + 1, depth, regex_allowed)

      starts_with?(source, offset, "//") ->
        next_offset = skip_line(source, size, offset + 2)
        skip_template_expression(source, size, next_offset, depth, regex_allowed)

      starts_with?(source, offset, "/*") ->
        with {:ok, next_offset} <- skip_block_comment(source, size, offset + 2) do
          skip_template_expression(source, size, next_offset, depth, regex_allowed)
        end

      byte in [?\", ?'] ->
        with {:ok, next_offset} <- skip_quoted(source, size, offset + 1, byte) do
          skip_template_expression(source, size, next_offset, depth, false)
        end

      byte == ?` ->
        with {:ok, next_offset} <- skip_template(source, size, offset + 1) do
          skip_template_expression(source, size, next_offset, depth, false)
        end

      byte == ?{ ->
        skip_template_expression(source, size, offset + 1, depth + 1, true)

      byte == ?} and depth == 1 ->
        {:ok, offset + 1}

      byte == ?} ->
        skip_template_expression(source, size, offset + 1, depth - 1, false)

      byte == ?/ and regex_allowed ->
        with {:ok, next_offset} <- skip_regex(source, size, offset + 1, false) do
          skip_template_expression(source, size, next_offset, depth, false)
        end

      byte == ?/ ->
        skip_template_expression(source, size, offset + 1, depth, true)

      identifier_start?(byte) ->
        next_offset = take_while(source, size, offset + 1, &identifier_continue?/1)
        skip_template_expression(source, size, next_offset, depth, false)

      digit?(byte) ->
        next_offset = take_while(source, size, offset + 1, &number_continue?/1)
        skip_template_expression(source, size, next_offset, depth, false)

      byte in [?), ?]] ->
        skip_template_expression(source, size, offset + 1, depth, false)

      true ->
        skip_template_expression(source, size, offset + 1, depth, true)
    end
  end

  defp skip_regex(_source, size, offset, _in_class) when offset >= size,
    do: {:error, "unclosed JavaScript regular expression literal"}

  defp skip_regex(source, size, offset, in_class) do
    byte = :binary.at(source, offset)

    cond do
      byte in [?\n, ?\r] ->
        {:error, "unclosed JavaScript regular expression literal"}

      byte == ?\\ ->
        skip_escape(source, size, offset + 1, fn next_source, next_size, next_offset ->
          skip_regex(next_source, next_size, next_offset, in_class)
        end)

      byte == ?[ and not in_class ->
        skip_regex(source, size, offset + 1, true)

      byte == ?] and in_class ->
        skip_regex(source, size, offset + 1, false)

      byte == ?/ and not in_class ->
        {:ok, take_while(source, size, offset + 1, &identifier_continue?/1)}

      true ->
        skip_regex(source, size, offset + 1, in_class)
    end
  end

  defp skip_escape(_source, size, offset, _continuation) when offset >= size,
    do: {:error, "dangling JavaScript escape sequence"}

  defp skip_escape(source, size, offset, continuation),
    do: continuation.(source, size, offset + 1)

  defp regex_start?(nil), do: true

  defp regex_start?(%Token{kind: :identifier, value: value}),
    do: value in ~w(await case delete else in instanceof new of return throw typeof void yield)

  defp regex_start?(%Token{value: value}),
    do:
      value in [
        "(",
        "[",
        "{",
        ",",
        ":",
        ";",
        "=",
        "=>",
        "!",
        "!=",
        "!==",
        "&&",
        "||",
        "??",
        "?",
        "+",
        "-",
        "*",
        "%",
        "&",
        "|",
        "^",
        "~",
        "<",
        ">",
        "<=",
        ">="
      ]

  defp punctuation(source, size, offset) do
    Enum.find_value([4, 3, 2], fn length ->
      if offset + length <= size do
        candidate = binary_part(source, offset, length)

        if candidate in ~w(>>>= === !== **= &&= ||= ??= >>> ... => == != <= >= ++ -- && || ?? ** += -= *= /= %= &= |= ^= <<= >>= ?. ??) do
          {candidate, offset + length}
        end
      end
    end) || {binary_part(source, offset, 1), offset + 1}
  end

  defp starts_with?(source, offset, expected) do
    expected_size = byte_size(expected)

    offset + expected_size <= byte_size(source) and
      binary_part(source, offset, expected_size) == expected
  end

  defp take_while(source, size, offset, predicate) when offset < size do
    if predicate.(:binary.at(source, offset)) do
      take_while(source, size, offset + 1, predicate)
    else
      offset
    end
  end

  defp take_while(_source, _size, offset, _predicate), do: offset

  defp take_until(source, size, offset, predicate) when offset < size do
    if predicate.(:binary.at(source, offset)) do
      offset
    else
      take_until(source, size, offset + 1, predicate)
    end
  end

  defp take_until(_source, _size, offset, _predicate), do: offset

  defp whitespace?(byte), do: byte in [9, 10, 11, 12, 13, 32]
  defp digit?(byte), do: byte >= ?0 and byte <= ?9

  defp identifier_start?(byte),
    do: (byte >= ?a and byte <= ?z) or (byte >= ?A and byte <= ?Z) or byte in [?_, ?$]

  defp identifier_continue?(byte), do: identifier_start?(byte) or digit?(byte)

  defp number_continue?(byte), do: identifier_continue?(byte) or byte == ?.
end
