# Architecture

LiveViewReact is a bridge between two existing runtimes. Phoenix LiveView owns
the connection and server-authoritative state; React owns an isolated subtree
and its client-local state. The bridge does not introduce another application
runtime.

## Ownership boundary

| Surface                                                  | Owner                              |
| -------------------------------------------------------- | ---------------------------------- |
| LiveView process, assigns, events, navigation, reconnect | Phoenix LiveView                   |
| Outer hook element and transport attributes              | LiveViewReact on the LiveView side |
| Inner mount target and component descendants             | React                              |
| Persisted and shared application state                   | The application through LiveView   |
| Drafts, focus, animation, widget state                   | The mounted React root             |

The rendered boundary has one transport-only outer element and one direct
React target:

```html
<div id="account-counter" phx-hook="LiveViewReactHook" phx-update="ignore">
  <div data-react-target><!-- React owns this subtree --></div>
</div>
```

React never owns the hook element. LiveView never patches through the inner
target. Ordinary HEEx assigns, including `class`, become React props rather
than attributes on the outer element.

## One component, one root

Every `<.react>` call creates one `createRoot` or `hydrateRoot` instance. Its
required `id` and `component` identify that root for its entire mounted
lifetime. Server updates call `root.render` on the existing root, so function
and class state, refs, memoization, providers, portals, transitions, and other
normal React behavior remain intact.

Changing the outer ID or component name in place is an error. To switch
component identity, let LiveView replace the whole `<.react>` element. Removing
the element destroys the hook, unmounts React, invalidates pending lazy loads,
and releases subscriptions.

Each root has its own built-in LiveView bridge and connection provider. The
library intentionally provides no hidden common React parent, cross-root
Context, global store, or event bus. `wrapRoot` installs application providers
inside every root independently; provider state is not shared between those
instances.

## Transport and reconciliation

Transport v2 uses one mandatory initial frame with exactly `version`,
`component`, `identifierPrefix`, `props`, `streams`, `events`, and `slots`.
The server renderer and hydration parser validate and materialize that same
frame; none of its data fields are inferred when missing. Connected ordinary
props carry either a full snapshot or compact patch, whichever is smaller.
LiveStream values use a separate prior-aware snapshot/patch lane because
Phoenix's `update_only`, reset, insertion, and limit behavior depends on browser
membership. One atomic frame carries materialized items plus raw insert,
delete, and reset metadata; the generic JSON Patch lane has no stream-specific
operations. Application is copy-on-write: unchanged subtrees keep their
JavaScript references so `React.memo` can avoid unrelated renders. Stream items
retain Phoenix's computed `__dom_id` for React keys. Events and slots have
dedicated validated transports.

The protocol is versioned. A malformed recoverable patch requests one full
LiveView reconnect snapshot; an unsupported version or repeated failure tears
down the root and raises instead of continuing with uncertain state. The
bridge does not keep a second server-state cache.

## Events and connection lifecycle

The browser bridge binds the public operations of the owning LiveView hook:
`pushEvent`, `pushEventTo`, `handleEvent`, `removeHandleEvent`, `upload`, and
`uploadTo`. Focused React hooks add cleanup, cancellation, stale-reply, and
reconnect policies without creating another socket.

The hook lifecycle maps directly to React runtime behavior:

- `mounted` validates the snapshot, resolves the registry entry, and creates
  or hydrates the root.
- `updated` validates identity and applies the latest props, streams, events,
  and slots.
- `disconnected` and `reconnected` update the per-root connection store.
- `destroyed` makes callbacks inert and unmounts the root exactly once.
  During a full LiveView navigation only, the runtime then retains a bounded
  static DOM snapshot until Phoenix replaces the outgoing main view. React
  effects, subscriptions, and pending lazy commits are already gone; ordinary
  conditional removal never waits for a navigation event.

## SSR and hydration

Disconnected SSR and browser hydration use the same component registry,
provider tree, ordinary props, stream props, slots, event metadata, and
ID-derived `identifierPrefix`. The immutable v2 hydration descriptor records
the exact dead-render frame. If the connected join brings a newer snapshot
while hydration is in progress, the runtime hydrates that dead frame first,
waits for the hydration commit, and only then renders the newest connected
state.

Development SSR is an HTTP request to the Vite plugin. Production SSR invokes
the built ESM renderer through `NodeJS`. An available renderer failure is an
error, not an implicit client-only fallback; absent SSR infrastructure uses the
documented client-only path. See [SSR](ssr.md).

The architecture intentionally keeps SSR buffered: the JavaScript renderer
returns one string and the BEAM adapter embeds that complete result in the
disconnected HEEx response. React streaming is deferred until a separate
Phoenix initial-response integration can own chunk delivery, backpressure,
abort propagation, phased errors, and hydration ordering end to end. It must
not overload the existing `render/1 -> binary()` boundary. The evidence and
migration boundary are recorded in
[Streaming SSR decision](ssr.md#streaming-ssr-decision).

## Deliberate non-goals

LiveViewReact does not provide cross-root Context, client-side routing, a
client data-fetching framework, streaming SSR in the current response model, a
generic framework adapter, or interactive Phoenix subtrees inside transported
slots. See [Limitations](limitations.md) and [Comparison](comparison.md) when
choosing an application architecture.
