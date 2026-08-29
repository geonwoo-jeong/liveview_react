#!/usr/bin/env bash

set -euo pipefail

readonly legacy_pattern='LiveReact|live_react|live-react|(^|[^[:alnum:]_])(ReactHook|getHooks|getRender|useLiveReact)([^[:alnum:]_]|$)|liveview_react/vite-plugin|LiveViewReact\.Reload'

legacy_match=""

while IFS= read -r matched_line; do
  case "$matched_line" in
    mix.exs:*https://github.com/mrdotb/live_react*) continue ;;
  esac

  legacy_match="$matched_line"
  break
done < <(
  git grep --line-number --extended-regexp "$legacy_pattern" -- \
    . \
    ':(exclude).github/scripts/check-clean-break.sh' \
    ':(exclude)THIRD_PARTY_NOTICES.md' \
    ':(exclude)UPGRADE_BASELINE.md' \
    ':(exclude)UPSTREAM.md' \
    ':(exclude,glob)docs/architecture/**' \
    ':(exclude,glob)docs/research/**' || true
)

if [[ -n "$legacy_match" ]]; then
  echo "Legacy LiveReact implementation name is not allowed: $legacy_match" >&2
  exit 1
fi

for implementation_file in \
  "lib/live_view_react.ex" \
  "assets/js/liveview_react/hooks.ts"; do
  if [[ -f "$implementation_file" ]] && grep -nF 'data-name' "$implementation_file"; then
    echo "Legacy data-name transport is not allowed in $implementation_file." >&2
    exit 1
  fi
done

legacy_path=""

while IFS= read -r tracked_path; do
  if [[ ! -e "$tracked_path" && ! -L "$tracked_path" ]]; then
    continue
  fi

  case "$tracked_path" in
    .github/scripts/check-clean-break.sh | \
      THIRD_PARTY_NOTICES.md | \
      UPGRADE_BASELINE.md | \
      UPSTREAM.md | \
      docs/architecture/* | \
      docs/research/*) continue ;;
  esac

  if [[ "$tracked_path" == assets/copy/* || "$tracked_path" == */vite-plugin.* || "$tracked_path" =~ $legacy_pattern ]]; then
    legacy_path="$tracked_path"
    break
  fi
done < <(git ls-files --cached --others --exclude-standard)

if [[ -n "$legacy_path" ]]; then
  echo "Legacy LiveReact implementation path is not allowed: $legacy_path" >&2
  exit 1
fi
