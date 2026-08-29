defmodule LiveViewReact.Installer.TypeScriptConfig do
  @moduledoc false

  alias LiveViewReact.Installer.JSONC

  @compiler_options [
    {"target", "ES2022", :target},
    {"module", "ESNext", :module},
    {"moduleResolution", "Bundler", :bundler},
    {"allowJs", true, true},
    {"noEmit", true, true},
    {"isolatedModules", true, true},
    {"strict", true, true},
    {"esModuleInterop", true, true},
    {"skipLibCheck", true, true},
    {"forceConsistentCasingInFileNames", true, true},
    {"jsx", "react-jsx", :jsx}
  ]

  @default_phoenix_paths %{"*" => ["../deps/*"]}

  @spec merge(String.t()) :: {:ok, String.t()} | {:error, [String.t()]}
  def merge(source) when is_binary(source) do
    with {:ok, root} <- parse_root(source),
         {:ok, source} <- ensure_compiler_options(source, root),
         {:ok, source} <- remove_obsolete_phoenix_resolution(source),
         {:ok, source} <- merge_compiler_options(source),
         {:ok, source} <- ensure_array_value(source, ["compilerOptions"], "types", "vite/client"),
         {:ok, source} <- ensure_array_value(source, [], "include", "js/**/*"),
         {:ok, source} <- ensure_array_value(source, [], "include", "react-components/**/*"),
         {:ok, _root} <- parse_root(source) do
      {:ok, source}
    else
      {:error, messages} when is_list(messages) -> {:error, messages}
      {:error, message} -> {:error, [message]}
    end
  end

  defp parse_root(source) do
    case JSONC.parse(source) do
      {:ok, %{kind: :object} = root} -> {:ok, root}
      {:ok, _node} -> {:error, "assets/tsconfig.json must contain a JSONC object"}
      {:error, message} -> {:error, "assets/tsconfig.json is invalid: #{message}"}
    end
  end

  defp ensure_compiler_options(source, root) do
    case JSONC.fetch(root, ["compilerOptions"]) do
      {:ok, %{kind: :object}} ->
        {:ok, source}

      :error ->
        JSONC.insert_property(source, root, "compilerOptions", "{}")

      {:ok, _node} ->
        {:error, "assets/tsconfig.json compilerOptions must be an object"}

      {:error, message} ->
        {:error, message}
    end
  end

  defp merge_compiler_options(source) do
    Enum.reduce_while(@compiler_options, {:ok, source}, fn option, {:ok, source} ->
      case ensure_compiler_option(source, option) do
        {:ok, source} -> {:cont, {:ok, source}}
        {:error, message} -> {:halt, {:error, message}}
      end
    end)
  end

  defp ensure_compiler_option(source, {key, desired, compatibility}) do
    with {:ok, root} <- parse_root(source),
         {:ok, compiler} <- JSONC.fetch(root, ["compilerOptions"]) do
      case JSONC.fetch(compiler, [key]) do
        :error ->
          JSONC.insert_property(source, compiler, key, Jason.encode!(desired))

        {:ok, node} ->
          current = JSONC.term(node)

          if compatible?(compatibility, current) do
            {:ok, source}
          else
            {:error,
             "assets/tsconfig.json compilerOptions.#{key} is #{inspect(current)}; " <>
               "expected a setting compatible with #{inspect(desired)}"}
          end

        {:error, message} ->
          {:error, message}
      end
    end
  end

  defp ensure_array_value(source, parent_path, key, desired) do
    with {:ok, root} <- parse_root(source),
         {:ok, parent} <- JSONC.fetch(root, parent_path) do
      case JSONC.fetch(parent, [key]) do
        :error ->
          JSONC.insert_property(source, parent, key, Jason.encode!([desired]))

        {:ok, %{kind: :array} = array} ->
          values = JSONC.term(array)

          cond do
            not Enum.all?(values, &is_binary/1) ->
              {:error, "assets/tsconfig.json #{key} must contain only strings"}

            desired in values ->
              {:ok, source}

            true ->
              JSONC.append_array_string(source, array, desired)
          end

        {:ok, _node} ->
          {:error, "assets/tsconfig.json #{key} must be an array"}

        {:error, message} ->
          {:error, message}
      end
    end
  end

  defp remove_obsolete_phoenix_resolution(source) do
    with {:ok, root} <- parse_root(source),
         {:ok, compiler} <- JSONC.fetch(root, ["compilerOptions"]) do
      resolve_phoenix_resolution(
        source,
        fetch_term(compiler, "baseUrl"),
        fetch_term(compiler, "paths")
      )
    end
  end

  defp resolve_phoenix_resolution(source, {:ok, "."}, {:ok, paths})
       when paths in [@default_phoenix_paths, %{}],
       do: remove_compiler_properties(source, ["baseUrl", "paths"])

  defp resolve_phoenix_resolution(source, {:ok, "."}, :missing),
    do: remove_compiler_properties(source, ["baseUrl"])

  defp resolve_phoenix_resolution(_source, {:ok, "."}, {:ok, _custom_paths}) do
    {:error,
     "assets/tsconfig.json combines compilerOptions.baseUrl \".\" with custom paths; " <>
       "refusing to change custom module resolution for TypeScript 7"}
  end

  defp resolve_phoenix_resolution(_source, {:ok, current}, _paths),
    do: {:error, ts7_base_url_message(current)}

  defp resolve_phoenix_resolution(_source, {:error, message}, _paths), do: {:error, message}
  defp resolve_phoenix_resolution(_source, _base_url, {:error, message}), do: {:error, message}

  defp resolve_phoenix_resolution(source, :missing, {:ok, paths})
       when paths == @default_phoenix_paths,
       do: remove_compiler_properties(source, ["paths"])

  defp resolve_phoenix_resolution(source, :missing, _paths), do: {:ok, source}

  defp fetch_term(object, key) do
    case JSONC.fetch(object, [key]) do
      {:ok, node} -> {:ok, JSONC.term(node)}
      :error -> :missing
      {:error, message} -> {:error, message}
    end
  end

  defp remove_compiler_properties(source, keys) do
    Enum.reduce_while(keys, {:ok, source}, fn key, {:ok, source} ->
      with {:ok, root} <- parse_root(source),
           {:ok, compiler} <- JSONC.fetch(root, ["compilerOptions"]),
           {:ok, source} <- JSONC.remove_property(source, compiler, key) do
        {:cont, {:ok, source}}
      else
        {:error, message} -> {:halt, {:error, message}}
        :error -> {:halt, {:error, "assets/tsconfig.json compilerOptions disappeared"}}
      end
    end)
  end

  defp target?(value) when is_binary(value) do
    String.upcase(value) in ~w(ES2020 ES2021 ES2022 ES2023 ES2024 ESNEXT)
  end

  defp target?(_value), do: false

  defp module?(value) when is_binary(value),
    do: String.upcase(value) in ~w(ES2022 ESNEXT PRESERVE)

  defp module?(_value), do: false

  defp bundler?(value) when is_binary(value), do: String.downcase(value) == "bundler"
  defp bundler?(_value), do: false

  defp jsx?(value) when is_binary(value),
    do: String.downcase(value) in ["react-jsx", "react-jsxdev"]

  defp jsx?(_value), do: false

  defp compatible?(:target, value), do: target?(value)
  defp compatible?(:module, value), do: module?(value)
  defp compatible?(:bundler, value), do: bundler?(value)
  defp compatible?(:jsx, value), do: jsx?(value)
  defp compatible?(true, value), do: value == true

  defp ts7_base_url_message(value) do
    "assets/tsconfig.json compilerOptions.baseUrl is #{inspect(value)}; " <>
      "TypeScript 7 removed baseUrl, so remove or migrate it before installing LiveViewReact"
  end
end
