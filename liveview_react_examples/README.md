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
[`localhost:4010`](http://localhost:4010) when the server is ready. Vite runs on
port 4011 in development.

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

Build the production image from the repository root so Docker can resolve both
local `liveview_react` dependencies:

```shell
docker build -f liveview_react_examples/Dockerfile .
```
