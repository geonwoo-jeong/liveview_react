defmodule LiveViewReactExamplesWeb.LiveStreamsSlotsE2E do
  @moduledoc false

  use LiveViewReactExamplesWeb, :live_view

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
        <button data-testid="update-slots" phx-click="update_slots">update slots</button>
        <button data-testid="remove-default-slot" phx-click="remove_default_slot">
          remove default slot
        </button>
        <button data-testid="remove-named-slot" phx-click="remove_named_slot">
          remove named slot
        </button>
      </nav>

      <output data-testid="server-last-operation">{@last_operation}</output>

      <.react
        id="e2e-streams-slots-root"
        component="E2EStreamsSlotsProbe"
        lastOperation={@last_operation}
        negative={@streams.negative}
        positive={@streams.positive}
        primary={@streams.primary}
        socket={@socket}
        ssr={true}
      >
        <:sidebar :if={@show_named_slot}>
          <p data-testid="named-slot-content">Named slot revision {@slot_revision}</p>
        </:sidebar>
        <p :if={@show_default_slot} data-testid="default-slot-content">
          Default slot revision {@slot_revision}: {@untrusted_slot}
        </p>
      </.react>
    </main>
    """
  end

  def mount(_params, _session, socket) do
    socket =
      socket
      |> assign(
        last_operation: "initial",
        show_default_slot: true,
        show_named_slot: true,
        slot_revision: 0,
        untrusted_slot: @untrusted_slot
      )
      |> stream_configure(:primary, dom_id: &"custom-primary-#{&1.id}")
      |> stream(:primary, @initial_primary)
      |> stream(:positive, @initial_limited)
      |> stream(:negative, @initial_limited)

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

  def handle_event("remove_named_slot", _params, socket) do
    {:noreply,
     socket
     |> assign(:show_named_slot, false)
     |> mark_operation("remove_named_slot")}
  end

  defp mark_operation(socket, operation), do: assign(socket, :last_operation, operation)
end
