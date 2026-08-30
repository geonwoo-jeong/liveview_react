defmodule LiveViewReact.StreamsDiffTest do
  use ExUnit.Case

  alias LiveViewReact.Test
  alias Phoenix.LiveView.LiveStream
  alias Phoenix.LiveView.Socket

  defp render_react_assigns(assigns) do
    assigns =
      Map.merge(
        %{id: "streams-test", component: "TestComponent", socket: %Socket{}},
        assigns
      )

    rendered = LiveViewReact.react(assigns)
    html = rendered |> Phoenix.HTML.html_escape() |> Phoenix.HTML.safe_to_string()
    Test.get_react(html)
  end

  # `react/1` forces a full stream reset whenever the render is "dead" (no connected
  # socket), since the client has no prior state to patch against in that case. These
  # tests exercise incremental (non-initial) diffs, so they simulate a connected
  # LiveView socket to opt into the incremental code path instead of the dead/init one.
  defp connected_socket, do: %Socket{transport_pid: self()}

  defp assert_patches_equal(actual, expected) do
    actual_sorted = actual |> decode_patch() |> Enum.sort_by(&{&1["path"], &1["op"]})
    expected_sorted = Enum.sort_by(expected, &{&1["path"], &1["op"]})
    assert actual_sorted == expected_sorted
  end

  defp decode_patch(patch_list) do
    patch_list
    |> Enum.map(fn
      [op, path] -> %{"op" => op, "path" => path}
      [op, path, value] -> %{"op" => op, "path" => path, "value" => value}
    end)
    |> Enum.reject(&(&1["op"] == "test"))
  end

  defp frame(items, inserts, deletes \\ [], reset \\ false) do
    %{
      "items" => items,
      "inserts" => inserts,
      "deletes" => deletes,
      "reset" => reset
    }
  end

  defmodule StreamUser do
    @moduledoc false
    @derive {LiveViewReact.Encoder, only: [:id, :name, :age]}
    defstruct [:id, :name, :age]
  end

  describe "LiveStream diff functionality" do
    test "initial render with LiveStream has stream diff in streams_diff" do
      users = [
        %StreamUser{id: 1, name: "Alice", age: 30},
        %StreamUser{id: 2, name: "Bob", age: 25}
      ]

      stream = LiveStream.new(:users, make_ref(), users, [])

      react = render_react_assigns(%{users: stream, __changed__: nil})

      expected_patches = [
        %{
          "op" => "stream",
          "path" => "/users",
          "value" =>
            frame(
              [
                %{"__dom_id" => "users-1", "age" => 30, "id" => 1, "name" => "Alice"},
                %{"__dom_id" => "users-2", "age" => 25, "id" => 2, "name" => "Bob"}
              ],
              [
                ["users-2", -1, nil, false],
                ["users-1", -1, nil, false]
              ]
            )
        }
      ]

      assert react.props == %{}
      assert react.streams_kind == "snapshot"
      assert_patches_equal(react.streams_diff, expected_patches)
    end

    test "inserting item to LiveStream creates a canonical stream frame" do
      new_user = %StreamUser{id: 3, name: "Charlie", age: 28}
      stream = LiveStream.new(:users, make_ref(), [], [])
      stream = LiveStream.insert_item(stream, new_user, -1, nil, false)

      react =
        render_react_assigns(%{
          users: stream,
          socket: connected_socket(),
          __changed__: %{users: LiveStream.new(:users, make_ref(), [], [])}
        })

      assert react.streams_kind == "patch"

      assert_patches_equal(react.streams_diff, [
        %{
          "op" => "stream",
          "path" => "/users",
          "value" =>
            frame(
              [%{"id" => 3, "name" => "Charlie", "age" => 28, "__dom_id" => "users-3"}],
              [["users-3", -1, nil, false]]
            )
        }
      ])
    end

    test "deleting item from LiveStream stays inside its canonical frame" do
      user_to_delete = %StreamUser{id: 2, name: "Bob", age: 25}
      stream = LiveStream.new(:users, make_ref(), [], [])
      stream = LiveStream.delete_item(stream, user_to_delete)

      react =
        render_react_assigns(%{
          users: stream,
          socket: connected_socket(),
          __changed__: %{users: LiveStream.new(:users, make_ref(), [], [])}
        })

      assert_patches_equal(react.streams_diff, [
        %{
          "op" => "stream",
          "path" => "/users",
          "value" => frame([], [], ["users-2"])
        }
      ])
    end

    test "resetting LiveStream stays inside its canonical frame" do
      stream = LiveStream.new(:users, make_ref(), [], [])
      stream = LiveStream.reset(stream)

      react =
        render_react_assigns(%{
          users: stream,
          socket: connected_socket(),
          __changed__: %{users: LiveStream.new(:users, make_ref(), [], [])}
        })

      assert_patches_equal(react.streams_diff, [
        %{"op" => "stream", "path" => "/users", "value" => frame([], [], [], true)}
      ])
    end

    test "stream limit stays atomic with its insert metadata" do
      stream = LiveStream.new(:users, make_ref(), [], [])

      stream =
        LiveStream.insert_item(stream, %StreamUser{id: 1, name: "User", age: 1}, -1, 5, false)

      react =
        render_react_assigns(%{
          users: stream,
          socket: connected_socket(),
          __changed__: %{users: LiveStream.new(:users, make_ref(), [], [])}
        })

      assert_patches_equal(react.streams_diff, [
        %{
          "op" => "stream",
          "path" => "/users",
          "value" =>
            frame(
              [%{"id" => 1, "name" => "User", "age" => 1, "__dom_id" => "users-1"}],
              [["users-1", -1, 5, false]]
            )
        }
      ])
    end

    test "stream insert keeps update_only atomic in the frame" do
      stream = LiveStream.new(:users, make_ref(), [], [])

      stream =
        LiveStream.insert_item(stream, %StreamUser{id: 1, name: "Updated", age: 1}, -1, nil, true)

      react =
        render_react_assigns(%{
          users: stream,
          socket: connected_socket(),
          __changed__: %{users: LiveStream.new(:users, make_ref(), [], [])}
        })

      assert_patches_equal(react.streams_diff, [
        %{
          "op" => "stream",
          "path" => "/users",
          "value" =>
            frame(
              [%{"id" => 1, "name" => "Updated", "age" => 1, "__dom_id" => "users-1"}],
              [["users-1", -1, nil, true]]
            )
        }
      ])
    end

    test "LiveStream assigns do not appear in props" do
      stream = LiveStream.new(:users, make_ref(), [], [])

      react = render_react_assigns(%{users: stream, title: "Page", __changed__: nil})

      assert react.props == %{"title" => "Page"}
    end

    test "dead render emits an empty stream snapshot that clears removed keys" do
      assigns = %{
        id: "streams-test",
        component: "TestComponent",
        title: "No streams remain",
        socket: %Socket{},
        __changed__: %{title: "Before"}
      }

      rendered = LiveViewReact.react(assigns)
      html = rendered |> Phoenix.HTML.html_escape() |> Phoenix.HTML.safe_to_string()
      react = Test.get_react(html)

      assert react.streams_kind == "snapshot"
      assert react.streams_diff == []
      assert Floki.attribute(Floki.parse_fragment!(html), "data-streams-diff") == [""]
    end
  end
end
