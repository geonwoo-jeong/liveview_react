defmodule LiveViewReactExamplesWeb.LiveSSRE2E do
  @moduledoc false

  use LiveViewReactExamplesWeb, :live_view

  @connected_mount_delay 1_000
  @live_event_delay 750

  def render(assigns) do
    ~H"""
    <main data-testid="ssr-harness" class="space-y-4 p-6">
      <.react
        id="e2e-ssr-root"
        component="E2ESSRProbe"
        phase={@phase}
        socket={@socket}
        ssr={true}
      />
      <.react
        id="e2e-ssr-root-two"
        component="E2ESSRProbe"
        phase={@phase}
        socket={@socket}
        ssr={true}
      />
      <.react
        id="e2e-client-root"
        component="E2ESSRProbe"
        phase={@phase}
        socket={@socket}
        ssr={false}
      />
    </main>
    """
  end

  def mount(_params, _session, socket) do
    connected? = connected?(socket)
    phase = if connected?, do: connected_phase(), else: "dead"

    if connected? do
      Process.send_after(self(), :emit_ssr_live_event, @live_event_delay)
    end

    {:ok, assign(socket, :phase, phase)}
  end

  def handle_info(:emit_ssr_live_event, socket) do
    {:noreply, push_event(socket, "e2e_ssr_live_event", %{message: "received"})}
  end

  defp connected_phase do
    Process.sleep(@connected_mount_delay)
    "connected"
  end
end
