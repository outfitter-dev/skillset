#!/usr/bin/env bash
#
# bootstrap.sh - cold-start helper for Skillset repo lifecycle commands.
#
# Usage:
#   ./scripts/bootstrap.sh [repo|agent|codex|claude|doctor|teardown] [--force] [--update]
#   ./scripts/bootstrap.sh --force   # legacy alias for repo --force
#   ./scripts/bootstrap.sh --update  # legacy alias for repo --update

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
BUN_VERSION_FILE="$REPO_ROOT/.bun-version"

usage() {
  printf '%s\n' 'Usage: ./scripts/bootstrap.sh [repo|agent|codex|claude|cursor|doctor|teardown] [--force] [--update]

Commands:
  repo     Make this checkout runnable (default)
  agent    Repo bootstrap plus agent lifecycle diagnostics
  codex    Codex agent bootstrap with provider-specific root detection
  claude   Claude agent bootstrap with provider-specific root detection
  cursor   Cursor agent bootstrap with provider-specific root detection
  doctor   Diagnostics only; no install, cleanup, or mutation
  teardown Conservative cleanup of configured local artifacts only

Compatibility:
  ./scripts/bootstrap.sh --force
  ./scripts/bootstrap.sh --update
  ./scripts/bootstrap.sh sweep'
}

SUBCOMMAND="${1:-repo}"
case "$SUBCOMMAND" in
  repo|agent|codex|claude|cursor|doctor|sweep|teardown)
    ;;
  --force|--update)
    SUBCOMMAND="repo"
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  -*)
    ;;
  *)
    echo "Unknown bootstrap subcommand: $SUBCOMMAND" >&2
    usage >&2
    exit 2
    ;;
esac

# Bun writes its runtime transpiler cache to BUN_RUNTIME_TRANSPILER_CACHE_PATH,
# resolved relative to the current working directory. An inherited relative
# value therefore drops `<cwd>/bun/*.pile` into whatever directory bun runs in,
# including a clean repository checkout. Only two values are safe to honour: an
# absolute path, and `0`, bun's documented disable switch that
# scripts/test-sandbox.ts relies on. Anything else is replaced, because a
# `${VAR:-default}` fallback would not help here — the failure mode is a value
# that is set, just set to something relative.
case "${BUN_RUNTIME_TRANSPILER_CACHE_PATH:-}" in
  /*|0) ;;
  *) export BUN_RUNTIME_TRANSPILER_CACHE_PATH="${XDG_CACHE_HOME:-$HOME/.cache}/bun/transpiler" ;;
esac
# The shared global installation may be read as a bootstrap seed, but this
# repository must never install over it. The session interpreter is resolved
# into the version-scoped cache before any lifecycle command runs.
export PATH="${BUN_INSTALL:-$HOME/.bun}/bin:$PATH"
hash -r 2>/dev/null || true

cd "$REPO_ROOT"

if [[ ! -f "$BUN_VERSION_FILE" ]]; then
  echo "Error: Missing .bun-version at $BUN_VERSION_FILE" >&2
  exit 1
fi

read_pinned_bun_version() {
  tr -d '[:space:]' < "$BUN_VERSION_FILE"
}

pinned_version="$(read_pinned_bun_version)"
if [[ ! "$pinned_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: .bun-version must hold a three-part version" >&2
  exit 1
fi

cached_pinned_bun() {
  local platform arch candidate
  platform="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$platform" in
    darwin|linux) ;;
    *) return 1 ;;
  esac
  case "$arch" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64) arch="x64" ;;
    *) return 1 ;;
  esac
  candidate="$HOME/.cache/skillset/bun/$platform-$arch/$pinned_version/bin/bun"
  if [[ -x "$candidate" ]] && [[ "$("$candidate" --version 2>/dev/null || true)" == "$pinned_version" ]]; then
    printf '%s\n' "$candidate"
  else
    return 1
  fi
}

bootstrap_bun="$(cached_pinned_bun || command -v bun || true)"
bootstrap_version=""
if [[ -n "$bootstrap_bun" ]]; then
  bootstrap_version="$("$bootstrap_bun" --version 2>/dev/null || true)"
fi

case "$SUBCOMMAND" in
  doctor|sweep|teardown)
    if [[ -z "$bootstrap_version" ]]; then
      echo "Error: Bun is required for '$SUBCOMMAND' and will not be installed by that command." >&2
      exit 1
    fi
    # These paths never provision Bun, but their child checks still resolve
    # `bun` by PATH. A previously cached pin must remain usable without a
    # global install.
    export PATH="$(dirname "$bootstrap_bun"):$PATH"
    exec "$bootstrap_bun" "$SCRIPT_DIR/bootstrap/main.ts" "$@"
    ;;
esac

# An ambient Bun from another repository might be too old to parse the
# resolver itself. Bootstrap under the exact pin before asking it to load TS.
if [[ "$bootstrap_version" != "$pinned_version" ]]; then
  bootstrap_seed="$(mktemp -d "${TMPDIR:-/tmp}/skillset-bootstrap-bun.XXXXXX")"
  trap 'rm -rf -- "$bootstrap_seed"' EXIT
  echo "Installing Bun $pinned_version into a temporary Skillset bootstrap seed..." >&2
  # With no Bun on PATH, the upstream installer otherwise offers to append
  # PATH setup to a writable shell profile. This bootstrap owns neither it
  # nor the contributor's global install.
  curl -fsSL https://bun.sh/install | BUN_INSTALL="$bootstrap_seed" SHELL=/bin/sh bash -s -- "bun-v$pinned_version"
  bootstrap_bun="$bootstrap_seed/bin/bun"
  if [[ ! -x "$bootstrap_bun" ]]; then
    echo "Error: Bun installer produced no usable bootstrap interpreter" >&2
    exit 1
  fi
fi

pinned_bun="$("$bootstrap_bun" "$SCRIPT_DIR/bootstrap/resolve-runtime.ts")"
if [[ ! -x "$pinned_bun" ]] || [[ "$("$pinned_bun" --version)" != "$pinned_version" ]]; then
  echo "Error: Skillset could not resolve pinned Bun $pinned_version" >&2
  exit 1
fi
export PATH="$(dirname "$pinned_bun"):$PATH"
hash -r 2>/dev/null || true

# The temporary seed exists only for cold starts. The resolver has copied or
# installed the pinned interpreter into its durable cache before this exec.
if [[ -n "${bootstrap_seed:-}" ]]; then
  rm -rf -- "$bootstrap_seed"
  trap - EXIT
fi
exec "$pinned_bun" "$SCRIPT_DIR/bootstrap/main.ts" "$@"
