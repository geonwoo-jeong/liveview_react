defmodule LiveViewReact.PropsDiffTest do
  use ExUnit.Case

  import Phoenix.Component

  alias LiveViewReact.Test
  alias Phoenix.LiveView.Socket

  defp render_react_assigns(assigns) do
    assigns =
      Map.merge(
        %{id: "props-test", component: "TestComponent", socket: connected_socket()},
        assigns
      )

    rendered = LiveViewReact.react(assigns)
    html = rendered |> Phoenix.HTML.html_escape() |> Phoenix.HTML.safe_to_string()
    Test.get_react(html)
  end

  defp connected_socket, do: %Socket{transport_pid: self()}

  defp assert_patches_equal(actual, expected) do
    actual_sorted = actual |> decode_patch() |> Enum.sort_by(& &1["path"])
    expected_sorted = Enum.sort_by(expected, & &1["path"])
    assert actual_sorted == expected_sorted
  end

  defp decode_patch(patch_list) do
    patch_list
    |> Enum.map(fn
      [op, path] -> %{"op" => op, "path" => path}
      [op, path, value] -> %{"op" => op, "path" => path, "value" => value}
    end)
  end

  describe "props_diff functionality" do
    test "initial render emits a complete snapshot" do
      assigns = %{username: "John", age: 30, __changed__: nil}

      react = render_react_assigns(assigns)

      assert react.props == %{"username" => "John", "age" => 30}
      assert react.props_kind == "snapshot"
      assert_patches_equal(react.props_diff, [])
    end

    test "single simple prop change creates replace operation" do
      assigns = %{username: "John", age: 30, __changed__: %{}}
      assigns = assign(assigns, :username, "Jane")

      react = render_react_assigns(assigns)

      assert react.props_kind == "patch"

      assert_patches_equal(react.props_diff, [
        %{"op" => "add", "path" => "/username", "value" => "Jane"}
      ])
    end

    test "complex prop changes use Jsonpatch.diff for minimal operations" do
      biography = String.duplicate("unchanged", 40)
      assigns = %{user: %{name: "John", age: 30, biography: biography}, __changed__: %{}}
      assigns = assign(assigns, :user, %{name: "Alice", age: 25, biography: biography})

      react = render_react_assigns(assigns)

      assert_patches_equal(react.props_diff, [
        %{"op" => "replace", "path" => "/user/age", "value" => 25},
        %{"op" => "replace", "path" => "/user/name", "value" => "Alice"}
      ])
    end

    test "uses a full snapshot when it is no larger than the patch" do
      assigns = %{user: %{name: "John", age: 30}, __changed__: %{}}
      assigns = assign(assigns, :user, %{name: "Alice", age: 25})

      react = render_react_assigns(assigns)

      assert react.props_kind == "snapshot"
      assert react.props == %{"user" => %{"name" => "Alice", "age" => 25}}
      assert react.props_diff == []
    end

    test "unchanged props do not appear in diff" do
      assigns = %{username: "John", age: 30, __changed__: %{}}
      assigns = assign(assigns, :username, "Bob")

      react = render_react_assigns(assigns)

      assert_patches_equal(react.props_diff, [
        %{"op" => "add", "path" => "/username", "value" => "Bob"}
      ])
    end

    test "removed top-level props use a remove operation" do
      react =
        render_react_assigns(%{
          "a/b~c" => String.duplicate("retained", 30),
          __changed__: %{removed: "stale"}
        })

      assert react.props_kind == "patch"
      assert react.props == nil

      assert_patches_equal(react.props_diff, [
        %{"op" => "remove", "path" => "/removed"}
      ])
    end

    test "preserves nil, false, zero, and empty string in patches" do
      filler = String.duplicate("unchanged", 50)

      react =
        render_react_assigns(%{
          filler: filler,
          optional: nil,
          enabled: false,
          count: 0,
          label: "",
          __changed__: %{optional: nil, enabled: true, count: 1, label: "old"}
        })

      assert react.props_kind == "patch"

      assert_patches_equal(react.props_diff, [
        %{"op" => "add", "path" => "/enabled", "value" => false},
        %{"op" => "replace", "path" => "/count", "value" => 0},
        %{"op" => "replace", "path" => "/label", "value" => ""},
        %{"op" => "add", "path" => "/optional", "value" => nil}
      ])
    end

    test "escapes JSON Pointer characters in top-level prop names" do
      react =
        render_react_assigns(%{
          "a/b~c" => false,
          filler: String.duplicate("unchanged", 40),
          __changed__: %{"a/b~c" => true}
        })

      assert react.props_kind == "patch"

      assert_patches_equal(react.props_diff, [
        %{"op" => "add", "path" => "/a~1b~0c", "value" => false}
      ])
    end

    test "lists are diffed based on id field" do
      assigns = %{
        items: [%{id: 1, name: "Alice"}, %{id: 2, name: "Bob"}],
        __changed__: %{}
      }

      assigns = assign(assigns, :items, [%{id: 1, name: "Alice"}, %{id: 2, name: "New Bob"}])

      react = render_react_assigns(assigns)

      assert_patches_equal(react.props_diff, [
        %{"op" => "replace", "path" => "/items/1/name", "value" => "New Bob"}
      ])
    end

    test "it's possible to disable diffs per-instance" do
      assigns = %{user: %{name: "John", age: 30}, diff: false, __changed__: %{}}
      assigns = assign(assigns, :user, %{name: "Jane", age: 25})

      react = render_react_assigns(assigns)

      assert react.props_kind == "snapshot"
      assert react.props == %{"user" => %{"name" => "Jane", "age" => 25}}
      assert_patches_equal(react.props_diff, [])
    end

    test "reads the props diff default from runtime application configuration" do
      assigns = %{
        biography: String.duplicate("unchanged", 40),
        username: "Jane",
        __changed__: %{username: "John"}
      }

      with_application_env(:enable_props_diff, false, fn ->
        react = render_react_assigns(assigns)

        assert react.props_kind == "snapshot"

        assert react.props == %{
                 "biography" => assigns.biography,
                 "username" => "Jane"
               }
      end)

      with_application_env(:enable_props_diff, true, fn ->
        react = render_react_assigns(assigns)

        assert react.props_kind == "patch"

        assert_patches_equal(react.props_diff, [
          %{"op" => "replace", "path" => "/username", "value" => "Jane"}
        ])
      end)
    end

    test "rejects a non-boolean props diff application configuration" do
      with_application_env(:enable_props_diff, :invalid, fn ->
        assert_raise ArgumentError,
                     "LiveViewReact expects config :liveview_react, :enable_props_diff to be a boolean, got: :invalid",
                     fn ->
                       render_react_assigns(%{username: "Jane", __changed__: %{username: "John"}})
                     end
      end)
    end

    test "dead render emits all current props instead of a changed subset" do
      react =
        render_react_assigns(%{
          username: "Jane",
          age: 30,
          socket: %Socket{},
          __changed__: %{username: "John"}
        })

      assert react.props_kind == "snapshot"
      assert react.props == %{"username" => "Jane", "age" => 30}
      assert_patches_equal(react.props_diff, [])
    end

    defmodule User do
      @moduledoc false
      @derive {LiveViewReact.Encoder, only: [:name, :age, :biography]}
      defstruct [:name, :age, :biography]
    end

    test "for structs uses LiveViewReact.Encoder to convert to map" do
      biography = String.duplicate("unchanged", 40)
      assigns = %{user: %User{name: "John", age: 30, biography: biography}, __changed__: %{}}
      assigns = assign(assigns, :user, %User{name: "Alice", age: 25, biography: biography})

      react = render_react_assigns(assigns)

      assert_patches_equal(react.props_diff, [
        %{"op" => "replace", "path" => "/user/age", "value" => 25},
        %{"op" => "replace", "path" => "/user/name", "value" => "Alice"}
      ])
    end

    test "struct props without LiveViewReact.Encoder raise a helpful error" do
      defmodule Undecoded do
        @moduledoc false
        defstruct [:name]
      end

      assigns = %{user: struct!(Undecoded, name: "John"), __changed__: nil}

      assert_raise Protocol.UndefinedError,
                   ~r/LiveViewReact.Encoder protocol must always be explicitly implemented/,
                   fn ->
                     render_react_assigns(assigns)
                   end
    end
  end

  defp with_application_env(key, value, fun) do
    previous_value = Application.fetch_env(:liveview_react, key)
    Application.put_env(:liveview_react, key, value)

    try do
      fun.()
    after
      case previous_value do
        {:ok, previous} -> Application.put_env(:liveview_react, key, previous)
        :error -> Application.delete_env(:liveview_react, key)
      end
    end
  end
end
