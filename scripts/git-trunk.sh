#!/usr/bin/env bash
#
# git-trunk.sh - print the remote trunk ref (e.g. origin/main).
#
# Push-range gates (lefthook pre-push, skillset:check:ci:report) diff against the
# remote default branch. Resolving origin/HEAD instead of hardcoding the name
# keeps them correct if the default branch ever changes. `git clone` sets
# origin/HEAD; `git remote set-head origin --auto` repairs it when missing.
set -euo pipefail

if ref="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD)"; then
  printf '%s\n' "$ref"
else
  printf 'origin/main\n'
fi
