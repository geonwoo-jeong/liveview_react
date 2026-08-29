defmodule LiveViewReactExamplesWeb.LiveEventsE2E do
  @moduledoc false

  use LiveViewReactExamplesWeb, :live_view

  def render(assigns) do
    ~H"""
    <main data-testid="events-harness" class="space-y-4 p-6">
      <div class="flex flex-wrap gap-2">
        <button data-testid="emit-server-event" phx-click="emit_server_event">
          emit server event
        </button>
        <button data-testid="remove-events-root" phx-click="remove_events_root">
          remove React events root
        </button>
        <button data-testid="callback-barrier" phx-click="callback_barrier">
          callback barrier
        </button>
      </div>

      <output data-testid="server-phx-count">{@phx_count}</output>
      <output data-testid="server-push-sequence">{@push_sequence}</output>
      <output data-testid="server-patch-step">{@step}</output>
      <output data-testid="callback-barrier-sequence">{@callback_barrier_sequence}</output>

      <div id="callback-transition" data-testid="callback-transition">transition target</div>
      <div id="callback-loading" data-testid="callback-loading">loading target</div>

      <.live_component
        module={LiveViewReactExamplesWeb.LiveEventsTargetE2E}
        id="events-callback-component"
      />

      <%= if @show_events_root do %>
        <.react
          id="e2e-events-root"
          component="E2EEventsProbe"
          patchStep={@step}
          r-on:increment={
            JS.add_class("e2e-transition-run", to: "#callback-transition")
            |> JS.push("callback_increment",
              target: "#events-callback-target",
              value: %{static: "server"}
            )
          }
          socket={@socket}
          ssr={false}
        />
      <% end %>
    </main>
    """
  end

  def mount(_params, _session, socket) do
    connect_params =
      if connected?(socket), do: Phoenix.LiveView.get_connect_params(socket) || %{}, else: %{}

    reconnect_mounts = Map.get(connect_params, "_mounts", 0)
    push_sequence = if is_integer(reconnect_mounts) and reconnect_mounts > 0, do: 100, else: 0

    {:ok,
     assign(socket,
       callback_barrier_sequence: 0,
       phx_count: 0,
       push_sequence: push_sequence,
       show_events_root: true,
       step: "initial"
     )}
  end

  def handle_params(params, _uri, socket) do
    {:noreply, assign(socket, :step, Map.get(params, "step", "initial"))}
  end

  def handle_event("programmatic_reply", %{"amount" => amount}, socket)
      when is_integer(amount) do
    {:reply, %{doubled: amount * 2, source: "programmatic"}, socket}
  end

  def handle_event("programmatic_reply", _params, socket) do
    {:reply, %{error: "invalid_amount"}, socket}
  end

  def handle_event("event_reply", %{"query" => query}, socket) when is_binary(query) do
    {:reply, %{result: String.upcase(query)}, socket}
  end

  def handle_event("event_reply", _params, socket) do
    {:reply, %{error: "invalid_query"}, socket}
  end

  def handle_event("react_phx_increment", %{"by" => by}, socket) when is_integer(by) do
    increment_phx_count(socket, by)
  end

  def handle_event("react_phx_increment", %{"by" => by}, socket) when is_binary(by) do
    case Integer.parse(by) do
      {increment, ""} -> increment_phx_count(socket, increment)
      _invalid -> {:noreply, socket}
    end
  end

  def handle_event("react_phx_increment", _params, socket), do: {:noreply, socket}

  def handle_event("emit_server_event", _params, socket) do
    sequence = socket.assigns.push_sequence + 1

    {:noreply,
     socket
     |> assign(:push_sequence, sequence)
     |> push_event("e2e_server_event", %{sequence: sequence})}
  end

  def handle_event("remove_events_root", _params, socket) do
    {:noreply, assign(socket, :show_events_root, false)}
  end

  def handle_event("callback_barrier", _params, socket) do
    {:noreply, update(socket, :callback_barrier_sequence, &(&1 + 1))}
  end

  defp increment_phx_count(socket, increment) do
    {:noreply, update(socket, :phx_count, &(&1 + increment))}
  end
end

defmodule LiveViewReactExamplesWeb.LiveEventsTargetE2E do
  @moduledoc false

  use LiveViewReactExamplesWeb, :live_component

  def render(assigns) do
    ~H"""
    <section id="events-callback-target" phx-target={@myself}>
      <output data-testid="callback-count">{@count}</output>
      <output data-testid="callback-payload">{@payload}</output>
    </section>
    """
  end

  def update(assigns, socket) do
    {:ok,
     socket
     |> assign(assigns)
     |> assign_new(:count, fn -> 0 end)
     |> assign_new(:payload, fn -> "none" end)}
  end

  def handle_event("callback_increment", %{"by" => by} = params, socket)
      when is_integer(by) do
    Process.sleep(700)

    payload =
      params
      |> Map.take(["by", "label", "static"])
      |> Enum.sort()
      |> Enum.map_join(",", fn {key, value} -> "#{key}=#{value}" end)

    {:noreply,
     socket
     |> update(:count, &(&1 + by))
     |> assign(:payload, payload)}
  end

  def handle_event("callback_increment", _params, socket), do: {:noreply, socket}
end

defmodule LiveViewReactExamplesWeb.LiveEventsDestinationE2E do
  @moduledoc false

  use LiveViewReactExamplesWeb, :live_view

  def render(assigns) do
    ~H"""
    <main data-testid="events-destination" class="space-y-4 p-6">
      <output data-testid="destination-via">{@via}</output>
      <.link data-testid="return-to-events" navigate={~p"/e2e/events"}>
        return to events harness
      </.link>
    </main>
    """
  end

  def mount(params, _session, socket) do
    {:ok, assign(socket, :via, Map.get(params, "via", "unknown"))}
  end
end
