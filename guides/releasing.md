# Releasing

LiveViewReact publishes one version to two public registries. The Hex package
contains the built npm runtime, so a release starts only after both artifacts
are reproducible from the same commit.

## Maintainer prerequisites

The repository release environment must contain `HEX_API_KEY` and `NPM_TOKEN`.
Set the `LIVEVIEW_REACT_RELEASE_REPOSITORY` repository variable to the exact
GitHub `owner/repository` allowed to publish. At least two maintainers should be
able to review the release environment and recover its credentials; do not put
tokens in the repository, shell history, or generated files.

The public `package.json` repository must also match that GitHub repository
exactly. npm provenance requires this metadata; publication remains blocked
until the canonical repository owner and URL are known and configured. The
workflow retains token authentication for now but requests an OIDC identity and
publishes with `--provenance`. Move to npm trusted publishing before removing
`NPM_TOKEN`.

## Prepare the version

1. Choose a SemVer version and update `@version` in `mix.exs`, `version` in
   `package.json`, and the `liveview_react` dependency requirement in
   `lib/live_view_react/installer/package_json.ex`. The first two values must
   match exactly and the installer must use `^<version>`.
2. Refresh the npm lockfile through the normal package manager and update
   `CHANGELOG.md` with the public behavior and breaking changes.
3. Confirm required guides and public module/type documentation describe the
   exports in this release.
4. Run the full verification from [Testing](testing.md) on a clean branch.

Do not publish an npm-only or Hex-only version intentionally. There is no
compatibility promise between different release lines.

## Local artifact dry run

From the repository root:

```sh
npm run release:check
npm publish --dry-run --access public --ignore-scripts
```

The script installs locked dependencies; checks the clean-break boundary,
formatting, warnings, Credo, ExUnit, JavaScript formatting/lint/types/tests;
then runs both artifact checks. `check-package-identity.sh` verifies both public
names are `liveview_react`, the Mix and npm versions match, and the installer
generates the matching npm dependency requirement. `pack:check`
builds the package, checks the npm file list and exact runtime export map, and
compiles a temporary consumer. `check-hex-package.sh` unpacks a temporary Hex
artifact and verifies its required BEAM, npm, documentation, license, and
provenance files. The final command exercises npm's publish path without
running the prepack script again or publishing to the registry.

Inspect the two dry-run file lists. Generated npm source maps, private test
fixtures, credentials, dependency trees, and development-only sources must not
leak into either artifact.

## Tag and hosted dry run

Commit the version and changelog, merge through the normal review process, and
create the exact annotated tag `v<version>` on the release commit. Do not move a
published version tag.

Run the `Release` workflow with `publish` left false first. Its `dry-run` job
repeats compile, lint, ExUnit, Vitest, package identity, Hex unpacking, npm
consumer checks, and `npm publish --dry-run`. One required job builds the
example's production browser and SSR bundles, then separately runs the real
Phoenix Chromium suite with the instrumented test endpoint and Vite development
server against the repository-built runtime. This proves both production
bundles compile and the browser lifecycle suite passes; it does not serve the
built production browser bundle to Chromium. Another job creates a new
application with a pinned `phx_new`, runs the public Igniter installer from the
unpacked Hex artifact, installs the npm tarball as a normal package directory,
and verifies the generated application's tests, TypeScript, production browser
build, SSR build, and a real SSR render. Resolve every failure in a new commit
and version/tag; never bypass a failed check.

## Publish

Select the exact `v<version>` tag in the `Release` workflow, set `publish` to
true, and enter `liveview_react` as the confirmation value. The protected
release job verifies:

- the workflow ref equals the synchronized `v<version>` tag;
- the current repository matches `LIVEVIEW_REACT_RELEASE_REPOSITORY`;
- the artifact dry-run, example-build/browser, and fresh-consumer jobs
  all passed;
- both package identities and artifacts still match; and
- whether that version already exists on Hex or npm.

The job publishes Hex first and npm second. Registry publication is not
atomic. If one succeeds and the other fails, do not change the version or
overwrite the published artifact. Correct the external failure and rerun the
same tagged workflow: the registry-state check skips the existing artifact and
publishes only the missing one.

After success, verify the version and README on both registries, install it in
a fresh Phoenix application, run the generated demo, and confirm browser and
production SSR builds. Drafting repository release notes is a separate
maintainer action; registry publication does not create or push commits, tags,
or GitHub releases.
