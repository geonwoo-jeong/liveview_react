defmodule LiveViewReactExamplesWeb.LiveTypescript do
  use LiveViewReactExamplesWeb, :live_view

  def render(assigns) do
    ~H"""
    <.react id="typescript-demo" component="Typescript" socket={@socket} />
    """
  end

  def mount(_params, _session, socket), do: {:ok, socket}
end
