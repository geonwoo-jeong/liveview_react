# Client hooks

LiveViewReact installs one bridge and one connection store inside every React
root. Hooks always address the LiveView that owns that root; they do not create
a socket or share state between roots.

## `useLiveViewReact`

`useLiveViewReact()` returns the public operations of the owning LiveView hook:

```ts
const {
  el,
  liveSocket,
  pushEvent,
  pushEventTo,
  handleEvent,
  removeHandleEvent,
  upload,
  uploadTo,
} = useLiveViewReact();
```

`pushEvent` and `pushEventTo` use the Promise APIs in Phoenix LiveView 1.2.
There is no callback overload. Calling `useLiveViewReact` outside a component
rendered inside a LiveViewReact root throws.

## `useLiveEvent`

Use `useLiveEvent` for events sent with `push_event/3`:

```tsx
useLiveEvent<{ message: string }>("notification", ({ message }) => {
  setMessages((current) => [...current, message]);
});
```

Each call creates an independent subscription. The hook calls the latest
handler without resubscribing on every render, removes the subscription on
unmount, and makes a retained delivery callback inert after cleanup. It is safe
under React StrictMode.

## `useEventReply`

`useEventReply` wraps a Promise `pushEvent` request with React state:

```tsx
const search = useEventReply<SearchReply, readonly Item[]>("search", {
  initialData: [],
  timeout: 5_000,
  reduce: (items, reply) => [...items, ...reply.items],
});

const reply = await search.execute({ query: "react" });
search.cancel();
```

The result contains `execute`, `cancel`, `data`, `error`, and `isLoading`.
Starting another request cancels the current request. Cancellation is logical:
it rejects the returned Promise and ignores a later reply; it cannot retract a
message already sent over the socket. Timeout and unmount use the same stale
reply protection. A reducer runs only for the latest successful reply.

Cancellation rejects with `LiveEventReplyCancelledError`; a configured timeout
rejects with `LiveEventReplyTimeoutError`. Both classes are exported from
`liveview_react`, so application code can distinguish expected lifecycle exits
without parsing messages:

```tsx
import { LiveEventReplyCancelledError } from "liveview_react";

try {
  await search.execute({ query: "react" });
} catch (error) {
  if (error instanceof LiveEventReplyCancelledError) return;
  throw error;
}
```

## `useLiveConnection`

```tsx
const { connected, reconnecting } = useLiveConnection();
```

The external-store snapshot follows the hook's `disconnected`, `reconnected`,
and `destroyed` lifecycle. Server rendering reports
`{ connected: false, reconnecting: false }`.

## `useLiveNavigation` and `Link`

```tsx
const { patch, navigate } = useLiveNavigation();

patch("/users?page=2");
navigate("/settings", { replace: true });
```

The commands delegate to the public `liveSocket.js()` API. The hook may render
during SSR or hydration. Render-time access before the live bridge exists still
throws, but the built-in hook uses the live client bridge for post-commit
browser events during hydration.

Prefer `Link` for anchors:

```tsx
<Link patch="/users?page=2">Next</Link>
<Link navigate="/settings" replace>Settings</Link>
<Link href="/logout">Sign out</Link>
```

Exactly one destination is required. Patch and navigate links emit Phoenix's
declarative link attributes, so LiveView retains ownership of click handling.
Native modified clicks, `target`, `download`, `rel`, and ordinary `onClick`
behavior are not reimplemented by the package.

All hooks in this guide are scoped to the owning root. Mounting the same
provider or hook in two `<.react>` elements creates two independent React
instances; it does not establish cross-root Context or state.
