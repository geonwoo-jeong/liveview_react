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

  defp stream(name, items \\ [], opts \\ []) do
    LiveStream.new(name, make_ref(), items, opts)
  end

  defp insert(stream, item, at \\ -1, limit \\ nil, update_only \\ false) do
    LiveStream.insert_item(stream, item, at, limit, update_only)
  end

  describe "patches/2" do
    test "initializes a snapshot and appends initial items in source order" do
      users = stream(:users, [item(1), item(2)])

      assert StreamAdapter.patches(%{users: users}, true) == [
               %{op: "add", path: "/users", value: []},
               %{
                 op: "upsert",
                 path: "/users/-",
                 value: %{
                   id: 1,
                   label: "item-1",
                   details: %{rank: 1},
                   __dom_id: "users-1"
                 }
               },
               %{
                 op: "upsert",
                 path: "/users/-",
                 value: %{
                   id: 2,
                   label: "item-2",
                   details: %{rank: 2},
                   __dom_id: "users-2"
                 }
               }
             ]
    end

    test "emits start, append, and arbitrary inserts in call order" do
      users =
        :users
        |> stream()
        |> insert(item(1), 0)
        |> insert(item(2), -1)
        |> insert(item(3), 1)

      assert Enum.map(StreamAdapter.patches(%{users: users}, false), fn patch ->
               {patch.path, patch.value.id}
             end) == [{"/users/0", 1}, {"/users/-", 2}, {"/users/1", 3}]
    end

    test "preserves repeated prepend semantics by retaining insertion call order" do
      users = Enum.reduce([item(1), item(2), item(3)], stream(:users), &insert(&2, &1, 0))

      assert Enum.map(StreamAdapter.patches(%{users: users}, false), & &1.value.id) == [1, 2, 3]
    end

    test "uses upsert for ordinary updates so existing item position is retained" do
      users = stream(:users) |> insert(item(1, "updated"), 4)

      assert StreamAdapter.patches(%{users: users}, false) == [
               %{
                 op: "upsert",
                 path: "/users/4",
                 value: %{
                   id: 1,
                   label: "updated",
                   details: %{rank: 1},
                   __dom_id: "users-1"
                 }
               }
             ]
    end

    test "uses an id-addressed replace for update_only" do
      users = stream(:users) |> insert(item(1, "updated"), -1, nil, true)

      assert [patch] = StreamAdapter.patches(%{users: users}, false)
      assert patch.op == "replace"
      assert patch.path == "/users/$$users-1"
      assert patch.value.label == "updated"
    end

    test "deletes by stream DOM id" do
      users = stream(:users) |> LiveStream.delete_item(item(2))

      assert StreamAdapter.patches(%{users: users}, false) == [
               %{op: "remove", path: "/users/$$users-2"}
             ]
    end

    test "orders reset before deletes and inserts" do
      users =
        :users
        |> stream()
        |> LiveStream.reset()
        |> LiveStream.delete_item_by_dom_id("users-old")
        |> insert(item(1))

      assert Enum.map(StreamAdapter.patches(%{users: users}, false), & &1.op) == [
               "replace",
               "remove",
               "upsert"
             ]
    end

    test "applies positive and negative limits immediately after their inserts" do
      users =
        :users
        |> stream()
        |> insert(item(1), 0, 2)
        |> insert(item(2), -1, -3)

      assert Enum.map(StreamAdapter.patches(%{users: users}, false), fn patch ->
               {patch.op, Map.get(patch, :value)}
             end) == [
               {"upsert", %{id: 1, label: "item-1", details: %{rank: 1}, __dom_id: "users-1"}},
               {"limit", 2},
               {"upsert", %{id: 2, label: "item-2", details: %{rank: 2}, __dom_id: "users-2"}},
               {"limit", -3}
             ]
    end

    test "keeps limits in authoritative snapshots for complete recovery" do
      users = stream(:users, [item(1)], limit: -5)

      assert Enum.map(StreamAdapter.patches(%{users: users}, true), & &1.op) == [
               "add",
               "upsert",
               "limit"
             ]
    end

    test "uses custom DOM ids for identity" do
      users =
        stream(:users, [item(7)], dom_id: fn user -> "account/#{user.id}" end)

      assert [_, patch] = StreamAdapter.patches(%{users: users}, true)
      assert patch.value.__dom_id == "account/7"
    end

    test "sorts multiple streams deterministically and keeps each stream contiguous" do
      users = stream(:users, [item(1)])
      alerts = stream(:alerts, [item(2)])

      paths =
        %{users: users, alerts: alerts}
        |> StreamAdapter.patches(true)
        |> Enum.map(& &1.path)

      assert paths == ["/alerts", "/alerts/-", "/users", "/users/-"]
    end

    test "escapes stream names and DOM ids as JSON Pointer segments" do
      name = "reports/~active"

      reports =
        stream(name, [], dom_id: fn item -> "row/#{item.id}~current" end)
        |> insert(item(1), -1, nil, true)
        |> LiveStream.delete_item_by_dom_id("old/row~1")

      assert StreamAdapter.patches(%{name => reports}, false) == [
               %{op: "remove", path: "/reports~1~0active/$$old~1row~01"},
               %{
                 op: "replace",
                 path: "/reports~1~0active/$$row~11~0current",
                 value: %{
                   id: 1,
                   label: "item-1",
                   details: %{rank: 1},
                   __dom_id: "row/1~current"
                 }
               }
             ]
    end

    test "encodes items through LiveViewReact.Encoder without mutating source values" do
      source = item(9)
      users = stream(:users, [source])
      original_inserts = users.inserts

      [_, patch] = StreamAdapter.patches(%{users: users}, true)

      assert patch.value == %{
               id: 9,
               label: "item-9",
               details: %{rank: 9},
               __dom_id: "users-9"
             }

      refute Map.has_key?(source, :__dom_id)
      assert users.inserts == original_inserts
    end

    test "rejects unsupported LiveStream insert tuple shapes" do
      users = %{stream(:users) | inserts: [{"users-1", -1, item(1)}]}

      assert_raise ArgumentError, ~r/unsupported insert tuple/, fn ->
        StreamAdapter.patches(%{users: users}, false)
      end
    end

    test "rejects non-stream values and invalid snapshot flags" do
      assert_raise ArgumentError, ~r/must be a Phoenix.LiveView.LiveStream/, fn ->
        StreamAdapter.patches(%{users: []}, false)
      end

      assert_raise ArgumentError, ~r/snapshot\? must be a boolean/, fn ->
        StreamAdapter.patches(%{}, :snapshot)
      end
    end

    test "rejects mismatched and duplicate normalized stream names" do
      users = stream(:users)

      assert_raise ArgumentError, ~r/does not match LiveStream.name/, fn ->
        StreamAdapter.patches(%{accounts: users}, false)
      end

      assert_raise ArgumentError, ~r/must be unique after normalization/, fn ->
        StreamAdapter.patches(%{:users => users, "users" => users}, false)
      end
    end
  end
end
