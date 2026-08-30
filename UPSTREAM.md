# Upstream provenance and synchronization policy

Status: imported baseline frozen; clean-break implementation active
Snapshot date: 2026-08-30 (Asia/Tokyo)

`liveview_react` starts from the Git history and source tree of
[`mrdotb/live_react`](https://github.com/mrdotb/live_react). The imported
baseline is the `main` branch at commit
[`6e392bd4635a47a2bad445cadd3fb8917e573506`](https://github.com/mrdotb/live_react/commit/6e392bd4635a47a2bad445cadd3fb8917e573506),
licensed under the MIT License. The repository keeps that project's commit
history, and its Git remote is named `upstream`.

The public Hex and npm package name for this continuation is `liveview_react`,
and its target Elixir namespace is `LiveViewReact.*`. This is a clean break:
the project does not preserve the imported `LiveReact.*` namespace or other
legacy public surfaces as compatibility aliases. Renaming or replacing those
surfaces does not change their source provenance.

## Derivative scope

Unless a later commit records a different origin, all files retained or
modified from commit `6e392bd` are derivatives of `mrdotb/live_react`. This
includes:

- the imported `LiveReact` Elixir module and `LiveReact.*` modules under
  `lib/live_react/`, including their later `LiveViewReact.*` replacements;
- the Mix task, package metadata, build configuration, and release templates;
- the JavaScript client, Context, Link, patch protocol, SSR entry point, Vite
  plugin, types, and tests under `assets/`;
- the Elixir tests under `test/`;
- the example Phoenix application under `live_react_examples/`;
- the documentation and CI configuration imported with the baseline.

New `liveview_react` work may replace substantial parts of those files over
time. Modified files remain derived from the upstream baseline where upstream
expression is retained. The original MIT notice in `LICENSE.md` must therefore
remain in source distributions and published packages.

Phase 0 research and architecture documents are newly authored for
`liveview_react`. They analyze the imported implementation and the frozen
references below but do not copy their source code.

## Frozen design references

These repositories were inspected at exact revisions to compare public APIs,
lifecycle behavior, installers, tests, and failure modes:

| Repository                                                                                    | Commit                                                                                                                                              | License | Phase 0 use                                                  |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------ |
| [`Valian/live_vue`](https://github.com/Valian/live_vue)                                       | [`6ea7b146d66eac54506f196cc0982229083a7755`](https://github.com/Valian/live_vue/commit/6ea7b146d66eac54506f196cc0982229083a7755)                    | MIT     | Design and developer-experience reference only               |
| [`woutdp/live_svelte`](https://github.com/woutdp/live_svelte)                                 | [`01ac55d87a2b58608b7790ea717d2eb8a56bdfb2`](https://github.com/woutdp/live_svelte/commit/01ac55d87a2b58608b7790ea717d2eb8a56bdfb2)                 | MIT     | Lifecycle, identity, installer, and testing reference only   |
| [`dcza/live-react-islands`](https://github.com/dcza/live-react-islands)                       | [`b142ad59af122cdca9fdd9e7ac0f50e9283d4a99`](https://github.com/dcza/live-react-islands/commit/b142ad59af122cdca9fdd9e7ac0f50e9283d4a99)            | MIT     | UX and failure-pattern reference only                        |
| [`phoenixframework/phoenix_live_view`](https://github.com/phoenixframework/phoenix_live_view) | [`eba3493126fe4286df94d46d14bb3f35eed5b2f5`](https://github.com/phoenixframework/phoenix_live_view/commit/eba3493126fe4286df94d46d14bb3f35eed5b2f5) | MIT     | Authoritative public lifecycle and client API reference only |

No code, generated artifact, or substantial documentation text from these four
design references was copied into `liveview_react` during Phase 0. Similar
concepts are independently specified against public behavior. In particular,
`live-react-islands` is not an implementation base: its shared hidden root,
portal renderer, global state, and stateful component DSL are outside this
project's runtime model.

## Upstream synchronization strategy

The frozen Phase 0 commit is the comparison base for the implementation
series. Upstream changes are not pulled implicitly and version research does
not move the source baseline.

For an intentional synchronization:

1. Fetch the `upstream` remote and record both the previous and candidate exact
   commit SHAs.
2. Review the entire upstream commit range for public API, protocol, lifecycle,
   dependency, test, and license changes.
3. Integrate on a dedicated synchronization branch. Prefer selective commits or
   a clearly identified merge when the histories still align; do not reset or
   rewrite the public `liveview_react` history to match upstream.
4. Resolve conflicts in favor of the documented `liveview_react` product
   scope, package and `LiveViewReact.*` namespace, clean-break migration policy,
   and one-component/one-root runtime invariant.
5. Run the relevant Elixir, JavaScript, SSR, example, and end-to-end checks, and
   document any intentional behavior change.
6. Update the frozen SHA and relationship notes in this file, the research
   baseline, and `THIRD_PARTY_NOTICES.md` in the same reviewed change.

Upstream fixes may also be independently reimplemented. The change must say
whether it is an original implementation, a mechanical port, or an adaptation;
the latter two require file-level provenance and the applicable copyright and
license notice.

## Notice update rule

Any change that copies, ports, adapts, vendors, or generates a substantial
portion from an external project must update `THIRD_PARTY_NOTICES.md` before it
is merged or released. Record the project and author, canonical URL, exact
commit or released version, license, affected files or generated artifacts, and
the nature of the reuse. Preserve required license text and copyright notices
in source and package artifacts.

Reading documentation, comparing observable behavior, or independently
implementing an idea does not by itself create a copied-code entry. Such a
reference may still be recorded here for engineering traceability, as the
Phase 0 references are.
