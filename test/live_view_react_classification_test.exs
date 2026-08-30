defmodule LiveViewReact.ClassificationTest do
  use ExUnit.Case

  import LiveViewReact
  import Phoenix.Component
  import Phoenix.LiveViewTest

  alias LiveViewReact.Test
  alias Phoenix.LiveView.JS
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

  test "rejects ordinary prop and stream names that collide after normalization" do
    users = LiveStream.new(:users, make_ref(), [], [])

    assert_raise ArgumentError,
                 ~r/colliding React prop "users".*ordinary props and streams/,
                 fn ->
                   render_direct(%{:users => users, "users" => "ordinary"})
                 end
  end

  test "rejects a changed prop that collides with an unchanged stream" do
    users = LiveStream.new(:users, make_ref(), [], [])

    assert_raise ArgumentError,
                 ~r/colliding React prop "users".*ordinary props and streams/,
                 fn ->
                   LiveViewReact.react(%{
                     :users => users,
                     "users" => "changed ordinary prop",
                     id: "connected-classification",
                     component: "TestComponent",
                     socket: %Socket{transport_pid: self()},
                     ssr: false,
                     __changed__: %{"users" => "old ordinary prop"}
                   })
                 end
  end

  test "rejects stream and event prop collisions" do
    on_save_item = LiveStream.new(:onSaveItem, make_ref(), [], [])

    assert_raise ArgumentError,
                 ~r/colliding React prop "onSaveItem".*streams and event props/,
                 fn ->
                   render_direct(%{
                     "r-on:save-item" => JS.push("save"),
                     onSaveItem: on_save_item
                   })
                 end
  end

  test "rejects stream and slot prop collisions" do
    users = LiveStream.new("users", make_ref(), [], [])
    slot = [%{__slot__: :users, inner_block: fn _, _ -> ["slot"] end}]

    assert_raise ArgumentError, ~r/colliding React prop "users".*streams and slot props/, fn ->
      render_direct(%{"users" => users, users: slot})
    end
  end

  test "rejects prototype-sensitive names before emitting a client frame" do
    assert_raise ArgumentError, ~r/prototype-sensitive React prop "constructor"/, fn ->
      render_direct(%{"constructor" => "unsafe"})
    end
  end

  defp render_direct(extra_assigns) do
    LiveViewReact.react(
      Map.merge(
        %{
          id: "classification",
          component: "TestComponent",
          socket: %Socket{},
          ssr: false,
          __changed__: nil
        },
        extra_assigns
      )
    )
  end
end
