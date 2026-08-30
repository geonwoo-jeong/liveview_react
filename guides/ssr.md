# Server-side rendering

LiveViewReact renders the same component registry on the server and in the
browser. The BEAM adapter sends one mandatory flat transport-v2 frame:
`version`, `component`, `identifierPrefix`, `props`, `streams`, `events`, and
`slots`. `props`, `streams`, `events`, and `slots` are required even when they
are empty. The prefix comes from the required React root ID and is reused by
`renderToString`, `hydrateRoot`, and `createRoot`, so React 19 `useId()` values
remain stable.

## Installer-generated entries

`mix igniter.install liveview_react` creates
`assets/js/liveview_react_server.tsx` with the canonical server entry:

```tsx
import components from "virtual:liveview-react/components";
import { createLiveViewReactServer } from "liveview_react/server";
import type { ServerRenderRequest } from "liveview_react/server";

const server = createLiveViewReactServer({ components });

export function render(request: ServerRenderRequest): Promise<string> {
  return server.render(request);
}
```

The generated browser entry imports the same
`virtual:liveview-react/components` module. Do not maintain a separate
server-only registry: a component that resolves differently between SSR and
the browser cannot hydrate correctly.

The virtual registry eagerly discovers default-exported `.js`, `.jsx`, `.ts`,
and `.tsx` components below `assets/react-components`. See
[Installation](installation.md) for its naming and validation rules.

## Vite development SSR

The installer adds React and LiveViewReact to the existing PhoenixVite config.
The relevant fragment is:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import liveViewReactPlugin from "liveview_react/vite";

export default defineConfig({
  plugins: [
    // Preserve the existing PhoenixVite and Tailwind plugins.
    react(),
    liveViewReactPlugin({
      entrypoint: "./js/liveview_react_server.tsx",
    }),
  ],
});
```

The plugin factory is also a named export:

```ts
import { liveViewReactPlugin } from "liveview_react/vite";
```

Its complete option surface is:

| Option | Default | Contract |
| --- | --- | --- |
| `componentDirectory` | `./react-components` | Registry directory inside the Vite root; no symlink traversal |
| `entrypoint` | `./js/server.ts` | Module loaded by Vite development SSR; must export `render` |
| `maxBodyBytes` | `1_048_576` | Positive safe-integer request limit |
| `path` | `/ssr_render` | Absolute development endpoint without query or fragment |

The built-in `LiveViewReact.SSR.ViteJS` adapter posts to `/ssr_render`; keep the
default path when using that adapter. A custom endpoint requires a matching
custom BEAM SSR module.

The plugin serves the SSR endpoint through the running Vite development
server and resolves the virtual registry. The installer also adds this
development configuration:

```elixir
config :liveview_react,
  ssr: true,
  ssr_module: LiveViewReact.SSR.ViteJS,
  vite_host: "http://localhost:5173"
```

PhoenixVite starts Vite with the Phoenix endpoint. Requests require
`Content-Type: application/json` with at most one optional charset parameter
and are bounded by the configured size and BEAM timeouts. Invalid requests use
specific 4xx responses. Unexpected renderer failures are logged with detail by
Vite but return only a generic 500 body to the BEAM client.

The endpoint authenticates neither callers nor individual render requests. It
is a development transport between Phoenix and Vite, not a public SSR API.
Bind the Vite server to loopback or a trusted private development network and
do not expose this route to the Internet. The body limit and schema validation
bound input; they are not authentication or authorization controls.

A configured Vite renderer fails explicitly when Vite is unreachable, the
component is missing, or the renderer raises; it does not silently switch to
client rendering.

If the Igniter installer is not used, the application must create the browser
and server entry points, virtual-module declaration, Vite plugin entries, and
development configuration itself. That manual setup does not receive the
installer's source-aware merge or idempotency checks.

## Node.js production SSR

The installer creates `assets/vite.liveview-react.ssr.config.mjs` and the
`build:ssr` package script. The dedicated config bundles the server entry and
writes the canonical ESM output to:

```text
priv/liveview_react/server.mjs
```

Build it with npm from the assets directory:

```sh
cd assets
npm run build:ssr
```

For an installation created with `--bun`, run the configured Bun profile from
the Phoenix application root:

```sh
mix bun assets run build:ssr
```

The normal `mix assets.build` and `mix assets.deploy` aliases build the browser
bundle; they do not replace the separate SSR build.

Add the optional NodeJS dependency when production SSR is enabled:

```elixir
defp deps do
  [
    {:liveview_react, "~> 0.1.0"},
    {:nodejs, "~> 3.1"}
  ]
end
```

Start its supervisor from the application supervision tree:

```elixir
children = [
  {NodeJS.Supervisor,
   [path: LiveViewReact.SSR.NodeJS.server_path(:my_app), pool_size: 4]}
]
```

Pass the OTP application that owns the generated SSR bundle. `server_path/1`
resolves that application's `priv` directory without relying on the calling
process:

```elixir
LiveViewReact.SSR.NodeJS.server_path(:my_app)
```

NodeJS module paths are relative to that supervisor path, so configure the
renderer as follows even though the source-tree file is physically located at
`priv/liveview_react/server.mjs`:

```elixir
config :liveview_react,
  ssr: true,
  ssr_module: LiveViewReact.SSR.NodeJS,
  ssr_filepath: "./liveview_react/server.mjs"
```

The release image must contain a supported Node.js runtime. See
[Deployment](deployment.md) for npm and Bun build sequences.

## Rendering contract

In the `LiveViewReact.SSR` namespace, `NotConfigured` means SSR infrastructure
is absent and lets the root continue as client-only output. This includes no
configured module, missing optional NodeJS code, or an absent NodeJS
supervisor. `RenderError` means an available renderer failed; it is not
silently converted to client rendering. Missing components, invalid requests,
timeouts, and renderer exceptions use this failure path. Both exception types
are BEAM APIs; the browser root callbacks described in
[Component API](component_api.md) are separate React 19 client errors.

The production adapter calls the configured ESM bundle's `render` export once,
with the normalized request as its only argument, and asks NodeJS for one
binary result. `LiveViewReact.SSR.render/1` rejects a non-binary result. Vite
development SSR mirrors that request/reply shape over HTTP. Its BEAM timeouts
bound how long the caller waits; they do not constitute a cross-runtime React
abort contract.

The renderer returns one complete HTML string. React 19 resource hints emitted
with `preload` or `preloadModule` remain inside that string; LiveViewReact does
not split, move, or reinterpret them. Dead-render HTML and its immutable v2
descriptor stay inside the React-owned target until the browser hydrates the
exact same component, provider, ordinary props, materialized stream props,
slots, event commands, and identifier prefix. If the connected join already
contains newer state, the runtime queues it and applies it only after the exact
dead-render tree commits hydration.

On successful SSR, the full dead stream snapshot is serialized once in the
hydration descriptor. The outer stream lane is marked as hydration-owned and
carries no second copy. When SSR infrastructure is absent or SSR is disabled,
there is no descriptor and the outer lane carries the authoritative connected
stream snapshot used by the client-only root. A configured renderer failure is
still fatal and never switches silently to that client-only path.

The current renderer deliberately uses
[`renderToString`](https://react.dev/reference/react-dom/server/renderToString).
A component that suspends during SSR renders its nearest Suspense fallback.
React does not wait for the suspended content, and LiveViewReact does not claim
or emulate streaming.

## Streaming SSR decision

**Status: explicitly deferred.** Buffered component SSR remains the production
contract. This is an architectural decision, not a missing call to a newer
React function.

React's streaming APIs target an HTTP response owner. On Node.js,
[`renderToPipeableStream`](https://react.dev/reference/react-dom/server/renderToPipeableStream)
returns `pipe` and `abort`; the Web Streams equivalent,
[`renderToReadableStream`](https://react.dev/reference/react-dom/server/renderToReadableStream),
accepts an abort signal and exposes `allReady`. They can emit a Suspense shell,
later content, and inline replacement scripts progressively. They also divide
failures into shell failures and recoverable errors after the shell, and an
HTTP status can no longer change after streaming starts.

That response model does not fit the current boundary:

| Concern | Buffered contract today | Requirement for real streaming |
| --- | --- | --- |
| Output | JavaScript returns `Promise<string>`; `LiveViewReact.SSR` accepts only a `binary()` | A cancellable stream handle and explicit shell, chunk, completion, and error phases |
| Suspense | The closest fallback is included in the final string | Progressive fallback replacement, including React's inline scripts |
| Backpressure | Vite and NodeJS collect one result before HEEx embeds it | React's source must remain connected to the final HTTP sink; Node stream piping manages flow only across that live connection |
| Abort and timeout | Vite bounds the BEAM HTTP wait; the renderer contract has no abort handle | Client disconnect and render timeout must abort React, close the transport, and release the Node worker |
| Errors | A renderer either returns the complete string or raises `RenderError` | Pre-shell failure may choose status or fallback; post-shell failure cannot replace the response and needs separate telemetry and client recovery |
| Hydration | The complete target and immutable descriptor exist before `hydrateRoot` | The descriptor, `identifierPrefix`, bootstrap ordering, CSP nonce policy, LiveView join, and late chunks need one race-free state machine |
| Deployment | One ESM `render` export crosses Vite HTTP or a NodeJS request/reply call | Development and production need the same long-lived stream protocol, bounded buffering, cancellation, and cleanup |

[Phoenix LiveView's lifecycle](https://hexdocs.pm/phoenix_live_view/Phoenix.LiveView.html#module-life-cycle)
starts with a regular HTTP render and then establishes the stateful connection.
`<.react>` contributes a nested target while that HEEx response is assembled;
it does not own the `Plug.Conn`. Plug can
[`send_chunked/2`](https://hexdocs.pm/plug/Plug.Conn.html#send_chunked/2) and
then send chunks, but that must happen at the response owner. Collecting a
React stream back into a string would preserve the current boundary but would
not provide progressive delivery or end-to-end backpressure.

[`prerenderToNodeStream`](https://react.dev/reference/react-dom/static/prerenderToNodeStream)
is a possible future experiment when the requirement is to wait for Suspense
data rather than reveal it progressively. React classifies it as static
generation: it waits for data before resolving, supports abort, and can be
collected into a string. It is not a drop-in streaming upgrade and is not the
default for LiveView-owned component snapshots.

### Migration boundary

Any future streaming implementation must be a separate response mode, not a
union return added to `render/1`:

1. Preserve the validated v2 request frame and shared component-tree builder,
   including `version`, `component`, `identifierPrefix`, `props`, `streams`,
   `events`, and `slots`.
2. Keep the current `render/1 -> binary()` adapter for nested component SSR.
   Put streaming behind a dedicated Phoenix initial-response integration that
   owns the `Plug.Conn` and can propagate backpressure.
3. Define `before_shell`, `streaming`, `complete`, and `aborted` phases. Only a
   pre-shell failure may become `RenderError` with a replacement response;
   later errors require telemetry and React's documented client recovery.
4. Propagate request timeout, browser disconnect, navigation, and target
   destruction to React's abort mechanism and release the Vite or Node worker
   exactly once.
5. Make the hydration descriptor and CSP/bootstrap policy available before the
   first byte. Do not apply connected updates or replace the target until the
   stream and hydration state machine declares that operation safe.
6. Require equivalent development and production protocols and verify slow
   consumers, abort cleanup, pre- and post-shell errors, CSP, hydration, join,
   navigation, and destroy races before enabling the mode.
