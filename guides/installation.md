# Installation

LiveViewReact is distributed as matching Hex and npm packages. Keep their
versions synchronized in every application.

## 1. Add the Hex dependency

```elixir
defp deps do
  [
    {:liveview_react, "~> 0.1.0"}
  ]
end
```

Run `mix deps.get`.

## 2. Add the browser packages

From the Phoenix assets directory:

```sh
npm install liveview_react@0.1.0 react@19 react-dom@19
```

## 3. Create a component registry

Registry entries are tagged so a zero-argument React component cannot be
mistaken for a lazy loader:

```tsx
import Counter from "./Counter";

export default {
  Counter: { component: Counter },
  Editor: { load: () => import("./Editor") },
} as const;
```

## 4. Register the LiveView hook

```tsx
import { Socket } from "phoenix";
import { LiveSocket } from "phoenix_live_view";
import { createLiveViewReact } from "liveview_react";
import components from "./components";

const csrfToken = document
  .querySelector<HTMLMetaElement>("meta[name='csrf-token']")
  ?.getAttribute("content");

const liveViewReact = createLiveViewReact({ components });

const liveSocket = new LiveSocket("/live", Socket, {
  hooks: { ...liveViewReact.hooks },
  params: { _csrf_token: csrfToken },
});

liveSocket.connect();
```

The canonical hook key is `LiveViewReactHook`. Do not rename it when combining
hook maps.

## 5. Render a root

Import the function component in your web component module:

```elixir
import LiveViewReact
```

Then render a registered component from a LiveView:

```heex
<.react
  id="profile-editor"
  component="Editor"
  socket={@socket}
  user={@user}
/>
```

Every root requires its own stable `id`. `component` must exactly match a
registry key. LiveView owns the outer wrapper; React owns only the inner mount
target.

## Optional SSR configuration

Development with Vite:

```elixir
config :liveview_react,
  ssr: true,
  ssr_module: LiveViewReact.SSR.ViteJS,
  vite_host: "http://localhost:5173"
```

Production with Node.js:

```elixir
config :liveview_react,
  ssr: true,
  ssr_module: LiveViewReact.SSR.NodeJS,
  ssr_filepath: "./priv/liveview_react/server.mjs"
```

See [SSR](ssr.md) for server entry points and runtime setup.
