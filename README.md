<p align="center">
  <img
    src="guides/images/liveview_react_logo.png"
    alt="LiveViewReact logo: a warm phoenix transitioning into React cyan"
    width="220"
  />
</p>

<p align="center">
  <strong>React 19 inside Phoenix LiveView, with LiveView still in charge.</strong>
</p>

<p align="center">
  <a href="https://hexdocs.pm/liveview_react">HexDocs</a> ·
  <a href="https://hex.pm/packages/liveview_react">Hex</a> ·
  <a href="https://github.com/geonwoo-jeong/liveview_react/blob/main/guides/getting_started.md">Getting started</a> ·
  <a href="https://github.com/geonwoo-jeong/liveview_react/blob/main/guides/comparison.md">Comparison</a> ·
  <a href="https://github.com/geonwoo-jeong/liveview_react/blob/main/guides/limitations.md">Limitations</a>
</p>

LiveViewReact mounts normal React roots inside Phoenix LiveView. LiveView
continues to own routing, authoritative server state, validation, reconnects,
and DOM replacement. React owns only the component tree you explicitly mount.
There is no second socket, hidden page-wide root, or SPA runtime.

If you are evaluating fit, read [Why](#why), [Runtime model](#runtime-model),
and [Boundaries](#boundaries) first.

## Features

- **Real React 19 roots** — one explicit, independently managed root per
  `<.react>` call
- **End-to-end LiveView reactivity** — server assigns update React props through
  immutable snapshots and copy-on-write patches without moving authoritative
  state into the browser
- **SSR and hydration** — the same component registry powers development SSR,
  production Node.js SSR, no-JavaScript HTML, and browser hydration
- **Efficient transport** — compact prop diffs and Phoenix Streams operations
  update existing roots while preserving local React state
- **LiveView interoperability** — events, Promise replies, navigation,
  connection state, forms, uploads, and direct `phx-*` attributes
- **Inert HTML slots** — the HEEx element body arrives as React `children`, and
  `<:slot name="...">` entries arrive as same-name props within the documented
  [non-interactive boundary](guides/slots.md)
- **Lifecycle safety** — conditional removal, slow live navigation, reconnects,
  lazy imports, and repeated destruction finalize exactly once
- **Type-safe Vite integration** — strict TypeScript, a virtual component
  registry, React Refresh, and matching browser and server entrypoints
- **One-command setup** — the Igniter installer configures PhoenixVite, React,
  TypeScript, SSR, and an optional working example

## Why

Pure LiveView is still the right default for most Phoenix screens. Use
LiveViewReact when one bounded part of the page needs React itself:

- a React-only component library
- substantial local interaction that would otherwise become imperative hooks
- Context, portals, Suspense, transitions, canvas, or WebGL
- a client-side widget that should remain inside a server-owned LiveView page

If React should own the whole page shell, routing, and remote data lifecycle,
use an SPA or Inertia-style architecture instead.

## Install

From the Phoenix application root:

```sh
mix igniter.install liveview_react
```

The installer wires PhoenixVite, React, TypeScript, the browser entrypoint, the
SSR entrypoint, and a component registry.

Useful variants:

- `mix igniter.install liveview_react --bun`
- `mix igniter.install liveview_react --no-demo`

In an umbrella, run the installer from the Phoenix child application, not the
umbrella root.

If `mix igniter.install` is unavailable, install the Igniter archive first with
`mix archive.install hex igniter_new`. Then run `mix assets.setup` and
`mix phx.server`; the generated demo is available at `/liveview-react`. See
[Installation](guides/installation.md) for the complete generated-file and
asset workflow.

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

Initialize the server state and handle the event in LiveView:

```elixir
def mount(_params, _session, socket) do
  {:ok, assign(socket, count: 0)}
end

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

LiveViewReact exports:

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

Call bridge commands from effects or event handlers, never during render. The
low-level commands returned by `useLiveViewReact()` intentionally throw during
SSR and the hydration render pass; the built-in hooks provide their documented
post-commit hydration behavior. See [Client hooks](guides/client_hooks.md).

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
- The HEEx element body and each `<:slot name="...">` entry are transported
  into React as inert HTML wrappers.
- Live navigation keeps cleanup exact and prevents late React mounts after a
  destroyed hook.

## Boundaries

These are intentional product constraints, not compatibility gaps:

- Each `<.react>` is a separate React root. Cross-root Context is impossible.
  If multiple widgets need one provider tree, they belong in one larger root.
- The outer LiveView element is transport-only. Public wrapper styling options
  are not part of the contract.
- Slot HTML uses a fail-closed passive-markup allowlist. Links, form controls,
  resource-bearing tags, event/style/URL attributes, `phx-*`, `phx-hook`,
  nested LiveViews, and nested LiveViewReact roots are rejected.
- A file input must still be rendered by Phoenix with
  `<.live_file_input>` outside the React-owned target. React cannot recreate
  Phoenix upload internals.
- SSR uses `renderToString`, not React streaming SSR.
- Production SSR requires a separately built server bundle, the optional
  `nodejs` dependency and supervisor, and Node.js in the release image. See
  [Deployment](guides/deployment.md).
- The 0.1.0 browser support contract is Chromium only. Firefox and WebKit are
  not claimed until equivalent browser lifecycle lanes run in CI.
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
- [Lazy loading](guides/lazy_loading.md)
- [Architecture](guides/architecture.md)
- [Comparison](guides/comparison.md)
- [Limitations](guides/limitations.md)
- [Testing](guides/testing.md)
- [Development](guides/development.md)
- [Deployment](guides/deployment.md)
- [Uninstallation](guides/uninstallation.md)
- [Releasing](guides/releasing.md)
- [Runnable Phoenix example](https://github.com/geonwoo-jeong/liveview_react/tree/main/liveview_react_examples)

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

Maintainer-grade verification adds `mix quality_full`, `npm run quality:ci`,
and the hosted release workflow. See
[Testing](guides/testing.md) and [Releasing](guides/releasing.md) before
cutting a Hex release.

## Credits

LiveViewReact began as a fork of
[LiveReact](https://github.com/mrdotb/live_react) by Baptiste Chaleil
(Mrdotb). It has since been substantially redesigned and reimplemented as an
independent project with its own package identity, public API, runtime, and
transport protocol. The original MIT copyright notice remains for inherited
portions of the codebase.

The project also draws significant inspiration from
[LiveVue](https://github.com/Valian/live_vue) and
[LiveSvelte](https://github.com/woutdp/live_svelte), particularly around
LiveView integration, SSR, streams, slots, and developer experience.

## License

Copyright (c) 2026 Geonwoo Jeong. Portions copyright (c) 2024 Mrdotb.
Released under the [MIT License](LICENSE.md).
