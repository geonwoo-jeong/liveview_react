defmodule LiveViewReact do
  @moduledoc """
  Phoenix function components for rendering React roots in LiveView.

  Every root requires an explicit DOM `id`, registry `component` name, and
  LiveView `socket`:

      <.react id="counter" component="Counter" socket={@socket} count={@count} />
  """

  use Phoenix.Component
  import Phoenix.HTML

  alias LiveViewReact.Encoder
  alias LiveViewReact.Events
  alias LiveViewReact.Patch
  alias LiveViewReact.Slots
  alias LiveViewReact.SSR
  alias LiveViewReact.StreamAdapter
  alias Phoenix.LiveView
  alias Phoenix.LiveView.LiveStream

  @ssr_default true
  @diff_default true
  @transport_version 2
  @reserved_assigns ~w(id component ssr diff socket __changed__ __given__)a
  @unsafe_property_names ~w(__proto__ constructor prototype)

  @doc """
  Renders one explicitly identified React component root.

  `:id` and `:component` must be non-empty strings, and `:socket` must be a
  `Phoenix.LiveView.Socket`. All remaining ordinary assigns are transported as
  props; streams and slots use their dedicated transports.
  """
  @spec react(map()) :: Phoenix.LiveView.Rendered.t()
  def react(assigns) when is_map(assigns) do
    validate_required_assigns!(assigns)

    flags = render_flags(assigns)
    assigns = prepare_assigns(assigns, flags)

    # Whitespace inside this element would become an SSR hydration text node.
    ~H"""
    <div
      id={@id}
      data-component={@component}
      data-liveview-react-version={@transport_version}
      data-props={@props_payload}
      data-props-kind={@props_kind}
      data-props-diff={@props_diff}
      data-streams-diff={@streams_diff}
      data-streams-kind={@streams_kind}
      data-events={json(@events)}
      data-slots={@slots |> Slots.base_encode_64() |> json()}
      phx-update="ignore"
      phx-hook="LiveViewReactHook"
    ><div
      data-react-target
      data-react-hydration={
        if is_map(@hydration_descriptor), do: json(@hydration_descriptor), else: nil
      }
    ><%= raw(@ssr_render[:html]) %></div></div>
    """
  end

  defp validate_required_assigns!(assigns) do
    validate_required_string!(assigns, :id)
    validate_required_string!(assigns, :component)

    case Map.fetch(assigns, :socket) do
      {:ok, %LiveView.Socket{}} ->
        :ok

      _ ->
        raise ArgumentError,
              "LiveViewReact.react/1 requires :socket to be a Phoenix.LiveView.Socket"
    end
  end

  defp validate_required_string!(assigns, key) do
    case Map.fetch(assigns, key) do
      {:ok, value} when is_binary(value) and value != "" ->
        :ok

      _ ->
        raise ArgumentError,
              "LiveViewReact.react/1 requires #{inspect(key)} to be a non-empty string"
    end
  end

  # Flags derived from the assigns that drive how the component is rendered.
  defp render_flags(assigns) do
    init = Map.get(assigns, :__changed__) == nil
    dead = not LiveView.connected?(assigns.socket)
    diff = render_flag!(assigns, :diff, :enable_props_diff, @diff_default)
    ssr = render_flag!(assigns, :ssr, :ssr, @ssr_default)

    %{
      init: init,
      dead: dead,
      diff: diff,
      ssr: init and dead and ssr
    }
  end

  defp render_flag!(assigns, key, config_key, default) do
    case Map.fetch(assigns, key) do
      :error ->
        configured_boolean!(config_key, default)

      {:ok, value} when is_boolean(value) ->
        value

      {:ok, value} ->
        raise ArgumentError,
              "LiveViewReact.react/1 requires #{inspect(key)} to be a boolean, got: #{inspect(value)}"
    end
  end

  defp configured_boolean!(key, default) do
    case Application.get_env(:liveview_react, key, default) do
      value when is_boolean(value) ->
        value

      value ->
        raise ArgumentError,
              "LiveViewReact expects config :liveview_react, #{inspect(key)} to be a boolean, got: #{inspect(value)}"
    end
  end

  # Builds the assigns consumed by the template: props, diffs, slots and SSR output.
  defp prepare_assigns(assigns, flags) do
    connected_snapshot? = flags.init or flags.dead
    changed_assigns = Enum.filter(assigns, fn {key, _value} -> key_changed(assigns, key) end)
    stream_assigns = if connected_snapshot?, do: assigns, else: changed_assigns

    {raw_props, _} = extract(assigns, assigns, :props)
    {events, events_changed?} = Events.extract(assigns, raw_props)
    props = Encoder.encode(raw_props, [])
    props_transport = build_props_transport(props, assigns, connected_snapshot? or not flags.diff)
    {all_streams, _} = extract(assigns, assigns, :streams)

    streams =
      if connected_snapshot? do
        all_streams
      else
        {changed_streams, _} = extract(stream_assigns, assigns, :streams)
        changed_streams
      end

    {slots, slots_changed?} = extract(assigns, assigns, :slots)
    slots_changed? = slots_changed? or possible_slot_removal?(assigns)
    rendered_slots = Slots.rendered_slot_map(slots)
    validate_component_prop_collisions!(raw_props, all_streams, events, rendered_slots)

    assigns
    |> Map.put(:props, props)
    |> Map.put(:events, events)
    |> Map.put(:transport_version, @transport_version)
    |> Map.put(:props_payload, props_transport.snapshot)
    |> Map.put(:props_kind, props_transport.kind)
    |> Map.put(:props_diff, props_transport.patch)
    |> Map.put(:slots, rendered_slots)
    |> put_ssr_render(flags, streams)
    |> put_stream_transport(streams, connected_snapshot?)
    |> mark_computed_changed(flags, slots_changed?, events_changed?)
  end

  defp build_props_transport(props, _assigns, true) do
    %{kind: "snapshot", snapshot: Patch.encode_object(props), patch: ""}
  end

  defp build_props_transport(props, assigns, false) do
    snapshot = Patch.encode_object(props)

    if ambiguous_removed_assign?(assigns) do
      %{kind: "snapshot", snapshot: snapshot, patch: ""}
    else
      patch = assigns |> calculate_props_diff(props) |> Patch.serialize()

      if byte_size(patch) < byte_size(snapshot) do
        %{kind: "patch", snapshot: nil, patch: patch}
      else
        %{kind: "snapshot", snapshot: snapshot, patch: ""}
      end
    end
  end

  defp put_ssr_render(assigns, %{ssr: true}, streams) do
    request = ssr_request(assigns, StreamAdapter.dead_render_snapshot(streams))

    case render_ssr(request) do
      nil ->
        put_ssr_result(assigns, nil, nil)

      ssr_render ->
        put_ssr_result(assigns, ssr_render, request)
    end
  end

  defp put_ssr_render(assigns, _flags, _streams), do: put_ssr_result(assigns, nil, nil)

  defp put_ssr_result(assigns, ssr_render, hydration_descriptor) do
    assigns
    |> Map.put(:ssr_render, ssr_render)
    |> Map.put(:hydration_descriptor, hydration_descriptor)
  end

  defp put_stream_transport(%{hydration_descriptor: descriptor} = assigns, _streams, _snapshot?)
       when is_map(descriptor) do
    assigns
    |> Map.put(:streams_diff, "")
    |> Map.put(:streams_kind, "hydration")
  end

  defp put_stream_transport(assigns, streams, true) do
    assigns
    |> Map.put(
      :streams_diff,
      streams |> StreamAdapter.connected_snapshot_patches() |> Patch.serialize()
    )
    |> Map.put(:streams_kind, "snapshot")
  end

  defp put_stream_transport(assigns, streams, false) do
    assigns
    |> Map.put(:streams_diff, streams |> StreamAdapter.incremental_patches() |> Patch.serialize())
    |> Map.put(:streams_kind, "patch")
  end

  # Marks the assigns we computed ourselves as changed so LiveView diffs them.
  defp mark_computed_changed(assigns, flags, slots_changed?, events_changed?) do
    computed_changed = %{
      events: events_changed?,
      transport_version: true,
      props_payload: true,
      props_kind: true,
      slots: slots_changed?,
      ssr_render: flags.ssr,
      hydration_descriptor: flags.ssr,
      props_diff: true,
      streams_diff: true,
      streams_kind: true
    }

    update_in(assigns.__changed__, fn
      nil -> nil
      changed -> for {k, true} <- computed_changed, into: changed, do: {k, true}
    end)
  end

  # Uses LiveView change tracking without adding a second server-side state store.
  # `add` is intentional for unknown/nil old values: for object properties it is
  # valid for both insertion and replacement, so an explicit nil prop is retained.
  defp calculate_props_diff(%{__changed__: changed} = assigns, props) do
    changed
    |> Enum.sort_by(fn {key, _old_value} -> to_string(key) end)
    |> Enum.flat_map(fn {key, old_value} ->
      case Map.fetch(props, key) do
        {:ok, new_value} ->
          diff_changed_prop(pointer_path(key), old_value, new_value)

        :error ->
          removed_prop_diff(assigns, key, old_value)
      end
    end)
  end

  # LiveView may track a removed default slot as `inner_block: true` instead of
  # retaining the prior slot entry. `inner_block` is reserved HEEx slot
  # metadata and was never an ordinary React prop, so it must not produce a
  # remove operation against the props object.
  defp removed_prop_diff(_assigns, key, _old_value)
       when key in [:inner_block, "inner_block"],
       do: []

  defp removed_prop_diff(assigns, key, old_value) do
    current_value = Map.get(assigns, key, old_value)

    case normalize_key(assigns, key, current_value) do
      :props -> [%{op: "remove", path: pointer_path(key)}]
      _type -> []
    end
  end

  defp diff_changed_prop(path, old_value, new_value) when old_value in [nil, true] do
    [%{op: "add", path: path, value: new_value}]
  end

  defp diff_changed_prop(path, old_value, new_value) do
    old_value
    |> Encoder.encode([])
    |> Jsonpatch.diff(new_value, ancestor_path: path, object_hash: &object_hash/1)
  end

  defp pointer_path(key) do
    escaped = key |> to_string() |> String.replace("~", "~0") |> String.replace("/", "~1")
    "/" <> escaped
  end

  defp object_hash(%{id: id}) when not is_nil(id), do: id
  defp object_hash(%{"id" => id}) when not is_nil(id), do: id
  defp object_hash(_), do: nil

  # `iterable` is the (possibly diff-filtered) collection of assigns to bucket by `type`.
  # `source` is always the original, unfiltered assigns map (with `__changed__` intact),
  # used for the `key_changed/2` lookups below regardless of what `iterable` is.
  defp extract(iterable, source, type) do
    Enum.reduce(iterable, {%{}, false}, fn {key, value}, {acc, changed} ->
      case normalize_key(source, key, value) do
        ^type -> {Map.put(acc, key, value), changed || key_changed(source, key)}
        _ -> {acc, changed}
      end
    end)
  end

  defp normalize_key(_source, key, _val) when key in @reserved_assigns, do: :special

  defp normalize_key(_source, "r-on:" <> _event_name, _value), do: :events

  defp normalize_key(source, key, value) do
    cond do
      slot_assign?(source, key, value) -> :slots
      is_atom(key) -> normalize_key(source, Atom.to_string(key), value)
      match?(%LiveStream{}, value) -> :streams
      true -> :props
    end
  end

  defp key_changed(%{__changed__: nil}, _key), do: true
  defp key_changed(%{__changed__: changed}, key), do: Map.has_key?(changed, key)

  defp slot_assign?(source, key, value) do
    slot_value?(value) or changed_from_slot?(source, key)
  end

  defp slot_value?([%{__slot__: _} | _rest]), do: true
  defp slot_value?(_value), do: false

  defp changed_from_slot?(%{__changed__: nil}, _key), do: false

  defp changed_from_slot?(%{__changed__: changed}, key) do
    changed
    |> Map.get(key)
    |> slot_value?()
  end

  # HEEx represents a conditional named slot that became false as an empty
  # list, which is indistinguishable from an ordinary empty-list prop. If such
  # an assign changed, refresh the authoritative slot map. Ordinary list props
  # pay only this small transport cost; stale named slots cannot survive.
  defp possible_slot_removal?(%{__changed__: nil}), do: false

  defp possible_slot_removal?(%{__changed__: changed} = assigns) do
    Enum.any?(changed, fn {key, old_value} ->
      Map.get(assigns, key) == [] or ambiguous_removed_assign?(assigns, key, old_value)
    end)
  end

  # A `true`/`nil` old value is LiveView's unknown-change sentinel, not enough
  # information to distinguish a removed arbitrary prop from erased named-slot
  # metadata. A full props snapshot clears either case correctly, and refreshing
  # slots prevents an erased slot from surviving on the client.
  defp ambiguous_removed_assign?(%{__changed__: changed} = assigns) do
    Enum.any?(changed, fn {key, old_value} ->
      ambiguous_removed_assign?(assigns, key, old_value)
    end)
  end

  defp ambiguous_removed_assign?(assigns, key, old_value) do
    old_value in [nil, true] and not Map.has_key?(assigns, key)
  end

  defp ssr_request(assigns, streams) do
    %{
      version: @transport_version,
      component: assigns.component,
      events: assigns.events,
      identifierPrefix: identifier_prefix(assigns.id),
      props: assigns.props,
      streams: streams,
      slots: assigns.slots
    }
  end

  defp identifier_prefix(root_id), do: "liveview-react-#{root_id}-"

  defp render_ssr(request) do
    SSR.render(request)
  rescue
    SSR.NotConfigured -> nil
  end

  defp validate_component_prop_collisions!(props, streams, events, slots) do
    namespaces = [
      {"ordinary props", normalized_prop_names!(Map.keys(props), "ordinary props")},
      {"streams", normalized_prop_names!(Map.keys(streams), "streams")},
      {"event props", normalized_prop_names!(Map.keys(events), "event props")},
      {"slot props",
       normalized_prop_names!(
         Enum.map(slots, fn {name, _} -> Slots.prop_name(name) end),
         "slot props"
       )}
    ]

    namespaces
    |> Enum.with_index()
    |> Enum.each(&validate_namespace_against_rest!(&1, namespaces))
  end

  defp validate_namespace_against_rest!({{left_label, left_names}, index}, namespaces) do
    namespaces
    |> Enum.drop(index + 1)
    |> Enum.each(fn {right_label, right_names} ->
      validate_namespace_pair!(left_label, left_names, right_label, right_names)
    end)
  end

  defp validate_namespace_pair!(left_label, left_names, right_label, right_names) do
    case left_names |> MapSet.intersection(right_names) |> Enum.sort() do
      [name | _rest] ->
        raise ArgumentError,
              "LiveViewReact.react/1 cannot merge colliding React prop #{inspect(name)} " <>
                "from #{left_label} and #{right_label}"

      [] ->
        :ok
    end
  end

  defp normalized_prop_names!(names, namespace) do
    Enum.reduce(names, MapSet.new(), fn key, normalized ->
      name = normalize_prop_name!(key, namespace)

      if MapSet.member?(normalized, name) do
        raise ArgumentError,
              "LiveViewReact.react/1 cannot merge duplicate React prop #{inspect(name)} " <>
                "within #{namespace}"
      end

      MapSet.put(normalized, name)
    end)
  end

  defp normalize_prop_name!(name, namespace) when is_atom(name),
    do: name |> Atom.to_string() |> normalize_prop_name!(namespace)

  defp normalize_prop_name!(name, namespace) when name in @unsafe_property_names do
    raise ArgumentError,
          "LiveViewReact.react/1 requires #{namespace} to reject prototype-sensitive " <>
            "React prop #{inspect(name)}"
  end

  defp normalize_prop_name!(name, _namespace) when is_binary(name) and name != "", do: name
  defp normalize_prop_name!(name, _namespace) when is_integer(name), do: Integer.to_string(name)

  defp normalize_prop_name!(name, namespace) do
    raise ArgumentError,
          "LiveViewReact.react/1 requires #{namespace} to use non-empty string-compatible names, " <>
            "got: #{inspect(name)}"
  end

  defp json(data), do: Jason.encode!(data, escape: :html_safe)
end
