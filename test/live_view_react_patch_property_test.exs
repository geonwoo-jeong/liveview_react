defmodule LiveViewReact.PatchPropertyTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  alias LiveViewReact.Patch

  @transport_sentinel "~^:/|.🚀한𝄞"
  @string_fragments [
    "a",
    "Z",
    "0",
    ":",
    ".",
    "|",
    "~",
    "^",
    "/",
    "\\",
    "\"",
    "é",
    "한",
    "🚀",
    "𝄞"
  ]

  property "compact patches round-trip bounded protocol operations" do
    check all(
            patches <- list_of(operation_generator(), min_length: 1, max_length: 18),
            initial_seed: 1_592_638_686,
            max_runs: 160,
            max_generation_size: 36
          ) do
      assert patches
             |> Patch.serialize()
             |> Patch.deserialize()
             |> Enum.map(&from_wire/1) == patches
    end
  end

  property "compact object encoding is reversible for bounded JSON values" do
    check all(
            value <- json_value_generator(),
            initial_seed: 1_426_516_190,
            max_runs: 140,
            max_generation_size: 32
          ) do
      encoded = Patch.encode_object(value)

      assert Patch.decode_object(encoded) == value
      refute String.contains?(encoded, "\"")
    end
  end

  defp operation_generator do
    one_of([
      bind(member_of(["add", "replace"]), fn op ->
        bind(path_generator(), fn path ->
          map(json_value_generator(), fn value -> %{op: op, path: path, value: value} end)
        end)
      end),
      map(path_generator(), fn path -> %{op: "remove", path: path} end),
      stream_operation_generator()
    ])
  end

  defp stream_operation_generator do
    {transport_string_generator(), list_of(json_scalar_generator(), max_length: 6)}
    |> tuple()
    |> map(fn {name, values} -> stream_operation(name, values) end)
  end

  defp stream_operation(name, values) do
    items =
      values
      |> Enum.with_index()
      |> Enum.map(fn {value, index} ->
        %{"__dom_id" => "item-#{index}", "value" => value}
      end)

    inserts =
      items
      |> Enum.reverse()
      |> Enum.map(fn item -> [item["__dom_id"], -1, nil, false] end)

    %{
      op: "stream",
      path: "/" <> escape_pointer_segment(name),
      value: %{
        "items" => items,
        "inserts" => inserts,
        "deletes" => [],
        "reset" => false
      }
    }
  end

  defp path_generator do
    list_of(transport_string_generator(), min_length: 1, max_length: 4)
    |> map(fn segments -> "/" <> Enum.map_join(segments, "/", &escape_pointer_segment/1) end)
  end

  defp json_value_generator do
    scalar = json_scalar_generator()
    key = transport_string_generator()

    one_of([
      scalar,
      list_of(scalar, max_length: 6),
      map_of(key, scalar, max_length: 6),
      list_of(map_of(key, scalar, max_length: 4), max_length: 4),
      map_of(key, list_of(scalar, max_length: 4), max_length: 4)
    ])
  end

  defp json_scalar_generator do
    one_of([
      constant(nil),
      boolean(),
      integer(-9_007_199_254_740_991..9_007_199_254_740_991),
      transport_string_generator()
    ])
  end

  defp transport_string_generator do
    list_of(member_of(@string_fragments), max_length: 14)
    |> map(fn fragments -> Enum.join(fragments) <> @transport_sentinel end)
  end

  defp escape_pointer_segment(segment) do
    segment
    |> String.replace("~", "~0")
    |> String.replace("/", "~1")
  end

  defp from_wire([op, path]), do: %{op: op, path: path}
  defp from_wire([op, path, value]), do: %{op: op, path: path, value: value}
end
