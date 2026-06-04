---
slug: global-xdg-managed-installs-and-sync
title: Global / XDG Managed Installs and Sync
status: draft
created: 2026-06-04
updated: 2026-06-04
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0]
---

# ADR: Global / XDG Managed Installs and Sync

Status: design (SET-12). No implementation in the compiler build path. This proposal precedes any install/sync code.

## Context

Let Skillset optionally manage skills/plugins for a user *outside* a single content repo — a global loadout — without ever turning `skillset build` into an activation step. The hard line from the tenets: **build output does not imply trust.** Anything that installs, symlinks, or mutates user-level Claude/Codex config is a separate, explicit, opt-in workflow.

## Decision

Global Skillset state should live under Skillset-owned XDG paths, and install/sync/trust should be separate commands from build. Build may generate output for a global source root, but it must not mutate target runtime locations or user-level Claude/Codex config.

## Where global state lives

Follow XDG with a Skillset-owned home, never the targets' config dirs:

- **State / source:** `$XDG_DATA_HOME/skillset/` (default `~/.local/share/skillset/`). Holds a global `.skillset/` source tree and its generated output, exactly like a repo — Skillset manages *its own* directory, not `~/.claude` or `~/.codex`.
- **Config:** `$XDG_CONFIG_HOME/skillset/config.yaml` (default `~/.config/skillset/`) for global preferences (which targets, output roots).
- **Cache (optional):** `$XDG_CACHE_HOME/skillset/` for transient build artifacts.

Skillset is *allowed to manage* only paths under its own XDG dirs. It is **not** allowed to write `~/.claude/`, `~/.codex/`, marketplaces, or [skills.sh](https://skills.sh) state as part of build.

## Global standalone vs plugin-bound output

- **Global standalone skills**: built from the global `.skillset/skills/` into a Skillset-owned output root under `$XDG_DATA_HOME/skillset/`. These are the natural fit for "I want this skill everywhere" without a marketplace.
- **Plugin-bound output**: a global `.skillset/plugins/<name>/` still builds a full plugin repo (manifest + companions). The difference is only *where the output root lives* (XDG vs repo), not the generated shape — generated plugins stay identical and reproducible.

The build contract is unchanged; "global" is just a configured root + output location. Determinism and lockfiles apply identically.

## Install / sync / trust boundaries

Three separate verbs, sharply divided from `build`:

| Verb | What it does | Touches user runtime? |
| --- | --- | --- |
| `build` (existing) | source → generated output under managed roots | **No** |
| `install` (new, opt-in) | make a built skill/plugin discoverable by a target | **Yes — explicit** |
| `sync` (new, opt-in) | rebuild + re-point an existing install to fresh output | **Yes — explicit** |

Rules:

- `build` never installs, trusts, symlinks, or edits user config. (Unchanged.)
- `install`/`sync` are the *only* commands allowed to touch user-level locations, always explicitly invoked, never implied by `build`/`check`.
- `install` records what it linked/activated in Skillset-owned state (`$XDG_DATA_HOME/skillset/installs.json` or lock) so `sync`/`uninstall` are reversible and auditable.
- Trust is explicit: installing a plugin that ships hooks/MCP/monitors must surface that and require confirmation, because those run code. Skillset must not silently trust generated artifacts.

## Interactions with each surface

- **Claude:** a global standalone skill could be made discoverable by linking it into `~/.claude/skills/` (or a project's), but only via `install` — and the link target is Skillset-owned generated output, so `sync` can refresh it. Project/user `settings.json` is **never** edited by `build`.
- **Codex:** likewise, standalone skills into the Codex skill discovery path via `install` only. Codex `AGENTS.md` and config are not mutated by build.
- **Marketplaces:** out of scope for global installs — marketplaces are a publishing path, not a local-install path. A global install is the alternative *to* a marketplace for personal loadouts, not a wrapper around one.
- **[skills.sh](https://skills.sh):** treat as an external registry Skillset can *import from* (existing `skillset import`) or, later, publish to — but global install/sync manages local files, not skills.sh state.
- **Symlinks:** allowed only under `install`/`sync`, only pointing at Skillset-owned generated output, recorded for reversibility. `build` creates no symlinks.
- **User-level config:** off-limits to `build`. `install`/`sync` may add discovery links but should prefer the least-invasive mechanism each target supports and record every change.

## Consequences

- Preserves "builds do not imply trust": activation is a separate, explicit, reversible workflow.
- Reuses the existing deterministic build + lock model — "global" is a configured root, not a new compiler mode.
- Keeps Skillset's writes inside Skillset-owned XDG dirs by default; only explicit `install`/`sync` reaches into target runtime, with an audit trail.

## Implementation gating

Do not implement install/sync in the compiler build path. A future slice would:

1. Add global-root resolution (XDG dirs) as a configured build target — pure build, no activation. This alone is safe and useful.
2. Add `install`/`sync`/`uninstall` as a *separate* command surface with explicit confirmation, an installs ledger, and reversibility — gated behind clear trust prompts.

## Non-goals

- Mutating `~/.claude` / `~/.codex` during normal repo work.
- Implementing install/sync in `build`/`check`.
- Publishing to or syncing marketplace/skills.sh state.

## References

- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - baseline source-first compiler doctrine.
- [Tenets](../../tenets.md) - build does not imply trust.
- [Changelog and Version Bump Workflow](20260604-changelog-and-versioning.md) - related non-goal for install/sync behavior.
