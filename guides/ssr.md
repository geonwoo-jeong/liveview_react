# Server-side rendering

LiveViewReact uses the same tagged component registry on the browser and the
server. The BEAM adapter sends one render request object containing
`component`, `props`, and `slots`.

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
component falls back to client rendering. Hydration and `useId` requirements
are covered in the component and architecture guides.
