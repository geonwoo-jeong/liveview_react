# Testing

LiveViewReact separates transport tests, React runtime tests, and real-browser
integration. Application tests should use the cheapest layer that can observe
the behavior under test, then keep a small Playwright set for complete user
flows.

## Inspect a root from ExUnit

Add optional Floki support to the consuming application in test:

```elixir
{:floki, "~> 0.38", only: :test}
```

`LiveViewReact.Test.get_react/2` accepts rendered HTML or a
`Phoenix.LiveViewTest.View`:

```elixir
{:ok, view, _html} = live(conn, "/counter")

root = LiveViewReact.Test.get_react(view, id: "account-counter")

assert root.component == "Counter"
assert root.props["count"] == 1
assert root.transport_version == 2
```

Select by `:id` when a page contains several instances of the same component,
or by `:component` when it is unique. The result exposes `props`, `events`,
`slots`, `ssr`, `hydration`, `props_kind`, `props_diff`, `streams_kind`,
`streams_diff`, and `transport_version` in addition to identity.
For an SSR root, `root.hydration["streams"]` is the materialized disconnected
snapshot used by both `renderToString` and the first browser hydration tree;
`root.streams_kind` is then `"hydration"` and `root.streams_diff` is empty.

For assertions that must see full props on every render, disable compact props
diffs only in the test environment:

```elixir
config :liveview_react, enable_props_diff: false
```

Do not assert private DOM transport encoding when the decoded helper result
expresses the contract.

## Repository verification

The complete local unit and artifact checks are:

```sh
mix deps.get
mix quality
mix quality_full

npm ci
npm run quality
npm run quality:ci
```

`mix quality_full` is the closest single local entry point to the latest BEAM
CI lane because it adds retired and vulnerable dependency audits, unused
dependency checking, and Dialyzer to the fast checks. `npm run quality:ci`
similarly layers package assembly and a dependency audit on top of the fast
JavaScript checks. The lint stage uses Oxlint with its TypeScript 7-aware
`oxlint-tsgolint` backend.

ExUnit covers assign classification, encoding, compact patches, streams, slots,
SSR, forms/uploads, the installer, and the HTML test helper. Vitest covers
decoding and copy-on-write patching, registry and Vite validation, hydration,
root lifecycle, StrictMode, React compatibility, events/navigation,
forms/uploads, slots, reconnect, and package behavior. TypeScript strict checks
and the temporary packed-package consumer verify the public types and exact
runtime exports.

Property tests are discovered by normal `mix test` and `npm test`. Their fixed
seeds and bounded runs exercise Unicode and compact delimiters, patch
round-trips, immutable model equivalence, original-input preservation, changed
path cloning, and unchanged sibling reference retention. Focused commands are
listed in [Development](development.md).

## Real Phoenix browser tests

Run the Playwright suite after preparing the root and example dependencies:

```sh
npm run test:e2e:typecheck
npm run test:e2e
```

The config starts a dedicated Vite server and Phoenix test endpoint. It covers
props and local-state preservation, events and replies, direct `phx-*`
bindings, patch/navigate links, SSR without JavaScript, hydration, delayed
mount, disconnect/reconnect, conditional removal, lazy update/destroy races,
streams, validation, upload, multiple roots, portals, Context, transitions,
class/memo/forwardRef/useId/StrictMode behavior, third-party React components,
controlled and rich-text inputs, canvas/WebGL, React DevTools root discovery,
Error Boundaries, root error callbacks, and cleanup.

React-specific checks explicitly assert provider locality per root, portal
ownership and synthetic bubbling, `useId()` hydration stability, `memo` and
copy-on-write prop identity, `forwardRef`, transition scheduling,
`useSyncExternalStore` reconnect snapshots, balanced `StrictMode` effects, and
the earliest post-commit hydration window for built-in bridge hooks such as
`useEventReply`, `useLiveNavigation`, and `useLiveForm`.

The lifecycle cleanup flow covers conditional removal and LiveView navigation,
then checks that bridge subscriptions, effects, roots, and retained callback
probes return to zero. The lower-level deterministic stress test mounts and
destroys 1,000 roots and requires exact cleanup; optional heap delta is
diagnostic only, not a portable pass/fail threshold.

## Compatibility matrix

The package declarations and CI lanes define the supported initial range:

| Surface | Minimum lane | Latest lane |
| --- | --- | --- |
| Elixir / OTP | Elixir 1.20.0 / OTP 27.3.4.10 | Elixir 1.20.4 / OTP 29.0.5 |
| Phoenix | 1.8.0 exactly | newest release satisfying `~> 1.8` |
| Phoenix LiveView | 1.2.11 exactly | newest release satisfying `~> 1.2.11` |
| Node.js | 24.20.0 | 26.8.1 |
| React / ReactDOM | 19.0.0 | 19.2.8 |
| TypeScript | 7.0.2 | 7.0.2 |
| Vite | 8.0.0 | 8.2.2 |

The minimum BEAM lane unlocks the repository lock and resolves exact Phoenix
and LiveView floors. The latest lane unlocks and resolves the newest versions
inside the supported ranges. JavaScript unit/package checks and example builds
run on both Node lanes. The minimum JavaScript lane installs its matrix-selected
React, ReactDOM, TypeScript, and Vite versions without saving them and verifies
the resolved versions before testing. The real Chromium E2E suite runs on Node
24 to avoid duplicating identical browser coverage.

React 18, Phoenix 1.7, LiveView 0.x, CommonJS, and old package or namespace
surfaces are not compatibility targets. See [Limitations](limitations.md).

These floors are not all asserted as technical minima. React 19 is required by
the public root callback APIs used by this package. Phoenix LiveView 1.2.11 is
the tested lifecycle floor because the suite depends on the stale-diff rejoin
behavior fixed there. Elixir 1.20, Phoenix 1.8, Node.js 24, TypeScript 7, and
Vite 8 are conservative tested release-policy floors; lowering any of them
requires adding explicit CI lanes and evidence for that lower range.

## Benchmarks

Performance measurements are report-only and must never trade correctness for
a lower number:

```sh
mix run bench/performance.exs
npm run benchmark
```

The BEAM report compares full-snapshot and compact-patch bytes plus server
render/diff time for one nested-field change in a 1,000-item list and a separate
1,000-field form. It also reports item/metadata counts, compact bytes,
adapter-plus-serialization time, and serialization-only time for 10,000-item
canonical stream insert, update-only, and delete frames. Its injected SSR probe
measures the deterministic BEAM contract, not a JavaScript engine.

The JavaScript report compares full JSON parse with compact field patch
decode/apply for the large form, generic 10,000-op compact decode/apply,
10,000 stream insert/update/delete application, existing-root update with
destroy/remount, and 100 preserved updates with 100 root replacements. It
measures React SSR render separately from hydrate-through-commit and measures a
tagged lazy loader. When example production assets exist, it also requires the
`app.js -> lazy.js -> lazy-component.js` split and reports each file's bytes.

Build the example client assets first when running locally if the lazy split
must be included; otherwise that artifact-only report is explicitly skipped.
The manually dispatched `Benchmarks` workflow always performs the build and
records both raw reports in the job summary. Numbers vary by machine, runtime
warmup, and garbage collector, so there is no numeric regression threshold;
semantic invariants still fail.

For cross-version comparison against upstream `live_react`, use the temp-only
comparison harness instead of the shared worktree. It snapshots the current
repository, exports the pinned upstream GitHub commits, downloads the pinned
published npm tarball, and records machine-readable JSON plus a Markdown
summary:

```sh
npm run bench:upstream:prepare
npm run bench:upstream:run
```

The prepare step is the only networked step. It writes under the platform
temporary directory (`$TMPDIR/liveview-react-upstream-comparison` on macOS) by
default, builds only the temporary current snapshot, and never touches the
shared repository `dist/` directory. The offline run step fails closed if the
prepared manifest is missing or the pinned target revisions are absent.

The JSON report captures the local environment, warmup/sample counts,
per-sample timings, mean, standard deviation, variance, percentile summaries,
package size, the public client entry's transitive static module-graph bytes and
file count, and explicit `N/A` reasons for unsupported surfaces. Package and
client-graph measurements are captured from pristine packed/downloaded
artifacts before any temp-only compatibility rewriting. Comparable cases cover
mount, hydration, prop update, multi-root lifecycle, destroy/remount, SSR, and
stream transport when the shipped client supports it. Target adapters also
measure the event bridge, listener balance, and forced-GC heap delta when those
shipped surfaces can be normalized; otherwise the report records an explicit
`N/A` instead of inventing comparability.
