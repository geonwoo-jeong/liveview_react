defmodule LiveViewReact.LifecycleTest do
  @moduledoc """
  Exercises the transport against a real Phoenix endpoint and LiveView socket.

  Unlike the `render_component/2` suites, these tests run through HEEx change
  tracking exactly as production does, so `__changed__` carries the real
  old-value semantics the props diff is built on.
  """

  use ExUnit.Case, async: true

  import Phoenix.ConnTest
  import Phoenix.LiveViewTest

  alias LiveViewReact.Test
  alias LiveViewReact.TestSupport.TemporaryLive
  alias Phoenix.HTML.Safe
  alias Phoenix.LiveView.Socket

  @endpoint LiveViewReact.TestSupport.Endpoint

  defp conn, do: Phoenix.ConnTest.build_conn()

  defp react(view_or_html, id), do: Test.get_react(view_or_html, id: id)

  # A patch render carries no props snapshot, so a name can hide in either
  # transport lane. Check both.
  defp refute_prop(found, name) do
    if is_map(found.props) do
      refute Map.has_key?(found.props, name),
             "#{name} leaked into the props snapshot: #{inspect(found.props)}"
    end

    paths = Enum.map(found.props_diff, fn [_op, path | _rest] -> path end)

    refute ("/" <> name) in paths,
           "#{name} leaked into the props patch: #{inspect(found.props_diff)}"
  end

  describe "ordinary props" do
    test "dead and connected mounts both transport a full snapshot" do
      dead = conn() |> get("/props") |> html_response(200)
      {:ok, view, _html} = live(conn(), "/props")

      for html <- [dead, render(view)] do
        found = react(html, "props")

        assert found.props_kind == "snapshot"
        assert found.props["count"] == 0
        assert found.props["label"] == "zero"
        assert found.props_diff == []
      end
    end

    test "a scalar prop change transports one add operation" do
      {:ok, view, _html} = live(conn(), "/props")

      first = react(render_click(view, "increment", %{}), "props")
      second = react(render_click(view, "increment", %{}), "props")

      assert first.props_kind == "patch"
      assert first.props_diff == [["add", "/count", 1]]
      assert second.props_diff == [["add", "/count", 2]]
    end

    test "a nested map change transports only the changed leaf" do
      {:ok, view, _html} = live(conn(), "/props")

      found = react(render_click(view, "rename", %{"name" => "Jane"}), "props")

      assert found.props_kind == "patch"
      assert found.props_diff == [["replace", "/user/name", "Jane"]]
    end

    test "two assigns in one handler diff against the value from the cycle start" do
      {:ok, view, _html} = live(conn(), "/props")

      found = react(render_click(view, "rename_twice", %{}), "props")

      assert found.props_diff == [["replace", "/user/name", "final"]]
    end

    test "an assign returned to its original value transports an empty patch" do
      {:ok, view, _html} = live(conn(), "/props")

      found = react(render_click(view, "rename_back", %{}), "props")

      assert found.props_diff == []
    end

    test "an empty list stays an ordinary prop with an empty list value" do
      {:ok, view, _html} = live(conn(), "/props")

      found = react(render(view), "props")

      assert found.props["empty"] == []
    end
  end

  describe "temporary_assigns" do
    # temporary_assigns resets the assign after every render, so LiveView's
    # recorded old value is no longer what the client holds. A props patch is
    # only valid while that precondition holds.
    test "a prop backed by temporary_assigns always transports a snapshot" do
      {:ok, view, _html} = live(conn(), "/temporary")
      baseline_length = length(TemporaryLive.baseline())

      for id <- ~w(a b c) do
        found = react(render_click(view, "push", %{"id" => id}), "temporary")

        assert found.props_kind == "snapshot",
               "temporary_assigns must not use a props patch, got: #{inspect(found.props_diff)}"

        assert length(found.props["messages"]) == baseline_length + 1
        assert List.last(found.props["messages"])["id"] == id
      end
    end
  end

  describe "named slots" do
    test "a hidden named slot never becomes an ordinary prop" do
      dead = conn() |> get("/slots") |> html_response(200)
      {:ok, view, _html} = live(conn(), "/slots")

      for html <- [dead, render(view)] do
        found = react(html, "slots")

        refute_prop(found, "header")
        assert Map.has_key?(found.slots, "footer")
        refute Map.has_key?(found.slots, "header")
      end
    end

    test "a hidden named slot stays absent while other props change" do
      {:ok, view, _html} = live(conn(), "/slots")

      found = react(render_click(view, "bump", %{}), "slots")

      refute_prop(found, "header")
    end

    test "toggling a named slot off and on never leaks it into props" do
      {:ok, view, _html} = live(conn(), "/slots?header=true")

      shown = react(render(view), "slots")
      assert shown.slots["header"] == "Header 1"
      refute_prop(shown, "header")

      hidden = react(render_click(view, "toggle_header", %{}), "slots")
      refute Map.has_key?(hidden.slots, "header")
      refute_prop(hidden, "header")

      restored = react(render_click(view, "toggle_header", %{}), "slots")
      assert restored.slots["header"] == "Header 1"
      refute_prop(restored, "header")
    end

    test "the default slot and named slots are transported together" do
      {:ok, view, _html} = live(conn(), "/slots?header=true")

      found = react(render(view), "slots")

      assert found.slots["default"] == "\n  Body 1\n"
      assert found.slots["header"] == "Header 1"
      assert found.slots["footer"] == "Footer 1"
    end

    # Slot identity comes from the reserved assign names alone. `react/1` never
    # inspects an ordinary prop's value to decide whether it is "really" a slot,
    # so the removed `<:name>` form is not special-cased; it simply reaches the
    # encoder as a prop and fails closed there.
    test "the removed <:name> slot syntax fails closed instead of transporting" do
      assert_raise Protocol.UndefinedError, ~r/Encoder not implemented/, fn ->
        conn() |> get("/legacy-slots") |> html_response(200)
      end
    end

    test "an ordinary prop may carry a __slot__ key without being mistaken for a slot" do
      html =
        LiveViewReact.react(%{
          __changed__: nil,
          component: "Props",
          id: "slot-shaped-prop",
          items: [%{__slot__: "external", value: 1}],
          socket: %Socket{transport_pid: self()},
          ssr: false
        })
        |> Safe.to_iodata()
        |> IO.iodata_to_binary()

      found = react(html, "slot-shaped-prop")

      assert found.slots == %{}
      assert found.props == %{"items" => [%{"__slot__" => "external", "value" => 1}]}
    end
  end

  describe "cross-runtime transport fixture" do
    @fixture_path Path.join([__DIR__, "fixtures", "props_transport_v2.json"])

    # The fixture is the contract between this suite and
    # transport/propsTransportFixture.test.ts, which replays the same frames
    # through the browser runtime and asserts it converges on the same props.
    # Asserting the live transport against it here keeps the fixture honest.
    test "the recorded frames still match the live transport" do
      fixture = @fixture_path |> File.read!() |> Jason.decode!()
      scenario = fixture["scenario"]
      assert fixture["transportVersion"] == 2

      {:ok, view, _html} = live(conn(), "/props")

      steps = %{
        "mount" => fn -> render(view) end,
        "increment" => fn -> render_click(view, "increment", %{}) end,
        "rename" => fn -> render_click(view, "rename", %{"name" => "Jane"}) end,
        "append" => fn -> render_click(view, "append", %{"id" => 2}) end,
        "rename_twice" => fn -> render_click(view, "rename_twice", %{}) end
      }

      for frame <- scenario["frames"] do
        found = react(Map.fetch!(steps, frame["step"]).(), "props")

        assert found.props_kind == frame["propsKind"], "kind mismatch at #{frame["step"]}"
        assert found.props == frame["props"], "snapshot mismatch at #{frame["step"]}"

        recorded =
          Enum.map(found.props_diff, fn
            [op, path] -> %{"op" => op, "path" => path}
            [op, path, value] -> %{"op" => op, "path" => path, "value" => value}
          end)

        assert recorded == frame["propsDiff"], "patch mismatch at #{frame["step"]}"
      end
    end
  end

  describe "streams" do
    test "dead and connected mounts transport a stream snapshot" do
      dead = conn() |> get("/streams") |> html_response(200)
      {:ok, view, _html} = live(conn(), "/streams")

      for html <- [dead, render(view)] do
        found = react(html, "streams")

        assert found.streams_kind == "snapshot"
        assert [["stream", "/rows", frame]] = found.streams_diff
        assert Enum.map(frame["items"], & &1["value"]) == ["a", "b"]
      end
    end

    test "insert, prepend, delete and reset transport incremental frames" do
      {:ok, view, _html} = live(conn(), "/streams")

      appended = react(render_click(view, "append", %{"id" => 3}), "streams")
      assert appended.streams_kind == "patch"
      assert [["stream", "/rows", frame]] = appended.streams_diff
      assert frame["inserts"] == [["rows-3", -1, nil, false]]

      prepended = react(render_click(view, "prepend", %{"id" => 4}), "streams")
      assert [["stream", "/rows", frame]] = prepended.streams_diff
      assert frame["inserts"] == [["rows-4", 0, nil, false]]

      deleted = react(render_click(view, "delete", %{"id" => 2}), "streams")
      assert [["stream", "/rows", frame]] = deleted.streams_diff
      assert frame["deletes"] == ["rows-2"]
      assert frame["items"] == []

      reset = react(render_click(view, "reset", %{}), "streams")
      assert [["stream", "/rows", frame]] = reset.streams_diff
      assert frame["reset"] == true
    end

    test "an unrelated assign does not re-render the root" do
      {:ok, view, _html} = live(conn(), "/streams")

      before = react(render_click(view, "append", %{"id" => 3}), "streams")
      after_unrelated = react(render_click(view, "unrelated", %{}), "streams")

      # The stream did not change, so LiveView must not resend the frame.
      assert after_unrelated.streams_diff == before.streams_diff
    end
  end
end
