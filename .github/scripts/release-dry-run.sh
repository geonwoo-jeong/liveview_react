#!/usr/bin/env bash

set -euo pipefail

readonly repository_root="$(git rev-parse --show-toplevel)"
readonly release_docs_root="$(mktemp -d)"
readonly release_mix_environment="test"

cleanup() {
  rm -rf -- "$release_docs_root"
}

trap cleanup EXIT

if [[ ! -f "$repository_root/mix.exs" || ! -f "$repository_root/package.json" ]]; then
  echo "Run the release dry-run from the liveview_react repository." >&2
  exit 1
fi

cd "$repository_root"

.github/scripts/check-clean-break.sh

MIX_ENV=dev mix deps.get
MIX_ENV="$release_mix_environment" mix deps.get
npm ci

MIX_ENV="$release_mix_environment" mix deps.unlock --check-unused
MIX_ENV="$release_mix_environment" mix format --check-formatted
MIX_ENV=dev mix compile --force --warnings-as-errors
MIX_ENV="$release_mix_environment" mix compile --force --warnings-as-errors
MIX_ENV="$release_mix_environment" mix credo --strict
MIX_ENV="$release_mix_environment" mix test
MIX_ENV=dev mix docs --warnings-as-errors --output "$release_docs_root"

npm run format:check
npm run lint
npm run typecheck
npm test
npm run pack:check

.github/scripts/check-package-identity.sh
.github/scripts/check-hex-package.sh

echo "liveview_react release dry-run passed without publishing to Hex or npm."
