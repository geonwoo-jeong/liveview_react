defmodule LiveViewReact.Installer.JSONC do
  @moduledoc false

  @type json_node :: map()

  @spec parse(String.t()) :: {:ok, json_node()} | {:error, String.t()}
  def parse(source) when is_binary(source) do
    with {:ok, tokens} <- tokenize(source, 0, []),
         {:ok, node, []} <- parse_value(tokens) do
      {:ok, node}
    else
      {:ok, _node, _remaining} -> {:error, "JSONC has trailing tokens"}
      {:error, _message} = error -> error
    end
  end

  @spec fetch(json_node(), [String.t()]) :: {:ok, json_node()} | :error | {:error, String.t()}
  def fetch(node, []), do: {:ok, node}

  def fetch(%{kind: :object, properties: properties}, [key | rest]) do
    case Enum.filter(properties, &(&1.key == key)) do
      [] -> :error
      [%{value: value}] -> fetch(value, rest)
      _duplicates -> {:error, "JSONC contains duplicate #{inspect(key)} properties"}
    end
  end

  def fetch(_node, _path), do: :error

  @spec term(json_node()) :: term()
  def term(%{kind: :object, properties: properties}) do
    Map.new(properties, &{&1.key, term(&1.value)})
  end

  def term(%{kind: :array, items: items}), do: Enum.map(items, &term/1)
  def term(%{kind: :scalar, value: value}), do: value

  @spec replace(String.t(), json_node(), String.t()) :: String.t()
  def replace(source, node, replacement) do
    binary_part(source, 0, node.start) <>
      replacement <>
      binary_part(source, node.stop, byte_size(source) - node.stop)
  end

  @spec remove_property(String.t(), json_node(), String.t()) ::
          {:ok, String.t()} | {:error, String.t()}
  def remove_property(source, %{kind: :object, properties: properties} = object, key)
      when is_binary(source) and is_binary(key) do
    matches =
      Enum.with_index(properties) |> Enum.filter(fn {property, _index} -> property.key == key end)

    case matches do
      [] ->
        {:ok, source}

      [{property, index}] ->
        with {:ok, tokens} <- tokenize(source, 0, []),
             {:ok, separator} <- property_separator(tokens, object, properties, property, index),
             updated <- remove_property_ranges(source, property, separator),
             {:ok, _root} <- parse(updated) do
          {:ok, updated}
        end

      _duplicates ->
        {:error, "JSONC contains duplicate #{inspect(key)} properties"}
    end
  end

  def remove_property(_source, _node, _key),
    do: {:error, "JSONC target is not an object"}

  @spec insert_property(String.t(), json_node(), String.t(), String.t()) ::
          {:ok, String.t()} | {:error, String.t()}
  def insert_property(source, %{kind: :object} = object, key, encoded_value) do
    with {:ok, source} <- ensure_object_separator(source, object),
         {:ok, refreshed} <- parse(source),
         {:ok, refreshed_object} <- refetch_object(refreshed, object.path) do
      {position, prefix, suffix} = insertion_layout(source, refreshed_object)
      indent = closing_indent(source, refreshed_object.close_start) <> "  "
      property = indent <> Jason.encode!(key) <> ": " <> encoded_value
      {:ok, insert(source, position, prefix <> property <> suffix)}
    end
  end

  def insert_property(_source, _node, _key, _value),
    do: {:error, "JSONC target is not an object"}

  @spec append_array_string(String.t(), json_node(), String.t()) ::
          {:ok, String.t()} | {:error, String.t()}
  def append_array_string(source, %{kind: :array} = array, value) do
    with {:ok, source} <- ensure_array_separator(source, array),
         {:ok, refreshed} <- parse(source),
         {:ok, refreshed_array} <- refetch_array(refreshed, array.path) do
      {position, prefix, suffix} = insertion_layout(source, refreshed_array)
      indent = closing_indent(source, refreshed_array.close_start) <> "  "
      {:ok, insert(source, position, prefix <> indent <> Jason.encode!(value) <> suffix)}
    end
  end

  def append_array_string(_source, _node, _value),
    do: {:error, "JSONC target is not an array"}

  defp refetch_object(root, path) do
    case fetch(root, path) do
      {:ok, %{kind: :object} = object} -> {:ok, object}
      _ -> {:error, "JSONC object changed while it was being updated"}
    end
  end

  defp refetch_array(root, path) do
    case fetch(root, path) do
      {:ok, %{kind: :array} = array} -> {:ok, array}
      _ -> {:error, "JSONC array changed while it was being updated"}
    end
  end

  defp ensure_object_separator(source, %{properties: []}), do: {:ok, source}

  defp ensure_object_separator(source, %{trailing_comma?: true}), do: {:ok, source}

  defp ensure_object_separator(source, %{properties: properties}) do
    last = List.last(properties).value
    {:ok, insert(source, last.stop, ",")}
  end

  defp ensure_array_separator(source, %{items: []}), do: {:ok, source}
  defp ensure_array_separator(source, %{trailing_comma?: true}), do: {:ok, source}

  defp ensure_array_separator(source, %{items: items}) do
    {:ok, insert(source, List.last(items).stop, ",")}
  end

  defp property_separator(tokens, object, properties, property, index) do
    next_boundary =
      case Enum.at(properties, index + 1) do
        nil -> object.close_start
        next -> next.key_start
      end

    case commas_between(tokens, property.value.stop, next_boundary) do
      [separator] ->
        {:ok, separator}

      [] when length(properties) == 1 ->
        {:ok, nil}

      [] when index > 0 ->
        previous = Enum.at(properties, index - 1)

        case commas_between(tokens, previous.value.stop, property.key_start) do
          [separator] -> {:ok, separator}
          _ -> {:error, "JSONC could not identify the separator for #{inspect(property.key)}"}
        end

      _ ->
        {:error, "JSONC could not identify the separator for #{inspect(property.key)}"}
    end
  end

  defp commas_between(tokens, lower_bound, upper_bound) do
    Enum.filter(tokens, fn
      {:punct, ?,, start, stop} -> start >= lower_bound and stop <= upper_bound
      _token -> false
    end)
  end

  defp remove_property_ranges(source, property, nil) do
    remove_ranges(source, [{property.key_start, property.value.stop}])
  end

  defp remove_property_ranges(source, property, {:punct, ?,, start, stop}) do
    remove_ranges(source, [{property.key_start, property.value.stop}, {start, stop}])
  end

  defp remove_ranges(source, ranges) do
    ranges
    |> Enum.sort_by(&elem(&1, 0), :desc)
    |> Enum.reduce(source, fn {start, stop}, source ->
      binary_part(source, 0, start) <>
        binary_part(source, stop, byte_size(source) - stop)
    end)
  end

  defp insertion_layout(source, %{close_start: close_start}) do
    line_start = line_start(source, close_start)
    before_close = binary_part(source, line_start, close_start - line_start)

    if String.trim(before_close) == "" do
      {line_start, "", "\n"}
    else
      {close_start, "\n", "\n" <> closing_indent(source, close_start)}
    end
  end

  defp closing_indent(source, close_start) do
    start = line_start(source, close_start)
    line_prefix = binary_part(source, start, close_start - start)
    [indent] = Regex.run(~r/^[ \t]*/, line_prefix)
    indent
  end

  defp line_start(source, position) do
    prefix = binary_part(source, 0, position)

    case :binary.matches(prefix, "\n") do
      [] -> 0
      matches -> matches |> List.last() |> elem(0) |> Kernel.+(1)
    end
  end

  defp insert(source, position, value) do
    binary_part(source, 0, position) <>
      value <>
      binary_part(source, position, byte_size(source) - position)
  end

  defp tokenize(source, position, acc) when position >= byte_size(source),
    do: {:ok, Enum.reverse(acc)}

  defp tokenize(source, position, acc) do
    byte = :binary.at(source, position)

    cond do
      whitespace?(byte) ->
        tokenize(source, position + 1, acc)

      byte == ?/ and next_byte(source, position) == ?/ ->
        tokenize(source, skip_line_comment(source, position + 2), acc)

      byte == ?/ and next_byte(source, position) == ?* ->
        case skip_block_comment(source, position + 2) do
          {:ok, next} -> tokenize(source, next, acc)
          :error -> {:error, "JSONC contains an unterminated block comment"}
        end

      byte == ?" ->
        with {:ok, stop} <- scan_string(source, position + 1),
             raw = binary_part(source, position, stop - position),
             {:ok, value} <- Jason.decode(raw) do
          tokenize(source, stop, [{:string, value, position, stop} | acc])
        else
          _ -> {:error, "JSONC contains an invalid string at byte #{position}"}
        end

      byte in [?{, ?}, ?[, ?], ?:, ?,] ->
        tokenize(source, position + 1, [{:punct, byte, position, position + 1} | acc])

      true ->
        stop = scan_literal(source, position)
        raw = binary_part(source, position, stop - position)

        case Jason.decode(raw) do
          {:ok, value} ->
            tokenize(source, stop, [{:literal, value, position, stop} | acc])

          _ ->
            {:error, "JSONC contains an invalid value at byte #{position}"}
        end
    end
  end

  defp parse_value([{:punct, ?{, start, _stop} | rest]), do: parse_object(rest, start, [], false)
  defp parse_value([{:punct, ?[, start, _stop} | rest]), do: parse_array(rest, start, [], false)

  defp parse_value([{kind, value, start, stop} | rest]) when kind in [:string, :literal] do
    {:ok, %{kind: :scalar, start: start, stop: stop, value: value, path: []}, rest}
  end

  defp parse_value(_tokens), do: {:error, "JSONC contains an incomplete value"}

  defp parse_object([{:punct, ?}, close, stop} | rest], start, properties, trailing?) do
    properties = Enum.reverse(properties)

    {:ok,
     %{
       kind: :object,
       start: start,
       close_start: close,
       stop: stop,
       properties: properties,
       trailing_comma?: trailing?,
       path: []
     }
     |> assign_paths([]), rest}
  end

  defp parse_object(
         [{:string, key, key_start, _key_stop}, {:punct, ?:, _colon, _colon_stop} | rest],
         start,
         properties,
         _trailing?
       ) do
    with {:ok, value, rest} <- parse_value(rest) do
      property = %{key: key, key_start: key_start, value: value}

      case rest do
        [{:punct, ?,, _comma, _comma_stop} | rest] ->
          parse_object(rest, start, [property | properties], true)

        [{:punct, ?}, _close, _stop} | _rest] ->
          parse_object(rest, start, [property | properties], false)

        _ ->
          {:error, "JSONC object properties must be separated by commas"}
      end
    end
  end

  defp parse_object(_tokens, _start, _properties, _trailing?),
    do: {:error, "JSONC contains an invalid object"}

  defp parse_array([{:punct, ?], close, stop} | rest], start, items, trailing?) do
    items = Enum.reverse(items)

    {:ok,
     %{
       kind: :array,
       start: start,
       close_start: close,
       stop: stop,
       items: items,
       trailing_comma?: trailing?,
       path: []
     }, rest}
  end

  defp parse_array(tokens, start, items, _trailing?) do
    with {:ok, value, rest} <- parse_value(tokens) do
      case rest do
        [{:punct, ?,, _comma, _comma_stop} | rest] ->
          parse_array(rest, start, [value | items], true)

        [{:punct, ?], _close, _stop} | _rest] ->
          parse_array(rest, start, [value | items], false)

        _ ->
          {:error, "JSONC array items must be separated by commas"}
      end
    end
  end

  defp assign_paths(%{kind: :object, properties: properties} = node, path) do
    properties =
      Enum.map(properties, fn property ->
        value = assign_paths(property.value, path ++ [property.key])
        %{property | value: value}
      end)

    %{node | properties: properties, path: path}
  end

  defp assign_paths(%{kind: :array, items: items} = node, path) do
    %{node | items: Enum.map(items, &assign_paths(&1, path)), path: path}
  end

  defp assign_paths(node, path), do: Map.put(node, :path, path)

  defp scan_string(source, position) when position >= byte_size(source), do: :error

  defp scan_string(source, position) do
    case :binary.at(source, position) do
      ?" -> {:ok, position + 1}
      ?\\ -> scan_string(source, position + 2)
      _byte -> scan_string(source, position + 1)
    end
  end

  defp scan_literal(source, position) when position >= byte_size(source), do: position

  defp scan_literal(source, position) do
    byte = :binary.at(source, position)

    if whitespace?(byte) or byte in [?{, ?}, ?[, ?], ?:, ?,] or
         (byte == ?/ and next_byte(source, position) in [?/, ?*]) do
      position
    else
      scan_literal(source, position + 1)
    end
  end

  defp skip_line_comment(source, position) when position >= byte_size(source), do: position

  defp skip_line_comment(source, position) do
    if :binary.at(source, position) in [?\n, ?\r],
      do: position,
      else: skip_line_comment(source, position + 1)
  end

  defp skip_block_comment(source, position) when position >= byte_size(source), do: :error

  defp skip_block_comment(source, position) do
    if :binary.at(source, position) == ?* and next_byte(source, position) == ?/ do
      {:ok, position + 2}
    else
      skip_block_comment(source, position + 1)
    end
  end

  defp next_byte(source, position) when position + 1 < byte_size(source),
    do: :binary.at(source, position + 1)

  defp next_byte(_source, _position), do: nil

  defp whitespace?(byte), do: byte in [?\s, ?\t, ?\n, ?\r]
end
