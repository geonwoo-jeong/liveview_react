# Releasing

LiveViewReact publishes one Hex package containing the built JavaScript runtime
and package metadata. A release starts only after the Hex artifact and its
bundled JS outputs are reproducible from the same commit.

## Maintainer prerequisites

The repository release environment must contain `HEX_API_KEY`. Set the
`LIVEVIEW_REACT_RELEASE_REPOSITORY` repository variable to the exact GitHub
`owner/repository` allowed to publish. At least two maintainers should be able
to review the release environment and recover its credentials; do not put
tokens in the repository, shell history, or generated files.

## Prepare the version

1. Choose a SemVer version and update `@version` in `mix.exs` and `version` in
   `package.json`. These values must match exactly.
2. Refresh the npm lockfile through the normal package manager and update
   `CHANGELOG.md` with the public behavior and breaking changes.
3. Confirm required guides and public module/type documentation describe the
   exports in this release.
4. Run the full verification from [Testing](testing.md) on a clean branch.

Do not publish a Hex version whose bundled `dist/` output or `package.json`
does not match the tagged commit.

## Local artifact dry run

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

## Tag and hosted dry run

Commit the version and changelog, merge through the normal review process, and
create the exact annotated tag `v<version>` on the release commit. Do not move a
published version tag. Local docs default source links to `main`, CI links to
the checked-out commit SHA, and the hosted HexDocs release links to the exact
version tag selected by the publish job.

Run the `Release` workflow with `publish` left false first. Its `dry-run` job
repeats compile, lint, ExUnit, API documentation rendering plus link
validation, Vitest, package assembly, and a credential-free `mix hex.build`. One
required job builds the
example's production browser and SSR bundles, then separately runs the real
Phoenix Chromium suite with the instrumented test endpoint and Vite development
server against the repository-built runtime. This proves both production
bundles compile and the browser lifecycle suite passes; it does not serve the
built production browser bundle to Chromium. Resolve every failure in a new
commit and version/tag; never bypass a failed check.

## Publish

Select the exact `v<version>` tag in the `Release` workflow, set `publish` to
true, and enter `liveview_react` as the confirmation value. The protected
release job verifies:

- the workflow ref equals the synchronized `v<version>` tag;
- the current repository matches `LIVEVIEW_REACT_RELEASE_REPOSITORY`;
- the artifact dry-run and example-build/browser jobs both passed; and
- the package metadata matches the selected tag.

When the version is not already present on Hex, the protected job runs an
authenticated `mix hex.publish --dry-run --yes` immediately before the real
publish command. This keeps the credential-free dry-run job safe while still
exercising Hex's complete local publication checks before upload.

The job publishes Hex only. If publication fails after the tag is cut, correct
the external failure and rerun the same tagged workflow.

After success, verify the version and README on Hex, install it in a fresh
Phoenix application, run the generated demo, and confirm browser and
production SSR builds. Drafting repository release notes is a separate
maintainer action; registry publication does not create or push commits, tags,
or GitHub releases.
