defmodule LiveViewReact.StreamAdapterTest do
  use ExUnit.Case, async: true

  alias LiveViewReact.StreamAdapter
  alias Phoenix.LiveView.LiveStream

  defmodule Item do
    @moduledoc false
    @derive {LiveViewReact.Encoder, only: [:id, :label, :details]}
    defstruct [:id, :label, :details, :secret]
  end

  defp item(id, label \\ nil) do
    %Item{id: id, label: label || "item-#{id}", details: %{rank: id}, secret: "hidden"}
  end

  defp encoded_item(id, label \\ nil, dom_id \\ nil) do
    %{
      "id" => id,
      "label" => label || "item-#{id}",
      "details" => %{"rank" => id},
      "__dom_id" => dom_id || "users-#{id}"
    }
  end

  defp stream(name, items \\ [], opts \\ []) do
    LiveStream.new(name, make_ref(), items, opts)
  end

  defp insert(stream, item, at), do: insert(stream, item, at, nil, false)
  defp insert(stream, item, at, limit), do: insert(stream, item, at, limit, false)

  defp insert(stream, item, at, limit, update_only) do
    LiveStream.insert_item(stream, item, at, limit, update_only)
  end

  defp frame(items, inserts, deletes \\ [], reset \\ false) do
    %{
      "items" => items,
      "inserts" => inserts,
      "deletes" => deletes,
      "reset" => reset
    }
  end

  describe "dead_render_snapshot/1" do
    test "uses Phoenix dead-render enumeration and ignores connected operation metadata" do
      users =
        :users
        |> stream([item(1), item(2)], limit: 1)
        |> LiveStream.delete_item(item(1))
        |> LiveStream.reset()
        |> insert(item(2, "newest"), 0, 1, true)
        |> insert(item(3), 0, -1, false)

      assert StreamAdapter.dead_render_snapshot(%{users: users}) == %{
               "users" => [encoded_item(1), encoded_item(2, "newest"), encoded_item(3)]
             }
    end

    test "preserves empty stream names, custom DOM ids, and deterministic stream membership" do
      users = stream(:users)
      alerts = stream(:alerts, [item(7)], dom_id: fn alert -> "alert/#{alert.id}" end)

      assert StreamAdapter.dead_render_snapshot(%{users: users, alerts: alerts}) == %{
               "alerts" => [encoded_item(7, nil, "alert/7")],
               "users" => []
             }
    end
  end

  describe "connected_snapshot_patches/1" do
    test "emits one canonical frame per stream in deterministic name order" do
      users = stream(:users, [item(1), item(2)])
      alerts = stream(:alerts)

      assert StreamAdapter.connected_snapshot_patches(%{users: users, alerts: alerts}) == [
               %{op: "stream", path: "/alerts", value: frame([], [])},
               %{
                 op: "stream",
                 path: "/users",
                 value:
                   frame(
                     [encoded_item(1), encoded_item(2)],
                     [
                       ["users-2", -1, nil, false],
                       ["users-1", -1, nil, false]
                     ]
                   )
               }
             ]
    end

    test "keeps update_only and limit atomic in raw insert metadata" do
      users = stream(:users) |> insert(item(1, "update only"), 0, -5, true)

      assert StreamAdapter.connected_snapshot_patches(%{users: users}) == [
               %{
                 op: "stream",
                 path: "/users",
                 value:
                   frame(
                     [encoded_item(1, "update only")],
                     [["users-1", 0, -5, true]]
                   )
               }
             ]
    end

    test "an empty map remains an authoritative empty snapshot frame" do
      assert StreamAdapter.connected_snapshot_patches(%{}) == []
    end
  end

  describe "incremental_patches/1" do
    test "keeps rendered item order separate from raw insertion metadata order" do
      users =
        :users
        |> stream()
        |> insert(item(1), 0)
        |> insert(item(2), -1)
        |> insert(item(3), 1)

      assert StreamAdapter.incremental_patches(%{users: users}) == [
               %{
                 op: "stream",
                 path: "/users",
                 value:
                   frame(
                     [encoded_item(1), encoded_item(2), encoded_item(3)],
                     [
                       ["users-3", 1, nil, false],
                       ["users-2", -1, nil, false],
                       ["users-1", 0, nil, false]
                     ]
                   )
               }
             ]
    end

    test "keeps reset, deletes, and inserts together in one atomic frame" do
      users =
        :users
        |> stream()
        |> LiveStream.reset()
        |> LiveStream.delete_item_by_dom_id("users-old")
        |> insert(item(1), 0, 2)
        |> insert(item(2), -1, -3)

      assert StreamAdapter.incremental_patches(%{users: users}) == [
               %{
                 op: "stream",
                 path: "/users",
                 value:
                   frame(
                     [encoded_item(1), encoded_item(2)],
                     [
                       ["users-2", -1, -3, false],
                       ["users-1", 0, 2, false]
                     ],
                     ["users-old"],
                     true
                   )
               }
             ]
    end

    test "escapes only the stream path while preserving raw custom DOM ids in frame data" do
      name = "reports/~active"

      reports =
        stream(name, [], dom_id: fn value -> "row/#{value.id}~current" end)
        |> insert(item(1), -1, nil, true)
        |> LiveStream.delete_item_by_dom_id("old/row~1")

      assert StreamAdapter.incremental_patches(%{name => reports}) == [
               %{
                 op: "stream",
                 path: "/reports~1~0active",
                 value:
                   frame(
                     [encoded_item(1, nil, "row/1~current")],
                     [["row/1~current", -1, nil, true]],
                     ["old/row~1"]
                   )
               }
             ]
    end

    test "keeps only the newest duplicate item while preserving every raw insert tuple" do
      users = stream(:users, [item(1), item(2)]) |> insert(item(2, "newest"), 0, 1, true)

      assert StreamAdapter.incremental_patches(%{users: users}) == [
               %{
                 op: "stream",
                 path: "/users",
                 value:
                   frame(
                     [encoded_item(1), encoded_item(2, "newest")],
                     [
                       ["users-2", 0, 1, true],
                       ["users-2", -1, nil, false],
                       ["users-1", -1, nil, false]
                     ]
                   )
               }
             ]
    end

    test "encodes immutable plain JSON without mutating the source item or stream" do
      source = item(9)
      users = stream(:users, [source])
      original_inserts = users.inserts

      [patch] = StreamAdapter.connected_snapshot_patches(%{users: users})

      assert patch.value["items"] == [encoded_item(9)]
      refute Map.has_key?(source, :__dom_id)
      assert users.inserts == original_inserts
    end
  end

  describe "validation" do
    test "rejects unsupported LiveStream tuple and field shapes in every mode" do
      malformed_tuple = %{stream(:users) | inserts: [{"users-1", -1, item(1)}]}

      for fun <- [&StreamAdapter.dead_render_snapshot/1, &StreamAdapter.incremental_patches/1] do
        assert_raise ArgumentError, ~r/unsupported insert tuple/, fn ->
          fun.(%{users: malformed_tuple})
        end
      end

      invalid_streams = [
        %{stream(:users) | dom_id: nil},
        %{stream(:users) | inserts: :invalid},
        %{stream(:users) | deletes: :invalid},
        %{stream(:users) | reset?: nil},
        %{stream(:users) | consumable?: nil}
      ]

      Enum.each(invalid_streams, fn users ->
        assert_raise ArgumentError, fn ->
          StreamAdapter.connected_snapshot_patches(%{users: users})
        end
      end)
    end

    test "rejects invalid operation values even when dead enumeration would ignore them" do
      for inserts <- [
            [{"", -1, item(1), nil, false}],
            [{"users-1", -2, item(1), nil, false}],
            [{"users-1", -1, item(1), :invalid, false}],
            [{"users-1", -1, item(1), nil, :invalid}]
          ] do
        users = %{stream(:users) | inserts: inserts}

        assert_raise ArgumentError, fn ->
          StreamAdapter.dead_render_snapshot(%{users: users})
        end
      end
    end

    test "rejects non-stream inputs, mismatched names, and normalized duplicate names" do
      assert_raise ArgumentError, ~r/streams must be a map/, fn ->
        StreamAdapter.incremental_patches([])
      end

      assert_raise ArgumentError, ~r/must be a Phoenix.LiveView.LiveStream/, fn ->
        StreamAdapter.incremental_patches(%{users: []})
      end

      users = stream(:users)

      assert_raise ArgumentError, ~r/does not match LiveStream.name/, fn ->
        StreamAdapter.incremental_patches(%{accounts: users})
      end

      assert_raise ArgumentError, ~r/must be unique after normalization/, fn ->
        StreamAdapter.incremental_patches(%{:users => users, "users" => users})
      end
    end

    test "rejects items that cannot become unambiguous plain JSON objects" do
      duplicate_keys = stream(:users, [%{:id => 1, "id" => 2}])
      scalar_item = stream(:users, [1], dom_id: fn _value -> "users-1" end)

      assert_raise ArgumentError, ~r/duplicate JSON key "id"/, fn ->
        StreamAdapter.dead_render_snapshot(%{users: duplicate_keys})
      end

      assert_raise ArgumentError, ~r/plain JSON objects/, fn ->
        StreamAdapter.dead_render_snapshot(%{users: scalar_item})
      end
    end

    test "validates canonical hydration snapshots fail-closed" do
      valid = %{"users" => [%{"id" => 1, "__dom_id" => "users-1"}]}
      assert StreamAdapter.validate_snapshot!(valid) == valid

      for invalid <- [
            %{users: []},
            %{"__proto__" => []},
            %{"users" => [%{"id" => 1}]},
            %{"users" => [%{"__dom_id" => ""}]},
            %{
              "users" => [
                %{"__dom_id" => "users-1"},
                %{"__dom_id" => "users-1"}
              ]
            },
            %{"users" => [%{"__dom_id" => "users-1", "value" => make_ref()}]},
            %{"users" => [%{"__dom_id" => "users-1", "constructor" => %{}}]}
          ] do
        assert_raise ArgumentError, fn -> StreamAdapter.validate_snapshot!(invalid) end
      end

      unsafe_stream = stream(:__proto__)

      assert_raise ArgumentError, ~r/prototype-sensitive/, fn ->
        StreamAdapter.dead_render_snapshot(%{__proto__: unsafe_stream})
      end
    end
  end
end
