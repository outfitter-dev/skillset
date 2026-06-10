---
slug: one-action-repo-adoption
title: One-Action Repo Adoption
status: draft
created: 2026-06-10
updated: 2026-06-10
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, fixtures-tests-dogfooding-and-evals, global-xdg-managed-installs-and-sync, source-change-release-provenance]
---

# ADR: One-Action Repo Adoption

## Context

Migrating an existing Claude or Codex repo to Skillset today is a multi-step, partial affair: run `skillset init`, inspect the detected import candidates, run `skillset import` per candidate, then hand-migrate whatever the candidate detectors did not see. Candidate detection covers plugin manifests, marketplace plugin sources, and conventional skill roots — not the rest of what real repos carry.

The first external fixture run (against [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin), pinned in `fixtures/external/repos.yaml`) made the gap concrete. After marketplace-aware candidate detection landed, import lifted both plugins and the round-trip came back 197/243 files byte-identical for the larger plugin — and still left behind:

- root `.claude/commands/` (project-level commands outside any plugin);
- root `AGENTS.md` and `CLAUDE.md` (instruction material);
- companion files inside the plugin source: `LICENSE`, `CHANGELOG.md`, `.codex-plugin/plugin.json`, `.cursor-plugin/`;
- plugin manifest fields (`author`, `homepage`, `repository`, `license`, `keywords`, `version`) dropped from the generated projection.

The goal this ADR commits to: point Skillset at an existing repo — a local path or a Git URL — and get as close as possible to a one-action migration. The adopted repo gains a `.skillset/` source tree and otherwise stays byte-identical to the original, and building that source reproduces the original surfaces substantially similarly.

## Decision

Skillset gets a whole-repo adoption flow: survey everything adoptable, lower each surface into its canonical `.skillset/` home, transform target-native authoring into portable source where the conversion is mechanical, leave the original tree untouched, and record where everything came from.

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
| `AGENTS.md`, `CLAUDE.md`, rules | `.skillset/instructions/` |
| Project agents | `.skillset/src/agents/` |
| Target-native files with no portable lowering | `.skillset/src/claude/`, `.skillset/src/codex/` islands |

`.skillset/src/` is not a universal dump of the original tree. It holds only project agents and target-native islands, exactly as the source contract defines today. The islands are the legitimate catch-all: a Claude-native file with no portable representation moves there visibly instead of being dropped or faked as portable. The test: if adoption put a file somewhere because of where it *was* rather than what it *means*, the lowering is wrong — lower intent, not filenames.

### Adoption transforms, and every transform is provenanced

Adoption is a migration assistant, not a file copier. Where the conversion is mechanical, `adopt` rewrites authored content into portable source:

- frontmatter keys with portable equivalents move under the portable vocabulary (the existing import classification of recognized, target-native, and unsupported keys becomes a rewrite step instead of a report-only step where the mapping is unambiguous);
- Claude-native dynamic constructs that have portable equivalents (`$ARGUMENTS`-style variables, substitution patterns the linter already recognizes) convert to their Skillset source forms;
- plugin manifest fields round-trip: `author`, `homepage`, `repository`, `license`, `keywords`, and `version` survive into source metadata and back out into generated manifests.

Every rewrite lands in the migration report: what changed, from what, to what, and why. Anything ambiguous stays verbatim and is reported as needing a human decision. Migration is explicit, ambiguity is not.

Adopted source is regenerable by design: re-running adoption against the same original produces the same `.skillset/` tree. Hand-tuning is expected to start *after* migration settles, which is what makes the refresh loop below safe for fixtures and predictable for users.

### The original tree stays pure

Adoption writes `.skillset/` and nothing else. The invariant is mechanically checkable: in a clean clone, `git status --porcelain` after adopt-and-build shows only `.skillset/`. Any other dirty path is a toolchain defect, not a judgment call.

This is what keeps the original usable as the round-trip baseline. Generated output is diffed against the original files sitting untouched in place, so fidelity gaps are visible as ordinary diffs rather than archaeology over an overwritten tree.

### Isolated output roots are pure configuration

Builds during adoption must not write into the original repo's live surfaces — `plugins-claude/`, `.claude/skills`, `.claude/rules`, and derived `AGENTS.md` destinations can all collide with original files. The fix is not an adoption-only build mode; it is finishing output-root configuration:

- every output surface (plugins, skills, rules, instruction destinations) becomes configurable the way plugin outputs already are through target output objects such as `claude.plugins.path`;
- a root-oriented reproduction under `.skillset/build/out/` — the generated tree laid out as the repo root would be — is one ordinary configuration of those roots, aligned with the Skillset-owned `~/.skillset/build` preview area and with `skillset test`'s isolated runs under `.skillset/build/tests/`.

This means adoption, external fixtures, deterministic tests, and global loadouts are all consumers of the same configuration. Fixtures get no privileged build mode; "isolated" is a place you point the existing build at, and the build contract — determinism, locks, drift checks — applies identically.

### Acquisition is sugar; provenance makes refresh real

`skillset adopt <git-url>` shallow-clones to a Skillset-owned cache location and runs the same flow as `skillset adopt <path>`. Acquisition adds no semantics.

Imported source records its origin — repository, pinned commit, and original path — in lock provenance. That record is what turns "upstream moved" into a defined operation: a future `adopt --refresh` re-pins, re-runs the regenerable migration, and reports the delta, instead of asking the user to remember where source came from. Refresh semantics beyond wholesale regeneration (merging upstream changes into hand-tuned source) are explicitly deferred.

## Non-Goals

- **Activation.** Adoption never installs, trusts, symlinks, or mutates Claude/Codex runtime config. The install/sync boundary from the global XDG draft is untouched.
- **Three-way merge on refresh.** Refresh regenerates or reports; it does not attempt to merge upstream changes into hand-edited source in v1.
- **Perfect byte fidelity.** Generated projections legitimately differ from originals (normalized frontmatter, `metadata.generated` provenance). The round-trip target is substantial similarity with every difference explainable, not zero diff.

## Consequences

### Positive

- A repo like compound-engineering-plugin migrates with one command, and the result compiles back substantially similar — the external fixture harness measures exactly this and its run reports become the regression surface.
- The external fixture harness stops choreographing init-plus-imports itself and becomes a thin wrapper over the product command, so fixture runs exercise what users actually run.
- Output-root configuration closes a real gap (only plugin outputs are redirectable today) and serves adoption, fixtures, tests, and global loadouts with one mechanism.
- Origin provenance gives the upstream-refresh loop a foundation instead of a convention.

### Tradeoffs

- Transform rules are a maintenance surface: every mechanical rewrite is a mapping Skillset must keep current as Claude and Codex vocabulary evolves.
- Wholesale regeneration on refresh discards hand-tuning. Acceptable for fixtures (which must stay untouched) and for freshly migrated repos; real long-lived repos will eventually need the deferred refresh semantics.

### Risks

- **Over-eager transforms.** A variable or frontmatter conversion that changes behavior is worse than leaving the original verbatim. Mitigation: transforms ship only where the mapping is unambiguous, everything else stays verbatim-and-reported, and the round-trip diff plus lint make bad conversions visible.
- **Survey sprawl.** "Everything adoptable" can creep toward surfaces Skillset cannot faithfully represent. Mitigation: the survey only recognizes surfaces with a defined lowering; recognized-but-unrepresentable content fails loudly into the report.

## Non-Decisions

- The command spelling (`skillset adopt` versus `skillset import --all`) is an implementation choice; this ADR decides the behavior, not the flag surface.
- Which transforms ship in the first slice, and the exact source vocabulary for converted variables, are implementation-time decisions guided by the external fixture reports.
- Cache location and eviction for URL acquisition follow the Skillset-owned XDG paths draft when that lands.

## References

- [Tenets](../../tenets.md) - source-first loadouts, lower intent not filenames, drift visible early.
- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - the source contract adoption migrates repos into.
- ADR: Fixtures, Tests, Dogfooding, and Evals (draft) - external fixtures consume adoption; isolated output aligns with `skillset test` run isolation.
- ADR: Global XDG Managed Installs and Sync (draft) - establishes that output location is configuration, not a compiler mode, and owns the activation boundary.
- ADR: Source Change, Release, and Dependency Provenance (draft) - lock provenance vocabulary that origin records extend.
- [Fixtures README](../../../fixtures/README.md) - the external fixture tier whose round-trip reports motivated and now measure this decision.
