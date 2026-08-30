defmodule LiveViewReact.Test do
  @moduledoc """
  Helpers for inspecting LiveViewReact roots in rendered LiveView HTML.

  ## Examples

      {:ok, view, _html} = live(conn, "/")
      react = LiveViewReact.Test.get_react(view)

      assert react.component == "MyComponent"
      assert react.props["title"] == "Hello"

  ## Configuration

  ### enable_props_diff

  Set `enable_props_diff` to `false` to inspect full props on every render:

  ```elixir
  # config/test.exs
  config :liveview_react,
    enable_props_diff: false
  ```

  """

  @compile {:no_warn_undefined, Floki}
  @event_prop ~r/\Aon[A-Z][A-Za-z0-9]*\z/
  @event_operation ~r/\A[a-z][a-z0-9_]*\z/
  @slot_name ~r/\A[a-z][A-Za-z0-9_]*\z/
  @unsafe_property_names ~w(__proto__ constructor prototype)

  @doc """
  Extracts React component information from a LiveView or HTML string.

  When multiple roots are present, select one with `:component` or `:id`.

  Returns a map containing the component's configuration:
    * `:component` - The registry component name
    * `:id` - The required unique component identifier
    * `:props` - The decoded props passed to the component
    * `:events` - The encoded Phoenix JS command chains keyed by React callback prop
    * `:slots` - decoded slot HTML keyed by slot name
    * `:ssr` - Boolean indicating if server-side rendering was performed
    * `:hydration` - The decoded immutable SSR hydration descriptor, or `nil`
    * `:props_kind` - `"snapshot"` or `"patch"`
    * `:streams_kind` - `"snapshot"`, `"patch"`, or `"hydration"`
    * `:transport_version` - the integer wire protocol version

  ## Options
    * `:component` - Find a root by registry component name
    * `:id` - Find component by ID

  ## Examples

      {:ok, view, _html} = live(conn, "/")
      react = LiveViewReact.Test.get_react(view)

      react = LiveViewReact.Test.get_react(view, component: "MyComponent")
      react = LiveViewReact.Test.get_react(view, id: "my-component-1")
  """
  def get_react(view, opts \\ [])

  def get_react(view, opts) when is_struct(view, Phoenix.LiveViewTest.View) do
    view |> Phoenix.LiveViewTest.render() |> get_react(opts)
  end

  def get_react(html, opts) when is_binary(html) do
    if Code.ensure_loaded?(Floki) do
      react =
        html
        |> Floki.parse_document!()
        |> Floki.find("[phx-hook='LiveViewReactHook']")
        |> find_component!(opts)

      component = attr(react, "data-component")
      id = attr(react, "id")
      react_target = direct_react_target!(react)
      hydration = decode_hydration_descriptor(react_target)
      validate_hydration_component!(hydration, component)
      validate_hydration_identifier_prefix!(hydration, id)
      streams_diff = LiveViewReact.Patch.deserialize(attr(react, "data-streams-diff") || "")
      streams_kind = attr(react, "data-streams-kind")
      validate_stream_transport!(hydration, streams_kind, streams_diff)

      %{
        props: decode_props(attr(react, "data-props")),
        events: decode_events(attr(react, "data-events")),
        component: component,
        id: id,
        slots: extract_base64_slots(attr(react, "data-slots")),
        ssr: hydration != nil,
        hydration: hydration,
        transport_version: decode_transport_version(attr(react, "data-liveview-react-version")),
        props_kind: attr(react, "data-props-kind"),
        props_diff: LiveViewReact.Patch.deserialize(attr(react, "data-props-diff") || ""),
        streams_diff: streams_diff,
        streams_kind: streams_kind
      }
    else
      raise "Floki is not installed. Add {:floki, \"~> 0.38\", only: :test} to use LiveViewReact.Test"
    end
  end

  defp decode_props(nil), do: nil
  defp decode_props(props), do: LiveViewReact.Patch.decode_object(props)

  defp decode_events(events) when is_binary(events) do
    case Jason.decode!(events) do
      decoded when is_map(decoded) -> decoded
      _decoded -> raise "LiveViewReact data-events must contain a JSON object"
    end
  end

  defp decode_events(_events), do: raise("LiveViewReact data-events must contain a JSON object")

  defp decode_transport_version("2"), do: 2

  defp decode_transport_version(_version) do
    raise "LiveViewReact root must use transport version 2"
  end

  defp extract_base64_slots(slots) do
    slots
    |> Jason.decode!()
    |> Enum.map(fn {key, value} -> {key, Base.decode64!(value)} end)
    |> Enum.into(%{})
  end

  defp find_component!(components, opts) do
    available =
      Enum.map_join(components, ", ", &"#{attr(&1, "data-component")}##{attr(&1, "id")}")

    components = Enum.reduce(opts, components, &filter_components!(&1, &2, available))

    case components do
      [react | _] ->
        react

      [] ->
        raise "No LiveViewReact components found in the rendered HTML"
    end
  end

  defp filter_components!({:id, id}, components, available) do
    filter_components!(components, "id", id, available)
  end

  defp filter_components!({:component, component}, components, available) do
    filter_components!(components, "data-component", component, available)
  end

  defp filter_components!({key, _value}, _components, _available) do
    raise ArgumentError, "invalid keyword option for get_react/2: #{key}"
  end

  defp filter_components!(components, attribute, value, available) do
    case Enum.filter(components, &(attr(&1, attribute) == value)) do
      [] ->
        label = if attribute == "id", do: "id", else: "component"

        raise "No LiveViewReact component found with #{label}=\"#{value}\". " <>
                "Available components: #{available}"

      matches ->
        matches
    end
  end

  defp attr(element, name) do
    case Floki.attribute(element, name) do
      [value] -> value
      [] -> nil
    end
  end

  defp direct_react_target!(react) do
    targets =
      Enum.filter(Floki.children(react), fn
        {_tag, _attributes, _children} = child -> has_attr?(child, "data-react-target")
        _other -> false
      end)

    case targets do
      [target] -> target
      _targets -> raise "LiveViewReact root must contain exactly one direct React target"
    end
  end

  defp has_attr?(element, name), do: Floki.attribute(element, name) != []

  defp decode_hydration_descriptor(target) do
    case attr(target, "data-react-hydration") do
      nil -> nil
      descriptor -> descriptor |> Jason.decode!() |> validate_hydration_descriptor!()
    end
  end

  defp validate_hydration_descriptor!(descriptor) do
    case hydration_descriptor_fields(descriptor) do
      {:ok, fields} ->
        validate_hydration_fields!(descriptor, fields)

      :error ->
        raise "Invalid data-react-hydration descriptor"
    end
  end

  defp valid_string_map?(map) do
    Enum.all?(map, fn {name, value} -> is_binary(name) and is_binary(value) end)
  end

  defp valid_hydration_payload?(props, streams, slots, events) do
    plain_map?(props) and valid_stream_snapshot?(streams) and
      valid_slot_map?(slots) and valid_event_map?(events) and
      collision_free?(props, streams, events, slots)
  end

  defp hydration_descriptor_fields(descriptor)
       when is_map(descriptor) and map_size(descriptor) == 7 do
    with {:ok, 2} <- Map.fetch(descriptor, "version"),
         {:ok, component} <- Map.fetch(descriptor, "component"),
         {:ok, events} <- Map.fetch(descriptor, "events"),
         {:ok, identifier_prefix} <- Map.fetch(descriptor, "identifierPrefix"),
         {:ok, props} <- Map.fetch(descriptor, "props"),
         {:ok, streams} <- Map.fetch(descriptor, "streams"),
         {:ok, slots} <- Map.fetch(descriptor, "slots") do
      {:ok,
       %{
         component: component,
         events: events,
         identifier_prefix: identifier_prefix,
         props: props,
         streams: streams,
         slots: slots
       }}
    else
      _other -> :error
    end
  end

  defp hydration_descriptor_fields(_descriptor), do: :error

  defp validate_hydration_fields!(
         descriptor,
         %{
           component: component,
           events: events,
           identifier_prefix: identifier_prefix,
           props: props,
           streams: streams,
           slots: slots
         }
       ) do
    case valid_hydration_fields?(component, events, identifier_prefix, props, streams, slots) do
      true -> descriptor
      false -> raise "Invalid data-react-hydration descriptor"
    end
  end

  defp valid_hydration_fields?(component, events, identifier_prefix, props, streams, slots) do
    is_binary(component) and component != "" and
      is_binary(identifier_prefix) and identifier_prefix != "" and
      valid_hydration_payload?(props, streams, slots, events)
  end

  defp plain_map?(value), do: is_map(value) and not is_struct(value)

  defp valid_stream_snapshot?(streams) do
    LiveViewReact.StreamAdapter.validate_snapshot!(streams)
    true
  rescue
    ArgumentError -> false
  end

  defp valid_slot_map?(slots) do
    valid_string_map?(slots) and
      Enum.all?(slots, fn {name, _html} ->
        name != "children" and name not in @unsafe_property_names and
          (name == "default" or Regex.match?(@slot_name, name))
      end)
  end

  defp collision_free?(props, streams, events, slots) do
    namespaces = [
      Map.keys(props),
      Map.keys(streams),
      Map.keys(events),
      Enum.map(slots, fn {name, _html} -> LiveViewReact.Slots.prop_name(name) end)
    ]

    safe_names? =
      Enum.all?(namespaces, fn names ->
        Enum.all?(names, &(&1 not in @unsafe_property_names))
      end)

    normalized = Enum.map(namespaces, &MapSet.new/1)

    safe_names? and
      normalized
      |> Enum.with_index()
      |> Enum.all?(fn {left, index} ->
        normalized
        |> Enum.drop(index + 1)
        |> Enum.all?(&MapSet.disjoint?(left, &1))
      end)
  end

  defp valid_event_map?(map) do
    plain_map?(map) and
      Enum.all?(map, fn
        {name, commands} when is_binary(name) and is_list(commands) ->
          Regex.match?(@event_prop, name) and
            Enum.all?(commands, fn
              [operation, options] when is_binary(operation) and is_map(options) ->
                Regex.match?(@event_operation, operation)

              _command ->
                false
            end)

        _entry ->
          false
      end)
  end

  defp validate_stream_transport!(nil, kind, _diff) when kind in ["snapshot", "patch"], do: :ok

  defp validate_stream_transport!(%{} = _hydration, "hydration", []), do: :ok

  defp validate_stream_transport!(_hydration, _kind, _diff) do
    raise "Invalid LiveViewReact stream transport"
  end

  defp validate_hydration_component!(nil, _component), do: :ok

  defp validate_hydration_component!(%{"component" => component}, component), do: :ok

  defp validate_hydration_component!(_hydration, _component) do
    raise "data-react-hydration component must match data-component"
  end

  defp validate_hydration_identifier_prefix!(nil, _id), do: :ok

  defp validate_hydration_identifier_prefix!(
         %{"identifierPrefix" => "liveview-react-" <> rest},
         id
       )
       when rest == id <> "-" do
    :ok
  end

  defp validate_hydration_identifier_prefix!(_hydration, _id) do
    raise "data-react-hydration identifierPrefix must match the root id"
  end
end
