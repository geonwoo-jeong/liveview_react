# Library development

Install both toolchains, then run the independent verification suites:

```sh
mix deps.get
mix format --check-formatted
mix compile --force --warnings-as-errors
mix credo --strict
mix test
mix dialyzer

npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run pack:check
```

The example application lives in `liveview_react_examples`. Its npm dependency
points at the repository root, so build the library package before installing
or building the example assets.

```sh
npm ci
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

## Focused deterministic checks

Property suites use fixed seeds and bounded runs, so a failure is reproducible:

```sh
mix test test/live_view_react_patch_property_test.exs
npx vitest run \
  assets/js/liveview_react/transport/compactPatch.property.test.ts \
  assets/js/liveview_react/transport/jsonPatch.property.test.ts
```

The root lifecycle stress test is part of normal `npm test` and can be run
alone:

```sh
npm run test:stress
```

It mounts and destroys 1,000 roots and requires exact setup/cleanup balance,
zero active roots, unmounted controllers, and empty targets. When garbage
collection is exposed, it reports heap delta without a host-dependent failure
threshold.

## Browser tests

The Playwright config starts the example Vite and Phoenix test servers. Prepare
both dependency trees and the built library package first, then run:

```sh
npm ci
npm run build
cd liveview_react_examples
mix deps.get
cd assets
npm ci
cd ../..
npx playwright install chromium
npm run test:e2e:typecheck
npm run test:e2e
```

The suite exercises an actual LiveView connection, SSR/hydration, reconnect,
events, navigation, streams, forms, uploads, lazy races, cleanup, multiple
roots, and the React compatibility matrix. See [Testing](testing.md) for the CI
lanes.

## Report-only performance suite

Run the server and browser-runtime benchmarks independently:

```sh
mix run bench/performance.exs
npm run benchmark
```

The server report covers a one-field change in a 1,000-item nested list and a
separate 1,000-field form, 10,000 stream insert/upsert, update-only/replace, and
delete/remove operations, plus an injected deterministic SSR contract. It
reports payload sizes and the relevant render, diff, adapter, and serialization
times.

The JavaScript report covers full-versus-compact form work, generic 10,000-op
compact decode/apply, 10,000 stream insert/update/delete application,
update-versus-remount, 100 preserved updates versus 100 root replacements,
React SSR render and hydrate-through-commit, and tagged lazy-loader resolution.
To include the production lazy chunk invariant and byte report, build the
example client assets before `npm run benchmark`:

```sh
npm run build
cd liveview_react_examples/assets
npm ci
npm run build
cd ../..
npm run benchmark
```

That check requires the `app.js -> lazy.js -> lazy-component.js` split and
reports all three file sizes. Results vary by host and deliberately have no
numeric regression threshold; semantic invariants still fail. The manually
dispatched `Benchmarks` workflow performs the required build and writes both
reports to its job summary rather than treating measurements as performance
promises.

Before a release, use the single reproducible check entry point described in
[Releasing](releasing.md):

```sh
npm run release:check
```
