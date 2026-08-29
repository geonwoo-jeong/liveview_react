defmodule LiveViewReactExamplesWeb.LiveLazy do
  use LiveViewReactExamplesWeb, :live_view

  def render(assigns) do
    ~H"""
    <.react id="lazy-demo" component="Lazy" socket={@socket} />
    """
  end

  def mount(_params, _session, socket), do: {:ok, socket}
end
