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
  @type events :: %{optional(String.t()) => any}
  @type slots :: %{optional(String.t()) => any}
  @type request :: %{
          required(:component) => String.t(),
          required(:events) => events,
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
  def render(request) do
    case normalize_request(request) do
      {:ok, normalized_request} ->
        render_with_configured_module(normalized_request)

      :error ->
        raise LiveViewReact.SSR.RenderError,
          message:
            "Invalid SSR render request: expected component, events, identifierPrefix, props, and slots"
    end
  end

  defp normalize_request(
         %{
           component: component,
           events: events,
           identifierPrefix: identifier_prefix,
           props: props,
           slots: slots
         } = request
       )
       when map_size(request) == 5 do
    case valid_request_fields?(component, events, identifier_prefix, props, slots) do
      true -> {:ok, request}
      false -> :error
    end
  end

  defp normalize_request(_request), do: :error

  defp valid_request_fields?(component, events, identifier_prefix, props, slots) do
    is_binary(component) and component != "" and
      is_map(events) and is_binary(identifier_prefix) and identifier_prefix != "" and
      is_map(props) and is_map(slots)
  end

  defp render_with_configured_module(%{component: component} = request) do
    case Application.get_env(:liveview_react, :ssr_module, nil) do
      nil -> raise LiveViewReact.SSR.NotConfigured
      mod -> perform_render(mod, request, %{component: component})
    end
  end

  defp perform_render(mod, request, metadata) do
    :telemetry.span([:liveview_react, :ssr], metadata, fn ->
      {mod.render(request), metadata}
    end)
    |> parse_render_body()
  end

  defp parse_render_body(body) when is_binary(body), do: %{html: body}

  defp parse_render_body(body) do
    raise LiveViewReact.SSR.RenderError,
      message: "SSR renderer returned an invalid response: #{inspect(body)}"
  end
end
