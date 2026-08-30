# Uninstallation

LiveViewReact has no compatibility or automatic uninstall layer. Remove its
owned integration explicitly so application-specific PhoenixVite, React,
TypeScript, Tailwind, and router configuration remains intact.

Perform the removal on a branch. Start by replacing every `<.react>` root and
every import from `liveview_react`; otherwise removing the dependencies only
turns known usage into compile or build failures.

## 1. Remove the generated demo

If the default demo was installed, remove only these demo surfaces:

- the `/liveview-react` route from the selected router's browser scope
- the generated `LiveViewReactDemoLive` module
- `assets/react-components/LiveViewReactDemo.tsx`

Keep a file or route if the application has adopted and renamed its behavior;
in that case it is application code and must be migrated before removal.

## 2. Disconnect the bridge

Remove the LiveViewReact-specific fragments while preserving neighboring
hooks, plugins, and configuration:

- remove the generated bridge import from `assets/js/app.js` and remove only
  the `...liveViewReact.hooks` entry from `LiveSocket`'s hook map
- remove the `liveview_react/vite` import and its plugin call from
  `assets/vite.config.mjs`
- remove the `@vitejs/plugin-react` import and `react()` plugin call only when
  no remaining application bundle uses React
- remove the `config :liveview_react, ...` development SSR block from
  `config/dev.exs`
- remove `import LiveViewReact` from the selected web module's
  `html_helpers/0`

Delete installer-generated files only when they have not become shared
application entry points:

- `assets/js/liveview_react.ts`
- `assets/js/liveview_react_server.tsx`
- `assets/js/liveview-react.d.ts`
- `assets/vite.liveview-react.ssr.config.mjs`
- `assets/tsconfig.json`

Do not delete an adopted TypeScript configuration. Remove only its
LiveViewReact virtual-module declaration and references instead.

Remove React component files only when they were used exclusively by
LiveViewReact. The directory `assets/react-components` is application source,
not disposable installer state once the application adds components to it.

## 3. Remove packages and scripts

Remove the Hex dependency from `mix.exs`:

```elixir
{:liveview_react, "~> 0.1.0"}
```

Then clean the unused dependency after the application compiles without it:

```sh
mix deps.clean liveview_react --unlock
```

With npm, remove the local asset dependency from the assets directory:

```sh
cd assets
npm uninstall liveview_react
```

With Bun, run `mix bun assets remove liveview_react` before removing its Mix
configuration so the Bun lockfile is updated. Remove the installer-owned
`typecheck` or SSR build script only if no remaining asset workflow uses it.
Keep `react`, `react-dom`, `@types/react`, `@types/react-dom`,
`@vitejs/plugin-react`, and `typescript` when the application still contains
React or TypeScript code; if they are now unused, remove them with the same
package manager.

Delete generated SSR output such as `priv/liveview_react/server.mjs` from the
release build context. If production configured `LiveViewReact.SSR.NodeJS`,
also remove its config, `NodeJS.Supervisor` child, and optional `:nodejs`
dependency when nothing else uses them.

## 4. Decide whether to keep PhoenixVite

PhoenixVite configures the application's entire asset pipeline, not just
LiveViewReact. Removing LiveViewReact does not require removing PhoenixVite.
The safest default is to keep it and remove only the LiveViewReact plugin.

If the application must return to Phoenix's generated esbuild/Tailwind Mix
tasks, follow PhoenixVite's current removal guidance and reconstruct the
watchers, layout asset tags, Mix aliases, dependencies, static paths, and
Tailwind integration as one separate migration. Do not delete Vite files or
restore old configs blindly: those files may now contain unrelated application
work.

## 5. Verify the result

Search for remaining runtime references:

```sh
rg 'liveview_react|LiveViewReact|LiveViewReactHook|virtual:liveview-react'
```

Provenance documents and historical lockfile entries may legitimately remain
until their normal cleanup; application code and runtime configuration should
not. Finish by running the Elixir formatter, warnings-as-errors compilation,
tests, and the surviving asset build.
