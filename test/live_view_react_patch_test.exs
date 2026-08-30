defmodule LiveViewReact.PatchTest do
  use ExUnit.Case

  alias LiveViewReact.Patch

  describe "values" do
    test "round-trips nil" do
      patches = [%{op: "replace", path: "/value", value: nil}]
      assert serialize_deserialize(patches) == patches
    end

    test "round-trips booleans" do
      patches = [
        %{op: "replace", path: "/enabled", value: true},
        %{op: "replace", path: "/disabled", value: false}
      ]

      assert serialize_deserialize(patches) == patches
    end

    test "round-trips integers" do
      patches = [%{op: "replace", path: "/count", value: 6}]
      assert serialize_deserialize(patches) == patches
    end

    test "round-trips floats" do
      patches = [%{op: "replace", path: "/price", value: 12.5}]
      assert serialize_deserialize(patches) == patches
    end

    test "round-trips strings" do
      patches = [%{op: "replace", path: "/title", value: "Published"}]
      assert serialize_deserialize(patches) == patches
    end

    test "round-trips lists" do
      patches = [%{op: "replace", path: "/tags", value: ["bug", "urgent"]}]
      assert serialize_deserialize(patches) == patches
    end

    test "round-trips maps" do
      patches = [%{op: "replace", path: "/user", value: %{"id" => 3, "name" => "Charlie"}}]
      assert serialize_deserialize(patches) == patches
    end

    test "round-trips caret-encoded JSON edge cases" do
      patches = [
        %{
          op: "replace",
          path: "/meta",
          value: %{"empty" => "", "caret" => "^", "tilde" => "~", "both" => "~^"}
        }
      ]

      assert serialize_deserialize(patches) == patches
    end
  end

  describe "paths" do
    test "round-trips the document root path" do
      patches = [%{op: "replace", path: "", value: %{"status" => "ready"}}]
      assert serialize_deserialize(patches) == patches
    end

    test "round-trips nested paths" do
      patches = [%{op: "replace", path: "/profile/name", value: "Ada"}]
      assert serialize_deserialize(patches) == patches
    end

    test "round-trips array index paths" do
      patches = [%{op: "replace", path: "/items/0/name", value: "Keyboard"}]
      assert serialize_deserialize(patches) == patches
    end

    test "round-trips append marker paths" do
      patches = [%{op: "add", path: "/items/-", value: "new"}]
      assert serialize_deserialize(patches) == patches
    end

    test "round-trips JSON pointer escapes in path segments" do
      patches = [%{op: "replace", path: "/settings/a~1b~0c", value: "value"}]
      assert serialize_deserialize(patches) == patches
    end

    test "round-trips UTF-8 paths and values using JavaScript string lengths" do
      patches = [
        %{op: "replace", path: "/profile/na.me", value: "zażółć"},
        %{op: "replace", path: "/emoji", value: "🚀"}
      ]

      assert Patch.serialize(patches) == "r14:/profile/na.mes6:zażółćr6:/emojis2:🚀"
      assert serialize_deserialize(patches) == patches
    end
  end

  describe "operations" do
    test "round-trips an empty patch list" do
      assert serialize_deserialize([]) == []
    end

    test "round-trips remove operations without a value" do
      patches = [%{op: "remove", path: "/items/0"}]
      assert serialize_deserialize(patches) == patches
    end

    test "rejects operations outside the protocol" do
      assert_raise ArgumentError, ~r/invalid patch operation/, fn ->
        Patch.serialize([%{op: "test", path: "", value: 123}])
      end

      assert_raise ArgumentError, ~r/invalid patch operation/, fn ->
        Patch.serialize([%{op: "replace", path: "/value", value: 123, legacy: true}])
      end
    end

    test "round-trips one canonical stream frame with the deterministic s code" do
      empty_frame = %{"items" => [], "inserts" => [], "deletes" => [], "reset" => false}

      patches = [
        %{
          op: "stream",
          path: "/users",
          value: %{
            "items" => [%{"id" => 4, "__dom_id" => "users-4"}],
            "inserts" => [["users-4", -1, 10, false]],
            "deletes" => [],
            "reset" => false
          }
        }
      ]

      assert serialize_deserialize(patches) == patches

      encoded_frame = Patch.encode_object(empty_frame)

      assert Patch.serialize([%{op: "stream", path: "/users", value: empty_frame}]) ==
               "s6:/usersJ#{String.length(encoded_frame)}:#{encoded_frame}"
    end

    test "rejects malformed stream frames and paths on both codec boundaries" do
      valid_frame = %{"items" => [], "inserts" => [], "deletes" => [], "reset" => false}

      for invalid_frame <- [
            %{},
            Map.put(valid_frame, "legacy", true),
            %{valid_frame | "reset" => nil},
            %{valid_frame | "inserts" => [["users-1", -1, nil, nil]]},
            %{
              valid_frame
              | "items" => [%{"__dom_id" => "users-1"}],
                "inserts" => []
            }
          ] do
        assert_raise ArgumentError, fn ->
          Patch.serialize([%{op: "stream", path: "/users", value: invalid_frame}])
        end
      end

      for invalid_path <- ["", "/", "/users/extra", "/users~2", "/__proto__"] do
        assert_raise ArgumentError, ~r/stream JSON Pointer path/, fn ->
          Patch.serialize([%{op: "stream", path: invalid_path, value: valid_frame}])
        end
      end

      malformed_frame = Patch.encode_object(%{})

      assert_raise ArgumentError, ~r/stream frames require exactly/, fn ->
        Patch.deserialize("s6:/usersJ#{String.length(malformed_frame)}:#{malformed_frame}")
      end
    end

    test "rejects removed generic upsert and limit operations" do
      for patch <- [
            %{op: "upsert", path: "/users/-", value: %{"id" => 4}},
            %{op: "limit", path: "/users", value: 10}
          ] do
        assert_raise ArgumentError, ~r/invalid patch operation/, fn ->
          Patch.serialize([patch])
        end
      end

      assert_raise ArgumentError, ~r/Unknown patch operation/, fn -> Patch.deserialize("u0:z") end
      assert_raise ArgumentError, ~r/Unknown patch operation/, fn -> Patch.deserialize("l0:z") end
    end
  end

  describe "encode_object/decode_object" do
    test "round-trips a plain map" do
      value = %{"name" => "Ada", "count" => 3}
      assert value |> Patch.encode_object() |> Patch.decode_object() == value
    end

    test "escapes carets and tildes reversibly" do
      value = %{"weird" => "~^both^~"}
      assert value |> Patch.encode_object() |> Patch.decode_object() == value
    end
  end

  describe "malformed payloads" do
    test "rejects missing and truncated length-prefixed fields" do
      assert_raise ArgumentError, ~r/length prefix/, fn -> Patch.deserialize("r:/titlez") end

      assert_raise ArgumentError, ~r/exceeds the remaining payload/, fn ->
        Patch.deserialize("r99:/titlez")
      end
    end

    test "rejects unknown operations, values, and invalid pointers" do
      assert_raise ArgumentError, fn -> Patch.deserialize("x0:") end
      assert_raise ArgumentError, ~r/Invalid patch value/, fn -> Patch.deserialize("r0:x") end

      assert_raise ArgumentError, ~r/invalid JSON Pointer/, fn ->
        Patch.serialize([%{op: "replace", path: "title", value: "bad"}])
      end
    end

    test "rejects malformed numbers" do
      assert_raise ArgumentError, ~r/Invalid patch number/, fn ->
        Patch.deserialize("r0:n3:nan")
      end
    end
  end

  defp serialize_deserialize(patches) do
    patches
    |> Patch.serialize()
    |> Patch.deserialize()
    |> Enum.map(&patch_from_wire/1)
  end

  defp patch_from_wire([op, path]), do: %{op: op, path: path}
  defp patch_from_wire([op, path, value]), do: %{op: op, path: path, value: value}
end
