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

| Issue | Branch | Status | PR (draft) |
| --- | --- | --- | --- |
| SET-122 | `set-122-mechanical-rename-to-render-result-vocabulary` | Reviewed 5/5; verified; Linear In Review | [#102](https://github.com/outfitter-dev/skillset/pull/102) |
| SET-123 | `set-123-cut-config-over-to-compileunsupporteddestination` | Reviewed 5/5; verified; Linear In Review | [#103](https://github.com/outfitter-dev/skillset/pull/103) |
| SET-124 | `set-124-separate-target-and-destination-in-render-result-data` | Reviewed 5/5 (P2+P3 fixed); verified; Linear In Review | [#104](https://github.com/outfitter-dev/skillset/pull/104) |
| SET-125 | `set-125-refresh-docs-and-generated-guidance-for-deriverender` | Reviewed 4/5 (3×P2+P3 fixed); verified; Linear In Review | [#105](https://github.com/outfitter-dev/skillset/pull/105) |
| SET-126 | `set-126-add-terminology-guard-for-deriverender-cutover` | Reviewed 4/5 (P1+P2+P3 fixed); verified; Linear In Review | [#106](https://github.com/outfitter-dev/skillset/pull/106) |

Full-stack review: **5/5**, one P2 (render-results.md missing `destination` field row) fixed on SET-125. Stack: `main → 122 → 123 → 124 → 125 → 126`, all stacked draft PRs submitted; pre-push gate (`skillset-ci` + `bun run check`) passed at submit.

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

### SET-126 — Terminology guard

- Added `scripts/terminology-guard.ts` (+ `scripts/__tests__/terminology-guard.test.ts`): scans tracked active surfaces (`.ts/.md/.json/.yaml`) for retired vocabulary (the `lowering`/`lowering outcome`/`LoweringOutcome`/`loweringOutcomes`/`LOWERING_OUTCOME`/`SkillsetLowering`/`skillset-lowering-outcome`/`loweringOwner`/`lowering policy`/`loss ledger` family + `compile.unsupported` not followed by `Destination` + bare `lowering`/`lowered`). `projection` deliberately excluded (too entangled with the un-renamed deterministic-projection concept).
- Wired into `bun run check` via a `terminology:guard` script; documented in the script header/footer and `AGENTS.md`.
- Allowlists (explicit + commented): PATHS for historical ADRs, generated trees, goal packets, changesets, change notes, the deferred transforms package, `render.ts`, and the deterministic-projection files; LINE substrings for the deterministic-projection concept, historical ADR link/title, and the deferred transform-dialect/version `lowering` usages.
- The guard surfaced real misses the SET-125 subagent's scope had not covered (top-level `README.md` and `AGENTS.md`, and the adapter-conformance "support lowered with" message) — all fixed to render/derive vocabulary.

## Execution Log (continued)

- All five issues implemented. Pending: per-branch guard-quality + full-stack review, then batch PR submission.

## Tracker Mutations

- SET-122..126: Backlog → In Progress (at each branch start) → In Review (at PR submission). Each issue has a comment linking its draft PR.
- Created follow-up [SET-135](https://linear.app/outfitter/issue/SET-135/rename-deferred-loweringprojection-internal-vocabulary-transforms) for the deferred internal `lowering`/`projection` rename (transforms field + `render.ts` comments + deterministic-projection concept), with instructions to shrink the guard allowlist as it lands.

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

### SET-126 (all green)

- `bun run typecheck` clean; `bun run test` 490 pass / 0 fail (added 6 guard tests); `bun run terminology:guard` scans 227 files, no retired vocabulary; **`bun run check` (full aggregate, now incl. the guard) passes**; `bun run skillset:check`/`skillset:ci` clean; `git diff --check` clean.

## Local Review Log

- SET-122 mechanical-rename reviewer: **5/5**. No P0/P1/P2. One P3 (index.ts re-export `type` block not re-alphabetized after token swap) — fixed and amended into the SET-122 commit. Verified behavior preservation, no missed active renames, boundaries respected, cross-refs resolve.
- SET-123 config/schema reviewer: **5/5**. No findings. Verified complete cutover (no residual `compile.unsupported`/`CompileUnsupportedPolicy`), old key now genuinely rejected by the strict allowlist (no alias), behavior preserved (default "error", reserved-policy path), tests still hit their named validation paths.
- SET-124 data/model reviewer: **5/5**. P2 (plugin-feature destinations `plugin-mcp`/`plugin-bin` duplicated featureId, and companion used bare `featureKey` while plugin-features used `plugin-` prefix) — FIXED: all plugin-feature/companion/unsupported destinations now bare scope names (`mcp`, `bin`, `agents`, …), consistent across producers and never just mirroring featureId. P3 (import tool-intent + setup island-skip lacked destination) — FIXED: added `skill-frontmatter` / `target-native-island`. Verified target stays strictly the provider, determinism/lock-stability preserved, behavior unchanged.
- SET-125 docs/guidance reviewer: **4/5**. Three P2 (all FIXED): (1) `target-surfaces.md` over-replaced `lossy lowering`→`degraded render`, conflating two distinct statuses — restored to `lossy render`; (2) feature-registry summary/evidence prose still said `lowers`/`lowering` (surfaces via explain/doctor) — changed to `renders`/`rendering`; (3) the doc rename left a dead ADR link (`lowering-outcomes.md`) — repaired URL to `render-results.md`. One P3 (FIXED): differentiated two adjacent "rendering, not …" bullets in skillset-adrs SKILL.md. Verified no missed active vocab, preserved concepts intact, docs match code contract.
- SET-126 guard-quality reviewer: **4/5**. P1 (FIXED): whole-line allowlist masked co-located regressions (`const loweringOutcomes = match.lowering;` slipped) — reworked to per-match span-containment so an allowlisted phrase only exempts the matched text inside it; added a masking-regression test. P2 (FIXED): the `.skillset-adrs/scripts/lib/` path allowlist excluded ~8 active files for one string — reworded the string to "target rendering model" and removed the path entry (re-refreshed provenance). P3 (FIXED): added test coverage for `LOWERING_OUTCOME`/`lowering policy`/bare `lowered` + the masking case. The stricter per-match logic then surfaced three transform-field literals in `adopt.ts` that the old logic had hidden; added precise span markers for them.

- Required reviewer lanes:
  - mechanical rename reviewer;
  - config/schema reviewer;
  - target/destination data-model reviewer;
  - docs/guidance reviewer;
  - terminology guard reviewer;
  - full-stack review after fixes.

## Remote Review / CI Log

- 5 stacked draft PRs submitted (#102–#106) via `gt submit --stack --draft`. The Graphite pre-push gate ran and passed: repo-sanity, whitespace, changesets guard, workflow lint, `skillset-ci`, and `bun run check` (the same aggregate CI runs).
- Bot/human review state at submit: none yet (just created as drafts). PRs are draft pending review.

## P3 / Follow-Up Log

- All per-branch P3s were fixed inline (index.ts export ordering; SET-124 import/setup destinations; SET-125 SKILL bullet wording; SET-126 test coverage). No unresolved P3s.
- Deferred (out of the 5-issue scope, tracked as [SET-135](https://linear.app/outfitter/issue/SET-135/rename-deferred-loweringprojection-internal-vocabulary-transforms)): transforms `lowering` field + consumers, `render.ts` transform comments, deterministic-projection concept. Allowlisted in the guard.

## Forbidden Actions Audit

Executor must record final status for:

- no publish;
- no user-level Claude/Codex config mutation;
- no install/trust/symlink/runtime activation;
- no remote addition;
- no merge without explicit approval;
- no accidental staging of the pre-existing `fixtures/external/repos.yaml` edit.

### Forbidden-action audit — final status

- **No publish**: confirmed. No `publish:packages`; only Changesets `.md` entries authored (one per package-facing branch). No npm publish.
- **No user-level Claude/Codex config mutation**: confirmed. Only repo-local files touched.
- **No install/trust/symlink/runtime activation**: confirmed. `skillset:build` writes generated repo output only; no global activation.
- **No remote addition**: confirmed. Existing `origin` only; `gt submit` pushed branches + opened draft PRs (explicitly authorized for this run).
- **No merge without approval**: confirmed. All PRs are DRAFT; nothing merged.
- **`fixtures/external/repos.yaml`**: preserved unstaged throughout (every `git add` used `:!fixtures/external/repos.yaml`); never committed. Verified after each commit.
- **Change-provenance**: the `.skillset/` guidance edits required change-entry coverage (`skillset:ci`); resolved by adding a SET-125 change entry and refreshing stale source-hash evidence in three older pending notes — the sanctioned evidence-accumulation path, not a forbidden action.

## Final State

**Complete.** SET-122..126 implemented, reviewed (5/5, 5/5, 5/5, 4/5, 4/5 — all findings fixed), verified, and submitted as stacked draft PRs #102–#106; full-stack review 5/5 (one P2 fixed). Linear SET-122..126 In Review with PR links; follow-up SET-135 filed. All gates green at submit: `typecheck`, `bun run test` (491), `skillset:build/check/lint/ci`, `bun run check`, `terminology:guard`, `git diff --check`, changeset guard. No unresolved P0/P1/P2. The cutover removed retired vocabulary from active code, schema, config, CLI/help, docs, generated guidance, tests, and self-hosted lock output, with a guard preventing regression.

### Archive readiness

Ready to archive to `.agents/plans/archive/` at merge readiness (per `.agents/plans/PLANNING.md`). Deferred until the maintainer reviews/merges the stack, since the packet currently rides on the open SET-122 branch.
