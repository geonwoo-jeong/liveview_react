defmodule LiveViewReact.Installer.JavaScript do
  @moduledoc false

  alias LiveViewReact.Installer.JavaScript.Imports
  alias LiveViewReact.Installer.JavaScript.Scanner
  alias LiveViewReact.Installer.JavaScript.Scanner.Token
  alias LiveViewReact.Installer.JavaScript.Source

  @type update_result :: {:ok, binary()} | {:error, binary()}

  @reserved_expressions ~w(__proto__ constructor prototype)

  @doc """
  Adds one exact static import after the source's leading import/header region.

  Whitespace, comments, quote style, and a trailing semicolon do not affect
  import equality. An existing import from the same module with a different
  binding is a conflict rather than an idempotent success.
  """
  @spec ensure_import(binary(), binary(), binary()) :: update_result()
  def ensure_import(source, import_statement, module_specifier),
    do: Imports.ensure(source, import_statement, module_specifier)

  @doc """
  Merges a hook object expression into the only `new LiveSocket(...)` call.

  The call must pass a direct object literal as its third and final argument.
  Existing literal hooks are extended in place. A general hooks expression is
  retained and wrapped in a new object before the requested spread is added.
  """
  @spec merge_live_socket_hooks(binary(), binary()) :: update_result()
  def merge_live_socket_hooks(source, hook_expression) do
    with :ok <- validate_source(source),
         {:ok, hook} <- validate_expression(hook_expression, "hook expression"),
         {:ok, tokens, pairs} <- scan_source(source),
         {:ok, call} <- only_live_socket_call(tokens, pairs),
         {:ok, options} <- live_socket_options(call) do
      merge_hooks_property(source, options, hook)
    end
  end

  @doc """
  Ensures an import and inserts one expression into the only Vite plugins array.

  The update is atomic from the caller's perspective: any import conflict,
  malformed source, non-array `plugins` value, or ambiguous property returns an
  error without a partially updated source.
  """
  @spec ensure_vite_plugin(binary(), binary(), binary(), binary()) :: update_result()
  def ensure_vite_plugin(source, import_statement, module_specifier, plugin_expression) do
    with :ok <- validate_source(source),
         {:ok, plugin} <- validate_expression(plugin_expression, "Vite plugin expression"),
         {:ok, imported_source} <- ensure_import(source, import_statement, module_specifier),
         {:ok, tokens, pairs} <- scan_source(imported_source),
         {:ok, plugins} <- only_plugins_array(tokens, pairs) do
      merge_plugin(imported_source, plugins, plugin)
    end
  end

  @doc """
  Returns whether the only Vite plugins array contains a call to one callee.

  This is a fail-closed inspection helper for installer preflight checks. It
  only reports success when the source parses cleanly and exposes exactly one
  direct `plugins: [...]` property.
  """
  @spec vite_plugin_present?(binary(), binary()) :: {:ok, boolean()} | {:error, binary()}
  def vite_plugin_present?(source, plugin_callee) do
    with :ok <- validate_source(source),
         {:ok, callee} <- validate_expression(plugin_callee, "Vite plugin callee"),
         {:ok, tokens, pairs} <- scan_source(source),
         {:ok, plugins} <- only_plugins_array(tokens, pairs) do
      {:ok, plugins_array_includes_callee?(plugins.tokens, callee.normalized)}
    end
  end

  @doc """
  Ensures the exported Vite config deduplicates React and ReactDOM.

  Only a direct config object (`export default {...}` or
  `export default defineConfig({...})`) is updated. Existing `resolve` and
  `dedupe` values must likewise be direct object and array literals so the
  installer never guesses how a dynamic configuration behaves.
  """
  @spec ensure_vite_react_dedupe(binary()) :: update_result()
  def ensure_vite_react_dedupe(source) do
    with :ok <- validate_source(source),
         {:ok, tokens, pairs} <- scan_source(source),
         {:ok, config} <- only_vite_config_object(tokens, pairs),
         {:ok, missing} <- missing_react_dedupe_members(config.tokens) do
      ensure_missing_react_dedupe_members(source, missing)
    end
  end

  defp validate_source(source) when is_binary(source) do
    cond do
      not String.valid?(source) ->
        {:error, "JavaScript source must be valid UTF-8"}

      :binary.match(source, <<0>>) != :nomatch ->
        {:error, "JavaScript source must not contain NUL bytes"}

      true ->
        :ok
    end
  end

  defp validate_source(_source), do: {:error, "JavaScript source must be a string"}

  defp validate_expression(expression, label) when is_binary(expression) do
    expression = String.trim(expression)

    with :ok <- require_nonempty(expression, "#{label} must not be empty"),
         :ok <- reject_expression_comments(expression, label),
         {:ok, tokens, _pairs} <- scan_source(expression),
         :ok <- require_tokens(tokens, label),
         :ok <- reject_expression_separators(tokens, label),
         :ok <- reject_reserved_expression(tokens, label) do
      {:ok, %{source: expression, tokens: tokens, normalized: Scanner.normalize(tokens)}}
    end
  end

  defp validate_expression(_expression, label), do: {:error, "#{label} must be a string"}

  defp reject_expression_comments(expression, label) do
    if String.contains?(expression, ["//", "/*"]),
      do: {:error, "#{label} must not contain comments"},
      else: :ok
  end

  defp reject_expression_separators(tokens, label) do
    with {:ok, parts} <- Scanner.split_top_level(tokens) do
      cond do
        length(parts) != 1 ->
          {:error, "#{label} must be one expression"}

        Enum.any?(tokens_at_top_level(tokens), &(&1.value == ";")) ->
          {:error, "#{label} must not contain a top-level semicolon"}

        true ->
          :ok
      end
    end
  end

  defp reserved_expression?([%Token{kind: :identifier, value: value}]),
    do: value in @reserved_expressions

  defp reserved_expression?(_tokens), do: false

  defp reject_reserved_expression(tokens, label) do
    if reserved_expression?(tokens),
      do: {:error, "#{label} uses a reserved prototype name"},
      else: :ok
  end

  defp require_nonempty("", message), do: {:error, message}
  defp require_nonempty(_value, _message), do: :ok

  defp require_tokens([], label),
    do: {:error, "#{label} must contain an executable expression"}

  defp require_tokens(_tokens, _label), do: :ok

  defp scan_source(source) do
    with {:ok, tokens} <- Scanner.scan(source),
         {:ok, pairs} <- Scanner.delimiter_pairs(tokens) do
      {:ok, tokens, pairs}
    end
  end

  defp only_live_socket_call(tokens, pairs) do
    calls =
      tokens
      |> Enum.with_index()
      |> Enum.reduce([], &collect_live_socket_call(&1, &2, tokens, pairs))

    case calls do
      [call] ->
        {:ok, call}

      [] ->
        {:error, "expected exactly one executable new LiveSocket(...) call, found none"}

      _many ->
        {:error, "expected exactly one executable new LiveSocket(...) call, found multiple"}
    end
  end

  defp live_socket_options(%{tokens: call_tokens}) do
    with {:ok, raw_arguments} <- Scanner.split_top_level(call_tokens),
         arguments <- logical_parts(raw_arguments),
         3 <- length(arguments),
         options when options != [] <- Enum.at(arguments, 2),
         %Token{value: "{"} = open <- List.first(options),
         %Token{value: "}"} = close <- List.last(options) do
      {:ok, %{open: open, close: close, tokens: Enum.slice(options, 1, length(options) - 2)}}
    else
      count when is_integer(count) ->
        {:error, "new LiveSocket(...) must have exactly three arguments, found #{count}"}

      [] ->
        {:error, "new LiveSocket(...) options argument must not be empty"}

      %Token{} ->
        {:error, "new LiveSocket(...) third argument must be a direct object literal"}

      {:error, message} ->
        {:error, message}

      _other ->
        {:error, "new LiveSocket(...) third argument must be a direct object literal"}
    end
  end

  defp merge_hooks_property(source, options, hook) do
    with {:ok, properties} <- named_properties(options.tokens, "hooks") do
      case properties do
        [] ->
          {:ok,
           Source.insert_collection_member(
             source,
             options.open,
             options.close,
             options.tokens,
             "hooks: { ...#{hook.source} }"
           )}

        [property] ->
          merge_existing_hooks(source, property, hook)

        _many ->
          {:error, "LiveSocket options contain multiple hooks properties"}
      end
    end
  end

  defp named_properties(tokens, property_name) do
    with {:ok, members} <- Scanner.split_top_level(tokens) do
      members
      |> Enum.reject(&(&1 == []))
      |> collect_named_properties(property_name)
    end
  end

  defp parse_named_property([key, %Token{value: ":"} | value], property_name) do
    if property_key?(key, property_name), do: property_result(value, property_name), else: :other
  end

  defp parse_named_property(
         [
           %Token{value: "["},
           %Token{kind: :string} = key,
           %Token{value: "]"},
           %Token{value: ":"} | value
         ],
         property_name
       ) do
    if property_key?(key, property_name), do: property_result(value, property_name), else: :other
  end

  defp parse_named_property([key | _rest], property_name) do
    if property_key?(key, property_name) do
      {:error, "#{property_name} must use an explicit property value"}
    else
      :other
    end
  end

  defp parse_named_property([], _property_name), do: :other

  defp property_result([], property_name),
    do: {:error, "#{property_name} property must have a value"}

  defp property_result(value, _property_name), do: {:ok, %{value: value}}

  defp property_key?(%Token{kind: kind, value: value}, property_name)
       when kind in [:identifier, :string],
       do: value == property_name and not String.contains?(value, "\\")

  defp property_key?(_token, _property_name), do: false

  defp merge_existing_hooks(source, %{value: value}, hook) do
    cond do
      Scanner.normalize(value) == hook.normalized ->
        {:ok, source}

      object_literal?(value) ->
        merge_hooks_object(source, value, hook)

      true ->
        first = List.first(value)
        last = List.last(value)
        existing = binary_part(source, first.start, last.stop - first.start)
        replacement = "{ ...(#{existing}), ...#{hook.source} }"
        {:ok, Source.replace(source, first.start, last.stop, replacement)}
    end
  end

  defp object_literal?([%Token{value: "{"} | _rest] = tokens),
    do: List.last(tokens).value == "}"

  defp object_literal?(_tokens), do: false

  defp merge_hooks_object(source, value, hook) do
    open = List.first(value)
    close = List.last(value)
    members = Enum.slice(value, 1, length(value) - 2)

    with {:ok, parts} <- Scanner.split_top_level(members) do
      spread_count = Enum.count(parts, &spread_matches?(&1, hook.normalized))

      case spread_count do
        0 ->
          {:ok,
           Source.insert_collection_member(source, open, close, members, "...#{hook.source}")}

        1 ->
          {:ok, source}

        _many ->
          {:error, "hooks object contains the requested spread multiple times"}
      end
    end
  end

  defp spread_matches?([%Token{value: "..."} | expression], normalized),
    do: Scanner.normalize(expression) == normalized

  defp spread_matches?(_member, _normalized), do: false

  defp only_plugins_array(tokens, pairs) do
    properties = plugins_properties(tokens)

    case properties do
      [] ->
        {:error, "expected exactly one plugins property, found none"}

      [_first, _second | _rest] ->
        {:error, "expected exactly one plugins property, found multiple"}

      [%{value_index: value_index}] ->
        case Enum.at(tokens, value_index) do
          %Token{value: "["} = open ->
            close_index = Map.fetch!(pairs, value_index)
            close = Enum.at(tokens, close_index)
            inner = Enum.slice(tokens, value_index + 1, max(close_index - value_index - 1, 0))
            {:ok, %{open: open, close: close, tokens: inner}}

          _other ->
            {:error, "Vite plugins property must be a direct array literal"}
        end
    end
  end

  defp only_vite_config_object(tokens, pairs) do
    configs =
      tokens
      |> Enum.with_index()
      |> Enum.reduce([], &collect_vite_config_object(&1, &2, tokens, pairs))
      |> Enum.reverse()

    case configs do
      [config] -> {:ok, config}
      [] -> {:error, "expected exactly one direct exported Vite config object, found none"}
      _many -> {:error, "expected exactly one direct exported Vite config object, found multiple"}
    end
  end

  defp collect_vite_config_object(
         {%Token{kind: :identifier, value: "export"}, index},
         configs,
         tokens,
         pairs
       ) do
    case vite_config_object_at(tokens, pairs, index) do
      {:ok, config} -> [config | configs]
      :error -> configs
    end
  end

  defp collect_vite_config_object({_token, _index}, configs, _tokens, _pairs), do: configs

  defp vite_config_object_at(tokens, pairs, index) do
    case {Enum.at(tokens, index + 1), Enum.at(tokens, index + 2)} do
      {%Token{kind: :identifier, value: "default"}, %Token{value: "{"}} ->
        direct_object(tokens, pairs, index + 2)

      {%Token{kind: :identifier, value: "default"},
       %Token{kind: :identifier, value: "defineConfig"}} ->
        define_config_object(tokens, pairs, index + 3)

      _other ->
        :error
    end
  end

  defp define_config_object(tokens, pairs, call_open_index) do
    with %Token{value: "("} <- Enum.at(tokens, call_open_index),
         %Token{value: "{"} <- Enum.at(tokens, call_open_index + 1),
         {:ok, call_close_index} <- Map.fetch(pairs, call_open_index),
         {:ok, object_close_index} <- Map.fetch(pairs, call_open_index + 1),
         true <- object_close_index + 1 == call_close_index do
      direct_object(tokens, pairs, call_open_index + 1)
    else
      _other -> :error
    end
  end

  defp direct_object(tokens, pairs, open_index) do
    with %Token{value: "{"} = open <- Enum.at(tokens, open_index),
         {:ok, close_index} <- Map.fetch(pairs, open_index),
         %Token{value: "}"} = close <- Enum.at(tokens, close_index) do
      inner = Enum.slice(tokens, open_index + 1, max(close_index - open_index - 1, 0))
      {:ok, %{open: open, close: close, tokens: inner}}
    else
      _other -> :error
    end
  end

  defp missing_react_dedupe_members(config_tokens) do
    with :ok <- reject_object_spreads(config_tokens, "Vite config"),
         {:ok, resolve_properties} <- named_properties(config_tokens, "resolve") do
      case resolve_properties do
        [] ->
          {:ok, :resolve}

        [%{value: value}] ->
          missing_react_dedupe_members_from_resolve(value)

        _many ->
          {:error, "Vite config contains multiple resolve properties"}
      end
    end
  end

  defp missing_react_dedupe_members_from_resolve(value) do
    with {:ok, resolve_members} <- resolve_members(value),
         :ok <- reject_object_spreads(resolve_members, "Vite resolve config"),
         {:ok, dedupe_properties} <- named_properties(resolve_members, "dedupe") do
      case dedupe_properties do
        [] -> {:ok, :dedupe}
        [%{value: value}] -> missing_react_dedupe_array_members(value)
        _many -> {:error, "Vite resolve config contains multiple dedupe properties"}
      end
    end
  end

  defp missing_react_dedupe_array_members(value) do
    case value do
      [%Token{value: "["} | _rest] ->
        if List.last(value).value == "]" do
          value
          |> Enum.slice(1, length(value) - 2)
          |> validate_react_dedupe_elements()
        else
          {:error, "Vite resolve.dedupe property must be a direct array literal"}
        end

      _other ->
        {:error, "Vite resolve.dedupe property must be a direct array literal"}
    end
  end

  defp validate_react_dedupe_elements(tokens) do
    with {:ok, raw_elements} <- Scanner.split_top_level(tokens),
         elements <- Enum.reject(raw_elements, &(&1 == [])),
         :ok <- require_literal_dedupe_elements(elements),
         :ok <- reject_duplicate_react_dedupe_members(elements) do
      existing = MapSet.new(elements, fn [%Token{value: value}] -> value end)
      {:ok, Enum.reject(["react", "react-dom"], &MapSet.member?(existing, &1))}
    end
  end

  defp require_literal_dedupe_elements(elements) do
    if Enum.all?(elements, &literal_dedupe_element?/1),
      do: :ok,
      else: {:error, "Vite resolve.dedupe must contain only unescaped string literals"}
  end

  defp literal_dedupe_element?([%Token{kind: :string, value: value}]),
    do: not String.contains?(value, "\\")

  defp literal_dedupe_element?(_element), do: false

  defp reject_object_spreads(tokens, label) do
    with {:ok, members} <- Scanner.split_top_level(tokens) do
      if Enum.any?(members, &spread_member?/1),
        do: {:error, "#{label} must not contain spread properties"},
        else: :ok
    end
  end

  defp spread_member?([%Token{value: "..."} | _expression]), do: true
  defp spread_member?(_member), do: false

  defp reject_duplicate_react_dedupe_members(elements) do
    values = Enum.map(elements, fn [%Token{value: value}] -> value end)

    case Enum.find(["react", "react-dom"], &(Enum.count(values, fn value -> value == &1 end) > 1)) do
      nil -> :ok
      duplicate -> {:error, "Vite resolve.dedupe contains #{inspect(duplicate)} multiple times"}
    end
  end

  defp ensure_missing_react_dedupe_members(source, :resolve) do
    with {:ok, config} <- vite_config_object(source) do
      {:ok,
       Source.insert_collection_member(
         source,
         config.open,
         config.close,
         config.tokens,
         ~s(resolve: { dedupe: ["react", "react-dom"] })
       )}
    end
  end

  defp ensure_missing_react_dedupe_members(source, :dedupe) do
    with {:ok, resolve} <- vite_resolve_object(source) do
      {:ok,
       Source.insert_collection_member(
         source,
         resolve.open,
         resolve.close,
         resolve.tokens,
         ~s(dedupe: ["react", "react-dom"])
       )}
    end
  end

  defp ensure_missing_react_dedupe_members(source, missing) when is_list(missing) do
    Enum.reduce_while(missing, {:ok, source}, fn member, {:ok, current} ->
      case insert_react_dedupe_member(current, member) do
        {:ok, updated} -> {:cont, {:ok, updated}}
        {:error, _message} = error -> {:halt, error}
      end
    end)
  end

  defp insert_react_dedupe_member(source, member) do
    with {:ok, dedupe} <- vite_dedupe_array(source) do
      {:ok,
       Source.insert_collection_member(
         source,
         dedupe.open,
         dedupe.close,
         dedupe.tokens,
         inspect(member)
       )}
    end
  end

  defp vite_config_object(source) do
    case scan_source(source) do
      {:ok, tokens, pairs} -> only_vite_config_object(tokens, pairs)
      {:error, _message} = error -> error
    end
  end

  defp vite_resolve_object(source) do
    with {:ok, config} <- vite_config_object(source),
         {:ok, [%{value: value}]} <- named_properties(config.tokens, "resolve") do
      object_from_value(value, "Vite resolve property must be a direct object literal")
    else
      {:ok, _properties} -> {:error, "expected exactly one Vite resolve property"}
      {:error, _message} = error -> error
    end
  end

  defp vite_dedupe_array(source) do
    with {:ok, resolve} <- vite_resolve_object(source),
         {:ok, [%{value: value}]} <- named_properties(resolve.tokens, "dedupe") do
      array_from_value(value, "Vite resolve.dedupe property must be a direct array literal")
    else
      {:ok, _properties} -> {:error, "expected exactly one Vite resolve.dedupe property"}
      {:error, _message} = error -> error
    end
  end

  defp object_from_value(value, message) do
    if object_literal?(value) do
      open = List.first(value)
      close = List.last(value)
      inner = Enum.slice(value, 1, length(value) - 2)
      {:ok, %{open: open, close: close, tokens: inner}}
    else
      {:error, message}
    end
  end

  defp resolve_members(value) do
    if object_literal?(value) do
      {:ok, Enum.slice(value, 1, length(value) - 2)}
    else
      {:error, "Vite resolve property must be a direct object literal"}
    end
  end

  defp array_from_value([%Token{value: "["} | _rest] = value, message) do
    if List.last(value).value == "]" do
      open = List.first(value)
      close = List.last(value)
      inner = Enum.slice(value, 1, length(value) - 2)
      {:ok, %{open: open, close: close, tokens: inner}}
    else
      {:error, message}
    end
  end

  defp array_from_value(_value, message), do: {:error, message}

  defp plugins_properties(tokens) do
    tokens
    |> Enum.with_index()
    |> Enum.reduce([], fn {token, index}, properties ->
      cond do
        property_key?(token, "plugins") and match?(%Token{value: ":"}, Enum.at(tokens, index + 1)) ->
          [%{value_index: index + 2} | properties]

        token.value == "[" and
          property_key?(Enum.at(tokens, index + 1), "plugins") and
          match?(%Token{value: "]"}, Enum.at(tokens, index + 2)) and
            match?(%Token{value: ":"}, Enum.at(tokens, index + 3)) ->
          [%{value_index: index + 4} | properties]

        true ->
          properties
      end
    end)
    |> Enum.reverse()
  end

  defp merge_plugin(source, plugins, plugin) do
    with {:ok, elements} <- Scanner.split_top_level(plugins.tokens) do
      elements = Enum.reject(elements, &(&1 == []))
      count = Enum.count(elements, &(Scanner.normalize(&1) == plugin.normalized))
      conflicts = conflicting_plugin_calls(elements, plugin)

      case {count, conflicts} do
        {_count, [_conflict | _rest]} ->
          {:error, "Vite plugins array contains the requested plugin with a different expression"}

        {0, []} ->
          {:ok,
           Source.insert_collection_member(
             source,
             plugins.open,
             plugins.close,
             plugins.tokens,
             plugin.source
           )}

        {1, []} ->
          {:ok, source}

        {_many, []} ->
          {:error, "Vite plugins array contains the requested plugin multiple times"}
      end
    end
  end

  defp plugins_array_includes_callee?(tokens, callee_normalized) do
    case Scanner.split_top_level(tokens) do
      {:ok, elements} ->
        elements
        |> Enum.reject(&(&1 == []))
        |> Enum.any?(&(call_callee(&1) == callee_normalized))

      {:error, _message} ->
        false
    end
  end

  defp conflicting_plugin_calls(elements, plugin) do
    case call_callee(plugin.tokens) do
      nil ->
        []

      requested_callee ->
        Enum.filter(elements, fn element ->
          Scanner.normalize(element) != plugin.normalized and
            call_callee(element) == requested_callee
        end)
    end
  end

  defp call_callee(tokens) do
    case Enum.find_index(tokens, &(&1.value == "(")) do
      nil ->
        nil

      0 ->
        nil

      open_index ->
        tokens
        |> Enum.take(open_index)
        |> Scanner.normalize()
    end
  end

  defp tokens_at_top_level(tokens) do
    {top_level, _stack} =
      Enum.reduce(tokens, {[], []}, fn token, {top_level, stack} ->
        cond do
          token.value in ["(", "[", "{"] -> {top_level, [token.value | stack]}
          token.value in [")", "]", "}"] -> {top_level, tl(stack)}
          stack == [] -> {[token | top_level], stack}
          true -> {top_level, stack}
        end
      end)

    Enum.reverse(top_level)
  end

  defp logical_parts([[]]), do: []

  defp logical_parts(parts) do
    case List.last(parts) do
      [] -> Enum.drop(parts, -1)
      _part -> parts
    end
  end

  defp collect_live_socket_call(
         {%Token{kind: :identifier, value: "new"}, index},
         calls,
         tokens,
         pairs
       ) do
    case live_socket_call_tokens(tokens, pairs, index) do
      {:ok, call} -> [call | calls]
      :error -> calls
    end
  end

  defp collect_live_socket_call({_token, _index}, calls, _tokens, _pairs), do: calls

  defp live_socket_call_tokens(tokens, pairs, index) do
    case {Enum.at(tokens, index + 1), Enum.at(tokens, index + 2)} do
      {%Token{kind: :identifier, value: "LiveSocket"}, %Token{value: "("}} ->
        build_live_socket_call(tokens, pairs, index)

      _other ->
        :error
    end
  end

  defp build_live_socket_call(tokens, pairs, index) do
    case Map.fetch(pairs, index + 2) do
      {:ok, close_index} ->
        argument_count = max(close_index - index - 3, 0)
        {:ok, %{tokens: Enum.slice(tokens, index + 3, argument_count)}}

      :error ->
        :error
    end
  end

  defp collect_named_properties(members, property_name) do
    members
    |> Enum.reduce_while({:ok, []}, &collect_named_property(&1, &2, property_name))
    |> finalize_named_properties()
  end

  defp collect_named_property(member, {:ok, properties}, property_name) do
    case parse_named_property(member, property_name) do
      :other -> {:cont, {:ok, properties}}
      {:ok, property} -> {:cont, {:ok, [property | properties]}}
      {:error, message} -> {:halt, {:error, message}}
    end
  end

  defp finalize_named_properties({:ok, properties}), do: {:ok, Enum.reverse(properties)}
  defp finalize_named_properties({:error, message}), do: {:error, message}
end
