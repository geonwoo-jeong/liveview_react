#!/usr/bin/env bash

set -euo pipefail

readonly temporary_root="$(mktemp -d)"
readonly package_root="$temporary_root/package"
trap 'rm -rf "$temporary_root"' EXIT

mix hex.build --unpack --output "$package_root"

required_files=(
  "dist/index.js"
  "dist/index.d.ts"
  "dist/server.js"
  "dist/server.d.ts"
  "dist/vite.js"
  "dist/vite.d.ts"
  "lib/live_view_react.ex"
  "package.json"
  "README.md"
  "LICENSE.md"
  "THIRD_PARTY_NOTICES.md"
  "UPSTREAM.md"
)

for required_file in "${required_files[@]}"; do
  if [[ ! -f "$package_root/$required_file" ]]; then
    echo "Hex package is missing $required_file." >&2
    exit 1
  fi
done

if [[ -e "$package_root/assets/js" ]]; then
  echo "Hex package must not include JavaScript source files." >&2
  exit 1
fi

unexpected_dist_file="$(
  find "$package_root/dist" -type f \
    \( \
      -path '*/tests/*' -o \
      -name '*.bench.*' -o \
      -name '*.test-support.*' -o \
      -name '*.test.*' \
    \) \
    -print -quit
)"

if [[ -n "$unexpected_dist_file" ]]; then
  echo "Hex package contains a development-only artifact: $unexpected_dist_file" >&2
  exit 1
fi

node --eval '
  const manifest = require(process.argv[1]);
  if (manifest.name !== "liveview_react") {
    throw new Error(`Unexpected npm package name in Hex artifact: ${manifest.name}`);
  }
' "$package_root/package.json"
