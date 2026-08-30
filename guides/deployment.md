# Deployment

LiveViewReact has two independent production assets:

- the PhoenixVite browser bundle built by `mix assets.deploy`
- the Node.js SSR bundle built by the generated `build:ssr` script

Build both before assembling a release. `mix assets.deploy` does not build the
SSR entry implicitly.

## npm installation

For the default installer setup, install the locked asset dependencies and run
the generated checks and SSR build from `assets`:

```sh
cd assets
npm ci
npm run typecheck
npm run build:ssr
cd ..

mix assets.deploy
MIX_ENV=prod mix release
```

Vite's `build` command already produces the production browser bundle. The
generated PhoenixVite production runtime configuration reads that bundle's
manifest, so the first asset build must create the manifest before a production
Mix runtime starts. A later `MIX_ENV=prod mix release` copies and validates the
completed `priv` artifacts.

Vite, TypeScript, and the React plugin are development dependencies needed at
build time. Do not use `npm ci --omit=dev` in the asset build stage. They do not
need to remain in the final release image.

## Bun installation

When the project was installed with `--bun`, use the configured Mix profiles
and PhoenixVite aliases from the Phoenix application root:

```sh
mix assets.setup
mix bun assets run typecheck
mix bun assets run build:ssr
mix assets.deploy
MIX_ENV=prod mix release
```

Keep the Bun lockfile authoritative; do not switch the same checkout between
npm and Bun during one release build.

## SSR release runtime

The generated `assets/vite.liveview-react.ssr.config.mjs` imports
`assets/js/liveview_react_server.tsx`, resolves components through
`virtual:liveview-react/components`, and writes:

```text
priv/liveview_react/server.mjs
```

Mix includes application `priv` files in the release. Verify that this file is
present before `mix release`; a stale browser bundle is not a substitute for a
missing SSR bundle.

Production SSR also requires:

- the optional `{:nodejs, "~> 3.1"}` Hex dependency
- `NodeJS.Supervisor` in the application supervision tree
- a supported Node.js runtime in the release image
- `LiveViewReact.SSR.NodeJS` in the production LiveViewReact configuration

When the supervisor uses
`LiveViewReact.SSR.NodeJS.server_path(:my_app)`, its module root is that
released application's `priv` directory. Configure the module path relative to
that root:

```elixir
config :liveview_react,
  ssr: true,
  ssr_module: LiveViewReact.SSR.NodeJS,
  ssr_filepath: "./liveview_react/server.mjs"
```

If production SSR is intentionally disabled, set `ssr: false` in the
production configuration. The SSR build, optional NodeJS dependency,
supervisor, and Node.js runtime can then be omitted; the PhoenixVite browser
build is still required.

## Manual asset setups

These commands assume `mix igniter.install liveview_react` generated the
virtual registry, server entry, dedicated SSR Vite config, and package scripts.
A manually configured application must provide the same renderer export and
ensure its configured `ssr_filepath` matches its actual ESM output. There is no
alternate script or second server-only registry fallback.

Keep the Hex and npm `liveview_react` packages on the same release line. The
library publication workflow verifies synchronized package versions, while
each consuming application remains responsible for keeping its own lockfiles
and release artifacts consistent.

Library maintainers should follow [Releasing](releasing.md) for the local
artifact dry run, tag contract, protected environment, and two-registry
publication sequence.
