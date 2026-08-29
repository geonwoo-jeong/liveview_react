defmodule LiveViewReactExamplesWeb.LiveSimpleProps do
  use LiveViewReactExamplesWeb, :live_view

  def render(assigns) do
    ~H"""
    <.react
      id="simple-props-demo"
      component="SimpleProps"
      socket={@socket}
      user={%{name: "LiveViewReact", age: 1}}
    />
    """
  end

  def mount(_params, _session, socket), do: {:ok, socket}
end
