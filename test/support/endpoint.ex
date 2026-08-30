defmodule LiveViewReact.TestSupport.ErrorHTML do
  @moduledoc false

  def render(template, _assigns) do
    Phoenix.Controller.status_message_from_template(template)
  end
end

defmodule LiveViewReact.TestSupport.Layouts do
  @moduledoc false

  use Phoenix.Component

  def root(assigns) do
    ~H"""
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
      </head>
      <body>
        {@inner_content}
      </body>
    </html>
    """
  end
end

defmodule LiveViewReact.TestSupport.Router do
  @moduledoc false

  use Phoenix.Router
  import Phoenix.LiveView.Router

  pipeline :browser do
    plug(:accepts, ["html"])
    plug(:fetch_session)
    plug(:put_root_layout, html: {LiveViewReact.TestSupport.Layouts, :root})
  end

  scope "/", LiveViewReact.TestSupport do
    pipe_through(:browser)

    live("/props", PropsLive)
    live("/temporary", TemporaryLive)
    live("/slots", SlotsLive)
    live("/legacy-slots", LegacySlotsLive)
    live("/streams", StreamsLive)
  end
end

defmodule LiveViewReact.TestSupport.Endpoint do
  @moduledoc false

  use Phoenix.Endpoint, otp_app: :liveview_react

  plug(Plug.Session,
    store: :cookie,
    key: "_liveview_react_test",
    signing_salt: "iCbwXAcH"
  )

  plug(LiveViewReact.TestSupport.Router)
end
