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
  alias LiveViewReact.Patch
  alias LiveViewReact.Slots
  alias LiveViewReact.SSR
  alias Phoenix.LiveView
  alias Phoenix.LiveView.LiveStream

  @ssr_default Application.compile_env(:liveview_react, :ssr, true)
  @diff_default Application.compile_env(:liveview_react, :enable_props_diff, true)
  @transport_version 1
  @reserved_assigns ~w(id component ssr diff socket __changed__ __given__)a

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
    diff = boolean_flag!(assigns, :diff, @diff_default)
    ssr = boolean_flag!(assigns, :ssr, @ssr_default)

    %{
      init: init,
      dead: dead,
      diff: diff,
      streams_diff: Enum.any?(assigns, fn {_k, v} -> match?(%LiveStream{}, v) end),
      ssr: init and dead and ssr
    }
  end

  defp boolean_flag!(assigns, key, default) do
    case Map.fetch(assigns, key) do
      :error ->
        default

      {:ok, value} when is_boolean(value) ->
        value

      {:ok, value} ->
        raise ArgumentError,
              "LiveViewReact.react/1 requires #{inspect(key)} to be a boolean, got: #{inspect(value)}"
    end
  end

  # Builds the assigns consumed by the template: props, diffs, slots and SSR output.
  defp prepare_assigns(assigns, flags) do
    transport_snapshot? = flags.init or flags.dead
    changed_assigns = Enum.filter(assigns, fn {key, _value} -> key_changed(assigns, key) end)
    stream_assigns = if transport_snapshot?, do: assigns, else: changed_assigns

    {raw_props, _} = extract(assigns, assigns, :props)
    props = Encoder.encode(raw_props, [])
    props_transport = build_props_transport(props, assigns, transport_snapshot? or not flags.diff)
    {streams, _} = extract(stream_assigns, assigns, :streams)
    {slots, slots_changed?} = extract(assigns, assigns, :slots)

    streams_diff =
      if flags.streams_diff,
        do: calculate_streams_diff(streams, transport_snapshot?),
        else: []

    assigns
    |> Map.put(:props, props)
    |> Map.put(:transport_version, @transport_version)
    |> Map.put(:props_payload, props_transport.snapshot)
    |> Map.put(:props_kind, props_transport.kind)
    |> Map.put(:props_diff, props_transport.patch)
    |> Map.put(:streams_diff, Patch.serialize(streams_diff))
    |> Map.put(:streams_kind, transport_kind(transport_snapshot?))
    |> Map.put(:slots, if(slots_changed?, do: Slots.rendered_slot_map(slots), else: %{}))
    |> put_ssr_render(flags)
    |> mark_computed_changed(flags, slots_changed?)
  end

  defp transport_kind(true), do: "snapshot"
  defp transport_kind(false), do: "patch"

  defp build_props_transport(props, _assigns, true) do
    %{kind: "snapshot", snapshot: Patch.encode_object(props), patch: ""}
  end

  defp build_props_transport(props, assigns, false) do
    snapshot = Patch.encode_object(props)
    patch = assigns |> calculate_props_diff(props) |> Patch.serialize()

    if byte_size(patch) < byte_size(snapshot) do
      %{kind: "patch", snapshot: nil, patch: patch}
    else
      %{kind: "snapshot", snapshot: snapshot, patch: ""}
    end
  end

  defp put_ssr_render(assigns, %{ssr: true}) do
    request = ssr_request(assigns)

    case render_ssr(request) do
      nil ->
        put_ssr_result(assigns, nil, nil)

      ssr_render ->
        descriptor = Map.put(request, :version, 1)
        put_ssr_result(assigns, ssr_render, descriptor)
    end
  end

  defp put_ssr_render(assigns, _flags), do: put_ssr_result(assigns, nil, nil)

  defp put_ssr_result(assigns, ssr_render, hydration_descriptor) do
    assigns
    |> Map.put(:ssr_render, ssr_render)
    |> Map.put(:hydration_descriptor, hydration_descriptor)
  end

  # Marks the assigns we computed ourselves as changed so LiveView diffs them.
  defp mark_computed_changed(assigns, flags, slots_changed?) do
    computed_changed = %{
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
  defp calculate_props_diff(%{__changed__: changed}, props) do
    changed
    |> Enum.sort_by(fn {key, _old_value} -> to_string(key) end)
    |> Enum.flat_map(fn {key, old_value} ->
      case Map.fetch(props, key) do
        {:ok, new_value} ->
          diff_changed_prop(pointer_path(key), old_value, new_value)

        :error ->
          removed_prop_diff(key, old_value)
      end
    end)
  end

  defp removed_prop_diff(key, old_value) do
    case normalize_key(key, old_value) do
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

  # Generates JSON patch operations for LiveStream changes.
  # Handles insertions and deletions for Phoenix LiveView streams.
  defp calculate_streams_diff(streams, initial)

  defp calculate_streams_diff(streams, true) do
    # for initial render, we want to reset all streams, and then apply the diffs
    init = Enum.map(streams, fn {k, _} -> %{op: "add", path: "/#{k}", value: []} end)
    diffs = Enum.flat_map(streams, fn {k, stream} -> generate_stream_patches(k, stream) end)
    init ++ diffs
  end

  defp calculate_streams_diff(streams, false) do
    Enum.flat_map(streams, fn {k, stream} -> generate_stream_patches(k, stream) end)
  end

  # Generates JSON patch operations for a single LiveStream's changes.
  defp generate_stream_patches(stream_name, %LiveStream{} = stream) do
    patches = []

    patches =
      if stream.reset?,
        do: [%{op: "replace", path: "/#{stream_name}", value: []} | patches],
        else: patches

    patches =
      Enum.reduce(stream.deletes, patches, fn dom_id, patches ->
        [%{op: "remove", path: "/#{stream_name}/$$#{dom_id}"} | patches]
      end)

    # Reversed - inserts at -1 should be correctly ordered, inserts at 0 should be reversed
    # see https://hexdocs.pm/phoenix_live_view/Phoenix.LiveView.html#stream/4 :at option
    stream.inserts
    |> Enum.reverse()
    |> Enum.reduce(patches, fn {dom_id, at, item, limit, update_only}, patches ->
      item = Map.put(Encoder.encode(item, []), :__dom_id, dom_id)

      patches =
        if update_only,
          do: [%{op: "replace", path: "/#{stream_name}/$$#{dom_id}", value: item} | patches],
          else: [
            %{
              op: "upsert",
              path: "/#{stream_name}/#{if at == -1, do: "-", else: at}",
              value: item
            }
            | patches
          ]

      if limit,
        do: [%{op: "limit", path: "/#{stream_name}", value: limit} | patches],
        else: patches
    end)
    |> Enum.reverse()
  end

  # `iterable` is the (possibly diff-filtered) collection of assigns to bucket by `type`.
  # `source` is always the original, unfiltered assigns map (with `__changed__` intact),
  # used for the `key_changed/2` lookups below regardless of what `iterable` is.
  defp extract(iterable, source, type) do
    Enum.reduce(iterable, {%{}, false}, fn {key, value}, {acc, changed} ->
      case normalize_key(key, value) do
        ^type -> {Map.put(acc, key, value), changed || key_changed(source, key)}
        _ -> {acc, changed}
      end
    end)
  end

  defp normalize_key(key, _val) when key in @reserved_assigns, do: :special

  defp normalize_key(_key, [%{__slot__: _}]), do: :slots
  defp normalize_key(key, val) when is_atom(key), do: key |> to_string() |> normalize_key(val)
  defp normalize_key(_key, %LiveStream{}), do: :streams
  defp normalize_key(_key, _val), do: :props

  defp key_changed(%{__changed__: nil}, _key), do: true
  defp key_changed(%{__changed__: changed}, key), do: Map.has_key?(changed, key)

  defp ssr_request(assigns) do
    %{
      component: assigns.component,
      props: assigns.props,
      slots: assigns.slots
    }
  end

  defp render_ssr(request) do
    SSR.render(request)
  rescue
    SSR.NotConfigured -> nil
  end

  defp json(data), do: Jason.encode!(data, escape: :html_safe)
end
