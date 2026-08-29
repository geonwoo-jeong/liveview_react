# Server-side rendering

LiveViewReact uses the same tagged component registry on the browser and the
server. The BEAM adapter sends one render request object containing
`component`, `identifierPrefix`, `props`, and `slots`. The prefix is derived
from the required React root ID and is reused by `renderToString`,
`hydrateRoot`, and `createRoot`, so React 19 `useId()` values remain stable.

Create a server entry point:

```tsx
import components from "../components";
import { createLiveViewReactServer } from "liveview_react/server";

export const { render } = createLiveViewReactServer({ components });
```

## Vite development SSR

Add the canonical Vite subpath to the plugin list:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import liveViewReact from "liveview_react/vite";

export default defineConfig({
  plugins: [react(), liveViewReact()],
});
```

Configure the BEAM adapter:

```elixir
config :liveview_react,
  ssr_module: LiveViewReact.SSR.ViteJS,
  vite_host: "http://localhost:5173"
```

## Node.js production SSR

Build the server entry as ESM to
`priv/liveview_react/server.mjs`, add the optional `:nodejs` dependency, and
start its supervisor:

```elixir
children = [
  {NodeJS.Supervisor,
   [path: LiveViewReact.SSR.NodeJS.server_path(), pool_size: 4]}
]
```

```elixir
config :liveview_react,
  ssr_module: LiveViewReact.SSR.NodeJS,
  ssr_filepath: "./priv/liveview_react/server.mjs"
```

SSR failures are explicit renderer errors. If no renderer is configured, the
component falls back to client rendering. A configured renderer never silently
falls back: missing components and renderer failures are raised with their
original context.

The renderer contract returns one HTML string. React 19 resource hints emitted
with `preload` or `preloadModule` remain inside that string; LiveViewReact does
not split, move, or reinterpret them. The dead-render HTML and its immutable
hydration descriptor stay inside the React-owned target until the connected
join hydrates the exact same component, provider, props, slots, and identifier
prefix. Connected props are applied only after the hydration commit.

The current renderer uses `renderToString`. A component that suspends during
SSR therefore renders its nearest Suspense fallback; streaming SSR is not
claimed or emulated.
