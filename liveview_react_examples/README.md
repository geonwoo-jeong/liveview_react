# LiveViewReact examples

This Phoenix 1.8 application exercises the local `liveview_react` Hex and npm
packages against React 19. It requires Elixir 1.20 or newer and Node.js 24 or
newer.

To start it from this directory:

```shell
mix setup
mix phx.server
```

`mix setup` installs the example's dependencies, builds the npm package from the
repository root, and creates both client and SSR bundles. Visit
[`localhost:4010`](http://localhost:4010) when the server is ready. The landing
page redirects to `/sample`, which consolidates the current
`liveview_react` bridge surface into one screen. Vite runs on port 4011 in
development.

## Evaluation map

| Route | What it demonstrates |
| --- | --- |
| `/sample` | The primary evaluation surface: SSR/hydration, ordinary props and events, streams, forms, uploads, slots, navigation, Context, portals, lazy registry entries, and React 19 root behavior |
| `/sample/destination` | The destination and remount boundary for the sample's live navigation flow |
| `/ssr` | Focused server-rendered and client-only roots |
| `/hybrid-form` | Focused Phoenix validation with React-controlled form state |
| `/stream-demo` and `/slot` | Focused stream operations and inert HEEx slot transport |
| `/link-demo` and `/link-usage` | `Link`, patch, navigate, and direct LiveView navigation behavior |
| `/lazy`, `/context`, and `/live-counter` | Lazy component loading, per-root Context, and authoritative server updates |
| `/simple`, `/simple-props`, `/typescript`, `/log-list`, and `/flash-sonner` | Small integration examples kept for focused manual inspection |

Routes below `/e2e` are compiled only when `LIVEVIEW_REACT_E2E=true`. They are
purpose-built Playwright fixtures for failure injection, lifecycle races,
reconnects, SSR/hydration, streams/slots, forms/uploads, and React compatibility;
they are not part of the normal development application.

Useful checks:

```shell
mix format --check-formatted
mix compile --warnings-as-errors
mix test
cd assets
npm run typecheck
npm run build
npm run build-server
```

The browser lifecycle suite runs from the repository root. Install Chromium
once, then run the suite against the isolated instrumented Phoenix test server
and Vite development server:

```shell
npx playwright install chromium
npm run test:e2e
```

Build the production image from the repository root so Docker can resolve both
local `liveview_react` dependencies:

```shell
docker build -f liveview_react_examples/Dockerfile .
```
