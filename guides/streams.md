# Streams

LiveViewReact passes Phoenix `LiveStream` assigns to React as immutable arrays
from disconnected SSR and no-JavaScript HTML through hydration, connected
updates, and reconnects. The server keeps Phoenix's operation order; the
browser applies each connected frame with copy-on-write updates so untouched
streams and items retain their references.

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
An empty named stream is never inferred away: the component receives that prop
as `[]` in the mandatory initial frame.

## Semantics

Phoenix has three related but distinct stream modes. LiveViewReact names and
tests them separately rather than hiding them behind one snapshot flag.

### Disconnected render

The SSR frame uses Phoenix's dead-render enumeration. It restores insertion
call order and retains only the newest item for a duplicate DOM ID. Like a
normal no-WebSocket Phoenix stream comprehension, it does not enforce `limit`
on the first render. Pending client-operation metadata such as `at`,
`update_only`, delete, and reset is not replayed against a client collection to
produce this frame.

That materialized plain-JSON snapshot, including every computed `__dom_id`, is
passed to `renderToString` and stored unchanged in the v2 hydration descriptor.
The browser hydrates it directly; it does not hydrate an empty list and fill it
from an effect.

### Connected snapshot and incremental operations

Connected stream transport is one atomic frame per stream. The frame keeps
Phoenix's materialized items separate from its raw insert metadata, deletes,
and reset flag. This separation is necessary because `update_only`, `at`, and
`limit` depend on whether a DOM ID was already present in the browser; replaying
generic JSON Patch operations from an empty array cannot reproduce that rule.

An incremental frame reconciles against the current collection:

- `at: -1` appends; `at: 0` prepends; other non-negative positions insert at
  that index. A position beyond the current length appends.
- An existing `__dom_id` that was not reset or deleted updates in place.
  Phoenix does not reapply that item's `at` or `limit`.
- A missing `update_only: true` item is skipped, including its limit. A present
  item is updated in place.
- Deletes of missing IDs are idempotent.
- Delete and reset removal happen before incoming items. If an incoming DOM ID
  existed immediately before that removal, Phoenix restores it as a new insert;
  its `at` and `limit` therefore apply. A reset drops every unmentioned item.
- For an accepted new or restored insert, a positive limit immediately keeps
  the first N items and a negative limit immediately keeps the last N.
- Multiple streams are independent. Updating one does not clone untouched
  sibling stream arrays.

A connected mount or reconnect snapshot rebuilds membership solely from the
incoming frame and drops stale stream names and unmentioned items. It still
consults prior browser membership to decide whether an incoming `update_only`
item may be restored, matching LiveView's join patch rather than pretending the
prior DOM never existed. When a connected snapshot arrives during hydration,
LiveViewReact first commits the exact disconnected frame and then renders the
newest queued state.

## Transport v2

The initial SSR request and hydration descriptor use one mandatory flat frame:

```text
{version: 2, component, identifierPrefix, props, streams, events, slots}
```

All four data namespaces are required, even when empty, and every pair is
checked for name collisions before React props are merged. A missing field,
unknown field, malformed stream value, or unsupported version fails closed.
There is no v1 parser or compatibility fallback.

Successful SSR serializes the full stream snapshot once in the hydration
descriptor. The outer stream transport is empty until it carries a newer
connected snapshot or patch, so the same full stream payload is not duplicated
across two transport attributes. Client-only rendering instead uses the outer
authoritative snapshot because no hydration descriptor exists.

Connected stream payloads use only this v2 operation:

```text
{op: "stream", path: "/<stream-name>", value: {items, inserts, deletes, reset}}
```

There is no stream-specific `upsert`, `limit`, or `$$dom_id` extension in the
generic JSON Patch lane. Frames and paths have an exact schema and fail closed
when fields, DOM-ID membership, numeric ranges, or prototype-sensitive names
are invalid.

## Phoenix LiveView contract

Phoenix LiveView's
[LiveStream struct](https://hexdocs.pm/phoenix_live_view/Phoenix.LiveView.LiveStream.html)
is not a public extension API. LiveViewReact isolates its use in one internal
adapter and currently supports the tuple and struct contract shipped by Phoenix
LiveView `~> 1.2.11`. Stream keys must match its `name`; unsupported field or
insert-tuple shapes fail immediately instead of being guessed.

Keep LiveView within the Hex version range declared by `liveview_react`. Run
the package tests before widening that range for a newer LiveView line.
