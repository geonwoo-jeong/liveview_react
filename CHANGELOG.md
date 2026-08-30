# Changelog

## 0.1.0

- Established the new `liveview_react` Hex, OTP, and npm identity.
- Made explicit `id` and `component` attributes the only component API.
- Added a strict TypeScript-first React 19 package surface.
- Standardized registration on `createLiveViewReact()` and
  `LiveViewReactHook`.
- Standardized SSR on `createLiveViewReactServer()` and the
  `liveview_react/vite` entry point.
- Read global SSR and props-diff flags from runtime application configuration,
  and start OTP `:inets` as part of the Vite SSR adapter contract.
- Added immutable compact props patches, reconnect recovery, Phoenix Streams,
  and inert HEEx slot transport.
- Required named slots to be written as `<:slot name="...">`. HEEx renders a
  slot omitted by `:if` as `[]`, which is indistinguishable from an ordinary
  empty-list attribute, so slot identity now comes from the reserved `:slot`
  assign instead of from the shape of a value. Empty-list props keep their
  value, and a hidden named slot contributes nothing.
- Made inert slot transport fail closed with matching server/browser tag and
  attribute allowlists. Active/resource markup and event, style, URL, Phoenix,
  or nested-root attributes are rejected, while meaningful boundary whitespace
  is preserved.
- Forced a full props snapshot when a prop is backed by `:temporary_assigns`.
  LiveView resets those assigns after each render, so the diff baseline no
  longer matched the client and array patches could accumulate duplicates.
- Reported hook lifecycle failures asynchronously instead of throwing into
  LiveView's DOM patch, so one failing root can no longer abort the remaining
  hook callbacks in the same patch.
- Added SSR/hydration identity, lazy component loading, StrictMode, root error
  callbacks, portals, and React 19 compatibility coverage.
- Added LiveView events and replies, connection state, navigation, controlled
  Ecto forms, and Phoenix upload hooks.
- Added Vite component discovery and an idempotent Igniter installer for fresh
  Phoenix applications.
- Added ExUnit, property, Vitest, real-Phoenix Playwright, lifecycle stress,
  compatibility matrix, artifact, benchmark, and release dry-run workflows.
- Removed deprecated setup tasks, copy templates, reload hooks, and fallback
  IDs.
