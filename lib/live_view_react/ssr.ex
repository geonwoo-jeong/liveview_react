defmodule LiveViewReact.SSR.NotConfigured do
  @moduledoc """
  Raised when server-side rendering is requested but its infrastructure is
  unavailable.

  This includes a missing `:ssr_module`, an unavailable optional renderer
  runtime, or an SSR process that has not been started.
  """

  defexception message: "LiveViewReact server-side rendering is not configured"

  @typedoc "The exception raised when SSR infrastructure is unavailable."
  @type t :: %__MODULE__{message: String.t()}
end

defmodule LiveViewReact.SSR.RenderError do
  @moduledoc """
  Raised when an SSR request is invalid or a configured renderer fails.

  The built-in renderers use this exception for transport failures, timeouts,
  rendering errors, and invalid responses. `LiveViewReact.SSR.render/1` also
  raises it when a request does not match the transport contract.
  """

  defexception [:message]

  @typedoc "The exception raised for an invalid SSR request, failure, or response."
  @type t :: %__MODULE__{message: String.t()}
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

  @typedoc "A JSON-compatible value used in a materialized stream item."
  @type json_value ::
          nil
          | boolean()
          | number()
          | String.t()
          | [json_value()]
          | %{optional(String.t()) => json_value()}

  @typedoc """
  The plain prop map passed to an SSR renderer.

  Keys must be non-empty, string-compatible names and cannot use
  prototype-sensitive JavaScript property names.
  """
  @type props :: %{optional(String.t() | atom() | integer()) => term()}

  @typedoc """
  A materialized stream item passed to an SSR renderer.

  Every item is a plain JSON object with string keys and a unique, non-empty
  `"__dom_id"` string field.
  """
  @type stream_item :: %{required(String.t()) => json_value()}

  @typedoc "A dead-render stream snapshot keyed by non-empty stream name."
  @type streams :: %{optional(String.t()) => [stream_item()]}

  @typedoc """
  One Phoenix JavaScript command encoded for an SSR event callback.

  The command is exactly `[operation, options]`, where `operation` is a
  lowercase command name and `options` is a plain map. Elixir typespecs cannot
  express a fixed-length heterogeneous list, so the element type below is
  intentionally broader than the runtime validation.
  """
  @type event_command :: nonempty_list(String.t() | map())

  @typedoc """
  Event callback props mapped to ordered Phoenix JavaScript command lists.

  Event names use React's `onEvent` naming convention.
  """
  @type events :: %{optional(String.t()) => [event_command()]}

  @typedoc "Rendered slot HTML keyed by `default` or a named slot."
  @type slots :: %{optional(String.t()) => String.t()}

  @typedoc """
  The exact transport-v2 request passed to a configured SSR renderer.

  All seven fields are required and additional fields are rejected.
  """
  @type request :: %{
          required(:version) => 2,
          required(:component) => String.t(),
          required(:events) => events(),
          required(:identifierPrefix) => String.t(),
          required(:props) => props(),
          required(:streams) => streams(),
          required(:slots) => slots()
        }

  @typedoc """
  The normalized HTML returned by `render/1`.
  """
  @type render_response :: %{required(:html) => binary()}

  @doc """
  Renders one validated transport-v2 request as a complete HTML binary.

  Renderer implementations should raise `LiveViewReact.SSR.NotConfigured`
  when their infrastructure is unavailable and
  `LiveViewReact.SSR.RenderError` when rendering fails.
  """
  @callback render(request()) :: binary()

  @doc """
  Validates and renders a transport-v2 request with the configured SSR module.

  Returns the renderer's HTML in a normalized `%{html: html}` response. Raises
  `LiveViewReact.SSR.NotConfigured` when required SSR infrastructure is
  unavailable and `LiveViewReact.SSR.RenderError` when the request or renderer
  response is invalid, or when a built-in renderer fails. Other exceptions
  raised by a custom renderer propagate unchanged.
  """
  @spec render(request()) :: render_response()
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
