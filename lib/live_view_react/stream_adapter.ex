defmodule LiveViewReact.StreamAdapter do
  @moduledoc false

  alias LiveViewReact.Encoder
  alias Phoenix.LiveView.LiveStream

  @max_safe_integer 9_007_199_254_740_991
  @unsafe_property_names ~w(__proto__ constructor prototype)

  @typedoc "A patch operation consumed by LiveViewReact's stream transport."
  @type patch :: %{
          required(:op) => String.t(),
          required(:path) => String.t(),
          optional(:value) => term()
        }

  @typedoc "A materialized stream item containing Phoenix's computed DOM id."
  @type snapshot_item :: %{required(String.t()) => term()}

  @typedoc "The immutable stream snapshot used for dead-render SSR and hydration."
  @type snapshot :: %{required(String.t()) => [snapshot_item()]}

  @typedoc "One canonical connected or incremental stream operation value."
  @type frame :: %{required(String.t()) => term()}

  @doc """
  Materializes Phoenix's disconnected/dead-render view of each stream.

  This intentionally uses `LiveStream.mark_consumable/1` and the stream's
  `Enumerable` implementation, exactly like a HEEx stream comprehension. As a
  result, the newest duplicate DOM id wins while `at`, `limit`, `update_only`,
  deletes, and reset metadata do not alter the dead-render snapshot.
  """
  @spec dead_render_snapshot(map()) :: snapshot()
  def dead_render_snapshot(streams) do
    streams
    |> normalize_streams!()
    |> Map.new(fn {name, stream} ->
      {name, materialized_items!(name, stream)}
    end)
  end

  @doc """
  Builds authoritative connected/reconnect stream frames.

  Each present stream is represented by one atomic `stream` operation. Its
  value preserves the rendered item order and Phoenix's raw insertion metadata
  separately so the client can reconcile against prior state without losing
  `update_only` or per-insert limit semantics.
  """
  @spec connected_snapshot_patches(map()) :: [patch()]
  def connected_snapshot_patches(streams), do: canonical_stream_frames(streams)

  @doc """
  Builds canonical incremental frames for already-established connected state.

  Application mode is intentionally carried by the outer `data-streams-kind`
  transport attribute, not by a boolean or alternate frame shape here.
  """
  @spec incremental_patches(map()) :: [patch()]
  def incremental_patches(streams), do: canonical_stream_frames(streams)

  @doc false
  @spec validate_snapshot!(term()) :: snapshot()
  def validate_snapshot!(snapshot) when is_map(snapshot) and not is_struct(snapshot) do
    Enum.each(snapshot, fn
      {name, items} when is_binary(name) and name != "" and is_list(items) ->
        validate_safe_property_name!(name, "stream snapshot")
        validate_snapshot_items!(name, items)

      entry ->
        raise ArgumentError,
              "stream snapshots must map non-empty string names to item lists, got: #{inspect(entry)}"
    end)

    snapshot
  end

  def validate_snapshot!(snapshot) do
    raise ArgumentError,
          "stream snapshots must be plain maps, got: #{inspect(snapshot)}"
  end

  @doc false
  @spec validate_frame!(term()) :: frame()
  def validate_frame!(
        %{
          "items" => items,
          "inserts" => inserts,
          "deletes" => deletes,
          "reset" => reset
        } = frame
      )
      when map_size(frame) == 4 and is_list(items) and is_list(inserts) and
             is_list(deletes) and is_boolean(reset) do
    validate_snapshot!(%{"stream" => items})
    insert_ids = Enum.map(inserts, &validate_frame_insert!/1)
    Enum.each(deletes, &validate_dom_id!(&1, "frame", "delete"))
    validate_frame_membership!(items, insert_ids)
    frame
  end

  def validate_frame!(frame) do
    raise ArgumentError,
          "stream frames require exactly items, inserts, deletes, and reset fields, got: #{inspect(frame)}"
  end

  defp normalize_streams!(streams) when is_map(streams) and not is_struct(streams) do
    streams
    |> Enum.map(&normalize_stream!/1)
    |> Enum.sort_by(fn {name, _stream} -> name end)
    |> reject_duplicate_names!()
  end

  defp normalize_streams!(streams) do
    raise ArgumentError,
          "streams must be a map of Phoenix.LiveView.LiveStream values, got: #{inspect(streams)}"
  end

  defp validate_snapshot_items!(name, items) do
    Enum.reduce(items, MapSet.new(), &validate_snapshot_item!(&1, name, &2))
  end

  defp validate_frame_insert!([dom_id, at, limit, update_only])
       when is_boolean(update_only) do
    validate_dom_id!(dom_id, "frame", "insert")
    validate_position!(at, "frame")
    validate_limit!(limit, "frame")
    dom_id
  end

  defp validate_frame_insert!(insert) do
    raise ArgumentError,
          "stream frame inserts must be [domId, at, limit, updateOnly] with a boolean updateOnly, " <>
            "got: #{inspect(insert)}"
  end

  defp validate_frame_membership!(items, insert_ids) do
    item_ids = MapSet.new(items, &Map.fetch!(&1, "__dom_id"))

    if item_ids != MapSet.new(insert_ids) do
      raise ArgumentError,
            "stream frame item DOM ids must match its insertion metadata DOM ids"
    end
  end

  defp validate_snapshot_item!(item, name, dom_ids) do
    unless plain_json_object?(item) do
      raise ArgumentError,
            "stream #{inspect(name)} snapshot items must be immutable plain JSON objects"
    end

    item
    |> snapshot_dom_id!(name)
    |> put_unique_dom_id!(name, dom_ids)
  end

  defp snapshot_dom_id!(item, name) do
    case Map.fetch(item, "__dom_id") do
      {:ok, dom_id} when is_binary(dom_id) and dom_id != "" ->
        dom_id

      _other ->
        raise ArgumentError,
              "stream #{inspect(name)} snapshot items require a non-empty string __dom_id"
    end
  end

  defp put_unique_dom_id!(dom_id, name, dom_ids) do
    if MapSet.member?(dom_ids, dom_id) do
      raise ArgumentError,
            "stream #{inspect(name)} snapshot contains duplicate DOM id #{inspect(dom_id)}"
    end

    MapSet.put(dom_ids, dom_id)
  end

  defp plain_json_object?(value) when is_map(value) and not is_struct(value) do
    Enum.all?(value, fn {key, item} ->
      is_binary(key) and key not in @unsafe_property_names and plain_json_value?(item)
    end)
  end

  defp plain_json_object?(_value), do: false

  defp plain_json_value?(value)
       when is_nil(value) or is_boolean(value) or is_binary(value) or is_number(value),
       do: true

  defp plain_json_value?(value) when is_list(value), do: Enum.all?(value, &plain_json_value?/1)
  defp plain_json_value?(value), do: plain_json_object?(value)

  defp normalize_stream!({key, %LiveStream{} = stream}) do
    name = normalize_name!(key, "stream map key")
    struct_name = normalize_name!(stream.name, "LiveStream.name")

    if name != struct_name do
      raise ArgumentError,
            "stream map key #{inspect(key)} does not match LiveStream.name #{inspect(stream.name)}"
    end

    validate_stream_shape!(name, stream)
    {name, stream}
  end

  defp normalize_stream!({key, value}) do
    raise ArgumentError,
          "stream #{inspect(key)} must be a Phoenix.LiveView.LiveStream, got: #{inspect(value)}"
  end

  defp normalize_name!(name, source) when is_atom(name),
    do: name |> Atom.to_string() |> normalize_name!(source)

  defp normalize_name!(name, source) when is_binary(name) and name != "" do
    validate_safe_property_name!(name, source)
  end

  defp normalize_name!(name, source) do
    raise ArgumentError, "#{source} must be an atom or non-empty string, got: #{inspect(name)}"
  end

  defp validate_stream_shape!(name, %LiveStream{} = stream) do
    unless is_function(stream.dom_id, 1) do
      raise ArgumentError,
            "stream #{inspect(name)} has an invalid DOM id function: #{inspect(stream.dom_id)}"
    end

    unless is_list(stream.inserts) do
      raise ArgumentError,
            "stream #{inspect(name)} has unsupported inserts: #{inspect(stream.inserts)}"
    end

    unless is_list(stream.deletes) do
      raise ArgumentError,
            "stream #{inspect(name)} has unsupported deletes: #{inspect(stream.deletes)}"
    end

    unless is_boolean(stream.reset?) do
      raise ArgumentError,
            "stream #{inspect(name)} has an invalid reset flag: #{inspect(stream.reset?)}"
    end

    unless is_boolean(stream.consumable?) do
      raise ArgumentError,
            "stream #{inspect(name)} has an invalid consumable flag: #{inspect(stream.consumable?)}"
    end

    Enum.each(stream.inserts, &validate_insert_tuple!(&1, name))
    Enum.each(stream.deletes, &validate_dom_id!(&1, name, "delete"))
  end

  defp validate_insert_tuple!({dom_id, at, _item, limit, update_only}, name) do
    validate_dom_id!(dom_id, name, "insert")
    validate_position!(at, name)
    validate_limit!(limit, name)
    validate_update_only!(update_only, name)
    :ok
  end

  defp validate_insert_tuple!(tuple, name) do
    raise ArgumentError,
          "stream #{inspect(name)} has an unsupported insert tuple: #{inspect(tuple)}; " <>
            "expected {dom_id, at, item, limit, update_only}"
  end

  defp reject_duplicate_names!([{name, _left}, {name, _right} | _rest]) do
    raise ArgumentError, "stream names must be unique after normalization: #{inspect(name)}"
  end

  defp reject_duplicate_names!([entry | rest]), do: [entry | reject_duplicate_names!(rest)]
  defp reject_duplicate_names!([]), do: []

  defp canonical_stream_frames(streams) do
    streams
    |> normalize_streams!()
    |> Enum.map(fn {name, stream} ->
      %{op: "stream", path: pointer_path(name), value: stream_frame(name, stream)}
    end)
  end

  defp stream_frame(name, stream) do
    %{
      "items" => materialized_items!(name, stream),
      "inserts" => Enum.map(stream.inserts, &insert_metadata!(&1, name)),
      "deletes" => Enum.map(stream.deletes, &validate_dom_id!(&1, name, "delete")),
      "reset" => stream.reset?
    }
  end

  defp materialized_items!(name, stream) do
    stream
    |> LiveStream.mark_consumable()
    |> Enum.map(fn {dom_id, item} -> encode_item!(item, dom_id, name) end)
  end

  defp insert_metadata!({dom_id, at, _item, limit, update_only}, name) do
    dom_id = validate_dom_id!(dom_id, name, "insert")
    at = validate_position!(at, name)
    limit = validate_limit!(limit, name)
    update_only = validate_update_only!(update_only, name)

    [dom_id, at, limit, update_only]
  end

  defp insert_metadata!(tuple, name) do
    raise ArgumentError,
          "stream #{inspect(name)} has an unsupported insert tuple: #{inspect(tuple)}; " <>
            "expected {dom_id, at, item, limit, update_only}"
  end

  defp validate_dom_id!(dom_id, _name, _operation)
       when is_binary(dom_id) and dom_id != "",
       do: dom_id

  defp validate_dom_id!(dom_id, name, operation) do
    raise ArgumentError,
          "stream #{inspect(name)} #{operation} DOM id must be a non-empty string, got: #{inspect(dom_id)}"
  end

  defp validate_position!(-1, _name), do: -1

  defp validate_position!(at, _name)
       when is_integer(at) and at >= 0 and at <= @max_safe_integer,
       do: at

  defp validate_position!(at, name) do
    raise ArgumentError,
          "stream #{inspect(name)} insert position must be -1 or a non-negative safe integer, got: #{inspect(at)}"
  end

  defp validate_limit!(nil, _name), do: nil

  defp validate_limit!(limit, _name)
       when is_integer(limit) and limit >= -@max_safe_integer and limit <= @max_safe_integer,
       do: limit

  defp validate_limit!(limit, name) do
    raise ArgumentError,
          "stream #{inspect(name)} limit must be nil or a safe integer, got: #{inspect(limit)}"
  end

  defp validate_update_only!(value, _name) when value in [nil, false], do: false
  defp validate_update_only!(true, _name), do: true

  defp validate_update_only!(value, name) do
    raise ArgumentError,
          "stream #{inspect(name)} update_only must be a boolean, got: #{inspect(value)}"
  end

  defp encode_item!(item, dom_id, name) do
    case Encoder.encode(item, []) do
      encoded when is_map(encoded) and not is_struct(encoded) ->
        encoded
        |> canonical_json_object!(name)
        |> Map.delete("__dom_id")
        |> Map.put("__dom_id", dom_id)

      _encoded ->
        raise ArgumentError,
              "stream #{inspect(name)} items must encode to immutable plain JSON objects"
    end
  end

  defp canonical_json_object!(map, name) do
    Enum.reduce(map, %{}, fn {key, value}, normalized ->
      key = canonical_json_key!(key, name)

      if Map.has_key?(normalized, key) do
        raise ArgumentError,
              "stream #{inspect(name)} item contains duplicate JSON key #{inspect(key)}"
      end

      Map.put(normalized, key, canonical_json_value!(value, name))
    end)
  end

  defp canonical_json_key!(key, name) when is_atom(key),
    do: key |> Atom.to_string() |> canonical_json_key!(name)

  defp canonical_json_key!(key, name) when is_binary(key) do
    validate_safe_property_name!(key, "stream #{inspect(name)} item")
  end

  defp canonical_json_key!(key, name) do
    raise ArgumentError,
          "stream #{inspect(name)} item contains a non-string JSON key: #{inspect(key)}"
  end

  defp canonical_json_value!(value, _name)
       when is_nil(value) or is_boolean(value) or is_binary(value) or is_number(value),
       do: value

  defp canonical_json_value!(value, _name) when is_atom(value), do: Atom.to_string(value)

  defp canonical_json_value!(value, name) when is_list(value),
    do: Enum.map(value, &canonical_json_value!(&1, name))

  defp canonical_json_value!(value, name) when is_map(value) and not is_struct(value),
    do: canonical_json_object!(value, name)

  defp canonical_json_value!(value, name) do
    raise ArgumentError,
          "stream #{inspect(name)} item contains a non-JSON value: #{inspect(value)}"
  end

  defp validate_safe_property_name!(name, source) when name in @unsafe_property_names do
    raise ArgumentError,
          "#{source} cannot contain prototype-sensitive key #{inspect(name)}"
  end

  defp validate_safe_property_name!(name, _source), do: name

  defp pointer_path(name), do: "/" <> escape_pointer_segment(name)

  defp escape_pointer_segment(segment) do
    segment
    |> String.replace("~", "~0")
    |> String.replace("/", "~1")
  end

  # No `patches/2` compatibility alias is intentionally provided. Transport
  # v2 makes dead render, connected snapshot, and incremental semantics
  # explicit at every call site.
end
