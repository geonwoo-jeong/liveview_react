# Third-party notices

This file records source incorporated into `liveview_react` and distinguishes
it from repositories consulted only as engineering references. It supplements,
and does not replace, the license terms in `LICENSE.md`.

## Incorporated source

### LiveReact

- Project: [`mrdotb/live_react`](https://github.com/mrdotb/live_react)
- Imported revision:
  [`6e392bd4635a47a2bad445cadd3fb8917e573506`](https://github.com/mrdotb/live_react/commit/6e392bd4635a47a2bad445cadd3fb8917e573506)
- License: MIT
- Copyright: Copyright (c) 2024 Mrdotb
- Use: source and Git-history baseline for the complete repository

The imported Elixir library, JavaScript package, installer templates, tests,
example application, documentation, build metadata, and CI files are retained
or modified as the foundation of `liveview_react`. The full applicable MIT
license text and original copyright notice remain in `LICENSE.md` and must be
included in all copies or substantial portions of the software.

The continuation targets the `LiveViewReact.*` Elixir namespace as a clean
break and does not retain `LiveReact.*` or other legacy public surfaces as
compatibility aliases. Renamed or replaced modules remain derived from the
imported source wherever upstream expression is retained.

## Reference-only projects

Phase 0 inspected the following projects but copied no source code, generated
artifact, or substantial documentation text from them. They are listed for
traceability, not as incorporated dependencies or derivative source.

| Project                                                                                       | Frozen revision                                                                                                                                     | License and copyright                      | Reference purpose                                          |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| [`Valian/live_vue`](https://github.com/Valian/live_vue)                                       | [`6ea7b146d66eac54506f196cc0982229083a7755`](https://github.com/Valian/live_vue/commit/6ea7b146d66eac54506f196cc0982229083a7755)                    | MIT; Copyright (c) 2024 Jakub Skalecki     | Bridge API and developer-experience comparison             |
| [`woutdp/live_svelte`](https://github.com/woutdp/live_svelte)                                 | [`01ac55d87a2b58608b7790ea717d2eb8a56bdfb2`](https://github.com/woutdp/live_svelte/commit/01ac55d87a2b58608b7790ea717d2eb8a56bdfb2)                 | MIT; Copyright (c) 2023 Wout De Puysseleir | Lifecycle, stable identity, installer, and test comparison |
| [`dcza/live-react-islands`](https://github.com/dcza/live-react-islands)                       | [`b142ad59af122cdca9fdd9e7ac0f50e9283d4a99`](https://github.com/dcza/live-react-islands/commit/b142ad59af122cdca9fdd9e7ac0f50e9283d4a99)            | MIT; Copyright (c) 2026 David Czaplinski   | UX and failure-pattern comparison                          |
| [`phoenixframework/phoenix_live_view`](https://github.com/phoenixframework/phoenix_live_view) | [`eba3493126fe4286df94d46d14bb3f35eed5b2f5`](https://github.com/phoenixframework/phoenix_live_view/commit/eba3493126fe4286df94d46d14bb3f35eed5b2f5) | MIT; Copyright (c) 2018 Chris McCord       | Authoritative lifecycle and public client API reference    |

Their MIT license texts are available in their respective repositories. If a
future change copies or adapts material from one of them, that same change must
move the project into the incorporated-source section, identify every affected
file or artifact, and preserve the applicable copyright and license notice.

## Maintenance

Update this file in the same commit whenever external source is added, removed,
updated, generated, ported, or substantially adapted. The entry must include:

- the canonical project URL and author or copyright holder;
- the exact commit SHA or released version used;
- the license and any required notice text;
- the `liveview_react` files or artifacts containing that material;
- whether the material was copied, mechanically ported, adapted, or generated.

Pure behavioral research and independent implementation should remain in the
reference-only section or in `UPSTREAM.md`; do not mislabel it as incorporated
source.

The Hex and npm manifests include `THIRD_PARTY_NOTICES.md` alongside
`LICENSE.md`, and the artifact checks require both files. Future release
archives must also include any additional license texts required by
incorporated dependencies.
