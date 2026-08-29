# Streams

LiveViewReact passes Phoenix `LiveStream` assigns to React as immutable arrays.
The server keeps Phoenix's operation order; the browser applies each frame with
copy-on-write updates so untouched streams and items retain their references.

## Setup

Create and update streams through Phoenix LiveView:

```elixir
def mount(_params, _session, socket) do
  {:ok, stream(socket, :users, list_users())}
end

def handle_event("add-user", params, socket) do
  {:noreply, stream_insert(socket, :users, create_user!(params), at: 0)}
end
```

Pass the `LiveStream` directly to the React root:

```heex
<.react
  id="users"
  component="UserList"
  socket={@socket}
  users={@streams.users}
/>
```

Each encoded item includes Phoenix's computed `__dom_id`. Use it as the React
key rather than deriving another identity:

```tsx
type User = {
  readonly __dom_id: string;
  readonly id: number;
  readonly name: string;
};

function UserList({ users }: { readonly users: readonly User[] }) {
  return users.map((user) => <p key={user.__dom_id}>{user.name}</p>);
}
```

Custom IDs configured with `stream_configure/3` are preserved exactly.

## Semantics

The adapter implements Phoenix's client stream behavior:

- `at: -1` appends; `at: 0` prepends; other non-negative positions insert at
  that index. A position beyond the current length appends.
- Inserting an existing `__dom_id` updates it in place; `:at` does not move it.
- `update_only: true` replaces an existing item and does nothing when it is
  missing.
- Deletes of missing IDs are idempotent.
- A reset clears the stream before that frame's inserts are applied.
- A positive limit keeps the first N items; a negative limit keeps the last N.
- Multiple streams are independent. Updating one does not clone untouched
  sibling stream arrays.

A LiveViewReact snapshot is an authoritative client frame, not Phoenix's
no-WebSocket dead render. It therefore reapplies limits while reconstructing
the complete state during mount or recovery.

## Phoenix LiveView contract

`Phoenix.LiveView.LiveStream` is not a public extension API. LiveViewReact
isolates its use in one internal adapter and currently supports the tuple and
struct contract shipped by Phoenix LiveView `~> 1.2.11`. Stream keys must match
`LiveStream.name`; unsupported field or insert-tuple shapes fail immediately
instead of being guessed.

Keep LiveView within the Hex version range declared by `liveview_react`. Run
the package tests before widening that range for a newer LiveView line.
