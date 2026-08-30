# Limitations

These boundaries are intentional parts of the current product, not hidden
compatibility modes.

## Root and state boundaries

- Every `<.react>` creates an independent React root. There is no automatic
  cross-root Context, shared provider instance, global store, or portal host.
  Standard React portals may target DOM outside the mount target and retain
  their owning root's Context and event propagation.
- `wrapRoot` runs separately for every root. Provider state created there is
  local to that root.
- The required `id` and `component` cannot change while a hook is mounted.
  Replace the outer LiveView element when component identity must change; local
  React state is lost as part of that deliberate remount.
- Removing the LiveView element unmounts React. Local state is not serialized
  through navigation or restored by the bridge.
- Many roots have normal React-root memory and scheduling overhead. Combine
  tightly coordinated widgets into one component tree.

## DOM and slots

- The outer element is transport-only. There is no public outer-tag, class, or
  style option; ordinary assigns such as `class` are React props.
- Named slots must be written as `<:slot name="...">`. HEEx gives a function
  component no runtime way to tell a slot omitted by `:if` from an ordinary
  empty-list attribute, so slot identity comes from the reserved `:slot` assign
  rather than from the shape of a value.
- HEEx slots are validated inert HTML wrappers, not a general HTML sanitizer.
  A fail-closed allowlist admits passive structure, text, lists, tables, and
  neutral attributes. Active/resource tags, form controls, links, event
  handlers, inline styles, URL-bearing attributes, custom elements, `phx-*`
  and `data-phx-*` bindings, hooks, LiveComponents, and nested LiveViewReact
  roots are rejected. Dynamic HEEx values still rely on Phoenix escaping.
- Slot HTML is not a second LiveView subtree. Put interactivity in the owning
  React component or outside the React target.

## SSR and loading

- SSR uses `renderToString`, not React streaming SSR. A suspended component
  renders its nearest Suspense fallback.
- Phoenix deliberately does not apply a stream `limit` during the disconnected
  render. No-JavaScript and pre-join SSR HTML can therefore contain more rows
  than the authoritative connected snapshot; LiveViewReact hydrates that exact
  dead frame before applying the bounded connected state.
- Stream items must encode as plain JSON objects. LiveViewReact preserves
  Phoenix's computed `__dom_id` but never transports a `LiveStream` struct,
  function, reference, or other BEAM runtime value. Unsupported internal
  LiveStream shapes fail closed against the declared Phoenix LiveView version
  range.
- Slow LiveView redirects keep visual continuity with a navigation-only inert
  DOM snapshot after React unmounts. Effect cleanup, bridge teardown, and lazy
  mount cancellation still happen immediately. The snapshot copies ordinary
  DOM, form state, scroll offsets, and 2D canvas pixels where the browser
  exposes them. Custom elements, URL-backed CSS presentation, and active or
  resource-bearing content such as images, pictures, SVG, iframes, media, and
  scripts become bounded passive placeholders rather than reconnecting
  behavior or repeating resource requests. Those placeholders deliberately
  preserve geometry and a small safe subset of computed presentation, not the
  original URL-bearing attributes or styles. The snapshot is not a second live
  React tree or a pixel-perfect replay for portals, shadow DOM, images, active
  media playback, SVG, WebGL, text selection, or caret position.

  Phoenix replacement or a matching navigation completion removes the
  snapshot exactly once. If neither arrives, a two-second fail-safe removes the
  snapshot, disconnects its observer and listeners, and leaves the already
  destroyed outgoing target empty and inert. React effects and bridge state
  were intentionally finalized before the snapshot appeared, so the bridge
  cannot revive that old React root; a later Phoenix replacement or a new page
  navigation must provide the next live UI.

- The Vite plugin provides development SSR. Production requires a separately
  built ESM server bundle, the optional NodeJS dependency and supervisor, and a
  Node.js runtime in the release image.
- An available renderer's `RenderError` is raised. The bridge does not silently
  discard renderer failures and retry with client-only output. Absent SSR
  infrastructure uses the `NotConfigured` client-only path.
- The virtual component registry is eager. Code splitting requires an explicit
  `{ load: () => import(...) }` registry entry or React `lazy` below an eager
  root shell.
- LiveViewReact does not inspect the Vite production manifest or automatically
  emit component JavaScript/CSS preload links. Explicit React 19 resource hints
  are preserved.
- A bridge-level loader has no built-in fallback UI, and a rejection happens
  before a component Error Boundary exists. Use an eager shell with React
  `Suspense` and an Error Boundary when the loading experience needs them.

## Performance evidence

- Benchmark timings and heap deltas are report-only because host, runtime
  warmup, and garbage collection make portable numeric gates misleading.
- Semantic checks still fail on incorrect chunk topology, hydration output,
  stream results, remount behavior, or lifecycle cleanup.

## Forms, uploads, and events

- `useLiveForm` is a controlled-state bridge, not a client form backend.
  LiveView remains authoritative for validation and persistence.
- A file input must be rendered by Phoenix with `<.live_file_input>` outside
  the React-owned target. React cannot synthesize Phoenix upload internals.
- Reply cancellation is logical. It ignores a late reply but cannot retract an
  event already sent over the socket.
- LiveView hook APIs are available only inside a LiveViewReact root. Public
  `useLiveViewReact()` bridge commands still throw during SSR and the hydration
  render pass. Built-in bridge hooks use internal client command wiring so
  post-commit browser events during hydration can still validate forms,
  navigate, subscribe, and dispatch uploads.

## Supported platform

The initial release targets Phoenix 1.8+, Phoenix LiveView 1.2.11+, React and
ReactDOM 19.x, TypeScript 7.x, Vite 8.x, and Node.js 24+. It intentionally has
no Phoenix 1.7, LiveView 0.x, React 18, CommonJS, or deprecated API
compatibility layer. See [Testing](testing.md) for the exact CI matrix.

The real-browser contract is currently Chromium only. Firefox and WebKit may
work through the same standards-based APIs, but they are not supported claims
for the initial public release until equivalent lifecycle, hydration, form,
upload, and navigation lanes run in CI.
