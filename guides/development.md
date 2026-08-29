# Library development

Install both toolchains, then run the independent verification suites:

```sh
mix deps.get
mix format --check-formatted
mix compile --force --warnings-as-errors
mix credo --strict
mix test

npm ci
npm run format:check
npm run typecheck
npm test
npm run build
npm run pack:check
```

The example application lives in `liveview_react_examples`. Its npm dependency
points at the repository root, so build the library package before installing
or building the example assets.

```sh
npm run build
cd liveview_react_examples
mix deps.get
mix test
cd assets
npm ci
npm run typecheck
npm run build
npm run build-server
```

Source code lives in `lib/live_view_react*` and
`assets/js/liveview_react`. Generated npm artifacts live in `dist` and must not
be edited directly.
