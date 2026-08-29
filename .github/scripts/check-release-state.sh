#!/usr/bin/env bash

set -euo pipefail

readonly package_version="$(node --print "require('./package.json').version")"
readonly encoded_version="$(node --print "encodeURIComponent(require('./package.json').version)")"
readonly temporary_root="$(mktemp -d)"
trap 'rm -rf "$temporary_root"' EXIT

request_status() {
  local output_file="$1"
  local request_url="$2"

  curl \
    --silent \
    --show-error \
    --connect-timeout 10 \
    --max-time 30 \
    --retry 3 \
    --retry-all-errors \
    --retry-delay 1 \
    --output "$output_file" \
    --write-out '%{http_code}' \
    "$request_url"
}

hex_status="$(
  request_status \
    "$temporary_root/hex-release.json" \
    "https://hex.pm/api/packages/liveview_react/releases/$encoded_version"
)"

npm_status="$(
  request_status \
    "$temporary_root/npm-release.json" \
    "https://registry.npmjs.org/liveview_react/$encoded_version"
)"

case "$hex_status" in
  200) hex_exists="true" ;;
  404) hex_exists="false" ;;
  *)
    echo "Hex registry returned HTTP $hex_status while checking liveview_react $package_version." >&2
    exit 1
    ;;
esac

case "$npm_status" in
  200) npm_exists="true" ;;
  404) npm_exists="false" ;;
  *)
    echo "npm registry returned HTTP $npm_status while checking liveview_react $package_version." >&2
    exit 1
    ;;
esac

{
  echo "hex_exists=$hex_exists"
  echo "npm_exists=$npm_exists"
} >>"$GITHUB_OUTPUT"

echo "Registry state for liveview_react $package_version: Hex=$hex_exists npm=$npm_exists"
