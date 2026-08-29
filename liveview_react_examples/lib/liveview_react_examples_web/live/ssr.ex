defmodule LiveViewReactExamplesWeb.LiveSSR do
  use LiveViewReactExamplesWeb, :live_view

  def render(assigns) do
    ~H"""
    <h1 class="flex justify-center mb-10 font-bold">SSR</h1>
    <div class="flex space-x-2">
      <.react
        id="ssr-server"
        component="SSR"
        ssr={true}
        socket={@socket}
        text="I am rendered on Server"
        class="cursor-pointer"
      />
      <.react
        id="ssr-client"
        component="SSR"
        ssr={false}
        socket={@socket}
        text="I am rendered on Client"
        class="cursor-pointer"
      />
    </div>
    """
  end

  def mount(_session, _params, socket) do
    {:ok, socket}
  end
end
