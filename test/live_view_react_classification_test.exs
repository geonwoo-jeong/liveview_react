defmodule LiveViewReact.ClassificationTest do
  use ExUnit.Case

  import LiveViewReact
  import Phoenix.Component
  import Phoenix.LiveViewTest

  alias LiveViewReact.Test
  alias Phoenix.LiveView.LiveStream
  alias Phoenix.LiveView.Socket

  def stream_component(assigns) do
    ~H"""
    <.react
      id="stream-component"
      component="TestComponent"
      socket={@socket}
      users={@users}
      title={@title}
    />
    """
  end

  test "LiveStream values are excluded from props" do
    stream = LiveStream.new(:users, make_ref(), [], [])

    html =
      render_component(&stream_component/1,
        users: stream,
        title: "My Page",
        socket: %Socket{}
      )

    react = Test.get_react(html)

    assert react.props == %{"title" => "My Page"}
  end
end
