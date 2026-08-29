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
    demo =
      case {socket.view, socket.assigns.live_action} do
        {LiveViewReactExamplesWeb.LiveSimple, _} ->
          :simple

        {LiveViewReactExamplesWeb.LiveSimpleProps, _} ->
          :simple_props

        {LiveViewReactExamplesWeb.LiveTypescript, _} ->
          :typescript

        {LiveViewReactExamplesWeb.LiveLazy, _} ->
          :lazy

        {LiveViewReactExamplesWeb.LiveCounter, _} ->
          :counter

        {LiveViewReactExamplesWeb.LiveLogList, _} ->
          :log_list

        {LiveViewReactExamplesWeb.LiveFlashSonner, _} ->
          :flash_sonner

        {LiveViewReactExamplesWeb.LiveSSR, _} ->
          :ssr

        {LiveViewReactExamplesWeb.LiveHybridForm, _} ->
          :hybrid_form

        {LiveViewReactExamplesWeb.LiveSlot, _} ->
          :slot

        {LiveViewReactExamplesWeb.LiveContext, _} ->
          :context

        {LiveViewReactExamplesWeb.LiveLinkDemo, _} ->
          :link_demo

        {LiveViewReactExamplesWeb.LiveLinkUsage, _} ->
          :link_usage

        {LiveViewReactExamplesWeb.LiveStreamDemo, _} ->
          :stream_demo

        {_view, _live_action} ->
          nil
      end

    {:cont, assign(socket, demo: demo)}
  end
end
