# Component API

This guide describes the supported Elixir component and JavaScript entry
points. Internal transport modules and DOM attributes are not application APIs.

## HEEx component

Import `LiveViewReact` in the application's web helpers and call `react/1`:

```heex
<.react
  id="profile-editor"
  component="ProfileEditor"
  socket={@socket}
  user={@user}
  ssr={true}
  diff={true}
/>
```

| Assign | Contract |
| --- | --- |
| `id` | Required non-empty string; stable and unique in the rendered DOM |
| `component` | Required non-empty registry key; stable while mounted |
| `socket` | Required current `Phoenix.LiveView.Socket` |
| `ssr` | Optional boolean; defaults to `config :liveview_react, ssr: true` |
| `diff` | Optional boolean; defaults to `config :liveview_react, enable_props_diff: true` |
| all other assigns | Encoded as immutable React props, streams, events, or slots |

The outer element is transport-only. `class`, `style`, and other ordinary
assigns are component props; put outer visual markup inside the React
component.

Pass `@streams.name` directly and use each item's transported `__dom_id` as its
React key. Default HEEx content becomes React `children`; named slots are
written as `<:slot name="header">` and become same-name React props. Slot HTML
uses a fail-closed inert-markup allowlist and cannot contain links, form
controls, resource-bearing tags, event/style/URL attributes, LiveView bindings
or hooks, LiveComponents, or nested React roots. See [Streams](streams.md) and
[Slots](slots.md).

An `r-on:save={%Phoenix.LiveView.JS{}}` attribute becomes an `onSave` callback
prop. Event names must be lowercase kebab case. Callback names cannot collide
with ordinary props. See [Events](events.md).

## Component registry

The registry uses explicit tagged entries. Direct component values and
untagged zero-argument functions are rejected:

```tsx
import Counter from "./Counter";

const components = {
  Counter: { component: Counter },
  Editor: { load: () => import("./Editor") },
} as const;
```

An eager entry accepts React function and class components plus `memo`,
`forwardRef`, and `lazy` exotic components. A registry loader must resolve to
`{ default: Component }`.

The installer normally supplies the immutable default export from
`virtual:liveview-react/components`. It recursively registers default-exported
`.js`, `.jsx`, `.ts`, and `.tsx` files below `./react-components`, relative to
the Vite root. The extensionless relative path is the key. The virtual registry
is eager; use an explicit tagged registry when bridge-level code splitting is
required.

## Browser factory

Create the bridge once and merge its hook map into the application's existing
LiveSocket hooks:

```tsx
import components from "virtual:liveview-react/components";
import { createLiveViewReact } from "liveview_react";

const liveViewReact = createLiveViewReact({
  components,
  strictMode: true,
  wrapRoot({ children, componentName, element }) {
    return (
      <AppProviders root={componentName} element={element}>
        {children}
      </AppProviders>
    );
  },
  onCaughtError(error, info) {
    reportReactError("caught", error, info);
  },
  onRecoverableError(error, info) {
    reportReactError("recoverable", error, info);
  },
  onUncaughtError(error, info) {
    reportReactError("uncaught", error, info);
  },
});
```

`components` is required. `strictMode` defaults to `false`. `wrapRoot` receives
immutable `{ children, componentName, element }` for each root. The three error
callbacks are passed to React 19's client root API and are client-only. Unknown
options, accessors, and invalid values fail immediately.

`element` is `null` during SSR and the hydration pass. It is the outer hook
element for client-only roots and client renders after hydration. Do not derive
different visible provider markup from that value during hydration.

The factory returns `{ hooks: { LiveViewReactHook } }`. The main package also
exports `Link`, `useLiveViewReact`, `useLiveEvent`, `useEventReply`,
`useLiveConnection`, `useLiveNavigation`, `useLiveForm`, and `useLiveUpload`,
with their public TypeScript types.

Low-level `useLiveViewReact()` bridge commands are unavailable during SSR and
the hydration render pass. Invoke commands only from effects or event handlers;
the built-in hooks use their documented post-commit client bridge during
hydration. See [Client hooks](client_hooks.md).

## Vite plugin

Both import forms are supported and refer to the same plugin factory:

```ts
import liveViewReactPlugin from "liveview_react/vite";
// or: import { liveViewReactPlugin } from "liveview_react/vite";
```

Vite 8 is an optional peer because only applications importing this plugin
subpath need Vite at runtime.

```ts
liveViewReactPlugin({
  componentDirectory: "./react-components",
  entrypoint: "./js/liveview_react_server.tsx",
  maxBodyBytes: 1_048_576,
  path: "/ssr_render",
});
```

| Option | Default | Purpose |
| --- | --- | --- |
| `componentDirectory` | `./react-components` | Virtual-registry source inside the Vite root |
| `entrypoint` | `./js/server.ts` | Vite SSR module exporting `render` |
| `maxBodyBytes` | `1_048_576` | Maximum development SSR request body size |
| `path` | `/ssr_render` | Absolute development SSR endpoint path |

The directory must stay inside the Vite root and cannot traverse symlinks. The
SSR endpoint accepts only `POST` JSON with an optional single charset
parameter. Unknown plugin options and malformed requests fail explicitly.

## Server factory

The server entry uses the same registry:

```tsx
import components from "virtual:liveview-react/components";
import { createLiveViewReactServer } from "liveview_react/server";
import type { ServerRenderRequest } from "liveview_react/server";

const server = createLiveViewReactServer({ components });

export function render(request: ServerRenderRequest): Promise<string> {
  return server.render(request);
}
```

`createLiveViewReactServer` accepts `components`, `strictMode`, and `wrapRoot`.
Client root error callbacks are rejected on the server. Applications normally
receive `ServerRenderRequest` from the BEAM adapter rather than constructing it.
That request is the exact transport-v2 initial frame; `version`, `component`,
`identifierPrefix`, `props`, `streams`, `events`, and `slots` are all required,
and unknown fields are rejected.

## Public error classes

The main `liveview_react` entry exports four operational error classes:

- `LiveEventReplyCancelledError`: a reply was superseded, cancelled, or its
  component unmounted.
- `LiveEventReplyTimeoutError`: `useEventReply` exceeded its configured timeout.
- `LiveFormSubmitCancelledError`: submission could not start or was cancelled
  by reset, disconnect, unmount, or form replacement.
- `LiveFormSubmitInvalidError`: native browser constraint validation blocked
  submission.

Invalid JavaScript configuration or wire data raises `TypeError`; missing
registry entries and invalid mounted identity raise `Error`. On the BEAM side,
the `LiveViewReact.SSR` namespace uses the `NotConfigured` exception for absent
infrastructure and `RenderError` for renderer failures; invalid component
assigns raise `ArgumentError`. Do not parse error message text as an API.
