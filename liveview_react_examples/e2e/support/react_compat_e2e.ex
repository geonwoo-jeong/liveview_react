# This module is compiled only when the example application's E2E suite is explicitly enabled.
defmodule LiveViewReactExamplesWeb.ReactCompatE2E do
  @moduledoc false

  use LiveViewReactExamplesWeb, :live_view

  def mount(_params, _session, socket) do
    {:ok, assign(socket, crash_root: false, server_version: 0)}
  end

  def render(assigns) do
    ~H"""
    <main data-testid="react-compat-harness" class="space-y-4 p-6">
      <nav aria-label="React compatibility operations" class="flex flex-wrap gap-2">
        <button data-testid="server-update-compat" phx-click="increment_server">
          update server state
        </button>
        <button data-testid="crash-uncaught" phx-click="crash_uncaught">
          crash uncaught root
        </button>
      </nav>

      <output data-testid="compat-server-authoritative">{@server_version}</output>
      <div
        id="compat-portal-host"
        data-testid="compat-portal-host"
        phx-update="ignore"
      >
      </div>

      <.react
        id="e2e-react-compat-root"
        component="E2EReactCompatProbe"
        serverVersion={@server_version}
        socket={@socket}
        ssr={false}
      />
      <.react
        id="e2e-react-uncaught-root"
        component="E2EUncaughtErrorProbe"
        shouldThrow={@crash_root}
        socket={@socket}
        ssr={false}
      />
    </main>
    """
  end

  def handle_event("increment_server", _params, socket) do
    {:noreply, update(socket, :server_version, &(&1 + 1))}
  end

  def handle_event("crash_uncaught", _params, socket) do
    {:noreply, assign(socket, :crash_root, true)}
  end
end
