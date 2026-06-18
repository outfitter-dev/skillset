# Retro

## Planning State

- Packet created: 2026-06-17.
- Planner did not implement the target work.
- Repo at planning time: `main`, `origin/main`, latest commit `5fd7d2a ci(release): scope changesets to package payload (#101)`.
- Open GitHub PRs at planning time: none.
- Latest release at planning time: `v0.13.4`.
- Graphite stack at planning time: current branch only `main`.

## Execution Summary

- 2026-06-17: Execution started. Run authorized for: full autonomous 5-branch run; draft PRs submitted as one batch at the very end; Linear updated as planned (Backlog → In Progress → In Review). No merge/publish without explicit approval.
- Graphite healthy; stacking on `main` with one branch per issue.
- SET-122 (mechanical rename to render-result vocabulary): COMPLETE, verified. Branch `set-122-mechanical-rename-to-render-result-vocabulary`.

## Pre-existing Local State

- `fixtures/external/repos.yaml` had a pre-existing local edit adding `mattpocock-skills` pinned to `00ff03cac21a8a845b06256d826d183122f58c5e`.
- Execution should preserve this edit and avoid staging it unless Matt explicitly assigns that separate fixture change.

## Tracker State At Planning

| Issue | State | Priority | Notes |
| --- | --- | --- | --- |
| SET-122 | Backlog | High | Parent issue in `Skillset derive/render terminology cutover`. |
| SET-123 | Backlog | High | Child of SET-122. |
| SET-124 | Backlog | High | Child of SET-122. |
| SET-125 | Backlog | Medium | Child of SET-122. |
| SET-126 | Backlog | Medium | Child of SET-122. |

## Branch / PR / Issue Ledger

| Issue | Branch | Status | PR |
| --- | --- | --- | --- |
| SET-122 | `set-122-mechanical-rename-to-render-result-vocabulary` | Implemented + reviewed (5/5) + verified | pending (batch at end) |
| SET-123 | `set-123-cut-config-over-to-compileunsupporteddestination` | Implemented + reviewed (5/5) + verified | pending (batch at end) |
| SET-124 | `set-124-separate-target-and-destination-in-render-result-data` | Implemented + reviewed (5/5) + verified | pending (batch at end) |
| SET-125 | `set-125-refresh-docs-and-generated-guidance-for-deriverender` | Implemented + verified locally; Linear In Progress | pending (batch at end) |
| SET-126 | (pending) | not started | — |

## Execution Log

### SET-122 — Mechanical rename to render-result vocabulary

Boundary held (record model only; config/destination/docs/transforms deferred):

- Renamed files: `lowering-outcome.ts`→`render-result.ts`, `lowering-outcome-collector.ts`→`render-result-collector.ts`, `lowering-policy.ts`→`render-result-policy.ts`, plus the three matching test files.
- Symbol map: `SkillsetLoweringOutcome`→`SkillsetRenderResult`, `*OutcomeStatus/Input/Output/DiagnosticRef`→`RenderResult*`, `SkillsetLoweringError`→`SkillsetRenderResultError`, `SkillsetLoweringPolicy`→`SkillsetRenderResultPolicy`, `LOWERING_OUTCOME_SCHEMA/STATUS_VALUES`→`RENDER_RESULT_*`, `define/normalize/serialize/assertLoweringOutcome`→`*RenderResult`, `collectLoweringOutcomes`→`collectRenderResults`, `enforceLoweringOutcomePolicy`→`enforceRenderResultPolicy`, field `loweringOutcomes`→`renderResults`.
- Schema stamp `skillset-lowering-outcome@1`→`skillset-render-result@1`. Status value `emitted`→`rendered` (status surfaces only; left "not emitted for target" dependency prose). Restored alphabetical order of `RENDER_RESULT_STATUS_VALUES` (rename disturbed it) and updated the two tests that pin that order.
- CLI/report surfaces updated: explain `lowering [..]`→`render [..]`, doctor "lowering outcome advisor"→"render result advisor", adopt report "### Lowering outcomes"→"### Render results" and `summarize*`.
- `feature-registry.ts`: updated evidence/owner PATH values to renamed files only. Left feature `id: "lowering-outcomes"`, `docs:` pointer, `loweringOwner` field name, title/summary/notes for SET-125 (evidence notes are not validated — only ref paths are).
- Regenerated self-hosted output: 6 `.skillset.lock` files now carry `renderResults`/`skillset-render-result@1`/`rendered`.

Residual old-vocab (intentionally deferred, classified):

- SET-123 (config/policy): `compile.unsupported` key + `CompileUnsupportedPolicy` + "lowering policy blocked …" message in `render-result-policy.ts` and its assertions.
- SET-124/transforms (needs-judgment): `packages/transforms` `lowering` field (`bidirectional`/`to-codex`/`none`), `render.ts` "faithful Codex lowering", `setup.ts` import "lowering", `adopt.ts` `match.lowering`.
- SET-125 (docs/guidance + feature framing): `loweringOwner` field (28 entries) + `feature-registry` `id`/`title`/`summary`/notes, `docs/**` and `.skillset/**`, ADR drafts, "version lowering"/"dependency lowering"/"instruction lowering" evidence notes.

### SET-123 — Cut config to compile.unsupportedDestination

- Config key `compile.unsupported` → `compile.unsupportedDestination`. No legacy alias (parser is strict on unknown `compile` keys, so the old key now fails — clean cutover, no blocker found).
- `CompileConfig.unsupported` field → `unsupportedDestination`; default config + parser return + `build.ts` readers (3×) updated.
- Policy type `CompileUnsupportedPolicy` → `UnsupportedDestinationPolicy` (`types.ts`); `COMPILE_UNSUPPORTED_POLICIES` → `UNSUPPORTED_DESTINATION_POLICIES`; `readCompileUnsupportedPolicy` → `readUnsupportedDestinationPolicy` (reads `record.unsupportedDestination`). No `index.ts` export existed.
- Policy error message: "lowering policy blocked N outcome(s) (compile.unsupported: …)" → "unsupported destination policy blocked N render result(s) (compile.unsupportedDestination: …)".
- Tests: `skillset.test.ts` config tests (YAML keys, matchObjects, names) + policy-message assertions in `render-result-policy.test.ts`/`render-result-build.test.ts`. No YAML config files set the key (default "error"), so no fixture files needed changing.
- `skillset:build` wrote 0 files — config policy is not lock-serialized, so no generated drift.
- Boundary: `SkillsetRenderResultPolicy` annotation values (`unsupported:error`, `scope:excluded`, …) left unchanged (per-result annotations, not the config key). Docs (`docs/layout.md`, `docs/target-surfaces.md`) and `.skillset/**` guidance still mention `compile.unsupported` — owned by SET-125.

### SET-124 — Separate target and destination in render-result data

- Finding: `target` was NOT overloaded (already strictly the provider); `destination` was genuinely missing. Added optional `destination?: string` to `SkillsetRenderResult` = concrete output artifact/scope under the provider `target`.
- Destination taxonomy (collector): `skill` (standalone/plugin skill), `plugin-manifest`, `instruction`, `agent`, `target-native-island`, `changelog`, `plugin-<feature>` (mcp/bin/…), companion `featureKey`, `skill-frontmatter` (claude tool-intent), `skill-tools` (codex tool-intent), `plugin-manifest` (dependencies), `plugin-agents`/`plugin-bin` (unsupported). Distinct from `featureId` (capability): destination collapses skill features into `skill` and splits tool-intent by output scope.
- Threaded through: `normalizeRenderResult` (ordered after `target`), `assertRenderResult` (non-empty when present), collector + lock sort keys (deterministic), `.skillset.lock` serialization, `skillset explain`/`doctor` JSON, and explain/doctor text (`featureId -> destination`).
- Tests: multi-destination (one source skill → `skill` + `skill-frontmatter` under one target), unsupported-destination (`plugin-agents`/`plugin-bin` carry destination), serialize round-trip (field order), and explain/doctor JSON expose `destination`.
- Behavior preserved: existing target adapter behavior unchanged; only the result shape is richer. Regenerated 6 locks (now carry `destination`).

### SET-125 — Refresh docs and generated guidance

- Feature-registry framing (code): `loweringOwner` field → `renderOwner` (type + 28 entries + check + tests); feature `id: "lowering-outcomes"` → `render-results` (+ repositioned in `SEEDED_FEATURE_IDS` since the list sorts by id); title/summary/sourceShape/notes prose; `docs/features/lowering-outcomes.md` renamed to `render-results.md`; ADR evidence ref preserved.
- Docs + `.skillset/` prose cutover (delegated to a constrained editor subagent, then reviewed): ~24 doc files + 4 `.skillset` guidance files. Mappings: `compile.unsupported`→`compile.unsupportedDestination`, `lowering outcome(s)`→`render result(s)`, schema stamp, `Lowering Outcomes`→`Render Results`, render verb `lowers to`→`renders to`, `## Target Lowering`→`## Target Rendering` (×24), `projection`(output sense)→`rendering`, `emitted`(status)→`rendered`, `lowering policy`→`unsupported destination policy`, etc.
- Preserved (documented for SET-126 allowlist): all `docs/adrs/**` (historical decision records); the `deterministic projection`/`deterministic-projection` concept (code not renamed); ordinary English (`lower-level`, `lower-case`, etc.).
- Self-hosted output rebuilt (9 generated files). The `.skillset/` SKILL.md edits triggered the change-provenance gate (`skillset:ci`): added a SET-125 pending change entry covering the edited scopes, and refreshed (appended current source-hash evidence to) the three older pending notes that recorded those scopes. `skillset:ci` now passes.
- Deferred to a follow-up (genuinely needs-judgment, out of the 5-issue scope): `packages/transforms` `lowering` field + `render.ts` transform "lowering" comments + the `deterministic-projection` code concept. These are distinct internal/transform-dialect vocabulary; renaming them is a behavioral change. They will be allowlisted by the SET-126 guard and tracked as a follow-up.

## Execution Log (continued)

- Pending executor updates for SET-126.

## Tracker Mutations

- Pending executor updates.

## Verification Log

### SET-122 (all green)

- `bun run typecheck` — clean.
- `bun run test` (scoped: tracked apps/packages/scripts tests) — 483 pass / 0 fail.
- `bun run skillset:build` — wrote 6 generated files (locks).
- `bun run skillset:check` — checked 51 generated files, no drift.
- `bun run skillset:lint` — linted 5 source skills, clean.
- `git diff --check` — clean.
- Note: bare `bun test` (whole-tree) reports ~145 failures from gitignored external clones under `fixtures/external/repos/`; the repo gate is the scoped `bun run test`. Pre-existing `await ... .rejects` (TS 80007) editor hints exist repo-wide; `tsc` gate is clean. `bun run check` (full aggregate) reserved for final handoff.

### SET-123 (all green)

- `bun run typecheck` clean; `bun run test` 483 pass / 0 fail; `bun run skillset:build` wrote 0 files; `bun run skillset:check` no drift; `bun run skillset:lint` clean; `git diff --check` clean. Residual scan: no `compile.unsupported`/`CompileUnsupportedPolicy` in active code (docs/.skillset deferred to SET-125).

### SET-124 (all green)

- `bun run typecheck` clean; `bun run test` 484 pass / 0 fail (added multi-destination test); `bun run skillset:build` regenerated 6 locks (destination added) then 0 on re-run; `bun run skillset:check` no drift; `bun run skillset:lint` clean; `git diff --check` clean.

### SET-125 (all green)

- `bun run typecheck` clean; `bun run test` 484 pass / 0 fail; `bun run skillset:build` regenerated 9 files; `bun run skillset:check` no drift; `bun run skillset:lint` clean; **`bun run skillset:ci` passes** (change-entry coverage resolved); `git diff --check` clean. Residual scan: active docs/.skillset md clean of unintended old vocab (only historical ADRs + deterministic-projection concept remain, both intentional).

## Local Review Log

- SET-122 mechanical-rename reviewer: **5/5**. No P0/P1/P2. One P3 (index.ts re-export `type` block not re-alphabetized after token swap) — fixed and amended into the SET-122 commit. Verified behavior preservation, no missed active renames, boundaries respected, cross-refs resolve.
- SET-123 config/schema reviewer: **5/5**. No findings. Verified complete cutover (no residual `compile.unsupported`/`CompileUnsupportedPolicy`), old key now genuinely rejected by the strict allowlist (no alias), behavior preserved (default "error", reserved-policy path), tests still hit their named validation paths.
- SET-124 data/model reviewer: **5/5**. P2 (plugin-feature destinations `plugin-mcp`/`plugin-bin` duplicated featureId, and companion used bare `featureKey` while plugin-features used `plugin-` prefix) — FIXED: all plugin-feature/companion/unsupported destinations now bare scope names (`mcp`, `bin`, `agents`, …), consistent across producers and never just mirroring featureId. P3 (import tool-intent + setup island-skip lacked destination) — FIXED: added `skill-frontmatter` / `target-native-island`. Verified target stays strictly the provider, determinism/lock-stability preserved, behavior unchanged.
- SET-125 docs/guidance reviewer: **4/5**. Three P2 (all FIXED): (1) `target-surfaces.md` over-replaced `lossy lowering`→`degraded render`, conflating two distinct statuses — restored to `lossy render`; (2) feature-registry summary/evidence prose still said `lowers`/`lowering` (surfaces via explain/doctor) — changed to `renders`/`rendering`; (3) the doc rename left a dead ADR link (`lowering-outcomes.md`) — repaired URL to `render-results.md`. One P3 (FIXED): differentiated two adjacent "rendering, not …" bullets in skillset-adrs SKILL.md. Verified no missed active vocab, preserved concepts intact, docs match code contract.

- Required reviewer lanes:
  - mechanical rename reviewer;
  - config/schema reviewer;
  - target/destination data-model reviewer;
  - docs/guidance reviewer;
  - terminology guard reviewer;
  - full-stack review after fixes.

## Remote Review / CI Log

- Pending executor updates.

## P3 / Follow-Up Log

- Pending executor updates.

## Forbidden Actions Audit

Executor must record final status for:

- no publish;
- no user-level Claude/Codex config mutation;
- no install/trust/symlink/runtime activation;
- no remote addition;
- no merge without explicit approval;
- no accidental staging of the pre-existing `fixtures/external/repos.yaml` edit.

## Final State

Pending.
