defmodule LiveViewReact.Installer.PackageJSON do
  @moduledoc false

  @phoenix_vite_generated_version "^6.3.0"

  @dependencies [
    {"liveview_react", "^0.1.0", {:minor, 0, 1}},
    {"react", "^19.0.0", {:major, 19}},
    {"react-dom", "^19.0.0", {:major, 19}}
  ]

  @dev_dependencies [
    {"@types/react", "^19.0.0", {:major, 19}},
    {"@types/react-dom", "^19.0.0", {:major, 19}},
    {"@vitejs/plugin-react", "^6.0.0", {:major, 6}},
    {"typescript", "^7.0.2", {:major, 7}},
    {"vite", "^8.0.0", {:major, 8}}
  ]

  @scripts %{
    "build:ssr" => "vite build --config vite.liveview-react.ssr.config.mjs",
    "typecheck" => "tsc --noEmit"
  }

  @spec merge(String.t()) :: {:ok, String.t()} | {:error, [String.t()]}
  def merge(source) when is_binary(source) do
    with {:ok, package} <- decode_object(source),
         {:ok, package} <- require_object_fields(package),
         {:ok, package} <- merge_packages(package, "dependencies", @dependencies),
         {:ok, package} <- merge_packages(package, "devDependencies", @dev_dependencies),
         {:ok, package} <- merge_scripts(package) do
      {:ok, Jason.encode!(package, pretty: true) <> "\n"}
    end
  end

  defp decode_object(source) do
    case Jason.decode(source) do
      {:ok, value} when is_map(value) ->
        {:ok, value}

      {:ok, _value} ->
        {:error, ["assets/package.json must contain a JSON object"]}

      {:error, error} ->
        {:error, ["assets/package.json is invalid JSON: #{Exception.message(error)}"]}
    end
  end

  defp require_object_fields(package) do
    invalid =
      ["dependencies", "devDependencies", "scripts"]
      |> Enum.filter(fn key ->
        case Map.fetch(package, key) do
          :error -> false
          {:ok, value} -> not is_map(value)
        end
      end)

    case invalid do
      [] -> {:ok, package}
      keys -> {:error, ["assets/package.json #{Enum.join(keys, ", ")} must be objects"]}
    end
  end

  defp merge_packages(package, section, requirements) do
    Enum.reduce_while(requirements, {:ok, package}, fn requirement, {:ok, package} ->
      case merge_package(package, section, requirement) do
        {:ok, package} -> {:cont, {:ok, package}}
        {:error, message} -> {:halt, {:error, [message]}}
      end
    end)
  end

  defp merge_package(package, preferred_section, {name, desired, compatibility}) do
    locations =
      ["dependencies", "devDependencies"]
      |> Enum.flat_map(fn section ->
        case get_in(package, [section, name]) do
          nil -> []
          value -> [{section, value}]
        end
      end)

    case locations do
      [] ->
        {:ok, put_dependency(package, preferred_section, name, desired)}

      [{section, @phoenix_vite_generated_version}]
      when name == "vite" and desired == "^8.0.0" ->
        {:ok, put_dependency(package, section, name, desired)}

      [{_section, current}] when not is_binary(current) ->
        {:error, dependency_error(name, current, desired)}

      [{_section, current}] ->
        if compatible?(current, compatibility) do
          {:ok, package}
        else
          {:error, dependency_error(name, current, desired)}
        end

      _duplicates ->
        {:error,
         "assets/package.json declares #{inspect(name)} in both dependencies and devDependencies"}
    end
  end

  defp merge_scripts(package) do
    scripts = Map.get(package, "scripts", %{})

    Enum.reduce_while(@scripts, {:ok, scripts}, fn {name, desired}, {:ok, scripts} ->
      case Map.fetch(scripts, name) do
        :error ->
          {:cont, {:ok, Map.put(scripts, name, desired)}}

        {:ok, ^desired} ->
          {:cont, {:ok, scripts}}

        {:ok, current} ->
          {:halt,
           {:error,
            [
              "assets/package.json script #{inspect(name)} is #{inspect(current)}; " <>
                "refusing to overwrite it with #{inspect(desired)}"
            ]}}
      end
    end)
    |> case do
      {:ok, scripts} -> {:ok, Map.put(package, "scripts", scripts)}
      error -> error
    end
  end

  defp put_dependency(package, section, name, version) do
    Map.update(package, section, %{name => version}, &Map.put(&1, name, version))
  end

  defp compatible?(version, {:major, expected_major}) do
    case version_floor(version) do
      {:ok, {^expected_major, _minor}} -> bounded_to_major?(version, expected_major)
      _ -> false
    end
  end

  defp compatible?(version, {:minor, expected_major, expected_minor}) do
    case version_floor(version) do
      {:ok, {^expected_major, ^expected_minor}} -> bounded_to_minor?(version, expected_major)
      _ -> false
    end
  end

  defp version_floor(version) do
    case Regex.run(~r/^\s*(?:\^|~)?\s*(\d+)(?:\.(\d+|x|\*))?/, version) do
      [matched, major, minor] ->
        if supported_suffix?(version, matched) do
          {:ok, {String.to_integer(major), numeric_part(minor)}}
        else
          range_floor(version)
        end

      [matched, major] ->
        if supported_suffix?(version, matched) do
          {:ok, {String.to_integer(major), 0}}
        else
          range_floor(version)
        end

      _ ->
        range_floor(version)
    end
  end

  defp range_floor(version) do
    case Regex.run(~r/^\s*>=\s*(\d+)(?:\.(\d+))?(?:\.\d+)?\s+<\s*(\d+)\s*$/, version) do
      [_all, major, minor, _upper] ->
        {:ok, {String.to_integer(major), numeric_part(minor)}}

      _ ->
        :error
    end
  end

  defp supported_suffix?(version, matched) do
    suffix = version |> String.replace_prefix(matched, "") |> String.trim()
    suffix == "" or Regex.match?(~r/^\.\d+(?:-[0-9A-Za-z.-]+)?$/, suffix)
  end

  defp bounded_to_major?(version, major) do
    case Regex.run(~r/<\s*(\d+)/, version) do
      nil -> true
      [_all, upper] -> String.to_integer(upper) == major + 1
    end
  end

  defp bounded_to_minor?(version, major) do
    not String.starts_with?(String.trim(version), ">=") and major == 0
  end

  defp numeric_part(part) when part in [nil, "x", "*"], do: 0
  defp numeric_part(part), do: String.to_integer(part)

  defp dependency_error(name, current, desired) do
    "assets/package.json requires a compatible #{inspect(name)} version " <>
      "(expected #{desired}, found #{inspect(current)}); refusing to overwrite it"
  end
end
