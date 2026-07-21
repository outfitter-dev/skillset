---
id: 24
slug: one-action-repo-adoption
title: One-Action Repo Adoption
status: accepted
created: 2026-06-10
updated: 2026-07-20
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 9, 12, 14, 18, 22]
---

# ADR-0024: One-Action Repo Adoption

## Context

Before repo-local adoption was implemented, migrating an existing Claude,
Codex, or Cursor repo to Skillset was a multi-step, partial affair: run `skillset init`,
inspect detected import candidates, run `skillset import` per candidate, then
hand-migrate whatever the candidate detectors did not see.

The first external fixture run (against [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin), pinned in `fixtures/external/repos.yaml`) made the gap concrete. After marketplace-aware candidate detection landed, import lifted both plugins and the round-trip came back 197/243 files byte-identical for the larger plugin — and still left behind:

- root `.claude/commands/` (project-level commands outside any plugin);
- root `AGENTS.md` and `CLAUDE.md` (instruction material);
- companion files inside the plugin source: `LICENSE`, `CHANGELOG.md`, `.codex-plugin/plugin.json`, `.cursor-plugin/`;
- plugin manifest fields (`author`, `homepage`, `repository`, `license`, `keywords`, `version`) dropped from the generated projection.

The goal this ADR commits to: initialize an existing local repository with
repo-local adoption and get as close as possible to a one-action migration.
The adopted repo gains or reuses root `skillset.yaml` plus a `.skillset/`
source tree. Existing provider-authored surfaces stay byte-identical during
adoption, and an isolated build reproduces them substantially similarly without
writing live output roots.

## Decision

Skillset gets a whole-repo adoption flow through
`skillset init [directory] --adopt <all|candidate-id>`. It surveys everything
adoptable, derives each surface into its canonical `.skillset/` home, transforms target-native
authoring into portable source where the conversion is mechanical, leaves the
original tree untouched, and records where everything came from.

### Adoption surveys the whole repo, not just manifests

The survey extends candidate detection from "manifests and skill roots" to every surface Skillset can represent:

- single-plugin repos (`.claude-plugin/plugin.json` at root) and marketplace repos (`.claude-plugin/marketplace.json` plugin sources);
- nested plugin directories (`plugins/<name>/.claude-plugin/plugin.json`) even without a marketplace manifest;
- conventional skill roots (`.claude/skills`, `.codex/skills`, `.agents/skills`);
- root-level `.claude/commands`, `.claude/agents`, and `.claude/rules`;
- instruction material: root `AGENTS.md`, `CLAUDE.md`, and nested `AGENTS.md` files;
- companion files that belong with a plugin source: `LICENSE`, `CHANGELOG.md`, sibling `.codex-plugin/` manifests.

The survey is the contract: anything it recognizes gets imported; anything it cannot represent is reported with a reason, never silently skipped. Drift should become visible early, and that includes migration drift.

### Lowering goes to canonical homes, with islands as the explicit catch-all

Adoption lowers by surface, not by mirroring the original layout:

| Original surface | `.skillset/` home |
| --- | --- |
| Plugin directory | `.skillset/plugins/<name>/` |
| Standalone skill | `.skillset/skills/<name>/` |
| `AGENTS.md`, `CLAUDE.md`, rules | `.skillset/rules/` |
| Project agents | `.skillset/agents/` |
| Target-native files with no portable derivation | `.skillset/_claude/`, `.skillset/_codex/`, `.skillset/_cursor/` islands |

The flat `.skillset/` workspace is not a universal dump of the original tree.
Target-native islands are the explicit catch-all: a provider-native file with
no portable representation moves there visibly instead of being dropped or
faked as portable. If adoption places a file somewhere because of where it was
rather than what it means, the derivation is wrong—derive intent, not filenames.

### Adoption transforms, and every transform is provenanced

Adoption is a migration assistant, not a file copier. Where the conversion is
mechanical, the repo-local init flow rewrites authored content into portable
source:

- frontmatter keys with portable equivalents move under the portable vocabulary (the existing import classification of recognized, target-native, and unsupported keys becomes a rewrite step instead of a report-only step where the mapping is unambiguous);
- Claude-native dynamic constructs that have portable equivalents (`$ARGUMENTS`-style variables, substitution patterns the linter already recognizes) convert to their Skillset source forms;
- plugin manifest fields round-trip: `author`, `homepage`, `repository`, `license`, `keywords`, and `version` survive into source metadata and back out into generated manifests.

Every rewrite lands in the migration report: what changed, from what, to what, and why. Anything ambiguous stays verbatim and is reported as needing a human decision. Migration is explicit, ambiguity is not.

Adopted source is regenerable by design: repeating the repo-local adoption
against the same original produces the same `.skillset/` tree. Hand-tuning is
expected to start after migration settles, which keeps fixture proof and local
reproduction deterministic without defining a refresh contract.

The transform mappings are an intent-keyed registry — typed data, one portable
concept per entry with target-truth evidence and round-trip tests. Adopt-time
normalization persists the portable form when conversion is mechanical. The
current build-time dialect boundary is deliberately narrow: source may declare
only `dialect: claude`, and recognized transforms lower that source for Codex.
Other projections keep their existing renderer behavior without claiming
dialect translation. Target-native islands remain target-locked and are never
translated; broader dialects and all-target translation remain deferred.

### Original provider surfaces stay pure during adoption

Adoption creates or reuses root `skillset.yaml` and writes canonical source and
provenance under `.skillset/`. It leaves the detected provider-authored input
surfaces untouched. In a clean clone, `git status --porcelain` after adoption
may therefore show `skillset.yaml` and `.skillset/`, but must not show changes to
the original provider files. An isolated build adds no repo-local generated
output because its logical mirror is XDG-backed.

This is what keeps the original usable as the round-trip baseline. Generated output is diffed against the original files sitting untouched in place, so fidelity gaps are visible as ordinary diffs rather than archaeology over an overwritten tree.

Cutover is documentation, not a feature. A real migration ends with generated output replacing the originals, and unmanaged-output safety must make that step reversible rather than silent. The migration report therefore ends with explicit cutover instructions — review the listed originals, then build against live roots knowing any unmanaged collisions are backed up with restore ids — instead of a `--replace` mode. If real migrations show that manual review failing at scale, a guided cutover command can earn its place later.

### Isolated build output is a binary mode

Builds during adoption must not write into the original repo's live surfaces — `plugins-claude/`, `.claude/skills`, `.claude/rules`, and derived `AGENTS.md` destinations can all collide with original files. Generated output therefore goes either to the live directed roots (the default) or, with `--isolated`, to the logical `.skillset/cache/latest/` mirror stored in the repo's XDG cache bucket. The mirror reproduces repo-relative projection paths without creating that directory in the working tree. Build, `check --only outputs`, and `diff` select the mode explicitly; locks, drift, and checks resolve against the active root.

Adoption and external fixtures use the same isolated mode — fixtures get no privileged build path, and the build contract (determinism, locks, drift checks) applies identically in both modes. A fuller per-surface output-root vocabulary (redirecting individual surfaces) was considered and deferred: derived `AGENTS.md` destinations cannot be expressed as a single root anyway, and no current consumer needs partial redirection.

### Repo-local provenance keeps migration inspectable

Adoption operates on the existing local repository selected by `init
[directory]`; it does not acquire a Git URL or arbitrary external path.
Imported source records its local origin and transformation evidence in the
adoption report and generated provenance. Refresh and upstream acquisition are
explicitly deferred rather than implied by the stored evidence.

## Non-Goals

- **Activation.** Adoption never installs, trusts, symlinks, or mutates Claude, Codex, or Cursor runtime config. The install/sync boundary from the global XDG draft is untouched.
- **Refresh or upstream acquisition.** The accepted repo-local flow does not fetch, re-pin, regenerate from, or merge an external source.
- **Perfect byte fidelity.** Generated projections legitimately differ from originals (normalized frontmatter, `metadata.generated` provenance). The round-trip target is substantial similarity with every difference explainable, not zero diff.

## Consequences

### Positive

- A repo like compound-engineering-plugin migrates with one command, and the result compiles back substantially similar — the external fixture harness measures exactly this and its run reports become the regression surface.
- The external fixture harness stops choreographing init-plus-imports itself and becomes a thin wrapper over the product command, so fixture runs exercise what users actually run.
- The isolated whole-projection mode serves adoption, fixtures, and tests with one XDG-backed mechanism while live outputs stay untouched.
- Origin provenance makes the completed local migration inspectable without promising an upstream refresh loop.

### Tradeoffs

- Transform rules are a maintenance surface: every mechanical rewrite is a mapping Skillset must keep current as Claude, Codex, and Cursor vocabulary evolves.
- A future refresh design must preserve or explicitly reconcile hand-tuning; this decision does not authorize wholesale regeneration.

### Risks

- **Over-eager transforms.** A variable or frontmatter conversion that changes behavior is worse than leaving the original verbatim. Mitigation: transforms ship only where the mapping is unambiguous, everything else stays verbatim-and-reported, and the round-trip diff plus lint make bad conversions visible.
- **Survey sprawl.** "Everything adoptable" can creep toward surfaces Skillset cannot faithfully represent. Mitigation: the survey only recognizes surfaces with a defined lowering; recognized-but-unrepresentable content fails loudly into the report.

## Non-Decisions

- Which transforms ship in the first slice, and the exact source vocabulary for converted variables, are implementation-time decisions guided by the external fixture reports.
- Any future acquisition cache and eviction policy belongs to a separate XDG/activation decision.

## Acceptance Evidence (2026-07-20)

SET-277 and SET-366 verified the public one-action flow as repo-local `skillset
init [directory] --adopt <all|candidate-id>` before this decision was accepted.
It surveys supported source, records structured skips and provenance, lowers
mechanical cases, previews before confirmation, builds an isolated projection,
and preserves the original target-native tree. Public standalone `adopt`, Git
URL/path acquisition through `init --from`, and refresh are unsupported.

Adopted source uses the flat workspace: `.skillset/plugins/`, `skills/`,
`rules/`, `agents/`, `_claude/`, `_codex/`, and `_cursor/`, with shared and
partial resources under their canonical owners. Isolated output and reports use
logical XDG-backed cache paths. Deterministic source/provenance is in scope;
byte-identical output is reported rather than promised, and activation/trust is
never implied. Current proof is in `init-args.ts`, `adopt.ts`, setup/import
orchestration, finite JSON/adoption tests, layout docs, and pinned external
harness tests. The live external lane is not a default acceptance gate.

## References

- [Tenets](../tenets.md) - source-first loadouts, lower intent not filenames, drift visible early.
- [ADR-0000: Source-First Loadouts](0000-source-first-loadouts.md) - the source contract adoption migrates repos into.
- [Fixtures, Tests, Dogfooding, and Evals](0012-fixtures-tests-dogfooding-and-evals.md) - external fixtures consume adoption; isolated output aligns with `skillset test` run isolation.
- ADR: Global XDG Managed Installs and Sync (draft) - establishes that output location is configuration, not a compiler mode, and owns the activation boundary.
- [Source Change, Release, and Dependency Provenance](0014-source-change-release-provenance.md) - lock provenance vocabulary that origin records extend.
- [Fixtures README](../../fixtures/README.md) - the external fixture tier whose round-trip reports motivated and now measure this decision.
