---
slug: global-xdg-managed-installs-and-sync
title: Global / XDG Managed Installs and Sync
status: draft
created: 2026-06-04
updated: 2026-07-21
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1]
amends: [8]
---

# ADR: Global / XDG Managed Installs and Sync

Status: design. SET-362 binds the storage and activation ownership described
here, but no global-workspace, install, sync, uninstall, or activation command
is implemented. This record remains a draft until that workflow has executable
contract evidence.

## Context

Let Skillset optionally manage skills/plugins for a user *outside* a single
content repo — a global loadout — without ever turning `skillset build` into an
activation step. The hard line from the tenets: **build output does not imply
trust.** Anything that creates provider discovery entries is a separate,
explicit, opt-in workflow; provider settings and trust remain outside that
workflow.

## Decision

Global Skillset source and generated output use separate Skillset-owned XDG
roots. A future explicit user-scope workflow may build that source without
activating it. Only future `install` and `sync` commands may manage provider
discovery, and neither command may grant trust or edit provider settings.

## Where global state lives

Follow XDG with distinct Skillset-owned paths, never provider configuration
directories:

| Kind | Canonical path | Authority |
| --- | --- | --- |
| Global workspace | `$XDG_DATA_HOME/skillset/source/` | Root `skillset.yaml` plus the normal flat `.skillset/` source tree. |
| Generated projection | `$XDG_DATA_HOME/skillset/build/` | Reproducible provider output and its lock; never source truth and never active merely because it exists. |
| Preferences | `$XDG_CONFIG_HOME/skillset/config.yaml` | User-scope Skillset preferences; not provider settings or trust. |
| Rebuildable data | `$XDG_CACHE_HOME/skillset/` | Transient caches using the existing XDG fallback rules. |
| Activation ownership | `$XDG_STATE_HOME/skillset/activations.json` | Durable ledger of provider-specific activations created by Skillset. |

The XDG defaults are `~/.local/share`, `~/.config`, `~/.cache`, and
`~/.local/state`. Unset, empty, or relative XDG variables use those documented
home-relative defaults.

ADR-0008 historically proposed `~/.skillset/src` as a possible user source
root. That proposal shares the now-retired `.skillset/src` workspace topology;
current source loading rejects that nested layout. A later internal setup API
uses `~/.skillset/source` as its default global setup path, but no public
user-scope command or discovery contract owns it. Neither path is canonical,
auto-discovered, or migrated. Any future migration must be separately invoked,
preview-first, and reversible; this decision adds no compatibility lookup.

Ordinary source and build workflows may manage only Skillset-owned XDG paths.
They may not write `~/.claude/`, `~/.codex/`, `~/.cursor/`, marketplaces, or
[skills.sh](https://skills.sh) state. The bounded provider-discovery exception
belongs only to the future activation workflow below.

## Global standalone vs plugin-bound output

- **Global standalone skills**: built from the global `.skillset/skills/` into
  provider roots beneath `$XDG_DATA_HOME/skillset/build/`. These are the
  natural fit for "I want this skill everywhere" without a marketplace.
- **Plugin-bound output**: a global `.skillset/plugins/<name>/` still builds a
  full plugin repo (manifest + companions) beneath the build root. The
  generated shape stays target-native and reproducible.

The build contract is unchanged: the user-scope workspace is an ordinary
source root with a separate configured output location. Determinism and
lockfiles apply identically.

Current commands continue to resolve repo-local source by default and accept
only their existing explicit root selection. They do not fall back to the
global workspace. A future user-scope entry point must select the canonical
global workspace explicitly; this draft does not reserve a public flag or
command spelling. In particular, removed `create --global` behavior does not
return.

## Install / sync / trust boundaries

Three separate verbs, sharply divided from `build`:

| Verb | What it does | Touches user runtime? |
| --- | --- | --- |
| `build` (existing) | source → generated output under managed roots | **No** |
| `install` (future, opt-in) | create one provider-specific discovery activation from a reviewed build | **Yes — explicit and bounded** |
| `sync` (future, opt-in) | refresh an activation already owned by the ledger from reviewed generated output | **Yes — explicit and bounded** |

Rules:

- `build` never installs, trusts, symlinks, or edits user config. (Unchanged.)
- `install`/`sync` are the only Skillset commands authorized by this decision
  to touch a provider discovery location. Both preview their exact filesystem
  plan by default and require `--yes` before writing.
- `install` creates one provider-specific activation and records every managed
  path plus the reviewed projection identity in
  `$XDG_STATE_HOME/skillset/activations.json`.
- `sync` updates only an activation already owned by that ledger. It refuses a
  missing, incomplete, conflicting, or externally changed record instead of
  adopting or overwriting it.
- Reversal removes only ledger-owned paths whose current identity still
  matches the recorded activation. Collisions and tampering fail loudly and
  require explicit recovery; Skillset does not overwrite unrelated files.
- Discovery is not trust. `install` and `sync` may create the least-invasive
  provider-supported discovery link or file, but they never edit provider
  settings, marketplaces, allowlists, trust stores, or enable hooks, MCP
  servers, monitors, or executables.

## Interactions with each surface

- **Claude:** a global standalone skill could be made discoverable at a
  provider-supported user or explicit project discovery root, but only through
  a confirmed future `install`. Project and user `settings.json` remain outside
  this authority.
- **Codex:** likewise, standalone skills may enter a provider-supported user or
  explicit project discovery root through confirmed `install` only. Codex
  `AGENTS.md` and config remain outside this authority.
- **Cursor:** use the same provider-specific discovery rule. This decision does
  not infer a writable destination or trust mechanism from Claude or Codex.
- **Marketplaces:** out of scope for global installs — marketplaces are a publishing path, not a local-install path. A global install is the alternative *to* a marketplace for personal loadouts, not a wrapper around one.
- **[skills.sh](https://skills.sh):** treat as an external registry Skillset can *import from* (existing `skillset import`) or, later, publish to — but global install/sync manages local files, not skills.sh state.
- **Symlinks:** allowed only under `install`/`sync`, only pointing at Skillset-owned generated output, recorded for reversibility. `build` creates no symlinks.
- **Provider settings and trust:** off-limits to every workflow in this
  decision. `install`/`sync` may manage only a provider-supported discovery
  entry and must record every change.

## Consequences

- Preserves "builds do not imply trust": activation is a separate, explicit, reversible workflow.
- Reuses the existing deterministic build + lock model — "global" is a configured root, not a new compiler mode.
- Keeps ordinary writes inside Skillset-owned XDG directories; only explicit,
  confirmed `install`/`sync` may reach a provider discovery location, with a
  durable ownership trail.
- Narrows ADR-0008's unresolved user/global-location examples without editing
  its accepted historical body: the canonical source root is now
  `$XDG_DATA_HOME/skillset/source/`; historical `~/.skillset/src` and the later
  internal setup default `~/.skillset/source` are not discovered.

## Implementation gating

Do not implement install/sync in the compiler build path. SET-362 decides the
contract only; current CLI and Core code do not resolve the global workspace,
write the build root, create the activation ledger, or expose install/sync.
A future implementation slice must:

1. Add explicit user-scope root resolution and pure build output without
   activation or implicit discovery.
2. Add provider-specific activation adapters only where current provider
   evidence proves a discovery mechanism.
3. Add preview/`--yes`, collision and tamper refusal, atomic ledger updates,
   and exact reversal tests before exposing `install`, `sync`, or removal.

## Non-goals

- Mutating `~/.claude` / `~/.codex` during normal repo work.
- Implementing install/sync in `build`/`check`.
- Publishing to or syncing marketplace/skills.sh state.
- Migrating or auto-discovering historical `~/.skillset/src` or the later
  internal setup default `~/.skillset/source`.
- Choosing public user-scope CLI vocabulary before implementation evidence.

## References

- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - baseline source-first compiler doctrine.
- [ADR-0001: Root Compile Policy](../0001-root-compile-policy.md) - explicit root selection and provider compile policy remain intact.
- [ADR-0008: Unified Source Layout](../0008-unified-source-layout.md#repo-user-and-global-stay-separate) - this draft prospectively amends its unresolved user/global location examples while preserving its accepted body.
- [Tenets](../../tenets.md) - build does not imply trust.
- [Changelog and Version Bump Workflow](../0013-changelog-and-versioning.md) - related non-goal for install/sync behavior.
