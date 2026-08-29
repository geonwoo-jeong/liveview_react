#!/usr/bin/env bash

set -euo pipefail

beam_package_identity="$(elixir -e 'Mix.start(); Code.require_file("mix.exs"); config = LiveViewReact.MixProject.project(); package = config[:package] || []; IO.write("#{package[:name] || config[:app]}@#{config[:version]}")')"
beam_package_name="${beam_package_identity%%@*}"
beam_package_version="${beam_package_identity#*@}"
npm_package_name="$(node --print "require('./package.json').name")"
npm_package_version="$(node --print "require('./package.json').version")"

if [[ "$beam_package_name" != "liveview_react" ]]; then
  echo "Unexpected Hex package name: $beam_package_name" >&2
  exit 1
fi

if [[ "$npm_package_name" != "liveview_react" ]]; then
  echo "Unexpected npm package name: $npm_package_name" >&2
  exit 1
fi

if [[ "$beam_package_version" != "$npm_package_version" ]]; then
  echo "Hex version $beam_package_version does not match npm version $npm_package_version." >&2
  exit 1
fi

if [[ "${LIVEVIEW_REACT_REQUIRE_VERSION_TAG:-false}" == "true" ]]; then
  readonly expected_ref="refs/tags/v$beam_package_version"
  readonly expected_repository="${LIVEVIEW_REACT_RELEASE_REPOSITORY:-}"

  if [[ "${GITHUB_REF:-}" != "$expected_ref" ]]; then
    echo "Publication requires $expected_ref; received ${GITHUB_REF:-<none>}." >&2
    exit 1
  fi

  if [[ -z "$expected_repository" ]]; then
    echo "Set the LIVEVIEW_REACT_RELEASE_REPOSITORY repository variable before publishing." >&2
    exit 1
  fi

  if [[ "${GITHUB_REPOSITORY:-}" != "$expected_repository" ]]; then
    echo "Publication is not allowed from ${GITHUB_REPOSITORY:-<none>}; expected $expected_repository." >&2
    exit 1
  fi
fi

echo "Verified liveview_react $beam_package_version package identity."
