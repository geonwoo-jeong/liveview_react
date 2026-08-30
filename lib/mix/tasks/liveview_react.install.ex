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

  use Mix.Task

  alias LiveViewReact.Installer.JavaScript
  alias LiveViewReact.Installer.Loader

  @igniter_args Module.concat(["Igniter", "Mix", "Task", "Args"])
  @igniter_info Module.concat(["Igniter", "Mix", "Task", "Info"])
  @igniter_task Module.concat(["Igniter", "Mix", "Task"])
  @phoenix_vite_dep {:phoenix_vite, "~> 0.5"}
  @vite_config_path "assets/vite.config.mjs"
  @bun_schema [bun: :boolean]
  @bun_aliases [b: :bun]

  @impl Mix.Task
  @spec run([String.t()]) :: no_return()
  def run(_argv) do
    Mix.raise("Install LiveViewReact with `mix igniter.install liveview_react`.")
  end

  @doc false
  def installer?, do: true

  @doc false
  def supports_umbrella?, do: false

  @doc false
  def info(_argv, _composing_task) do
    configured? =
      phoenix_vite_already_configured?(
        Mix.Project.config() |> Keyword.get(:deps, []),
        read_vite_config(@vite_config_path)
      )

    struct!(@igniter_info,
      group: :liveview_react,
      example: @example,
      schema: installer_schema(configured?),
      defaults: installer_defaults(configured?),
      aliases: installer_aliases(configured?),
      required: [],
      installs: installer_installs(configured?)
    )
  end

  @doc false
  def parse_argv(argv) do
    positional_parser = Function.capture(@igniter_task, :__positional_args__!, 2)
    options_parser = Function.capture(@igniter_task, :__options__!, 2)

    {positional, argv_flags} =
      positional_parser.(__MODULE__, argv)

    options = options_parser.(__MODULE__, argv_flags)

    struct!(@igniter_args,
      positional: positional,
      options: options,
      argv: argv,
      argv_flags: argv_flags
    )
  end

  @doc false
  def igniter(igniter) do
    Loader.load!()
    install = Function.capture(installer_module(), :install, 2)
    install.(igniter, demo: igniter.args.options[:demo])
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

  defp installer_module do
    String.to_existing_atom("Elixir.LiveViewReact.Igniter")
  end

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
           JavaScript.ensure_import(
             source,
             ~s(import { phoenixVitePlugin } from "phoenix_vite";),
             "phoenix_vite"
           ),
         {:ok, configured?} <-
           JavaScript.vite_plugin_present?(source, "phoenixVitePlugin") do
      configured?
    else
      _missing_or_invalid -> false
    end
  end
end
