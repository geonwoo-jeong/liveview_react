defmodule LiveViewReact.TestSupport.PropsLive do
  @moduledoc false

  use Phoenix.LiveView, layout: false
  import LiveViewReact

  def mount(_params, _session, socket) do
    {:ok,
     assign(socket,
       count: 0,
       label: "zero",
       user: %{name: "John", age: 30, bio: String.duplicate("x", 60)},
       items: [%{id: 1, text: String.duplicate("a", 40)}],
       empty: []
     )}
  end

  def render(assigns) do
    ~H"""
    <.react
      id="props"
      component="Props"
      socket={@socket}
      count={@count}
      label={@label}
      user={@user}
      items={@items}
      empty={@empty}
      ssr={false}
    />
    """
  end

  def handle_event("increment", _params, socket) do
    {:noreply, assign(socket, count: socket.assigns.count + 1)}
  end

  def handle_event("set", %{"count" => count, "label" => label}, socket) do
    {:noreply, assign(socket, count: count, label: label)}
  end

  def handle_event("rename", %{"name" => name}, socket) do
    {:noreply, assign(socket, user: %{socket.assigns.user | name: name})}
  end

  # Two assigns in one handler: LiveView keeps only the value from the start of
  # the render cycle, so the diff must be computed against "John", not the
  # intermediate value.
  def handle_event("rename_twice", _params, socket) do
    socket = assign(socket, user: %{socket.assigns.user | name: "intermediate"})
    {:noreply, assign(socket, user: %{socket.assigns.user | name: "final"})}
  end

  # Touched but unchanged: the diff must be empty.
  def handle_event("rename_back", _params, socket) do
    original = socket.assigns.user
    socket = assign(socket, user: %{original | name: "temporary"})
    {:noreply, assign(socket, user: original)}
  end

  def handle_event("append", %{"id" => id}, socket) do
    item = %{id: id, text: String.duplicate("a", 40)}
    {:noreply, assign(socket, items: socket.assigns.items ++ [item])}
  end
end

defmodule LiveViewReact.TestSupport.TemporaryLive do
  @moduledoc false

  use Phoenix.LiveView, layout: false
  import LiveViewReact

  @baseline for index <- 1..40, do: %{id: index, text: "row-#{index}"}

  def baseline, do: @baseline

  def mount(_params, _session, socket) do
    {:ok, assign(socket, messages: @baseline), temporary_assigns: [messages: @baseline]}
  end

  def render(assigns) do
    ~H"""
    <.react
      id="temporary"
      component="Temporary"
      socket={@socket}
      messages={@messages}
      ssr={false}
    />
    """
  end

  def handle_event("push", %{"id" => id}, socket) do
    extra = %{id: id, text: "extra-#{id}"}
    {:noreply, assign(socket, messages: socket.assigns.messages ++ [extra])}
  end
end

defmodule LiveViewReact.TestSupport.SlotsLive do
  @moduledoc false

  use Phoenix.LiveView, layout: false
  import LiveViewReact

  def mount(params, _session, socket) do
    {:ok, assign(socket, header?: params["header"] == "true", revision: 1, empty: [])}
  end

  def render(assigns) do
    ~H"""
    <.react
      id="slots"
      component="Slots"
      socket={@socket}
      revision={@revision}
      empty={@empty}
      ssr={false}
    >
      <:slot :if={@header?} name="header">Header {@revision}</:slot>
      <:slot name="footer">Footer {@revision}</:slot>
      Body {@revision}
    </.react>
    """
  end

  def handle_event("toggle_header", _params, socket) do
    {:noreply, assign(socket, header?: not socket.assigns.header?)}
  end

  def handle_event("bump", _params, socket) do
    {:noreply, assign(socket, revision: socket.assigns.revision + 1)}
  end
end

defmodule LiveViewReact.TestSupport.LegacySlotsLive do
  @moduledoc false

  use Phoenix.LiveView, layout: false
  import LiveViewReact

  def mount(_params, _session, socket), do: {:ok, socket}

  def render(assigns) do
    ~H"""
    <.react id="legacy" component="Legacy" socket={@socket} ssr={false}>
      <:header>Header</:header>
    </.react>
    """
  end
end

defmodule LiveViewReact.TestSupport.StreamsLive do
  @moduledoc false

  use Phoenix.LiveView, layout: false
  import LiveViewReact

  def mount(_params, _session, socket) do
    {:ok,
     socket
     |> assign(:unrelated, 0)
     |> stream(:rows, [%{id: 1, value: "a"}, %{id: 2, value: "b"}])}
  end

  def render(assigns) do
    ~H"""
    <.react id="streams" component="Streams" socket={@socket} rows={@streams.rows} ssr={false} />
    """
  end

  def handle_event("append", %{"id" => id}, socket) do
    {:noreply, stream_insert(socket, :rows, %{id: id, value: "append-#{id}"})}
  end

  def handle_event("prepend", %{"id" => id}, socket) do
    {:noreply, stream_insert(socket, :rows, %{id: id, value: "prepend-#{id}"}, at: 0)}
  end

  def handle_event("limit", %{"id" => id}, socket) do
    {:noreply, stream_insert(socket, :rows, %{id: id, value: "limited-#{id}"}, at: 0, limit: 2)}
  end

  def handle_event("update_only", %{"id" => id}, socket) do
    {:noreply, stream_insert(socket, :rows, %{id: id, value: "updated-#{id}"}, update_only: true)}
  end

  def handle_event("delete", %{"id" => id}, socket) do
    {:noreply, stream_delete(socket, :rows, %{id: id})}
  end

  def handle_event("reset", _params, socket) do
    {:noreply, stream(socket, :rows, [%{id: 7, value: "reset"}], reset: true)}
  end

  def handle_event("unrelated", _params, socket) do
    {:noreply, assign(socket, unrelated: socket.assigns.unrelated + 1)}
  end
end
