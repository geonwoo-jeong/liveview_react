defmodule LiveViewReact.TestHelperTest do
  use ExUnit.Case

  import LiveViewReact
  import Phoenix.Component
  import Phoenix.LiveViewTest

  alias LiveViewReact.Test
  alias Phoenix.LiveView.Socket

  def component(assigns) do
    ~H"""
    <.react id="helper-test" component="TestComponent" socket={@socket} title="Hello" />
    """
  end

  test "get_react exposes transport kinds and diffs" do
    html = render_component(&component/1, socket: %Socket{})
    react = Test.get_react(html)

    assert react.props == %{"title" => "Hello"}
    assert react.props_kind == "snapshot"
    assert react.props_diff == []
    assert react.streams_kind == "snapshot"
    assert react.streams_diff == []
    assert react.hydration == nil
  end

  test "get_react rejects an invalid hydration descriptor" do
    html = """
    <div id="invalid" phx-hook="LiveViewReactHook" data-component="Test" data-props="{}"
      data-props-kind="snapshot" data-props-diff="" data-streams-kind="snapshot"
      data-streams-diff="" data-slots="{}">
      <div data-react-target
        data-react-hydration='{"version":2,"component":"Test","props":{},"slots":{}}'>
      </div>
    </div>
    """

    assert_raise RuntimeError, "Invalid data-react-hydration descriptor", fn ->
      Test.get_react(html)
    end
  end

  test "get_react rejects a hydration component mismatch" do
    html = """
    <div id="mismatch" phx-hook="LiveViewReactHook" data-component="Current"
      data-props="{}" data-props-kind="snapshot" data-props-diff=""
      data-streams-kind="snapshot" data-streams-diff="" data-slots="{}">
      <div data-react-target
        data-react-hydration='{"version":1,"component":"Stale","props":{},"slots":{}}'>
      </div>
    </div>
    """

    assert_raise RuntimeError,
                 "data-react-hydration component must match data-component",
                 fn -> Test.get_react(html) end
  end

  test "get_react requires exactly one direct React target" do
    html = """
    <div id="duplicate" phx-hook="LiveViewReactHook" data-component="Test"
      data-props="{}" data-props-kind="snapshot" data-props-diff=""
      data-streams-kind="snapshot" data-streams-diff="" data-slots="{}">
      <div data-react-target></div><div data-react-target></div>
    </div>
    """

    assert_raise RuntimeError,
                 "LiveViewReact root must contain exactly one direct React target",
                 fn -> Test.get_react(html) end
  end
end
