# LiveViewReact

LiveViewReact embeds independent React 19 roots inside Phoenix LiveView while
keeping LiveView in charge of server state, navigation, connection state, and
event delivery.

Each `<.react>` call owns one React root. Phoenix owns the outer hook element
and its transport metadata; React owns only its mount target. The package does
not create a hidden shared root, a second socket, a global event bus, or
cross-root Context.

## When to use it

Use pure LiveView when server-rendered HTML and LiveView hooks are enough. Use
LiveViewReact when one part of a LiveView needs a normal React component tree,
React-specific libraries, or substantial client-local interaction. Use a SPA
or Inertia-style architecture when the browser should own routing and remote
data fetching for the whole application.

## Installation

Add the Hex package:

```elixir
defp deps do
  [
    {:liveview_react, "~> 0.1.0"}
  ]
end
```

Install the matching npm package in your Phoenix assets directory:

```sh
npm install liveview_react@0.1.0 react@19 react-dom@19
```

Register React components and merge the generated hook into the existing
`LiveSocket` configuration:

```tsx
import { createLiveViewReact } from "liveview_react";
import Counter from "./Counter";

const liveViewReact = createLiveViewReact({
  components: {
    Counter: { component: Counter },
  },
});

const liveSocket = new LiveSocket("/live", Socket, {
  hooks: {
    ...liveViewReact.hooks,
  },
  params: { _csrf_token: csrfToken },
});
```

Render the component from a LiveView with an explicit, stable ID:

```heex
<.react
  id="account-counter"
  component="Counter"
  socket={@socket}
  count={@count}
/>
```

`id` and `component` are required non-empty strings, and `socket` must be the
current `Phoenix.LiveView.Socket`. Every other assign—including `class`—is a
React prop unless it is a reserved rendering attribute. The outer DOM element
is transport-only and has no public styling attributes.

Inside the React tree, `useLiveReact()` exposes the existing LiveView hook
bridge:

```tsx
import { useLiveReact } from "liveview_react";

export default function Counter({ count }: { count: number }) {
  const { pushEvent } = useLiveReact();

  async function increment() {
    try {
      await pushEvent("increment", { by: 1 });
    } catch (error) {
      console.error("Could not increment the counter", error);
    }
  }

  return (
    <button type="button" onClick={increment}>
      Count: {count}
    </button>
  );
}
```

`pushEvent` and `pushEventTo` expose the Promise APIs from the current
LiveView hook. There is no callback overload.

## Events and navigation

Use `useLiveEvent` for server-pushed events. It keeps the latest handler and
automatically removes the LiveView subscription when the component unmounts:

```tsx
import { useLiveEvent } from "liveview_react";

useLiveEvent<{ message: string }>("notification", ({ message }) => {
  console.info(message);
});
```

`useEventReply` adds loading, result, error, cancellation, timeout, and stale
reply handling around `pushEvent`:

```tsx
const search = useEventReply<{ items: readonly Item[] }>("search", {
  timeout: 5_000,
});

await search.execute({ query });
```

`useLiveConnection()` reports `{ connected, reconnecting }` through a React
external store. `useLiveNavigation()` exposes the current public
`liveSocket.js().patch()` and `.navigate()` commands. The hook can render
during SSR and hydration; invoking a command before the live bridge exists
throws a clear error.

For anchors, prefer the declarative `Link` component:

```tsx
import { Link } from "liveview_react";

<Link patch="/users?page=2">Next</Link>
<Link navigate="/settings" replace>Settings</Link>
<Link href="/logout">Logout</Link>
```

`Link` emits LiveView's `data-phx-link` attributes and leaves click handling to
LiveView's normal document delegation. Native modified-click, `target`,
`download`, external-link, and consumer `onClick` behavior therefore remains
on the anchor. The package also ships React JSX types for direct `phx-*`
attributes such as `<button phx-click="increment">`.

## Streams and slots

Pass `@streams.name` directly as a prop. React receives an immutable array and
each item includes Phoenix's computed `__dom_id`, which should be used as its
React key. Insert, in-place update, `update_only`, delete, reset, custom DOM ID,
positive/negative limit, and multiple independent streams follow Phoenix
semantics.

Default HEEx content is transported as React `children`, and named HEEx slots
are transported as same-name React props:

```heex
<.react id="dialog" component="Dialog" socket={@socket}>
  <:header><strong>Header</strong></:header>
  Body
</.react>
```

Slots are rendered as inert HTML wrappers inside the React tree. LiveViewReact
does not support Phoenix-managed interactive subtrees inside slot HTML.
Nested forms, `phx-*` bindings, `phx-hook`, and nested React roots are
rejected during render instead of failing later in the browser.

## Server-side rendering

The package supports Vite development SSR and Node.js production SSR through
the same component registry. A server entry point exports an object-shaped
renderer:

```tsx
import components from "./components";
import { createLiveViewReactServer } from "liveview_react/server";

export const { render } = createLiveViewReactServer({ components });
```

See [installation](guides/installation.md),
[client hooks](guides/client_hooks.md), [events](guides/events.md),
[streams](guides/streams.md), [slots](guides/slots.md),
[SSR](guides/ssr.md), and [deployment](guides/deployment.md) for the full
setup.

## Requirements

- Elixir 1.20+
- Phoenix 1.8+
- Phoenix LiveView ~> 1.2.11
- React and ReactDOM 19.x
- Node.js 24 LTS or 26 current for package development

## Project lineage

This is a clean-break project derived from an earlier Phoenix/React bridge; it
does not provide legacy package names, Elixir namespaces, configuration keys,
hook names, or JavaScript aliases. See [UPSTREAM.md](UPSTREAM.md) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for provenance and license
details.

## License

[MIT](LICENSE.md)
