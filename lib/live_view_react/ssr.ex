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
          required(:identifierPrefix) => String.t(),
          required(:props) => props,
          required(:slots) => slots
        }

  @typedoc """
  The normalized HTML returned by `render/1`.
  """
  @type render_response :: %{required(:html) => binary()}

  @callback render(request) :: binary() | no_return

  @spec render(request) :: render_response | no_return
  def render(
        %{
          component: component,
          identifierPrefix: identifier_prefix,
          props: props,
          slots: slots
        } = request
      )
      when map_size(request) == 4 and is_binary(component) and component != "" and
             is_binary(identifier_prefix) and identifier_prefix != "" and is_map(props) and
             is_map(slots) do
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

  def render(_request) do
    raise LiveViewReact.SSR.RenderError,
      message:
        "Invalid SSR render request: expected component, identifierPrefix, props, and slots"
  end

  defp parse_render_body(body) when is_binary(body), do: %{html: body}

  defp parse_render_body(body) do
    raise LiveViewReact.SSR.RenderError,
      message: "SSR renderer returned an invalid response: #{inspect(body)}"
  end
end
