# liveview_react

`liveview_react` is a clean-break React bridge for Phoenix LiveView.

It mounts normal React 19 roots inside LiveView without adding a second socket,
without turning the page into a SPA, and without hiding ownership boundaries.
LiveView stays in charge of routing, server state, validation, reconnects, and
DOM replacement. React owns only the subtree you mount.

## Why

Pure LiveView is still the right default for most Phoenix screens. Use
`liveview_react` when one bounded part of the page needs React itself:

- a React-only component library
- local interactive state that is awkward in imperative hooks
- portals, Suspense, transitions, canvas, or WebGL
- a client-side widget that should still live inside a LiveView page

If React should own the whole page shell, routing, and remote data lifecycle,
use an SPA or Inertia-style architecture instead.

## Features

- One explicit React root per `<.react>` call
- React 19 client rendering and SSR support
- Stable LiveView event bridge with Promise-based replies
- Phoenix stream support with immutable React props
- Named and default HEEx slots transported into React
- Navigation-safe lifecycle cleanup for LiveView replacement
- First-party hooks for events, navigation, forms, uploads, and connection
- File-based component registry for PhoenixVite and Vite SSR

## Install

From the Phoenix application root:

```sh
mix igniter.install liveview_react
```

The installer wires the matching Hex package, npm package, PhoenixVite, React,
TypeScript, the browser entrypoint, the SSR entrypoint, and a component
registry.

Useful variants:

- `mix igniter.install liveview_react --bun`
- `mix igniter.install liveview_react --no-demo`

In an umbrella, run the installer from the Phoenix child application, not the
umbrella root.

## First component

Create `assets/react-components/Counter.tsx`:

```tsx
import { useState } from "react";
import { useLiveViewReact } from "liveview_react";

type CounterProps = {
  readonly count: number;
};

export default function Counter({ count }: CounterProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { pushEvent } = useLiveViewReact();

  async function increment() {
    setErrorMessage(null);

    try {
      await pushEvent("increment", { by: 1 });
    } catch {
      setErrorMessage("The server could not process the increment");
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

Render it from LiveView:

```heex
<.react
  id="account-counter"
  component="Counter"
  socket={@socket}
  count={@count}
/>
```

Handle the event in LiveView:

```elixir
def handle_event("increment", %{"by" => by}, socket)
    when is_integer(by) and by in 1..10 do
  socket = update(socket, :count, &(&1 + by))
  {:reply, %{count: socket.assigns.count}, socket}
end

def handle_event("increment", _params, socket) do
  {:reply, %{error: "increment must be an integer from 1 through 10"}, socket}
end
```

The default registry names components by their extensionless path under
`assets/react-components`, so `assets/react-components/Counter.tsx` becomes
`"Counter"`.

## Runtime model

What LiveView owns:

- authoritative application state
- routing and live navigation
- validation and persistence
- reconnect and replacement lifecycle
- uploads and server events

What React owns:

- local UI state inside one mounted root
- Context inside that root
- controlled inputs, animations, and third-party widgets
- portals created by that root

A normal prop update rerenders the existing root and preserves local React
state. Removing the `<.react>` element, changing its `id`, or changing its
`component` is a deliberate remount boundary.

## Client API

`liveview_react` exports:

- `createLiveViewReact`
- `createLiveViewReactServer`
- `useLiveViewReact`
- `useLiveEvent`
- `useEventReply`
- `useLiveConnection`
- `useLiveNavigation`
- `useLiveForm`
- `useLiveUpload`
- `Link`

Minimal client entrypoint:

```tsx
import { Socket } from "phoenix";
import { LiveSocket } from "phoenix_live_view";
import components from "virtual:liveview-react/components";
import { createLiveViewReact } from "liveview_react";

const liveViewReact = createLiveViewReact({ components });

const liveSocket = new LiveSocket("/live", Socket, {
  hooks: {
    ...liveViewReact.hooks,
  },
  params: { _csrf_token: csrfToken },
});
```

Minimal SSR entrypoint:

```tsx
import components from "virtual:liveview-react/components";
import { createLiveViewReactServer } from "liveview_react/server";

export const { render } = createLiveViewReactServer({ components });
```

## Streams, slots, and navigation

- Phoenix `stream/3` data can be passed directly as a prop; React receives the
  materialized immutable array, including `__dom_id`.
- Default and named HEEx slots are transported into React as inert HTML
  wrappers.
- Live navigation keeps cleanup exact and prevents late React mounts after a
  destroyed hook.

## Boundaries

These are intentional product constraints, not compatibility gaps:

- Each `<.react>` is a separate React root. Cross-root Context is impossible.
  If multiple widgets need one provider tree, they belong in one larger root.
- The outer LiveView element is transport-only. Public wrapper styling options
  are not part of the contract.
- Slot HTML is not a nested Phoenix runtime. `phx-*`, nested forms,
  `phx-hook`, nested LiveViews, and nested `liveview_react` roots inside slot
  content are rejected.
- A file input must still be rendered by Phoenix with
  `<.live_file_input>` outside the React-owned target. React cannot recreate
  Phoenix upload internals.
- SSR uses `renderToString`, not React streaming SSR.
- This library is not a page-wide SPA router and does not make React the owner
  of remote data fetching.

## Requirements

- Elixir 1.20+
- OTP 27+
- Phoenix 1.8+
- Phoenix LiveView 1.2.11+
- React and ReactDOM 19.x
- TypeScript 7.x for the generated TypeScript setup
- Vite 8.x for the generated asset integration
- Node.js 24+ for the default asset and SSR setup

## Guides

- [Getting started](guides/getting_started.md)
- [Installation](guides/installation.md)
- [Component API](guides/component_api.md)
- [Client hooks](guides/client_hooks.md)
- [Events](guides/events.md)
- [Forms](guides/forms.md)
- [Uploads](guides/uploads.md)
- [Streams](guides/streams.md)
- [Slots](guides/slots.md)
- [SSR](guides/ssr.md)
- [Architecture](guides/architecture.md)
- [Comparison](guides/comparison.md)
- [Limitations](guides/limitations.md)
- [Testing](guides/testing.md)
- [Development](guides/development.md)
- [Deployment](guides/deployment.md)
- [Migration from LiveReact](guides/migration_from_live_react.md)
- [Uninstallation](guides/uninstallation.md)

## Development

Project checks:

```sh
mix quality
npm run quality
npm run test:e2e
```

This repository includes a Phoenix example application under
`liveview_react_examples` for SSR, lifecycle, stream, slot, and navigation
verification.

## Credits

- [Phoenix LiveView](https://github.com/phoenixframework/phoenix_live_view) for
  the server-owned UI model, lifecycle semantics, streams, and event runtime
- [LiveVue](https://github.com/Valian/live_vue) for a modern LiveView frontend
  bridge reference, especially installer and documentation shape
- [LiveSvelte](https://github.com/woutdp/live_svelte) for prior art around
  client-side state inside LiveView, streams, and forms
- [Phoenix](https://github.com/phoenixframework/phoenix),
  [Ecto](https://github.com/elixir-ecto/ecto),
  [Oban](https://github.com/oban-bg/oban), and
  [Ash](https://github.com/ash-project/ash) for the documentation style
  baseline common in well-maintained Elixir libraries
- Historical reference only:
  [live_react](https://github.com/mrdotb/live_react)

## License

[MIT](LICENSE.md)
