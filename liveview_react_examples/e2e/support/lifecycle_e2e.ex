defmodule LiveViewReactExamplesWeb.LiveLifecycleE2E do
  @moduledoc false

  # This module is compiled only for the opt-in browser lifecycle suite.
  use LiveViewReactExamplesWeb, :live_view

  def render(assigns) do
    ~H"""
    <main data-testid="lifecycle-harness" class="space-y-4 p-6">
      <div class="flex flex-wrap gap-2">
        <button data-testid="server-update-a" phx-click="increment_server" phx-value-target="a">
          update server A
        </button>
        <button data-testid="server-update-b" phx-click="increment_server" phx-value-target="b">
          update server B
        </button>
        <button data-testid="remove-b" phx-click="remove_b">remove B</button>
        <button data-testid="update-delayed" phx-click="update_delayed">update delayed</button>
        <button data-testid="remove-delayed-destroy" phx-click="remove_delayed_destroy">
          remove delayed root
        </button>
        <button data-testid="strict-ping" phx-click="strict_ping">strict ping</button>
        <button data-testid="remove-strict" phx-click="remove_strict">remove strict root</button>
        <.link data-testid="navigate-away" navigate={~p"/e2e/lifecycle/destination"}>
          navigate away
        </.link>
      </div>

      <output data-testid="authoritative-a">{@server_a}</output>
      <output data-testid="authoritative-queued-count">{length(@queued_items)}</output>
      <output data-testid="removal-sequence">{@removal_sequence}</output>
      <output data-testid="strict-sequence">{@strict_sequence}</output>

      <form id="e2e-reconnect-recovery" phx-change="recover_reconnect_form" hidden>
        <input type="hidden" name="reconnect[value]" value="stable" />
      </form>

      <div class="grid gap-4 md:grid-cols-2">
        <.react
          id="e2e-root-a"
          component="E2ELifecycleProbe"
          label="a"
          queuedItems={@queued_items}
          recoveryPadding={@recovery_padding}
          serverVersion={@server_a}
          socket={@socket}
          ssr={false}
        />

        <%= if @show_b do %>
          <.react
            id="e2e-root-b"
            component="E2ELifecycleProbe"
            label="b"
            serverVersion={@server_b}
            socket={@socket}
            ssr={false}
          />
        <% end %>

        <.react
          id="e2e-delayed-update"
          component="E2EDelayedUpdate"
          label="lazy-update"
          serverVersion={@delayed_version}
          socket={@socket}
          ssr={false}
        />

        <%= if @show_delayed_destroy do %>
          <.react
            id="e2e-delayed-destroy"
            component="E2EDelayedDestroy"
            label="lazy-destroy"
            serverVersion={@delayed_version}
            socket={@socket}
            ssr={false}
          />
        <% end %>

        <%= if @show_strict do %>
          <.react
            id="e2e-strict-root"
            component="E2EStrictModeProbe"
            socket={@socket}
            ssr={false}
          />
        <% end %>
      </div>
    </main>
    """
  end

  def mount(_params, _session, socket) do
    connect_params =
      if connected?(socket), do: Phoenix.LiveView.get_connect_params(socket) || %{}, else: %{}

    reconnect_mounts = Map.get(connect_params, "_mounts", 0)

    reconnect_with_queued_patch? =
      is_integer(reconnect_mounts) and reconnect_mounts > 0 and
        connect_params["e2e_queued_patch"] == true

    reconnect_with_recovery_seed? =
      is_integer(reconnect_mounts) and reconnect_mounts > 0 and
        connect_params["e2e_recovery_seed"] == true

    if reconnect_with_queued_patch?, do: send(self(), :apply_queued_reconnect_patch)

    {:ok,
     assign(socket,
       server_a: if(reconnect_with_recovery_seed?, do: 41, else: 0),
       server_b: 0,
       queued_items: [],
       recovery_padding: String.duplicate("stable", 100),
       delayed_version: 0,
       removal_sequence: 0,
       show_b: true,
       show_delayed_destroy: true,
       show_strict: true,
       strict_sequence: 0
     )}
  end

  def handle_event("increment_server", %{"target" => "a"}, socket) do
    {:noreply, update(socket, :server_a, &(&1 + 1))}
  end

  def handle_event("increment_server", %{"target" => "b"}, socket) do
    {:noreply, update(socket, :server_b, &(&1 + 1))}
  end

  def handle_event("increment_server", _params, socket), do: {:noreply, socket}

  def handle_event("recover_reconnect_form", _params, socket), do: {:noreply, socket}

  def handle_event("remove_b", _params, socket) do
    {:noreply,
     assign(socket,
       removal_sequence: socket.assigns.removal_sequence + 1,
       show_b: false
     )}
  end

  def handle_event("update_delayed", _params, socket) do
    {:noreply, update(socket, :delayed_version, &(&1 + 1))}
  end

  def handle_event("remove_delayed_destroy", _params, socket) do
    {:noreply, assign(socket, :show_delayed_destroy, false)}
  end

  def handle_event("strict_ping", _params, socket) do
    sequence = socket.assigns.strict_sequence + 1

    {:noreply,
     socket
     |> assign(:strict_sequence, sequence)
     |> push_event("e2e_strict_ping", %{sequence: sequence})}
  end

  def handle_event("remove_strict", _params, socket) do
    {:noreply, assign(socket, :show_strict, false)}
  end

  def handle_info(:apply_queued_reconnect_patch, socket) do
    {:noreply, assign(socket, :queued_items, [%{id: "queued-1", label: "post-join"}])}
  end
end

defmodule LiveViewReactExamplesWeb.LiveLifecycleDestination do
  @moduledoc false

  use LiveViewReactExamplesWeb, :live_view

  def render(assigns) do
    ~H"""
    <main data-testid="lifecycle-destination" class="p-6">
      lifecycle destination <.link navigate={~p"/e2e/lifecycle"}>return to lifecycle harness</.link>
    </main>
    """
  end

  def mount(_params, _session, socket), do: {:ok, socket}
end
