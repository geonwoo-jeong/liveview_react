defmodule Mix.Tasks.LiveviewReact.Install.Helper do
  @moduledoc false

  defmacro with_igniter(do: available, else: unavailable) do
    if Code.ensure_loaded?(Igniter) do
      available
    else
      unavailable
    end
  end
end

defmodule Mix.Tasks.LiveviewReact.Install do
  @shortdoc "Installs LiveViewReact into a Phoenix application"
  @example "mix igniter.install liveview_react"

  @moduledoc """
  #{@shortdoc}.

  Run through Igniter so PhoenixVite is installed and composed when needed:

      #{@example}

  Use `--no-demo` to omit the generated demo component, LiveView, and route.
  The public `--bun` option is accepted on both the first and later runs.
  """

  import Mix.Tasks.LiveviewReact.Install.Helper

  with_igniter do
    use Igniter.Mix.Task

    @phoenix_vite_dep {:phoenix_vite, "~> 0.5"}
    @vite_config_path "assets/vite.config.mjs"
    @bun_schema [bun: :boolean]
    @bun_aliases [b: :bun]

    @impl Igniter.Mix.Task
    def info(_argv, _composing_task) do
      configured? =
        phoenix_vite_already_configured?(
          Mix.Project.config() |> Keyword.get(:deps, []),
          read_vite_config(@vite_config_path)
        )

      %Igniter.Mix.Task.Info{
        group: :liveview_react,
        example: @example,
        schema: installer_schema(configured?),
        defaults: installer_defaults(configured?),
        aliases: installer_aliases(configured?),
        required: [],
        installs: installer_installs(configured?)
      }
    end

    @impl Igniter.Mix.Task
    def supports_umbrella?, do: false

    @impl Igniter.Mix.Task
    def igniter(igniter) do
      LiveViewReact.Igniter.install(igniter, demo: igniter.args.options[:demo])
    end

    @doc false
    def phoenix_vite_already_configured?(deps, vite_config_source)
        when is_list(deps) and is_binary(vite_config_source) do
      phoenix_vite_dependency?(deps) and phoenix_vite_plugin_configured?(vite_config_source)
    end

    def phoenix_vite_already_configured?(_deps, _vite_config_source), do: false

    defp installer_schema(true), do: [demo: :boolean] ++ @bun_schema
    defp installer_schema(false), do: [demo: :boolean]

    defp installer_defaults(true), do: [demo: true, bun: false]
    defp installer_defaults(false), do: [demo: true]

    defp installer_aliases(true), do: @bun_aliases
    defp installer_aliases(false), do: []

    defp installer_installs(true), do: []
    defp installer_installs(false), do: [@phoenix_vite_dep]

    defp read_vite_config(path) do
      case File.read(path) do
        {:ok, source} -> source
        {:error, _reason} -> nil
      end
    end

    defp phoenix_vite_dependency?(deps) do
      Enum.any?(deps, fn
        {name, _requirement} when name == :phoenix_vite -> true
        {name, _requirement, _opts} when name == :phoenix_vite -> true
        _other -> false
      end)
    end

    defp phoenix_vite_plugin_configured?(source) do
      with {:ok, ^source} <-
             LiveViewReact.Installer.JavaScript.ensure_import(
               source,
               ~s(import { phoenixVitePlugin } from "phoenix_vite";),
               "phoenix_vite"
             ),
           {:ok, configured?} <-
             LiveViewReact.Installer.JavaScript.vite_plugin_present?(source, "phoenixVitePlugin") do
        configured?
      else
        _missing_or_invalid -> false
      end
    end
  else
    use Mix.Task

    @impl Mix.Task
    def run(_argv) do
      Mix.raise("""
      The task `liveview_react.install` requires Igniter.

      Add `{:igniter, "~> 0.8", only: [:dev, :test]}` to your dependencies,
      fetch dependencies, and run `mix igniter.install liveview_react` again.
      """)
    end
  end
end
