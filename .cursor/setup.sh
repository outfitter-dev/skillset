#!/usr/bin/env bash
#
# setup.sh — Cursor Cloud Agent environment adapter for Skillset.
#
# Thin wrapper around the shared repo bootstrap that only adds what the Cursor
# Cloud Agent VM specifically needs. The shared `scripts/bootstrap.sh cursor`
# owns the portable work (install the pinned Bun, install workspace
# dependencies, normalize tracked checkout modes). This script then makes `bun`
# and a modern `node` resolvable ahead of the Cloud Agent execution-daemon PATH
# shims.
#
# Why the shims matter: the agent runtime prepends `/exec-daemon` to PATH, and
# its bundled `node` (v22.14.0) is older than the TypeScript-config loader
# requirement (Node ^20.19.0 || >=22.18.0). That older `node` shadows the
# image's nvm Node and makes Oxlint/Oxfmt fail to load `oxlint.config.ts` and
# `oxfmt.config.ts`, which breaks `ultracite:check` and `ultracite:fix`. `bun`
# is also absent from the default agent PATH. Symlinking both into
# `/usr/local/cargo/bin` (writable and ahead of `/exec-daemon` on PATH) fixes
# resolution. This is a Cursor-cloud-VM-specific accommodation, so it lives here
# rather than in the portable, multi-provider shared bootstrap.
#
# Idempotent: safe to run on every install.

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# 1. Portable setup: install Bun + workspace dependencies via the shared,
#    multi-provider bootstrap. This is the same entry contributors use.
./scripts/bootstrap.sh cursor

BUN_BIN="${BUN_INSTALL:-$HOME/.bun}/bin"

# 2. Expose Bun and a compatible Node ahead of platform PATH shims.
PRIORITY_BIN="/usr/local/cargo/bin"

if [[ ! -d "$PRIORITY_BIN" || ! -w "$PRIORITY_BIN" ]]; then
  echo "setup.sh: priority bin dir '$PRIORITY_BIN' is not writable; cannot install required PATH shims." >&2
  exit 1
fi

link_priority() { # link_priority <target> <link-name>
  local target="$1" name="$2"
  if [[ ! -x "$target" ]]; then
    echo "setup.sh: required executable '$target' is unavailable." >&2
    return 1
  fi
  ln -sf "$target" "$PRIORITY_BIN/$name"
  echo "setup.sh: linked $PRIORITY_BIN/$name -> $target" >&2
}

# Bun (and its bunx alias) are installed under BUN_INSTALL but not on the
# default agent PATH.
link_priority "$BUN_BIN/bun" bun
if [[ -e "$BUN_BIN/bunx" ]]; then
  link_priority "$BUN_BIN/bunx" bunx
else
  link_priority "$BUN_BIN/bun" bunx
fi

# Newest installed nvm Node satisfies the Oxlint/Oxfmt TS-config loader
# (Node ^20.19.0 || >=22.18.0).
node_satisfies() { # node_satisfies <node-binary>
  "$1" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit((major === 20 && minor >= 19) || major > 22 || (major === 22 && minor >= 18) ? 0 : 1)'
}

newest_node="$(ls -d "$HOME"/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
if [[ -z "$newest_node" ]]; then
  echo "setup.sh: no nvm Node found; Node ^20.19.0 || >=22.18.0 is required for the Oxlint/Oxfmt TS config." >&2
  exit 1
fi

if ! node_satisfies "$newest_node"; then
  echo "setup.sh: newest nvm Node ($("$newest_node" --version 2>/dev/null || echo unknown)) does not satisfy Node ^20.19.0 || >=22.18.0." >&2
  exit 1
fi
link_priority "$newest_node" node

# Do not report readiness until the installed shims satisfy the tools' runtime
# contract. This catches missing targets and stale or broken links explicitly.
"$PRIORITY_BIN/bun" --version >/dev/null
node_satisfies "$PRIORITY_BIN/node"

echo "setup.sh: environment ready (bun $("$PRIORITY_BIN/bun" --version), node $("$PRIORITY_BIN/node" --version))." >&2
