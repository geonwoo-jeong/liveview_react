#!/usr/bin/env bash

set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "Usage: $0 ELIXIR_REPORT JAVASCRIPT_REPORT" >&2
  exit 1
fi

readonly elixir_report="$1"
readonly javascript_report="$2"
readonly summary_file="${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"

append_report() {
  local -r heading="$1"
  local -r report_file="$2"

  printf '### %s\n\n```text\n' "$heading" >>"$summary_file"
  if [[ -f "$report_file" ]]; then
    sed -n '1,400p' "$report_file" >>"$summary_file"
  else
    printf 'Benchmark did not produce a report.\n' >>"$summary_file"
  fi
  printf '```\n\n' >>"$summary_file"
}

printf '## LiveViewReact benchmark report\n\n' >>"$summary_file"
printf 'This workflow records measurements without enforcing regression thresholds.\n\n' >>"$summary_file"
append_report "Elixir" "$elixir_report"
append_report "JavaScript" "$javascript_report"
