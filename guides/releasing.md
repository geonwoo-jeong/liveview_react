# Releasing

LiveViewReact uses [Release Please](https://github.com/googleapis/release-please)
as the only release version owner. It maintains the release PR and changelog,
creates the `v<version>` tag and GitHub release, and then lets the same workflow
validate and publish that exact source to Hex.

## Maintainer prerequisites

Configure these GitHub repository settings before the first release:

- set workflow permissions to read and write
- allow GitHub Actions to create and approve pull requests
- set `LIVEVIEW_REACT_RELEASE_REPOSITORY` to the exact `owner/repository`
- create the protected `release` environment and store an `api:write` Hex key
  in its `HEX_API_KEY` secret

If you want regular GitHub Actions workflows to run on release PRs created by
Release Please, configure the action with a personal access token instead of
the default `GITHUB_TOKEN`. The repository can still publish to Hex without
that extra token because the publish job runs in the same workflow invocation
that created the GitHub release.

At least two maintainers should be able to review the release environment and
recover its credentials. Do not put tokens in the repository, shell history,
or generated files.

## Synchronized versions

The source version remains synchronized across:

- `.release-please-manifest.json`
- `mix.exs`
- `package.json`
- the root `package-lock.json`
- the linked LiveViewReact entry in
  `liveview_react_examples/assets/package-lock.json`

The Node release strategy updates `package.json` and the root lockfile. A
generic annotation updates `mix.exs`, and a targeted JSON updater changes the
example lockfile entry. Both the test suite and the publish job reject version
drift before a Hex upload.

The manifest starts from the unpublished `0.1.0` development snapshot. The
automation bootstrap commit carries the one-time `Release-As: 1.0.0` footer,
so the first release PR changes every managed version to `1.0.0`. Future
release PRs derive their version from conventional commits:

- `fix:` bumps patch
- `feat:` bumps minor
- `feat!:` and other breaking changes bump major

Do not manually edit release versions, keep a persistent `release-as` setting,
or create release tags. Review the synchronized files in the generated release
PR instead.

## Local verification

From the repository root:

```sh
mix deps.get
mix quality_full
mix docs --warnings-as-errors --output _build/docs
mix run scripts/check_exdoc_links.exs _build/docs
npm ci
npm run quality:ci
mix hex.build --output _build/liveview_react.tar
```

These commands install locked dependencies; run formatting, warnings, Credo,
ExUnit, Dialyzer, API documentation generation plus HTML/EPUB internal-link
validation, JavaScript formatting/lint/types/tests, package assembly, and
dependency audits; and then build the exact JS payload that will ship inside
the Hex artifact.

Inspect the Hex artifact file list. Generated source maps, private test
fixtures, credentials, dependency trees, and development-only sources must not
leak into the shipped artifact.

## Release path

Merge releasable work into `main` using conventional commits. `release-please`
keeps one release PR open and refreshes it as more commits land. When you merge
that release PR, the `Release` workflow:

- creates the `v<version>` Git tag and GitHub release
- checks out the exact tagged commit
- reruns the package dry run and browser E2E lanes on that tagged source
- verifies all managed versions, the release tag, and the release commit SHA
- runs `mix hex.publish --yes` with `HEX_API_KEY` exposed only to that step

The publish step skips upload when the version is already present on Hex, which
makes reruns idempotent after a successful publish. If publication fails, fix
the external problem and use **Re-run failed jobs** on the original workflow
run; a new manual run will not recreate the already-created release output.

After success, verify the version and README on Hex, install it in a fresh
Phoenix application, run the generated demo, and confirm browser and
production SSR builds.
