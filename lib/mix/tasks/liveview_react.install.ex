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

  Run through Igniter so PhoenixVite is installed and composed first:

      #{@example}

  Use `--no-demo` to omit the generated demo component, LiveView, and route.
  PhoenixVite's public `--bun` option is accepted by the composed installer.
  """

  import Mix.Tasks.LiveviewReact.Install.Helper

  with_igniter do
    use Igniter.Mix.Task

    @impl Igniter.Mix.Task
    def info(_argv, _composing_task) do
      %Igniter.Mix.Task.Info{
        group: :liveview_react,
        example: @example,
        schema: [demo: :boolean],
        defaults: [demo: true],
        required: [],
        installs: [{:phoenix_vite, "~> 0.5"}]
      }
    end

    @impl Igniter.Mix.Task
    def supports_umbrella?, do: false

    @impl Igniter.Mix.Task
    def igniter(igniter) do
      LiveViewReact.Igniter.install(igniter, demo: igniter.args.options[:demo])
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
