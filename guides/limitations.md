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
- HEEx slots are validated inert HTML wrappers, not a general HTML sanitizer.
  Dynamic HEEx values still rely on Phoenix escaping. Interactive Phoenix
  content is rejected: forms, `phx-*` and `data-phx-*` bindings, hooks,
  LiveComponents, and nested LiveViewReact roots cannot be transported as
  slots.
- Slot HTML is not a second LiveView subtree. Put interactivity in the owning
  React component or outside the React target.

## SSR and loading

- SSR uses `renderToString`, not React streaming SSR. A suspended component
  renders its nearest Suspense fallback.
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
- The repository does not automate an upstream-library performance comparison;
  record environment and versions when comparing reports manually.

## Forms, uploads, and events

- `useLiveForm` is a controlled-state bridge, not a client form backend.
  LiveView remains authoritative for validation and persistence.
- A file input must be rendered by Phoenix with `<.live_file_input>` outside
  the React-owned target. React cannot synthesize Phoenix upload internals.
- Reply cancellation is logical. It ignores a late reply but cannot retract an
  event already sent over the socket.
- LiveView hook APIs are available only inside a LiveViewReact root. Commands
  that require the live bridge throw when invoked during SSR or before
  hydration makes the bridge available.

## Supported platform

The initial release targets Phoenix 1.8+, Phoenix LiveView 1.2.11+, React and
ReactDOM 19.x, TypeScript 7.x, Vite 8.x, and Node.js 24+. It intentionally has
no Phoenix 1.7, LiveView 0.x, React 18, CommonJS, old LiveReact namespace, or
deprecated API compatibility layer. See [Testing](testing.md) for the exact CI
matrix.
