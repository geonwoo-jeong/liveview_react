# Installation

LiveViewReact is distributed as the `liveview_react` Hex and npm packages. Its
Igniter installer configures a Phoenix application, PhoenixVite, React,
TypeScript, development SSR, and a file-based component registry together.
The BEAM transport and browser runtime share a protocol, so keep the Hex and
npm packages on the same LiveViewReact release line.

Use the installer from a clean branch so its PhoenixVite asset-stack changes
are easy to review.

## Requirements

- Elixir 1.20 or later
- Phoenix 1.8 or later with Phoenix LiveView
- React and ReactDOM 19
- Node.js 24 or later for the default npm setup, or the `--bun` setup described
  below

The `mix igniter.install` task must be available. If it is not already provided
by the project or your development environment, install the Igniter archive
once:

```sh
mix archive.install hex igniter_new
```

## Install in a Phoenix application

Run this command at the root of the Phoenix application:

```sh
mix igniter.install liveview_react
```

The default setup uses local Node.js and npm. To have PhoenixVite use its Bun
runner instead, pass the public PhoenixVite option through the same command:

```sh
mix igniter.install liveview_react --bun
```

The installer creates a small LiveView and React component at
`/liveview-react`. Omit that demo when installing into an application that does
not need it:

```sh
mix igniter.install liveview_react --no-demo
```

In an umbrella, do not run the installer from the umbrella root. Change into
the Phoenix child application's directory and run the same command there. This
keeps endpoint, router, web-module, asset, and dependency changes scoped to one
application; root-level umbrella installation is rejected.

## What the installer changes

The installer composes the public PhoenixVite installer. On a fresh Phoenix
application, PhoenixVite replaces the generated esbuild and Tailwind Mix tasks
with its Vite asset pipeline. Review that conversion together with the
LiveViewReact changes before accepting it.

LiveViewReact then creates or completes these integration files:

- `assets/tsconfig.json`
- `assets/js/liveview_react.ts`
- `assets/js/liveview_react_server.tsx`
- `assets/js/liveview-react.d.ts`
- `assets/vite.liveview-react.ssr.config.mjs`
- `assets/react-components/LiveViewReactDemo.tsx`, unless `--no-demo` is used
- a `LiveViewReactDemoLive` module and `/liveview-react` route, unless
  `--no-demo` is used

It also makes scoped changes to:

- `assets/package.json`, preserving unrelated dependencies, scripts, and
  fields
- `assets/js/app.js`, importing the generated bridge and merging
  `liveViewReact.hooks` into the existing `LiveSocket` hooks
- `assets/vite.config.mjs`, enabling the React and LiveViewReact plugins and
  selecting the generated SSR entry point
- `config/dev.exs`, enabling `LiveViewReact.SSR.ViteJS` at the local Vite host
- the selected web module's `html_helpers/0`, importing `LiveViewReact`
- the selected router's browser scope when the demo is enabled

Owned source templates are created only when absent or already equivalent to
the expected template. The installer structurally merges compatible
`package.json` and TypeScript settings, while source-aware edits preserve
unrelated code. An ambiguous endpoint, router, hook configuration, dependency,
script, route, or conflicting generated file is reported as an Igniter issue
instead of being overwritten.

Running the same install command again with the same options is idempotent. If
you intentionally customize an installer-owned file, keep that customization
and resolve any later installer issue explicitly rather than expecting a
template refresh to replace it.

## Run the generated demo

Use the normal Phoenix asset setup and server commands:

```sh
mix assets.setup
mix phx.server
```

Open `/liveview-react`. The PhoenixVite watcher serves the browser bundle and
the Vite development renderer used by `LiveViewReact.SSR.ViteJS`.

The generated asset package also provides TypeScript checking and an SSR build
script. Use PhoenixVite's normal Mix alias for the browser bundle, then run the
additional scripts from `assets`:

```sh
mix assets.build
cd assets
npm run typecheck
npm run build:ssr
```

For a Bun installation, keep `mix assets.build` for the browser bundle and run
the additional scripts through the configured Bun profile from the Phoenix
application root:

```sh
mix bun assets run typecheck
mix bun assets run build:ssr
```

## Add React components

The LiveViewReact Vite plugin exposes the virtual module
`virtual:liveview-react/components`. The generated browser and server entry
points import the same registry from that module, so SSR and hydration resolve
the same component names.

By default, the plugin scans `assets/react-components` recursively and imports
each discovered component eagerly. Every `.js`, `.jsx`, `.ts`, or `.tsx` file
must have a default export. Its component name is the extensionless
POSIX-style path relative to that directory:

```text
assets/react-components/Counter.tsx          -> Counter
assets/react-components/Admin/UserCard.tsx   -> Admin/UserCard
```

Render the second component with a stable root ID and the current LiveView
socket:

```heex
<.react
  id="admin-user-card"
  component="Admin/UserCard"
  socket={@socket}
  user={@user}
/>
```

Declaration files, test/spec files, dot-prefixed paths, and symlinks are not
registered. Duplicate extensionless names, unsafe path segments, and a
component directory outside the Vite root fail explicitly. Adding or removing
a component invalidates the virtual registry and triggers a full browser
reload; normal component edits use Vite's React refresh path.

To use another directory inside the Vite root, set `componentDirectory` on the
plugin:

```ts
import liveViewReactPlugin from "liveview_react/vite";

liveViewReactPlugin({ componentDirectory: "./ui/react" });
```

## TypeScript and Tailwind

The installer generates a strict TypeScript configuration and the declaration
for the virtual component module. Keep component props immutable and add
application-specific compiler options by extending the generated configuration
instead of weakening its checks.

PhoenixVite integrates Phoenix's generated Tailwind CSS with Tailwind v4 and
`@tailwindcss/vite`. The default component directory is under `assets`, so the
generated setup does not need the old `tailwind.config.js` content-glob edits.
If an existing application has a custom Tailwind source policy, make sure its
React component directory is included without removing the Phoenix HEEx source
directives.

## Production SSR

The installer configures Vite SSR for development and creates the dedicated
Vite config that builds `priv/liveview_react/server.mjs` for production. A
production release still needs a Node.js runtime, the optional `:nodejs` Hex
dependency, a `NodeJS.Supervisor`, and the matching
`LiveViewReact.SSR.NodeJS` configuration. See [Server-side rendering](ssr.md)
and [Deployment](deployment.md).

To remove this integration while preserving unrelated PhoenixVite
configuration, follow
[Uninstallation](uninstallation.md).
