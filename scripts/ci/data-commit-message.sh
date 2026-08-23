#!/usr/bin/env bash
#
# Prints a commit subject naming the dates the staged rows are actually dated with.
#
# Rows are dated by the source's own published date, never the run date, so `date +%F` produced
# subjects that contradicted their own diff: a scrape firing before the source publishes carries the
# previous date, and the fund and reconcile paths backfill a window of older dates in one commit.
#
# Usage: data-commit-message.sh "chore: update NEPSE data"
set -euo pipefail

prefix="$1"

# No `mapfile`: macOS bash 3.2 lacks it, and this has to run on a laptop as well as the runner.
dates=$(
  git diff --cached -U0 -- data \
    | sed -n 's/^+\([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\),.*/\1/p' \
    | sort -u
)

count=$(printf '%s\n' "$dates" | grep -c . || true)
first=$(printf '%s\n' "$dates" | head -n 1)
last=$(printf '%s\n' "$dates" | tail -n 1)

case "$count" in
  # Header-only change (new symbol file): name no date rather than inventing one.
  0) echo "$prefix" ;;
  1) echo "$prefix for $first" ;;
  *) echo "$prefix for $first to $last ($count dates)" ;;
esac
