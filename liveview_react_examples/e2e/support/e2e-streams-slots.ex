defmodule LiveViewReactExamplesWeb.LiveStreamsSlotsE2E do
  @moduledoc false

  use LiveViewReactExamplesWeb, :live_view

  @connected_mount_delay 1_000

  @initial_primary [
    %{id: "alpha", label: "Alpha"},
    %{id: "bravo", label: "Bravo"},
    %{id: "charlie", label: "Charlie"}
  ]

  @initial_limited [
    %{id: "one", label: "One"},
    %{id: "two", label: "Two"},
    %{id: "three", label: "Three"}
  ]

  @initial_client_only [
    %{id: "client", label: "Client only initial"}
  ]

  @comparison_initial [
    %{id: "one", label: "One"},
    %{id: "two", label: "Two"},
    %{id: "three", label: "Three"},
    %{id: "four", label: "Four"}
  ]

  @dead_primary [
    %{id: "dead-alpha", label: "Dead Alpha"},
    %{id: "dead-bravo", label: "Dead Bravo"}
  ]

  @connected_primary [
    %{id: "connected-alpha", label: "Connected Alpha"},
    %{id: "connected-bravo", label: "Connected Bravo"}
  ]

  @reconnect_primary [
    %{id: "reconnect-alpha", label: "Reconnect Alpha"},
    %{id: "reconnect-bravo", label: "Reconnect Bravo"}
  ]

  @reconnect_positive [
    %{id: "reconnect-positive", label: "Reconnect Positive"}
  ]

  @reconnect_negative [
    %{id: "reconnect-negative", label: "Reconnect Negative"}
  ]

  @reconnect_client_only [
    %{id: "reconnect-client", label: "Reconnect Client only"}
  ]

  @untrusted_slot ~S|<img src=x onerror="window.__liveViewReactSlotXss=true"> & "unsafe"|

  def render(assigns) do
    ~H"""
    <main data-testid="streams-slots-harness" class="space-y-4 p-6">
      <nav aria-label="stream operations" class="flex flex-wrap gap-2">
        <button data-testid="insert-start" phx-click="insert_start">insert start</button>
        <button data-testid="insert-append" phx-click="insert_append">insert append</button>
        <button data-testid="insert-arbitrary" phx-click="insert_arbitrary">
          insert arbitrary
        </button>
        <button data-testid="update-existing" phx-click="update_existing">
          update existing
        </button>
        <button data-testid="update-only-missing" phx-click="update_only_missing">
          update only missing
        </button>
        <button data-testid="delete-existing" phx-click="delete_existing">
          delete existing
        </button>
        <button data-testid="reset-primary" phx-click="reset_primary">reset</button>
        <button data-testid="positive-limit" phx-click="positive_limit">
          positive limit
        </button>
        <button data-testid="negative-limit" phx-click="negative_limit">
          negative limit
        </button>
        <button data-testid="compare-update-limit" phx-click="compare_update_limit">
          compare update with limit
        </button>
        <button
          data-testid="compare-update-only-limit"
          phx-click="compare_update_only_limit"
        >
          compare update only with limit
        </button>
        <button
          data-testid="compare-missing-update-only-limit"
          phx-click="compare_missing_update_only_limit"
        >
          compare missing update only with limit
        </button>
        <button
          data-testid="compare-reset-update-only"
          phx-click="compare_reset_update_only"
        >
          compare reset with update only
        </button>
        <button data-testid="update-slots" phx-click="update_slots">update slots</button>
        <button data-testid="remove-default-slot" phx-click="remove_default_slot">
          remove default slot
        </button>
        <button data-testid="restore-named-slot" phx-click="restore_named_slot">
          restore named slot
        </button>
        <button data-testid="remove-named-slot" phx-click="remove_named_slot">
          remove named slot
        </button>
      </nav>

      <output data-testid="server-last-operation">{@last_operation}</output>
      <output data-testid="server-mount-phase">{@mount_phase}</output>

      <.react
        id="e2e-streams-slots-root"
        component="E2EStreamsSlotsProbe"
        lastOperation={@last_operation}
        mountPhase={@mount_phase}
        negative={@streams.negative}
        positive={@streams.positive}
        primary={@streams.primary}
        react_missing_update_only_limit={@streams.react_missing_update_only_limit}
        react_reset_update_only={@streams.react_reset_update_only}
        react_update_limit={@streams.react_update_limit}
        react_update_only_limit={@streams.react_update_only_limit}
        socket={@socket}
        ssr={true}
      >
        <:slot :if={@show_named_slot} name="sidebar">
          <p data-testid="named-slot-content">Named slot revision {@slot_revision}</p>
        </:slot>
        <p :if={@show_default_slot} data-testid="default-slot-content">
          Default slot revision {@slot_revision}: {@untrusted_slot}
        </p>
      </.react>

      <.react
        id="e2e-client-only-stream-root"
        client_only={@streams.client_only}
        component="E2EClientOnlyStreamProbe"
        socket={@socket}
        ssr={false}
      />

      <section data-testid="native-stream-comparison">
        <ol
          id="native-update-limit"
          data-testid="stream-native-update-limit"
          phx-update="stream"
        >
          <li
            :for={{dom_id, item} <- @streams.native_update_limit}
            id={dom_id}
            data-stream-dom-id={dom_id}
            data-stream-logical-id={item.id}
          >
            {item.label}
          </li>
        </ol>
        <ol
          id="native-update-only-limit"
          data-testid="stream-native-update-only-limit"
          phx-update="stream"
        >
          <li
            :for={{dom_id, item} <- @streams.native_update_only_limit}
            id={dom_id}
            data-stream-dom-id={dom_id}
            data-stream-logical-id={item.id}
          >
            {item.label}
          </li>
        </ol>
        <ol
          id="native-missing-update-only-limit"
          data-testid="stream-native-missing-update-only-limit"
          phx-update="stream"
        >
          <li
            :for={{dom_id, item} <- @streams.native_missing_update_only_limit}
            id={dom_id}
            data-stream-dom-id={dom_id}
            data-stream-logical-id={item.id}
          >
            {item.label}
          </li>
        </ol>
        <ol
          id="native-reset-update-only"
          data-testid="stream-native-reset-update-only"
          phx-update="stream"
        >
          <li
            :for={{dom_id, item} <- @streams.native_reset_update_only}
            id={dom_id}
            data-stream-dom-id={dom_id}
            data-stream-logical-id={item.id}
          >
            {item.label}
          </li>
        </ol>
      </section>
    </main>
    """
  end

  def mount(params, _session, socket) do
    connect_params =
      if connected?(socket), do: Phoenix.LiveView.get_connect_params(socket) || %{}, else: %{}

    mode = stream_mode(params, socket, connect_params)

    if mode == :delayed_connected do
      Process.sleep(@connected_mount_delay)
    end

    seeds = stream_seeds(mode)

    socket =
      socket
      |> assign(
        last_operation: "initial",
        mount_phase: mount_phase(mode),
        show_default_slot: true,
        show_named_slot: true,
        slot_revision: 0,
        untrusted_slot: @untrusted_slot
      )
      |> stream_configure(:primary, dom_id: &"custom-primary-#{&1.id}")
      |> stream(:primary, seeds.primary)
      |> stream(:positive, seeds.positive)
      |> stream(:negative, seeds.negative)
      |> stream(:client_only, seeds.client_only)
      |> stream(:react_update_limit, @comparison_initial)
      |> stream(:native_update_limit, @comparison_initial)
      |> stream(:react_update_only_limit, @comparison_initial)
      |> stream(:native_update_only_limit, @comparison_initial)
      |> stream(:react_missing_update_only_limit, @comparison_initial)
      |> stream(:native_missing_update_only_limit, @comparison_initial)
      |> stream(:react_reset_update_only, @comparison_initial)
      |> stream(:native_reset_update_only, @comparison_initial)

    {:ok, socket}
  end

  def handle_event("insert_start", _params, socket) do
    {:noreply,
     socket
     |> stream_insert(:primary, %{id: "start", label: "Start"}, at: 0)
     |> mark_operation("insert_start")}
  end

  def handle_event("insert_append", _params, socket) do
    {:noreply,
     socket
     |> stream_insert(:primary, %{id: "append", label: "Append"})
     |> mark_operation("insert_append")}
  end

  def handle_event("insert_arbitrary", _params, socket) do
    {:noreply,
     socket
     |> stream_insert(:primary, %{id: "arbitrary", label: "Arbitrary"}, at: 2)
     |> mark_operation("insert_arbitrary")}
  end

  def handle_event("update_existing", _params, socket) do
    {:noreply,
     socket
     |> stream_insert(:primary, %{id: "alpha", label: "Alpha updated"}, update_only: true)
     |> mark_operation("update_existing")}
  end

  def handle_event("update_only_missing", _params, socket) do
    {:noreply,
     socket
     |> stream_insert(
       :primary,
       %{id: "missing", label: "Must not be inserted"},
       update_only: true
     )
     |> mark_operation("update_only_missing")}
  end

  def handle_event("delete_existing", _params, socket) do
    {:noreply,
     socket
     |> stream_delete(:primary, %{id: "alpha"})
     |> mark_operation("delete_existing")}
  end

  def handle_event("reset_primary", _params, socket) do
    replacement = [
      %{id: "reset-one", label: "Reset one"},
      %{id: "reset-two", label: "Reset two"}
    ]

    {:noreply,
     socket
     |> stream(:primary, replacement, reset: true)
     |> mark_operation("reset_primary")}
  end

  def handle_event("positive_limit", _params, socket) do
    {:noreply,
     socket
     |> stream_insert(:positive, %{id: "zero", label: "Zero"}, at: 0, limit: 3)
     |> mark_operation("positive_limit")}
  end

  def handle_event("negative_limit", _params, socket) do
    {:noreply,
     socket
     |> stream_insert(:negative, %{id: "four", label: "Four"}, at: -1, limit: -3)
     |> mark_operation("negative_limit")}
  end

  def handle_event("compare_update_limit", _params, socket) do
    item = %{id: "two", label: "Two ordinary updated"}

    {:noreply,
     socket
     |> stream_pair_insert(:react_update_limit, :native_update_limit, item, limit: 2)
     |> mark_operation("compare_update_limit")}
  end

  def handle_event("compare_update_only_limit", _params, socket) do
    item = %{id: "two", label: "Two update-only updated"}

    {:noreply,
     socket
     |> stream_pair_insert(
       :react_update_only_limit,
       :native_update_only_limit,
       item,
       update_only: true,
       limit: 2
     )
     |> mark_operation("compare_update_only_limit")}
  end

  def handle_event("compare_missing_update_only_limit", _params, socket) do
    item = %{id: "missing", label: "Missing must stay absent"}

    {:noreply,
     socket
     |> stream_pair_insert(
       :react_missing_update_only_limit,
       :native_missing_update_only_limit,
       item,
       update_only: true,
       limit: 2
     )
     |> mark_operation("compare_missing_update_only_limit")}
  end

  def handle_event("compare_reset_update_only", _params, socket) do
    item = %{id: "two", label: "Two reset update-only"}

    {:noreply,
     socket
     |> stream(:react_reset_update_only, [], reset: true)
     |> stream_insert(:react_reset_update_only, item, update_only: true)
     |> stream(:native_reset_update_only, [], reset: true)
     |> stream_insert(:native_reset_update_only, item, update_only: true)
     |> mark_operation("compare_reset_update_only")}
  end

  def handle_event("update_slots", _params, socket) do
    {:noreply,
     socket
     |> update(:slot_revision, &(&1 + 1))
     |> mark_operation("update_slots")}
  end

  def handle_event("remove_default_slot", _params, socket) do
    {:noreply,
     socket
     |> assign(:show_default_slot, false)
     |> mark_operation("remove_default_slot")}
  end

  def handle_event("restore_named_slot", _params, socket) do
    {:noreply,
     socket
     |> assign(:show_named_slot, true)
     |> mark_operation("restore_named_slot")}
  end

  def handle_event("remove_named_slot", _params, socket) do
    {:noreply,
     socket
     |> assign(:show_named_slot, false)
     |> mark_operation("remove_named_slot")}
  end

  defp mark_operation(socket, operation), do: assign(socket, :last_operation, operation)

  defp stream_pair_insert(socket, react_name, native_name, item, options) do
    socket
    |> stream_insert(react_name, item, options)
    |> stream_insert(native_name, item, options)
  end

  defp stream_mode(params, socket, connect_params) do
    reconnect_mounts = Map.get(connect_params, "_mounts", 0)

    cond do
      connected?(socket) and is_integer(reconnect_mounts) and reconnect_mounts > 0 and
          connect_params["e2e_stream_reconnect"] == true ->
        :reconnect

      params["dead_connected"] == "true" and connected?(socket) ->
        :delayed_connected

      params["dead_connected"] == "true" ->
        :delayed_dead

      connected?(socket) ->
        :connected

      true ->
        :dead
    end
  end

  defp stream_seeds(:dead),
    do: %{
      primary: @initial_primary,
      positive: @initial_limited,
      negative: @initial_limited,
      client_only: @initial_client_only
    }

  defp stream_seeds(:delayed_dead),
    do: %{
      primary: @dead_primary,
      positive: @initial_limited,
      negative: @initial_limited,
      client_only: @initial_client_only
    }

  defp stream_seeds(:delayed_connected),
    do: %{
      primary: @connected_primary,
      positive: @initial_limited,
      negative: @initial_limited,
      client_only: @initial_client_only
    }

  defp stream_seeds(:reconnect),
    do: %{
      primary: @reconnect_primary,
      positive: @reconnect_positive,
      negative: @reconnect_negative,
      client_only: @reconnect_client_only
    }

  defp stream_seeds(:connected),
    do: %{
      primary: @initial_primary,
      positive: @initial_limited,
      negative: @initial_limited,
      client_only: @initial_client_only
    }

  defp mount_phase(:dead), do: "dead"
  defp mount_phase(:delayed_dead), do: "dead"
  defp mount_phase(:delayed_connected), do: "connected"
  defp mount_phase(:reconnect), do: "reconnected"
  defp mount_phase(:connected), do: "connected"
end
