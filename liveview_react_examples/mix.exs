defmodule LiveViewReactExamples.MixProject do
  use Mix.Project

  def project do
    [
      app: :liveview_react_examples,
      version: "0.1.0",
      elixir: "~> 1.20",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps(),
      listeners: [Phoenix.CodeReloader]
    ]
  end

  # Configuration for the OTP application.
  #
  # Type `mix help compile.app` for more information.
  def application do
    [
      mod: {LiveViewReactExamples.Application, []},
      extra_applications: [:logger, :runtime_tools]
    ]
  end

  # Specifies which paths to compile per environment.
  defp elixirc_paths(:test) do
    ["lib", "test/support"] ++ e2e_paths(System.get_env("LIVEVIEW_REACT_E2E"))
  end

  defp elixirc_paths(_), do: ["lib"]

  defp e2e_paths("true"), do: ["e2e/support"]
  defp e2e_paths(_), do: []

  # Specifies your project dependencies.
  #
  # Type `mix help deps` for examples and options.
  defp deps do
    [
      {:phoenix, "~> 1.8.13"},
      {:phoenix_html, "~> 4.1"},
      {:phoenix_live_reload, "~> 1.2", only: :dev},
      {:nodejs, "~> 3.1"},
      {:phoenix_live_view, "~> 1.2.11"},
      {:floki, ">= 0.30.0", only: :test},
      {:heroicons,
       github: "tailwindlabs/heroicons",
       tag: "v2.1.1",
       sparse: "optimized",
       app: false,
       compile: false,
       depth: 1},
      {:telemetry_metrics, "~> 1.0"},
      {:telemetry_poller, "~> 1.0"},
      {:jason, "~> 1.2"},
      {:dns_cluster, "~> 0.3.0"},
      {:bandit, "~> 1.5"},
      # For development
      {:liveview_react, path: ".."}
      # For deployment
      # {:liveview_react, "~> 0.1.0"}
    ]
  end

  # Aliases are shortcuts or tasks specific to the current project.
  # For example, to install project dependencies and perform other setup tasks, run:
  #
  #     $ mix setup
  #
  # See the documentation for `Mix` for more info on aliases.
  defp aliases do
    [
      setup: ["deps.get", "package.build", "assets.setup", "assets.build"],
      "package.build": [
        "cmd --cd .. npm ci",
        "cmd --cd .. npm run build"
      ],
      "assets.setup": ["cmd --cd assets npm ci"],
      "assets.build": [
        "cmd --cd assets npm run build",
        "cmd --cd assets npm run build-server"
      ],
      "assets.deploy": [
        "cmd --cd assets npm run build",
        "cmd --cd assets npm run build-server",
        "phx.digest"
      ]
    ]
  end
end
