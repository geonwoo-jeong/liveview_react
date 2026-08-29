defmodule LiveViewReact.MixProject do
  use Mix.Project

  @version "0.1.0"

  def project do
    [
      app: :liveview_react,
      version: @version,
      elixir: "~> 1.20",
      start_permanent: Mix.env() == :prod,
      consolidate_protocols: Mix.env() != :test,
      deps: deps(),
      description: "React integration for Phoenix LiveView",
      package: package(),
      docs: docs()
    ]
  end

  def application do
    conditionals =
      case Application.get_env(:liveview_react, :ssr_module) do
        # Needed to use :httpc.request
        LiveViewReact.SSR.ViteJS -> [:inets]
        _ -> []
      end

    [
      extra_applications: [:logger] ++ conditionals
    ]
  end

  defp deps do
    [
      {:jason, "~> 1.4"},
      {:jsonpatch, "~> 2.3.1"},
      {:nodejs, "~> 3.1", optional: true},
      {:floki, "~> 0.38", optional: true},
      {:ecto, "~> 3.14", optional: true},
      {:phoenix_ecto, "~> 4.7", optional: true},
      {:phoenix, "~> 1.8.13"},
      {:phoenix_html, "~> 4.3"},
      {:phoenix_live_view, "~> 1.2.11"},
      {:telemetry, "~> 1.4"},
      {:credo, "~> 1.7.19", only: [:dev, :test], runtime: false},
      {:ex_doc, "~> 0.40", only: :dev, runtime: false}
    ]
  end

  defp package do
    [
      licenses: ["MIT"],
      links: %{
        "Upstream project" => "https://github.com/mrdotb/live_react"
      },
      files:
        ~w(dist guides lib)s ++
          ~w(CHANGELOG.md LICENSE.md README.md THIRD_PARTY_NOTICES.md UPSTREAM.md) ++
          ~w(mix.exs package.json .formatter.exs)
    ]
  end

  defp docs do
    [
      name: "LiveViewReact",
      source_ref: "v#{@version}",
      main: "readme",
      extras: [
        "README.md",
        "guides/installation.md",
        "guides/client_hooks.md",
        "guides/events.md",
        "guides/forms.md",
        "guides/uploads.md",
        "guides/streams.md",
        "guides/slots.md",
        "guides/deployment.md",
        "guides/development.md",
        "guides/ssr.md",
        "CHANGELOG.md",
        "LICENSE.md",
        "THIRD_PARTY_NOTICES.md",
        "UPSTREAM.md"
      ]
    ]
  end
end
