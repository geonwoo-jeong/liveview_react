defmodule LiveViewReact.EventsTest do
  use ExUnit.Case

  import LiveViewReact
  import Phoenix.Component
  import Phoenix.LiveViewTest

  alias LiveViewReact.Test
  alias Phoenix.HTML.Safe, as: HTMLSafe
  alias Phoenix.LiveView.JS
  alias Phoenix.LiveView.Socket

  defmodule CapturingSSRRenderer do
    @moduledoc false
    @behaviour LiveViewReact.SSR

    @impl true
    def render(request) do
      send(self(), {:ssr_request, request})
      "<button>server</button>"
    end
  end

  def callback_component(assigns) do
    ~H"""
    <.react
      id="callback"
      component="Counter"
      socket={@socket}
      label="Count"
      r-on:increment={
        JS.push("increment", value: %{source: "server"})
        |> JS.add_class("pending", to: "#callback")
      }
      r-on:reset={nil}
    />
    """
  end

  test "transports canonical r-on attributes outside ordinary props" do
    react = callback_component() |> Test.get_react()

    assert react.props == %{"label" => "Count"}

    assert react.events == %{
             "onIncrement" => [
               ["push", %{"event" => "increment", "value" => %{"source" => "server"}}],
               ["add_class", %{"names" => ["pending"], "to" => "#callback"}]
             ]
           }

    refute Map.has_key?(react.events, "onReset")
  end

  test "includes exact event metadata in SSR requests and hydration descriptors" do
    with_ssr_renderer(fn ->
      react = callback_component() |> Test.get_react()

      assert_receive {:ssr_request, request}
      assert request.events |> Jason.encode!() |> Jason.decode!() == react.events
      assert react.hydration["events"] == react.events
    end)
  end

  test "rejects malformed event names" do
    for attribute <- ["r-on:", "r-on:Increment", "r-on:save_item", "r-on:save--item"] do
      assert_raise ArgumentError, ~r/lowercase kebab-case event name/, fn ->
        render_direct(%{attribute => JS.push("event")})
      end
    end
  end

  test "accepts only Phoenix.LiveView.JS commands or nil" do
    for value <- ["increment", %{}, [], 1, false] do
      assert_raise ArgumentError, ~r/Phoenix.LiveView.JS command or nil/, fn ->
        render_direct(%{"r-on:increment" => value})
      end
    end

    assert render_direct(%{"r-on:increment" => nil}) |> Test.get_react() |> Map.fetch!(:events) ==
             %{}
  end

  test "rejects collisions with ordinary React props" do
    assert_raise ArgumentError,
                 ~s(LiveViewReact.react/1 cannot transport both "r-on:save-item" and the ordinary prop "onSaveItem"),
                 fn ->
                   render_direct(%{
                     "onSaveItem" => "ordinary",
                     "r-on:save-item" => JS.push("save")
                   })
                 end
  end

  defp callback_component do
    render_component(&callback_component/1, socket: %Socket{})
  end

  defp render_direct(extra_assigns) do
    LiveViewReact.react(
      Map.merge(
        %{
          id: "direct-events",
          component: "Counter",
          socket: %Socket{},
          ssr: false,
          __changed__: nil
        },
        extra_assigns
      )
    )
    |> HTMLSafe.to_iodata()
    |> IO.iodata_to_binary()
  end

  defp with_ssr_renderer(fun) do
    previous_renderer = Application.fetch_env(:liveview_react, :ssr_module)
    Application.put_env(:liveview_react, :ssr_module, CapturingSSRRenderer)

    try do
      fun.()
    after
      case previous_renderer do
        {:ok, renderer} -> Application.put_env(:liveview_react, :ssr_module, renderer)
        :error -> Application.delete_env(:liveview_react, :ssr_module)
      end
    end
  end
end
