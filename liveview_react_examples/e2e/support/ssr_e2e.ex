defmodule LiveViewReactExamplesWeb.LiveSSRE2E do
  @moduledoc false

  use LiveViewReactExamplesWeb, :live_view

  @connected_mount_delay 1_000

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
    phase = if connected?(socket), do: connected_phase(), else: "dead"
    {:ok, assign(socket, :phase, phase)}
  end

  defp connected_phase do
    Process.sleep(@connected_mount_delay)
    "connected"
  end
end
