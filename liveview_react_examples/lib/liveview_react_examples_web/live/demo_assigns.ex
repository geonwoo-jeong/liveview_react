defmodule LiveViewReactExamplesWeb.LiveDemoAssigns do
  @moduledoc """
  Assigns the current demo state.
  """

  import Phoenix.Component
  import Phoenix.LiveView

  def on_mount(:default, _params, _session, socket) do
    socket = attach_hook(socket, :active_tab, :handle_params, &set_active_demo/3)
    {:cont, socket}
  end

  defp set_active_demo(_params, _url, socket) do
    {:cont, assign(socket, demo: LiveViewReactExamples.demo_id_for_view(socket.view))}
  end
end
