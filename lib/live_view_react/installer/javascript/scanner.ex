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

  @multi_char_punctuation ~w(
    >>>=
    ===
    !==
    **=
    &&=
    ||=
    ??=
    >>>
    ...
    =>
    ==
    !=
    <=
    >=
    ++
    --
    &&
    ||
    ??
    **
    +=
    -=
    *=
    /=
    %=
    &=
    |=
    ^=
    <<=
    >>=
    ?.
  )

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
    |> Enum.reduce_while({[], [], []}, &split_top_level_token/2)
    |> finalize_split_top_level()
  end

  defp scan(_source, size, offset, tokens, _previous) when offset >= size,
    do: {:ok, Enum.reverse(tokens)}

  defp scan(source, size, offset, tokens, previous) do
    case next_scan_step(source, size, offset, previous) do
      {:skip, next_offset} ->
        scan(source, size, next_offset, tokens, previous)

      {:emit, token, next_offset} ->
        scan(source, size, next_offset, [token | tokens], token)

      {:error, _message} = error ->
        error
    end
  end

  defp split_top_level_token(%Token{value: value} = token, {parts, current, stack})
       when value in ["(", "[", "{"] do
    {:cont, {parts, [token | current], [value | stack]}}
  end

  defp split_top_level_token(%Token{value: value} = token, {parts, current, stack})
       when value in [")", "]", "}"] do
    close_split_top_level(token, parts, current, stack)
  end

  defp split_top_level_token(%Token{value: ","}, {parts, current, []}),
    do: {:cont, {[Enum.reverse(current) | parts], [], []}}

  defp split_top_level_token(token, {parts, current, stack}),
    do: {:cont, {parts, [token | current], stack}}

  defp close_split_top_level(%Token{value: closing} = token, parts, current, [opening | rest]) do
    if matching_delimiters?(opening, closing) do
      {:cont, {parts, [token | current], rest}}
    else
      {:halt,
       {:error, "mismatched JavaScript delimiters #{inspect(opening)} and #{inspect(closing)}"}}
    end
  end

  defp close_split_top_level(%Token{value: closing}, _parts, _current, []),
    do: {:halt, {:error, "unexpected JavaScript delimiter #{inspect(closing)}"}}

  defp finalize_split_top_level({:error, message}), do: {:error, message}

  defp finalize_split_top_level({_parts, _current, [_opening | _rest]}),
    do: {:error, "unclosed JavaScript delimiter"}

  defp finalize_split_top_level({parts, current, []}),
    do: {:ok, Enum.reverse([Enum.reverse(current) | parts])}

  defp next_scan_step(source, size, offset, previous) do
    byte = :binary.at(source, offset)

    cond do
      whitespace?(byte) ->
        {:skip, offset + 1}

      offset == 0 and starts_with?(source, offset, "#!") ->
        {:skip, skip_line(source, size, offset + 2)}

      starts_with?(source, offset, "//") ->
        {:skip, skip_line(source, size, offset + 2)}

      starts_with?(source, offset, "/*") ->
        next_block_comment_step(source, size, offset)

      true ->
        next_significant_scan_step(source, size, offset, previous, byte)
    end
  end

  defp next_block_comment_step(source, size, offset) do
    case skip_block_comment(source, size, offset + 2) do
      {:ok, next_offset} -> {:skip, next_offset}
      {:error, _message} = error -> error
    end
  end

  defp next_significant_scan_step(source, size, offset, previous, byte) do
    cond do
      byte in [?\", ?'] ->
        emit_string_step(source, size, offset, byte)

      byte == ?` ->
        emit_template_step(source, size, offset)

      byte == ?/ and regex_start?(previous) ->
        emit_regex_step(source, size, offset)

      identifier_start?(byte) ->
        emit_identifier_step(source, size, offset)

      digit?(byte) ->
        emit_number_step(source, size, offset)

      true ->
        emit_punctuation_step(source, size, offset)
    end
  end

  defp emit_string_step(source, size, offset, quote) do
    with {:ok, next_offset} <- skip_quoted(source, size, offset + 1, quote) do
      value = binary_part(source, offset + 1, next_offset - offset - 2)
      token = %Token{kind: :string, value: value, start: offset, stop: next_offset}
      {:emit, token, next_offset}
    end
  end

  defp emit_template_step(source, size, offset) do
    with {:ok, next_offset} <- skip_template(source, size, offset + 1) do
      value = binary_part(source, offset, next_offset - offset)
      token = %Token{kind: :template, value: value, start: offset, stop: next_offset}
      {:emit, token, next_offset}
    end
  end

  defp emit_regex_step(source, size, offset) do
    with {:ok, next_offset} <- skip_regex(source, size, offset + 1, false) do
      value = binary_part(source, offset, next_offset - offset)
      token = %Token{kind: :regex, value: value, start: offset, stop: next_offset}
      {:emit, token, next_offset}
    end
  end

  defp emit_punctuation_step(source, size, offset) do
    {value, next_offset} = punctuation(source, size, offset)
    token = %Token{kind: :punctuation, value: value, start: offset, stop: next_offset}
    {:emit, token, next_offset}
  end

  defp emit_identifier_step(source, size, offset) do
    next_offset = identifier_stop(source, size, offset)
    value = binary_part(source, offset, next_offset - offset)
    token = %Token{kind: :identifier, value: value, start: offset, stop: next_offset}
    {:emit, token, next_offset}
  end

  defp identifier_stop(source, size, offset),
    do: take_while(source, size, offset + 1, &identifier_continue?/1)

  defp emit_number_step(source, size, offset) do
    next_offset = number_stop(source, size, offset)
    value = binary_part(source, offset, next_offset - offset)
    token = %Token{kind: :number, value: value, start: offset, stop: next_offset}
    {:emit, token, next_offset}
  end

  defp number_stop(source, size, offset),
    do: take_while(source, size, offset + 1, &number_continue?/1)

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
    case template_expression_step(source, size, offset, depth, regex_allowed) do
      {:continue, next_offset, next_depth, next_regex_allowed} ->
        skip_template_expression(source, size, next_offset, next_depth, next_regex_allowed)

      {:ok, _next_offset} = success ->
        success

      {:error, _message} = error ->
        error
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
        skip_regex_escape(source, size, offset, in_class)

      true ->
        skip_regex_token(source, size, offset, in_class, byte)
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
    case longest_punctuation(source, size, offset, [4, 3, 2]) do
      nil -> {binary_part(source, offset, 1), offset + 1}
      match -> match
    end
  end

  defp template_expression_step(source, size, offset, depth, regex_allowed) do
    byte = :binary.at(source, offset)

    cond do
      whitespace?(byte) ->
        {:continue, offset + 1, depth, regex_allowed}

      starts_with?(source, offset, "//") ->
        {:continue, skip_line(source, size, offset + 2), depth, regex_allowed}

      starts_with?(source, offset, "/*") ->
        continue_template_block_comment(source, size, offset, depth, regex_allowed)

      true ->
        template_expression_token_step(source, size, offset, depth, regex_allowed, byte)
    end
  end

  defp continue_template_block_comment(source, size, offset, depth, regex_allowed) do
    case skip_block_comment(source, size, offset + 2) do
      {:ok, next_offset} -> {:continue, next_offset, depth, regex_allowed}
      {:error, _message} = error -> error
    end
  end

  defp template_expression_token_step(source, size, offset, depth, regex_allowed, byte) do
    cond do
      byte in [?\", ?'] ->
        continue_template_quoted(source, size, offset, depth, byte)

      byte == ?` ->
        continue_nested_template(source, size, offset, depth)

      byte in [?{, ?}] ->
        continue_template_brace(offset, depth, byte)

      byte == ?/ ->
        continue_template_slash(source, size, offset, depth, regex_allowed)

      true ->
        continue_template_literal(source, size, offset, depth, byte)
    end
  end

  defp continue_template_quoted(source, size, offset, depth, quote) do
    with {:ok, next_offset} <- skip_quoted(source, size, offset + 1, quote) do
      {:continue, next_offset, depth, false}
    end
  end

  defp continue_nested_template(source, size, offset, depth) do
    with {:ok, next_offset} <- skip_template(source, size, offset + 1) do
      {:continue, next_offset, depth, false}
    end
  end

  defp continue_template_brace(offset, depth, ?{),
    do: {:continue, offset + 1, depth + 1, true}

  defp continue_template_brace(offset, 1, ?}), do: {:ok, offset + 1}

  defp continue_template_brace(offset, depth, ?}),
    do: {:continue, offset + 1, depth - 1, false}

  defp continue_template_slash(source, size, offset, depth, true) do
    with {:ok, next_offset} <- skip_regex(source, size, offset + 1, false) do
      {:continue, next_offset, depth, false}
    end
  end

  defp continue_template_slash(_source, _size, offset, depth, false),
    do: {:continue, offset + 1, depth, true}

  defp continue_template_literal(source, size, offset, depth, byte) do
    cond do
      identifier_start?(byte) ->
        {:continue, identifier_stop(source, size, offset), depth, false}

      digit?(byte) ->
        {:continue, number_stop(source, size, offset), depth, false}

      byte in [?), ?]] ->
        {:continue, offset + 1, depth, false}

      true ->
        {:continue, offset + 1, depth, true}
    end
  end

  defp skip_regex_escape(source, size, offset, in_class) do
    skip_escape(source, size, offset + 1, fn next_source, next_size, next_offset ->
      skip_regex(next_source, next_size, next_offset, in_class)
    end)
  end

  defp skip_regex_token(source, size, offset, false, ?[),
    do: skip_regex(source, size, offset + 1, true)

  defp skip_regex_token(source, size, offset, true, ?]),
    do: skip_regex(source, size, offset + 1, false)

  defp skip_regex_token(source, size, offset, false, ?/),
    do: {:ok, take_while(source, size, offset + 1, &identifier_continue?/1)}

  defp skip_regex_token(source, size, offset, in_class, _byte),
    do: skip_regex(source, size, offset + 1, in_class)

  defp longest_punctuation(_source, _size, _offset, []), do: nil

  defp longest_punctuation(source, size, offset, [length | rest]) do
    case punctuation_candidate(source, size, offset, length) do
      nil -> longest_punctuation(source, size, offset, rest)
      match -> match
    end
  end

  defp punctuation_candidate(source, size, offset, length) when offset + length <= size do
    candidate = binary_part(source, offset, length)

    if candidate in @multi_char_punctuation do
      {candidate, offset + length}
    end
  end

  defp punctuation_candidate(_source, _size, _offset, _length), do: nil

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
