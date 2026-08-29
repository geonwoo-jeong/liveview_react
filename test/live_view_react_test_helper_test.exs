defmodule LiveViewReact.TestHelperTest do
  use ExUnit.Case

  import LiveViewReact
  import Phoenix.Component
  import Phoenix.LiveViewTest

  alias LiveViewReact.Test

  def component(assigns) do
    ~H"""
    <.react id="helper-test" component="TestComponent" title="Hello" />
    """
  end

  test "get_react exposes props_diff, streams_diff, and use_diff" do
    html = render_component(&component/1)
    react = Test.get_react(html)

    assert react.props == %{"title" => "Hello"}
    assert react.use_diff == true
    assert react.props_diff == []
    assert react.streams_diff == []
  end
end
