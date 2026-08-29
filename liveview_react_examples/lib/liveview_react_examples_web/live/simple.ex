defmodule LiveViewReactExamplesWeb.LiveSimple do
  use LiveViewReactExamplesWeb, :live_view

  def render(assigns) do
    ~H"""
    <.react id="simple-demo" component="Simple" socket={@socket} />
    """
  end

  def mount(_params, _session, socket), do: {:ok, socket}
end
