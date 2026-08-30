# Migration from LiveReact

`liveview_react` is a clean-break project, not an in-place release of
`live_react`. It intentionally provides no legacy package alias, Elixir module,
configuration fallback, hook key, JavaScript export, or deprecation layer.
Migrate every boundary explicitly and remove the old integration completely.

Do this work on a branch and keep the application compiling after each group
of changes. The new installer fails closed when it cannot safely merge a
customized old Vite setup; that is a request for a manual decision, not a
reason to overwrite the file.

## Public-name changes

| Old LiveReact surface             | LiveViewReact surface                       |
| --------------------------------- | ------------------------------------------- |
| Hex `live_react`                  | Hex `liveview_react`                        |
| npm `@mrdotb/live-react`          | npm `liveview_react`                        |
| `LiveReact`                       | `LiveViewReact`                             |
| `LiveReact.SSR.ViteJS`            | `LiveViewReact.SSR.ViteJS`                  |
| `LiveReact.SSR.NodeJS`            | `LiveViewReact.SSR.NodeJS`                  |
| application config `:live_react`  | application config `:liveview_react`        |
| hook key `ReactHook`              | hook key `LiveViewReactHook`                |
| JavaScript `getHooks(components)` | `createLiveViewReact({ components }).hooks` |
| HEEx `name="Counter"`             | HEEx `component="Counter"`                  |

Search the application for every old public name before removing the old
dependency:

```sh
rg '\blive_react\b|@mrdotb/live-react|\bLiveReact\b|\bReactHook\b|\bgetHooks\b'
```

Do not add local aliases to make this search pass gradually. Such aliases hide
an incomplete migration and are outside the supported API.

## 1. Replace dependencies and asset setup

Remove `{:live_react, ...}` and the old npm package. Install the new project
with its canonical command:

```sh
mix igniter.install liveview_react
```

Pass `--bun` if the application should use the PhoenixVite Bun runner, or
`--no-demo` if no migration demo is wanted. See [Installation](installation.md)
for the files and configuration owned by the installer.

Old LiveReact installations often have hand-written Vite watchers, Mix asset
aliases, copied server entry points, a `LiveReact.Reload` layout wrapper, and
manual Tailwind content globs. Remove those old integration fragments after
confirming PhoenixVite owns the equivalent asset behavior. Preserve unrelated
Vite plugins, npm scripts, CSS sources, and application aliases.

If the installer reports a conflict in an old `vite.config` or `app.js`, port
the unrelated customization into the PhoenixVite shape, remove the obsolete
LiveReact import or hook entry, and rerun the installer. Never keep both bridge
plugins or both hook keys active.

## 2. Move components to the virtual registry

The default registry discovers default-exported components under
`assets/react-components`. A file's extensionless relative path is its public
component name. For example,
`assets/react-components/Admin/UserCard.tsx` is registered as
`Admin/UserCard`.

Remove the old eager object or `import.meta.glob` registry and import
`virtual:liveview-react/components` through the generated browser and server
entry points. If application code still creates a registry manually, entries
must be tagged so a zero-argument component cannot be confused with a loader:

```tsx
const components = {
  Counter: { component: Counter },
  Editor: { load: () => import("./Editor") },
} as const;
```

Direct entries such as `{ Counter }` are not accepted.

## 3. Migrate HEEx roots

Every root now requires an explicit non-empty `id`, a non-empty `component`,
and the owning `Phoenix.LiveView.Socket`:

```heex
<.react
  id="account-counter"
  component="Counter"
  socket={@socket}
  count={@count}
/>
```

Replace `name` with `component`; never rely on the old process-counter ID.
`socket` is not optional, including the disconnected render of a LiveView.
`ssr` and `diff` remain strict boolean root options.

LiveView owns a transport-only outer element and React owns its inner mount
target. An old wrapper `class` is therefore not retained as outer DOM styling:
ordinary assigns, including `class`, are React props. Put layout and styling on
the component's own rendered element.

## 4. Migrate the JavaScript bridge

Replace `getHooks` and `ReactHook` with one immutable bridge instance:

```tsx
import components from "virtual:liveview-react/components";
import { createLiveViewReact } from "liveview_react";

const liveViewReact = createLiveViewReact({ components });

const liveSocket = new LiveSocket("/live", Socket, {
  hooks: {
    ...existingHooks,
    ...liveViewReact.hooks,
  },
  params: { _csrf_token: csrfToken },
});
```

The canonical key inside that map is `LiveViewReactHook`. Do not rename it.
The generated installer entry point already performs this setup, so use the
manual form only when integrating a custom asset entry.

Old LiveReact injected socket operations into every component's root props.
LiveViewReact does not. `useLiveReact` was the old upstream `live_react` hook
name, and this project intentionally does not expose it or keep it as a
compatibility alias. Read the owning bridge through `useLiveViewReact()`:

```tsx
const { pushEvent, pushEventTo, handleEvent, removeHandleEvent } =
  useLiveViewReact();
```

`pushEvent` and `pushEventTo` return Promises and have no callback overload.
Use `useLiveEvent`, `useEventReply`, `useLiveConnection`, and
`useLiveNavigation` for their focused lifecycles. Declarative server commands
use lowercase `r-on:*` HEEx attributes and arrive as `onCamelCase` React props;
ordinary `phx-*` attributes can be rendered directly by React.

## 5. Migrate SSR, streams, and slots

Change all SSR modules and configuration keys to the `LiveViewReact`
namespace. Browser and server rendering must import the same registry; do not
keep an old server-only component map. Development SSR uses
`LiveViewReact.SSR.ViteJS`, while production SSR uses
`LiveViewReact.SSR.NodeJS` and the separately built ESM server entry.

Pass Phoenix LiveView
[LiveStream struct](https://hexdocs.pm/phoenix_live_view/Phoenix.LiveView.LiveStream.html)
values directly as props and use the transported `__dom_id` as the React key.
The stream prop is present from disconnected SSR and no-JavaScript HTML through
hydration, connected updates, and reconnects; empty streams arrive as `[]`.
Do not adapt the old compact patch payload in application code. LiveViewReact
accepts only its mandatory v2 initial frame and intentionally provides no v1
parser, fallback, or compatibility mode.

HEEx slots become inert React nodes behind a fail-closed markup allowlist. They
cannot contain links, form controls, active or resource-bearing tags,
event/style/URL attributes, `phx-*` or `data-phx-*` bindings, hooks,
LiveComponents, or nested LiveViewReact roots. Move interactive content into
the owning React component or keep it outside the root.

Named slots are written with the reserved `<:slot>` entry and an explicit
`name`, not as `<:name>`:

```diff
-<:header>Title</:header>
+<:slot name="header">Title</:slot>
```

`react/1` classifies slots by assign name only; it never inspects an ordinary
prop's value to decide whether it is "really" a slot. The old form is therefore
not special-cased. A slot written the old way reaches the encoder as an ordinary
prop and fails closed there, because its `inner_block` is a function rather than
JSON. With the explicit form, a slot hidden by `:if` remains identifiable
through the reserved `:slot` assign and is omitted. An ordinary `items={[]}`
attribute continues to arrive as an empty-list React prop.

Search your templates for `<:` and convert every occurrence rather than relying
on a runtime error to find them.

## 6. Verify the clean break

Run the application suites and both asset builds, then repeat the old-name
search until it returns no application references:

```sh
mix format --check-formatted
mix compile --warnings-as-errors
mix test
mix assets.build

cd assets
npm run typecheck
npm run build:ssr
```

For a Bun installation, omit `cd assets` and the two npm commands. Run
`mix bun assets run typecheck` and `mix bun assets run build:ssr` from the
Phoenix application root instead. Exercise connected mount, reconnect,
navigation, SSR hydration, and any migrated stream, slot, form, or upload flows
in a real browser before removing the migration branch.

The repository's provenance notices may still contain the old project name;
that is attribution, not a compatibility surface. Application code and
configuration must use only `liveview_react` and `LiveViewReact`.
