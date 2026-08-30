Application.put_env(:liveview_react, LiveViewReact.TestSupport.Endpoint,
  url: [host: "localhost"],
  secret_key_base: String.duplicate("liveview_react", 8),
  live_view: [signing_salt: "e3wJm5Vb"],
  render_errors: [formats: [html: LiveViewReact.TestSupport.ErrorHTML]],
  check_origin: false,
  server: false
)

Logger.configure(level: :warning)

ExUnit.start()
LiveViewReact.Installer.Loader.load!()

{:ok, _} = Application.ensure_all_started(:phoenix)
{:ok, _} = LiveViewReact.TestSupport.Endpoint.start_link()
