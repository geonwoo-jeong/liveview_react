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

  alias LiveViewReact.StreamAdapter

  @transport_version 2
  @event_prop ~r/\Aon[A-Z][A-Za-z0-9]*\z/
  @event_operation ~r/\A[a-z][a-z0-9_]*\z/
  @slot_name ~r/\A[a-z][A-Za-z0-9_]*\z/
  @unsafe_property_names ~w(__proto__ constructor prototype)

  @type props :: %{optional(String.t() | atom) => any}
  @type stream_item :: %{required(String.t()) => any}
  @type streams :: %{required(String.t()) => [stream_item]}
  @type events :: %{optional(String.t()) => any}
  @type slots :: %{optional(String.t()) => any}
  @type request :: %{
          required(:version) => 2,
          required(:component) => String.t(),
          required(:events) => events,
          required(:identifierPrefix) => String.t(),
          required(:props) => props,
          required(:streams) => streams,
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
            "Invalid SSR render request: expected the exact transport v2 frame with " <>
              "version, component, identifierPrefix, props, streams, events, and slots"
    end
  end

  defp normalize_request(
         %{
           version: @transport_version,
           component: component,
           events: events,
           identifierPrefix: identifier_prefix,
           props: props,
           streams: streams,
           slots: slots
         } = request
       )
       when map_size(request) == 7 do
    case valid_request_fields?(component, events, identifier_prefix, props, streams, slots) do
      true -> {:ok, request}
      false -> :error
    end
  end

  defp normalize_request(_request), do: :error

  defp valid_request_fields?(component, events, identifier_prefix, props, streams, slots) do
    is_binary(component) and component != "" and
      valid_events?(events) and is_binary(identifier_prefix) and identifier_prefix != "" and
      plain_map?(props) and valid_stream_snapshot?(streams) and valid_slots?(slots) and
      collision_free?(props, streams, events, slots)
  end

  defp plain_map?(value), do: is_map(value) and not is_struct(value)

  defp valid_slots?(slots) do
    plain_map?(slots) and
      Enum.all?(slots, fn {name, html} ->
        is_binary(name) and
          name != "children" and
          name not in @unsafe_property_names and
          (name == "default" or Regex.match?(@slot_name, name)) and
          is_binary(html)
      end)
  end

  defp valid_events?(events) do
    plain_map?(events) and
      Enum.all?(events, fn
        {name, commands} when is_binary(name) and is_list(commands) ->
          Regex.match?(@event_prop, name) and
            Enum.all?(commands, fn
              [operation, options] when is_binary(operation) and is_map(options) ->
                Regex.match?(@event_operation, operation) and plain_map?(options)

              _command ->
                false
            end)

        _entry ->
          false
      end)
  end

  defp valid_stream_snapshot?(streams) do
    StreamAdapter.validate_snapshot!(streams)
    true
  rescue
    ArgumentError -> false
  end

  defp collision_free?(props, streams, events, slots) do
    with {:ok, prop_names} <- normalized_names(Map.keys(props)),
         {:ok, stream_names} <- normalized_names(Map.keys(streams)),
         {:ok, event_names} <- normalized_names(Map.keys(events)),
         {:ok, slot_names} <-
           normalized_names(Enum.map(slots, fn {name, _html} -> slot_prop_name(name) end)) do
      pairwise_disjoint?([prop_names, stream_names, event_names, slot_names])
    else
      :error -> false
    end
  end

  defp normalized_names(names) do
    Enum.reduce_while(names, {:ok, MapSet.new()}, fn name, {:ok, normalized} ->
      case normalize_name(name) do
        {:ok, name} -> put_normalized_name(name, normalized)
        :error -> {:halt, :error}
      end
    end)
  end

  defp put_normalized_name(name, normalized) do
    if MapSet.member?(normalized, name) do
      {:halt, :error}
    else
      {:cont, {:ok, MapSet.put(normalized, name)}}
    end
  end

  defp normalize_name(name) when is_atom(name), do: name |> Atom.to_string() |> normalize_name()

  defp normalize_name(name)
       when is_binary(name) and name != "" and name not in @unsafe_property_names,
       do: {:ok, name}

  defp normalize_name(name) when is_integer(name), do: {:ok, Integer.to_string(name)}
  defp normalize_name(_name), do: :error

  defp pairwise_disjoint?([]), do: true

  defp pairwise_disjoint?([names | rest]) do
    Enum.all?(rest, &MapSet.disjoint?(names, &1)) and pairwise_disjoint?(rest)
  end

  defp slot_prop_name("default"), do: "children"
  defp slot_prop_name(name), do: name

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
