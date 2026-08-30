# Changelog

## 0.1.0

- Established the new `liveview_react` Hex, OTP, and npm identity.
- Replaced the legacy Elixir namespace with `LiveViewReact`.
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
- Added SSR/hydration identity, lazy component loading, StrictMode, root error
  callbacks, portals, and React 19 compatibility coverage.
- Added LiveView events and replies, connection state, navigation, controlled
  Ecto forms, and Phoenix upload hooks.
- Added Vite component discovery and an idempotent Igniter installer for fresh
  Phoenix applications.
- Added ExUnit, property, Vitest, real-Phoenix Playwright, lifecycle stress,
  compatibility matrix, artifact, benchmark, and release dry-run workflows.
- Removed legacy setup tasks, copy templates, reload hooks, fallback IDs, and
  compatibility aliases.

The project begins at version 0.1.0 as a clean-break derivative. Historical
upstream releases are documented in [UPSTREAM.md](UPSTREAM.md).
