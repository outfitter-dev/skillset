---
slug: changelog-and-versioning
title: Changelog and Version Bump Workflow
status: draft
created: 2026-06-04
updated: 2026-06-04
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0]
---

# ADR: Changelog and Version Bump Workflow

Status: design (SET-11). No implementation; this defines the model and a concrete plan for a future `skillset changes` command.

## Context

Let authors manage versions and changelogs for root, plugin, and skill source from `.skillset/`, the same way they manage everything else: source-first, derive-by-default, lock-backed provenance. Keep generated artifact version metadata simple; keep the heavy provenance in `skillset.lock`.

## Decision

Adopt a changesets-style changelog model for future Skillset version workflows. Authors should write small source change entries under `.skillset/changes/`, and a future `skillset changes` command should apply version bumps, derive changelog output, and keep provenance in generated locks.

## Versioning model

Three independent semver axes already exist in source; this proposal names their roles precisely (it does not change them):

- **Root `skillset.version`** — the content version of the whole source tree; default fallback for standalone skills.
- **Plugin `skillset.version`** — the plugin's content version; default fallback for plugin-bound skills; lowers into the generated plugin manifest `version`.
- **Skill top-level `version`** — the skill artifact version; lowers into generated `metadata.version`.

`skillset.schema` (SET-3) is orthogonal: it versions the *source contract*, not content, and never participates in changelog/version bumps.

Resolution order is unchanged: skill `version` → plugin version → root version. `skillset verify` reports drift when a generated manifest/skill version is stale relative to source.

## Changelog authoring model

Adopt a **changesets-style** model (small, reviewable, mergeable change files) rather than hand-edited monolithic `CHANGELOG.md` files:

```
.skillset/
  changes/
    2026-06-03-add-foo.md     # one change entry
```

Each change entry is markdown with frontmatter declaring scope and bump:

```yaml
---
scope: plugin:skillset      # config:root | plugin:<name> | plugin.<plugin>.skill:<name> | skill:<name>
bump: minor                 # major | minor | patch
---

Added the `foo` surface.
```

Why entry files, not a single changelog:

- They merge without conflicts (one file per change).
- They carry intent (scope + bump) that `skillset changes version` can apply deterministically.
- They are source, so they review like everything else.

Generated, per-scope `CHANGELOG.md` files are **derived output** (like skills and manifests): written into the relevant generated root, tracked by `skillset.lock`, refreshed by build, and checked for freshness by verify. They are not hand-edited source truth.

## `skillset changes` command (proposed)

Three subcommands, all local and non-activating (consistent with "builds do not imply trust"):

- `skillset changes add` — scaffold a new entry in `.skillset/changes/` (interactive or `--scope`/`--bump`/`--message` flags). Authoring helper only.
- `skillset changes version` — consume entries, bump the affected source `version` fields (root/plugin/skill), append to the generated `CHANGELOG.md` for each scope, and delete the consumed entries. Writes only `.skillset/` source versions + generated changelogs; never publishes.
- `skillset changes status` / `check` — report pending entries and whether any shipped change lacks an entry (a lint-style guard, opt-in).

`skillset build`/`verify` keep their current jobs; changelog generation can run as part of `version` and be verified by `verify` (stale generated `CHANGELOG.md` is drift like any other generated file).

## Target-specific bumps when one target is skipped then resynced

This is the subtle case the issue calls out. Today, when a plugin enables both targets but a skill is `codex: false`, the plugin lock records `targetState: intentionally-skipped` and per-target `includedSkills`/`skippedSkills` with versions, so a target-specific version difference is visible even when that target's manifest/skills are byte-identical.

The changelog workflow builds on that:

- A change entry can scope to a target: `scope: skill:foo` plus an optional `targets: [claude]`. `changes version` then bumps the skill version and records that Codex remains at the prior version intentionally.
- When the skipped target is later resynced (the skill turns Codex back on), the lock's per-target `targetState`/version delta is the evidence of what changed for that target; `changes version` reconciles by emitting a catch-up entry in the Codex-scoped changelog referencing the already-bumped version.
- Generated artifact version stays a single simple `metadata.version`; the per-target history lives in `skillset.lock` and the generated per-scope `CHANGELOG.md`, never nested into skill frontmatter.

## Keep generated metadata simple

- Generated skill frontmatter: `metadata.version` + `metadata.generated` only (unchanged).
- Generated plugin manifest: `version` (unchanged).
- Heavy provenance (source hashes, per-target included/skipped versions, target state, change history) stays in `skillset.lock` and derived `CHANGELOG.md` — consistent with the "lockfiles carry heavy provenance" promise.

## Implementation plan (phased)

1. **Parse + validate change entries** (`.skillset/changes/*.md`): scope/bump schema, scope resolution against the build graph. Reuse the existing frontmatter + semver validators.
2. **`changes add`**: scaffold an entry. Pure authoring helper, no version mutation.
3. **`changes version`**: compute bumps per scope, rewrite source `version` fields, generate/append per-scope `CHANGELOG.md`, consume entries. Add lock entries for generated changelogs.
4. **`changes check`/`status`**: report pending entries and (opt-in) flag shipped changes lacking an entry.
5. **Target-aware entries**: add optional `targets:` to entries; reconcile with lock `targetState` for skipped/resynced targets.

## Consequences

Change history becomes source-first and reviewable, while generated `CHANGELOG.md` files stay derived output. The workflow gives future `check` and `doctor` commands structured evidence for missing or stale version bumps.

The tradeoff is that authors must write explicit change entries instead of relying on automatic semver inference. That keeps the first version of the workflow predictable and avoids guessing from diffs.

## Non-goals

- No publishing to Claude/Codex marketplaces.
- No global/XDG install/sync (see `global-installs.md`).
- No automatic semantic-version inference from diffs in v1 — bumps are authored.

## References

- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - baseline source-first compiler doctrine.
- [Tenets](../../tenets.md) - lock provenance and generated-output promises.
- [Global / XDG Managed Installs and Sync](20260604-global-xdg-managed-installs-and-sync.md) - related non-goal for install and sync workflows.
