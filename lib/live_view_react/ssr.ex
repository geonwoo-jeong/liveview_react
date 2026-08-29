defmodule LiveViewReact.SSR.NotConfigured do
  @moduledoc false

  defexception message: "LiveViewReact server-side rendering is not configured"
end

defmodule LiveViewReact.SSR.RenderError do
  @moduledoc false

  defexception [:message]
end

defmodule LiveViewReact.SSR do
  @moduledoc """
  A behaviour for rendering React components server-side.

  To define a custom renderer, change the application config in `config.exs`:

      config :liveview_react, ssr_module: MyCustomSSRModule

  Exposes a telemetry span for each render under key `[:liveview_react, :ssr]`
  """

  @type props :: %{optional(String.t() | atom) => any}
  @type slots :: %{optional(String.t()) => any}
  @type request :: %{
          required(:component) => String.t(),
          required(:props) => props,
          required(:slots) => slots
        }

  @typedoc """
  A render response which should have shape

  %{
    html: string,
  }
  """
  @type render_response :: %{optional(String.t() | atom) => any}

  @callback render(request) :: binary() | render_response | no_return

  @spec render(request) :: render_response | no_return
  def render(%{component: component, props: _props, slots: _slots} = request)
      when is_binary(component) do
    case Application.get_env(:liveview_react, :ssr_module, nil) do
      nil ->
        raise LiveViewReact.SSR.NotConfigured

      mod ->
        metadata = %{component: component}

        :telemetry.span([:liveview_react, :ssr], metadata, fn ->
          {mod.render(request), metadata}
        end)
        |> parse_render_body()
    end
  end

  defp parse_render_body(body) when is_binary(body) do
    case String.split(body, "<!-- preload -->", parts: 2) do
      [links, html] -> %{preloadLinks: links, html: html}
      [html] -> %{preloadLinks: "", html: html}
    end
  end

  defp parse_render_body(%{html: html} = body) when is_binary(html), do: body

  defp parse_render_body(body) do
    raise LiveViewReact.SSR.RenderError,
      message: "SSR renderer returned an invalid response: #{inspect(body)}"
  end
end
