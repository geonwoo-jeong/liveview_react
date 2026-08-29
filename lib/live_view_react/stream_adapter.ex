defmodule LiveViewReact.StreamAdapter do
  @moduledoc false

  alias LiveViewReact.Encoder
  alias Phoenix.LiveView.LiveStream

  @max_safe_integer 9_007_199_254_740_991

  @typedoc "A patch operation consumed by LiveViewReact's stream transport."
  @type patch :: %{
          required(:op) => String.t(),
          required(:path) => String.t(),
          optional(:value) => term()
        }

  # A LiveViewReact snapshot is an authoritative React client frame, not the
  # no-websocket Phoenix dead render. Limits remain in snapshots so mount and
  # recovery reconstruct the same bounded state.
  @doc false
  @spec patches(map(), boolean()) :: [patch()]
  def patches(streams, snapshot?) when is_map(streams) and is_boolean(snapshot?) do
    streams
    |> normalize_streams!()
    |> Enum.flat_map(&stream_patches(&1, snapshot?))
  end

  def patches(streams, _snapshot?) when not is_map(streams) do
    raise ArgumentError, "streams must be a map of Phoenix.LiveView.LiveStream values"
  end

  def patches(_streams, snapshot?) do
    raise ArgumentError, "snapshot? must be a boolean, got: #{inspect(snapshot?)}"
  end

  defp normalize_streams!(streams) do
    streams
    |> Enum.map(&normalize_stream!/1)
    |> Enum.sort_by(fn {name, _stream} -> name end)
    |> reject_duplicate_names!()
  end

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

  defp normalize_name!(name, _source) when is_atom(name), do: Atom.to_string(name)
  defp normalize_name!(name, _source) when is_binary(name) and name != "", do: name

  defp normalize_name!(name, source) do
    raise ArgumentError, "#{source} must be an atom or non-empty string, got: #{inspect(name)}"
  end

  defp validate_stream_shape!(name, %LiveStream{} = stream) do
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
  end

  defp reject_duplicate_names!([{name, _left}, {name, _right} | _rest]) do
    raise ArgumentError, "stream names must be unique after normalization: #{inspect(name)}"
  end

  defp reject_duplicate_names!([entry | rest]), do: [entry | reject_duplicate_names!(rest)]
  defp reject_duplicate_names!([]), do: []

  defp stream_patches({name, stream}, snapshot?) do
    path = pointer_path(name)

    snapshot_patch(path, snapshot?) ++
      reset_patch(path, stream.reset?) ++
      delete_patches(path, name, stream.deletes) ++
      insert_patches(path, name, stream.inserts)
  end

  defp snapshot_patch(path, true), do: [%{op: "add", path: path, value: []}]
  defp snapshot_patch(_path, false), do: []

  defp reset_patch(path, true), do: [%{op: "replace", path: path, value: []}]
  defp reset_patch(_path, false), do: []

  defp delete_patches(path, name, deletes) do
    Enum.map(deletes, fn dom_id ->
      dom_id = validate_dom_id!(dom_id, name, "delete")
      %{op: "remove", path: path <> "/$$" <> escape_pointer_segment(dom_id)}
    end)
  end

  defp insert_patches(path, name, inserts) do
    inserts
    |> Enum.reverse()
    |> Enum.flat_map(&insert_patch(path, name, &1))
  end

  defp insert_patch(path, name, {dom_id, at, item, limit, update_only}) do
    dom_id = validate_dom_id!(dom_id, name, "insert")
    at = validate_position!(at, name)
    limit = validate_limit!(limit, name)
    update_only = validate_update_only!(update_only, name)
    item = encode_item!(item, dom_id, name)

    operation =
      if update_only do
        %{op: "replace", path: path <> "/$$" <> escape_pointer_segment(dom_id), value: item}
      else
        %{op: "upsert", path: path <> "/" <> position_segment(at), value: item}
      end

    case limit do
      nil -> [operation]
      limit -> [operation, %{op: "limit", path: path, value: limit}]
    end
  end

  defp insert_patch(_path, name, tuple) do
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
        |> Map.delete("__dom_id")
        |> Map.put(:__dom_id, dom_id)

      encoded ->
        raise ArgumentError,
              "stream #{inspect(name)} items must encode to plain maps, got: #{inspect(encoded)}"
    end
  end

  defp pointer_path(name), do: "/" <> escape_pointer_segment(name)

  defp escape_pointer_segment(segment) do
    segment
    |> String.replace("~", "~0")
    |> String.replace("/", "~1")
  end

  defp position_segment(-1), do: "-"
  defp position_segment(at), do: Integer.to_string(at)
end
