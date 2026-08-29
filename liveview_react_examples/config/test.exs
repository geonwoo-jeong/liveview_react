import Config

config :liveview_react, ssr: false

e2e? = System.get_env("LIVEVIEW_REACT_E2E") == "true"
config :liveview_react_examples, e2e: e2e?

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :liveview_react_examples, LiveViewReactExamplesWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "1TSUMeDi3xh+wePzvzKMq73p/bD2psOzg340hjtEcR8WGPxm0qINVteU03whCTcS",
  server: false

if e2e? do
  config :liveview_react,
    ssr: true,
    ssr_module: LiveViewReact.SSR.ViteJS,
    vite_host: "http://127.0.0.1:4011"

  config :liveview_react_examples,
    vite: [dev_server: true, url: "http://127.0.0.1:4011"]

  config :liveview_react_examples, LiveViewReactExamplesWeb.Endpoint,
    check_origin: false,
    server: true
end

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

# Enable helpful, but potentially expensive runtime checks
config :phoenix_live_view,
  enable_expensive_runtime_checks: true
