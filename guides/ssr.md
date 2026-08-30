# Server-side rendering

LiveViewReact renders the same component registry on the server and in the
browser. The BEAM adapter sends one request containing `component`, `events`,
`identifierPrefix`, `props`, and `slots`. The prefix comes from the required
React root ID and is reused by `renderToString`, `hydrateRoot`, and
`createRoot`, so React 19 `useId()` values remain stable.

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

The renderer returns one HTML string. React 19 resource hints emitted with
`preload` or `preloadModule` remain inside that string; LiveViewReact does not
split, move, or reinterpret them. Dead-render HTML and its immutable hydration
descriptor stay inside the React-owned target until the connected join
hydrates the exact same component, provider, props, slots, event commands, and
identifier prefix. Connected props are applied only after hydration commits.

The current renderer uses `renderToString`. A component that suspends during
SSR renders its nearest Suspense fallback; streaming SSR is not claimed or
emulated.
