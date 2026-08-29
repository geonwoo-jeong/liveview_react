defmodule LiveViewReact.Installer.JavaScript.Imports do
  @moduledoc false

  alias LiveViewReact.Installer.JavaScript.Scanner
  alias LiveViewReact.Installer.JavaScript.Scanner.Token
  alias LiveViewReact.Installer.JavaScript.Source

  @spec ensure(binary(), binary(), binary()) :: {:ok, binary()} | {:error, binary()}
  def ensure(source, import_statement, module_specifier) do
    with {:ok, tokens} <- scan_source(source),
         {:ok, module_specifier} <- validate_module_specifier(module_specifier),
         {:ok, requested} <- requested_import(import_statement, module_specifier),
         {:ok, imports} <- static_imports(source, tokens),
         :ok <- import_available?(imports, requested) do
      insert_import(source, tokens, imports, requested)
    end
  end

  defp scan_source(source) do
    with {:ok, tokens} <- Scanner.scan(source),
         {:ok, _pairs} <- Scanner.delimiter_pairs(tokens) do
      {:ok, tokens}
    end
  end

  defp validate_module_specifier(module_specifier) when is_binary(module_specifier) do
    cond do
      module_specifier == "" ->
        {:error, "import module specifier must not be empty"}

      not String.valid?(module_specifier) ->
        {:error, "import module specifier must be valid UTF-8"}

      String.contains?(module_specifier, [<<0>>, "\n", "\r", "\"", "'", "\\"]) ->
        {:error, "import module specifier contains unsupported characters"}

      true ->
        {:ok, module_specifier}
    end
  end

  defp validate_module_specifier(_module_specifier),
    do: {:error, "import module specifier must be a string"}

  defp requested_import(import_statement, module_specifier) when is_binary(import_statement) do
    statement = String.trim(import_statement)

    with :ok <- require_import_statement(statement),
         {:ok, tokens} <- scan_source(statement),
         {:ok, imports} <- static_imports(statement, tokens),
         [requested] <- imports,
         true <-
           requested.start_index == 0 ||
             {:error, "import statement must contain only one static import"},
         true <-
           requested.end_index == length(tokens) - 1 ||
             {:error, "import statement contains unsupported trailing syntax"},
         true <-
           requested.module == module_specifier ||
             {:error, "import statement module does not match #{inspect(module_specifier)}"} do
      {:ok, Map.put(requested, :statement, statement)}
    else
      [] ->
        {:error, "import statement must contain one static import"}

      [_first, _second | _rest] ->
        {:error, "import statement must contain only one static import"}

      {:error, message} ->
        {:error, message}
    end
  end

  defp requested_import(_import_statement, _module_specifier),
    do: {:error, "import statement must be a string"}

  defp require_import_statement(""), do: {:error, "import statement must not be empty"}
  defp require_import_statement(_statement), do: :ok

  defp static_imports(source, tokens) do
    tokens
    |> indexed_top_level_tokens()
    |> Enum.reduce_while({:ok, []}, fn
      {%Token{kind: :identifier, value: "import"}, index}, {:ok, imports} ->
        collect_static_import(source, tokens, index, imports)

      {_token, _index}, accumulator ->
        {:cont, accumulator}
    end)
    |> case do
      {:ok, imports} -> {:ok, Enum.reverse(imports)}
      {:error, message} -> {:error, message}
    end
  end

  defp collect_static_import(source, tokens, index, imports) do
    if dynamic_import?(tokens, index) do
      {:cont, {:ok, imports}}
    else
      case parse_static_import(source, tokens, index) do
        {:ok, parsed} -> {:cont, {:ok, [parsed | imports]}}
        {:error, message} -> {:halt, {:error, message}}
      end
    end
  end

  defp dynamic_import?(tokens, index) do
    case Enum.at(tokens, index + 1) do
      %Token{value: value} when value in ["(", "."] -> true
      _other -> false
    end
  end

  defp parse_static_import(source, tokens, start_index) do
    case Enum.at(tokens, start_index + 1) do
      %Token{kind: :string} = module_token ->
        finish_static_import(source, tokens, start_index, start_index + 1, module_token)

      nil ->
        {:error, "malformed static import at end of source"}

      _binding ->
        parse_bound_import(source, tokens, start_index)
    end
  end

  defp parse_bound_import(source, tokens, start_index) do
    with {:ok, from_index} <- find_import_from(tokens, start_index + 1),
         %Token{kind: :string} = module_token <- Enum.at(tokens, from_index + 1) do
      finish_static_import(source, tokens, start_index, from_index + 1, module_token)
    else
      {:error, message} -> {:error, message}
      _other -> {:error, "static import from must be followed by a string module specifier"}
    end
  end

  defp find_import_from(tokens, index) do
    tokens
    |> Enum.drop(index)
    |> Enum.with_index(index)
    |> Enum.reduce_while([], &import_from_step/2)
    |> case do
      {:ok, from_index} -> {:ok, from_index}
      {:error, message} -> {:error, message}
      _stack -> {:error, "static import is missing a from clause"}
    end
  end

  defp import_from_step({%Token{value: opening}, _index}, stack)
       when opening in ["(", "[", "{"],
       do: {:cont, [opening | stack]}

  defp import_from_step({%Token{value: closing}, _index}, [_opening | rest])
       when closing in [")", "]", "}"],
       do: {:cont, rest}

  defp import_from_step({%Token{value: ";"}, _index}, []),
    do: {:halt, {:error, "static import is missing a from clause"}}

  defp import_from_step({%Token{kind: :identifier, value: "from"}, index}, []),
    do: {:halt, {:ok, index}}

  defp import_from_step({%Token{kind: :identifier, value: "import"}, _index}, []),
    do: {:halt, {:error, "static import is missing a from clause"}}

  defp import_from_step({_token, _index}, stack), do: {:cont, stack}

  defp finish_static_import(source, tokens, start_index, module_index, module_token) do
    with :ok <- validate_import_literal(module_token),
         {:ok, end_index} <- import_end_index(source, tokens, module_index) do
      normalized = tokens |> Enum.slice(start_index..module_index) |> Scanner.normalize()

      {:ok,
       %{
         start_index: start_index,
         end_index: end_index,
         module: module_token.value,
         normalized: normalized
       }}
    end
  end

  defp validate_import_literal(%Token{value: value}) do
    if String.contains?(value, "\\"),
      do: {:error, "escaped static import module specifiers are unsupported"},
      else: :ok
  end

  defp import_end_index(source, tokens, module_index) do
    module_token = Enum.at(tokens, module_index)

    case Enum.at(tokens, module_index + 1) do
      %Token{value: ";"} ->
        {:ok, module_index + 1}

      %Token{kind: :identifier, value: value} when value in ["with", "assert"] ->
        {:error, "static import attributes are unsupported"}

      %Token{} = next_token ->
        between = binary_part(source, module_token.stop, next_token.start - module_token.stop)

        if String.contains?(between, ["\n", "\r"]),
          do: {:ok, module_index},
          else: {:error, "static import contains unsupported trailing syntax"}

      nil ->
        {:ok, module_index}
    end
  end

  defp import_available?(imports, requested) do
    case Enum.filter(imports, &(&1.module == requested.module)) do
      [] ->
        :ok

      [%{normalized: normalized}] when normalized == requested.normalized ->
        :ok

      [_one] ->
        {:error,
         "module #{inspect(requested.module)} is already imported with a different binding"}

      _many ->
        {:error, "module #{inspect(requested.module)} has multiple static imports"}
    end
  end

  defp insert_import(source, tokens, imports, requested) do
    if same_import?(imports, requested) do
      {:ok, source}
    else
      offset = leading_import_offset(source, tokens, imports)
      before = binary_part(source, 0, offset)
      suffix = binary_part(source, offset, byte_size(source) - offset)
      newline = Source.line_break(source)
      separator = if before == "" or Source.ends_in_whitespace?(before), do: "", else: newline
      terminator = if starts_with_line_break?(suffix), do: "", else: newline
      insertion = separator <> requested.statement <> terminator
      {:ok, Source.replace(source, offset, offset, insertion)}
    end
  end

  defp same_import?(imports, requested) do
    Enum.any?(imports, fn import ->
      import.module == requested.module and import.normalized == requested.normalized
    end)
  end

  defp leading_import_offset(source, [], _imports), do: byte_size(source)

  defp leading_import_offset(_source, tokens, imports) do
    imports_by_start = Map.new(imports, &{&1.start_index, &1})
    consume_leading_imports(tokens, imports_by_start, 0)
  end

  defp consume_leading_imports(tokens, imports, index) do
    case Map.get(imports, index) do
      nil ->
        Enum.at(tokens, index).start

      import when import.end_index + 1 >= length(tokens) ->
        Enum.at(tokens, import.end_index).stop

      import ->
        next_index = import.end_index + 1

        if Map.has_key?(imports, next_index),
          do: consume_leading_imports(tokens, imports, next_index),
          else: Enum.at(tokens, import.end_index).stop
    end
  end

  defp indexed_top_level_tokens(tokens) do
    {top_level, _stack} =
      tokens
      |> Enum.with_index()
      |> Enum.reduce({[], []}, fn {token, index}, {top_level, stack} ->
        top_level = if stack == [], do: [{token, index} | top_level], else: top_level

        stack =
          cond do
            token.value in ["(", "[", "{"] -> [token.value | stack]
            token.value in [")", "]", "}"] -> tl(stack)
            true -> stack
          end

        {top_level, stack}
      end)

    Enum.reverse(top_level)
  end

  defp starts_with_line_break?(source),
    do: String.starts_with?(source, ["\r\n", "\n", "\r"])
end
