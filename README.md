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

## State ownership

Keep persisted data, authorization decisions, navigation, validation results,
and other authoritative state in LiveView. Pass it into React as props. Keep
drafts, focus, open/closed UI, animation, and third-party widget state local to
the React root.

A server prop update rerenders the existing root and preserves local React
state. Removing the `<.react>` element or replacing its stable `id` or
`component` is a remount boundary. If two widgets need one client-side Context
or state owner, render them under one `<.react>` tree; separate roots do not
share Context automatically.

## Installation

Install the Hex package, matching npm package, PhoenixVite integration,
TypeScript entry points, virtual component registry, and generated demo in one
step:

```sh
mix igniter.install liveview_react
```

Use `--bun` for the PhoenixVite Bun runner or `--no-demo` to omit the generated
`/liveview-react` example. In an umbrella, run the command from the Phoenix
child application, not the umbrella root.

Default-exported files under `assets/react-components` are registered by their
extensionless relative paths through
`virtual:liveview-react/components`. The generated browser entry creates and
merges the hook automatically. A custom entry point uses the same contract:

```tsx
import components from "virtual:liveview-react/components";
import { createLiveViewReact } from "liveview_react";

const liveViewReact = createLiveViewReact({
  components,
});

const liveSocket = new LiveSocket("/live", Socket, {
  hooks: {
    ...liveViewReact.hooks,
  },
  params: { _csrf_token: csrfToken },
});
```

The installer is idempotent and fails closed instead of overwriting ambiguous
custom code. See [installation](guides/installation.md) for its complete file
contract.

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

Inside the React tree, `useLiveViewReact()` exposes the existing LiveView hook
bridge:

```tsx
import { useState } from "react";
import { useLiveViewReact } from "liveview_react";

export default function Counter({ count }: { count: number }) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { pushEvent } = useLiveViewReact();

  async function increment() {
    setErrorMessage(null);
    try {
      await pushEvent("increment", { by: 1 });
    } catch {
      setErrorMessage("Could not increment the counter");
    }
  }

  return (
    <>
      <button type="button" onClick={() => void increment()}>
        Count: {count}
      </button>
      {errorMessage && <p role="alert">{errorMessage}</p>}
    </>
  );
}
```

`pushEvent` and `pushEventTo` expose the Promise APIs from the current
LiveView hook. There is no callback overload.

## Events and navigation

Use `useLiveEvent` for server-pushed events. It keeps the latest handler and
automatically removes the LiveView subscription when the component unmounts:

```tsx
import { useState } from "react";
import { useLiveEvent } from "liveview_react";

type Notification = {
  readonly id: string;
  readonly message: string;
};

function Notifications() {
  const [notifications, setNotifications] = useState<readonly Notification[]>(
    [],
  );

  useLiveEvent<Notification>("notification", (notification) => {
    setNotifications((current) => [...current, notification]);
  });

  return notifications.map(({ id, message }) => <p key={id}>{message}</p>);
}
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
during SSR and hydration. Render-time bridge access still throws until the live
bridge exists, while the built-in hooks use the live client bridge for
post-commit browser events during hydration.

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

Pass `@streams.name` directly as a prop. React receives that required immutable
array during disconnected SSR, in no-JavaScript HTML, during hydration, and on
connected updates and reconnects. An empty stream is still present as `[]`.
Each item includes Phoenix's computed `__dom_id`, which should be used as its
React key. The exact dead-render snapshot hydrates first; a newer connected
snapshot is applied only after the hydration commit. Insert, in-place update,
`update_only`, delete, reset, custom DOM ID, positive/negative limit, and
multiple independent streams follow Phoenix's mode-specific semantics.

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
import components from "virtual:liveview-react/components";
import { createLiveViewReactServer } from "liveview_react/server";

export const { render } = createLiveViewReactServer({ components });
```

The renderer accepts only the mandatory flat transport-v2 frame. Its
`streams` field contains the same dead-render snapshot embedded in the
hydration descriptor, so SSR HTML, no-JavaScript output, and the first
`hydrateRoot` tree receive identical stream props.

## Guides

- Start with [Getting started](guides/getting_started.md),
  [Installation](guides/installation.md), and
  [Component API](guides/component_api.md).
- Understand the runtime in [Architecture](guides/architecture.md),
  [Lazy loading](guides/lazy_loading.md),
  [Comparison](guides/comparison.md), and
  [Limitations](guides/limitations.md).
- Build features with [Client hooks](guides/client_hooks.md),
  [Events](guides/events.md), [Forms](guides/forms.md),
  [Uploads](guides/uploads.md), [Streams](guides/streams.md), and
  [Slots](guides/slots.md).
- Operate the integration with [SSR](guides/ssr.md),
  [Testing](guides/testing.md), [Development](guides/development.md),
  [Deployment](guides/deployment.md), and [Releasing](guides/releasing.md).
- Use [Migration from LiveReact](guides/migration_from_live_react.md) for the
  clean break or [Uninstallation](guides/uninstallation.md) to remove the
  integration.

## Requirements

- Elixir 1.20+ on OTP 27+
- Phoenix 1.8+
- Phoenix LiveView 1.2.11+
- React and ReactDOM 19.x
- TypeScript 7 for the generated TypeScript setup
- Vite 8 for the generated asset integration
- Node.js 24+ for assets and package development

## Project lineage

This is a clean-break project derived from an earlier Phoenix/React bridge; it
does not provide legacy package names, Elixir namespaces, configuration keys,
hook names, or JavaScript aliases. See [UPSTREAM.md](UPSTREAM.md) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for provenance and license
details.

## License

[MIT](LICENSE.md)
