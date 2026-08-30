defmodule LiveViewReact.MixProject do
  use Mix.Project

  @version "0.1.0"
  @source_url "https://github.com/geonwoo-jeong/liveview_react"

  def project do
    [
      app: :liveview_react,
      version: @version,
      source_url: @source_url,
      homepage_url: @source_url,
      elixir: "~> 1.20",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      consolidate_protocols: Mix.env() != :test,
      deps: deps(),
      description: "React integration for Phoenix LiveView",
      package: package(),
      docs: docs(),
      aliases: aliases(),
      dialyzer: [plt_add_apps: [:mix]]
    ]
  end

  def cli do
    [preferred_envs: [quality: :test, quality_full: :test]]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_env), do: ["lib"]

  def application do
    [
      extra_applications: [:inets, :logger]
    ]
  end

  defp deps do
    [
      {:jason, "~> 1.4"},
      {:jsonpatch, "~> 2.3.1"},
      {:nodejs, "~> 3.1", optional: true},
      {:floki, "~> 0.38", optional: true},
      {:igniter, "~> 0.8", optional: true},
      {:phoenix_vite, "~> 0.5", only: [:dev, :test], runtime: false},
      {:ecto, "~> 3.14", optional: true},
      {:phoenix_ecto, "~> 4.7", optional: true},
      {:phoenix,
       ci_dependency_requirement(
         "LIVEVIEW_REACT_CI_PHOENIX_REQUIREMENT",
         "~> 1.8",
         "== 1.8.0"
       )},
      {:phoenix_html, "~> 4.3"},
      {:phoenix_live_view,
       ci_dependency_requirement(
         "LIVEVIEW_REACT_CI_LIVE_VIEW_REQUIREMENT",
         "~> 1.2.11",
         "== 1.2.11"
       )},
      {:telemetry, "~> 1.4"},
      {:credo, "~> 1.7.19", only: [:dev, :test], runtime: false},
      {:dialyxir, "~> 1.4", only: [:dev, :test], runtime: false},
      {:mix_audit, "~> 2.1", only: [:dev, :test], runtime: false},
      {:phx_new, "== 1.8.9", only: :test},
      {:lazy_html, ">= 0.1.0", only: :test},
      {:stream_data, "~> 1.4", only: :test},
      {:ex_doc, "~> 0.40", only: :dev, runtime: false}
    ]
  end

  defp ci_dependency_requirement(variable, default, minimum) do
    case System.get_env(variable) do
      nil -> default
      requirement when requirement in [default, minimum] -> requirement
      requirement -> raise "invalid #{variable}: #{inspect(requirement)}"
    end
  end

  defp package do
    [
      licenses: ["MIT"],
      links: %{
        "GitHub" => @source_url,
        "Documentation" => "https://hexdocs.pm/liveview_react"
      },
      files:
        ~w(dist guides lib priv/installer)s ++
          ~w(CHANGELOG.md LICENSE.md README.md) ++
          ~w(mix.exs package.json .formatter.exs)
    ]
  end

  defp docs do
    [
      name: "LiveViewReact",
      source_ref: docs_source_ref(),
      main: "readme",
      logo: "guides/images/liveview_react_logo.png",
      assets: %{"guides/images" => "guides/images"},
      extras: [
        "README.md",
        "guides/installation.md",
        "guides/getting_started.md",
        "guides/architecture.md",
        "guides/component_api.md",
        "guides/client_hooks.md",
        "guides/events.md",
        "guides/forms.md",
        "guides/uploads.md",
        "guides/streams.md",
        "guides/slots.md",
        "guides/deployment.md",
        "guides/development.md",
        "guides/ssr.md",
        "guides/lazy_loading.md",
        "guides/testing.md",
        "guides/comparison.md",
        "guides/limitations.md",
        "guides/uninstallation.md",
        "guides/releasing.md",
        "CHANGELOG.md",
        "LICENSE.md"
      ]
    ]
  end

  defp docs_source_ref do
    case System.get_env("LIVEVIEW_REACT_DOCS_SOURCE_REF") do
      nil -> "main"
      "" -> raise "LIVEVIEW_REACT_DOCS_SOURCE_REF must not be empty"
      source_ref -> source_ref
    end
  end

  defp aliases do
    [
      quality: [
        "format --check-formatted",
        "compile --force --warnings-as-errors",
        "credo --strict",
        "test"
      ],
      quality_full: [
        "hex.audit",
        "deps.audit",
        "deps.unlock --check-unused",
        "format --check-formatted",
        "compile --force --warnings-as-errors",
        "credo --strict",
        "dialyzer",
        "test"
      ]
    ]
  end
end
