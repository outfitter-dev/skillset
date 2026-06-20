# Goal Plan: Workbench Check And Authoring Correctness

Date: 2026-06-20
Status: In progress

## Objective

Implement Skillset Workbench as the source/workspace correctness surface: cut `skillset check` over to Workbench, rename generated-output freshness to `skillset verify`, add diagnostics/presets/parser-backed rules/fixtures/docs, and submit the Graphite stack ready for review.

## Completion Condition

The goal is complete only when:

- Linear project "Skillset Workbench check and authoring correctness" and issues `SET-153` through `SET-164` reflect the implementation state.
- A Graphite stack implements each milestone in order with one coherent branch per milestone or narrower issue where needed.
- Each milestone branch has passing focused checks and a local reviewer loop with score 5/5 and no remaining P0-P3 findings.
- Full-stack verification proves `skillset check`, `skillset verify`, Workbench diagnostics, fixtures, generated-output freshness, docs, generated guidance, and repo checks behave as intended.
- Stack PRs are submitted and marked ready for review only after local checks/reviews are clean.
- `RETRO.md` has been updated as the durable execution record and final state ledger.

## Non-Goals

- Do not implement a full eval platform.
- Do not implement broad third-party code execution for rule packs beyond explicit opt-in scaffolding or a bounded proof.
- Do not preserve old `skillset check` semantics or backwards-compat aliases.
- Do not publish packages, merge PRs, or mutate user/global Claude/Codex runtime config.

## Source Of Truth

Read first:

1. `AGENTS.md`
2. `docs/tenets.md`
3. `.scratch/design/2026-06-20-workbench-validation-rulesets.md`
4. Linear project "Skillset Workbench check and authoring correctness"
5. Issues `SET-153` through `SET-164`
6. `.agents/plans/2026-06-20-workbench-check-authoring-correctness/RETRO.md`

## Work Plan

### M1: Check/Verify Command Cutover

Issue: `SET-154`

Intent:
- Reserve `skillset check` for Workbench source/workspace correctness.
- Move current generated-output freshness/currentness behavior to `skillset verify`.

Actions:
- Rename command routing/tests/scripts/docs/generated guidance.
- Keep the cutover clean; no old `check` compatibility alias.

Verification:
- Focused CLI tests for `check` and `verify`.
- `bun run skillset:build`
- `bun run check`

Done when:
- `skillset verify` proves generated output freshness.
- `skillset check` invokes Workbench behavior or a narrow Workbench entrypoint.
- M1 local review is 5/5 with no P0-P3.

### M2: Workbench Diagnostics And Presets

Issues: `SET-155`, `SET-156`

Intent:
- Introduce `@skillset/workbench` primitives and route existing lint checks through Workbench.

Actions:
- Add diagnostics, scope, subject, rule, result, formatter, `WorkbenchPreset`, built-in `standard` and `strict`.
- Bridge `@skillset/lint` findings into Workbench diagnostics.
- Add `--preset`, `--scope`, `--rule`, `--format json` where practical.

Verification:
- Package tests for diagnostics/presets/formatters.
- CLI JSON/text output tests.
- `bun run check`

Done when:
- Existing lint behavior is visible through `skillset check`.
- M2 local review is 5/5 with no P0-P3.

### M3: Parser And Schema Checks

Issues: `SET-157`, `SET-158`

Intent:
- Replace ad hoc parsing assumptions with Bun YAML/TOML and Markdown AST facts.
- Add schema-scope diagnostics for invalid source contracts.

Actions:
- Add parser adapters using Bun primitives by default.
- Add remark/unified for Markdown facts/locations.
- Add schema diagnostics for representative source surfaces.

Verification:
- Malformed YAML/TOML/frontmatter/Markdown fixtures.
- Schema failure fixtures for skills/config/agents/hooks.
- `bun run check`

Done when:
- `syntax.*` and `schema.*` diagnostics are covered by tests.
- M3 local review is 5/5 with no P0-P3.

### M4: Graph, Resource, Runtime Rules And Fixtures

Issues: `SET-159`, `SET-160`, `SET-161`

Intent:
- Catch workspace relationship errors and resource/runtime mistakes that single-file schema checks cannot see.

Actions:
- Add graph/provider/resource/runtime checks.
- Add positive and negative Workbench fixtures.
- Ensure no hook/script execution occurs during checks.

Verification:
- Fixture-backed JSON diagnostics for clean and failing workspaces.
- `skillset verify` stale/fresh fixture expectations.
- `bun run check`

Done when:
- Good/bad fixtures prove key rules.
- M4 local review is 5/5 with no P0-P3.

### M5: ast-grep Proof, Docs, Final Review

Issues: `SET-162`, `SET-163`, `SET-164`

Intent:
- Prove ast-grep can help as a bounded structural/code-pattern backend.
- Finish docs, self-hosted guidance, final full-stack review, and release-readiness evidence.

Actions:
- Add one explicit ast-grep-backed rule or adapter proof.
- Update docs, AGENTS, source skills, generated output.
- Run final local review and full validation ladder.

Verification:
- ast-grep proof test or explicit skip behavior.
- `bun run skillset:build`
- `bun run check`
- Manual command smoke tests for `skillset check` and `skillset verify`.

Done when:
- Full stack local review is 5/5 with no P0-P3.
- PRs are submitted ready for review and `RETRO.md` is finalized for handoff.

## Tracker Plan

- Project: Skillset Workbench check and authoring correctness
- Parent: `SET-153`
- Child issues in order: `SET-154`, `SET-155`, `SET-156`, `SET-157`, `SET-158`, `SET-159`, `SET-160`, `SET-161`, `SET-162`, `SET-163`, `SET-164`
- Dependency chain: each issue blocks the next in order.
- Update issue comments/status when a milestone starts, enters review, and is submitted.
- File follow-up issues only for real out-of-scope findings discovered during implementation or review.

## Source-Control Plan

- Branching model: Graphite stack.
- Branch order:
  1. `set-154-cut-cli-semantics-to-skillset-check-and-skillset-verify`
  2. `set-155-introduce-skillsetworkbench-diagnostic-primitives`
  3. `set-156-add-workbench-presets-rules-and-existing-lint-bridge`
  4. `set-157-add-bun-yamltoml-and-markdown-parser-backed-workbench-checks`
  5. `set-158-add-schema-backed-workbench-rules-for-source-contracts`
  6. `set-159-add-graph-and-provider-compatibility-workbench-rules`
  7. `set-160-add-resource-and-runtime-workbench-rules`
  8. `set-161-add-workbench-fixture-suite-for-good-and-bad-skillset-inputs`
  9. `set-162-add-bounded-ast-grep-backed-selector-rule-proof-point`
  10. `set-163-document-workbench-check-verify-presets-and-rule-authoring`
  11. `set-164-run-full-workbench-stack-verification-and-release-readiness`
- PR strategy: draft until local checks and local review are clean; ready only after final stack verification.
- Cleanup before merge: finalize `RETRO.md`; archive packet only after user-approved merge flow.

## Retro Discipline

`RETRO.md` is part of the completion contract, not optional notes.

- Update `RETRO.md` after meaningful implementation, tracker, verification, local review, remote review, CI, PR-body, or packaging changes.
- For stacked work, touch `RETRO.md` last before local completion, draft submission, ready-for-review, remote review closeout, merge readiness, or final handoff.
- Every meaningful review-flow change must have a corresponding retro entry before claiming the review loop is complete.

## Validation Ladder

Run checks from narrow to broad:

- Targeted CLI/package tests for changed command/rule/parser modules.
- `bun test`
- `bun run typecheck`
- `bun run skillset:build`
- `bun run skillset:lint`
- `bun run skillset:check` until renamed, then `bun run skillset:verify`
- `bun run check`
- Manual smoke: `bun ./apps/skillset/src/cli.ts check --root .`, `bun ./apps/skillset/src/cli.ts verify --root .`, and fixture-specific JSON checks.

## Local Review

Required after every milestone and after the full stack.

Reviewer lanes:

- API/architecture reviewer: command boundaries, package API, plain-core boundary, naming, and extensibility.
- Correctness/test reviewer: rule behavior, fixtures, JSON/text output, false positives/negatives, and generated-output verification.
- Docs/DX reviewer: docs, help text, AGENTS/generated guidance, examples, and command vocabulary.

Reviewer output contract:

- Overall score: `n/5`
- Prose summary: concise judgment
- Findings: P0/P1/P2/P3, with file/line evidence where applicable
- Prompt To Fix With AI for each actionable finding

Fix all P0-P3 findings before moving to the next milestone. If a P3 is truly out-of-scope, create/update a Linear follow-up and record the decision in `RETRO.md`.

## Progress Reporting

After each execution checkpoint, report:

- Current checkpoint
- What changed
- What was verified
- Command/output summary
- What remains
- Blocker status
- Next checkpoint

## Stop / Pause Rules

Stop and ask if:

- Live repo or tracker state contradicts this plan in a way that changes command naming, package boundaries, or issue scope.
- A public API/scope change beyond Workbench check/verify is required.
- Verification fails repeatedly for unrelated repo reasons and the failing surface is not shrinking.
- Secrets, publishing, user/global config mutation, plugin activation, or registry writes are needed.
- Graphite cannot safely create/submit the stack.

## Handoff Audit

- [x] Objective is singular and end-to-end.
- [x] Completion condition is objectively checkable.
- [x] Tracker state is current.
- [x] Branch names/order are exact.
- [x] Dependencies/blockers are represented.
- [x] Ignored/untracked source docs are summarized in tracked packet files.
- [x] Validation commands match repo conventions.
- [x] `GOAL.md` requires transcript-visible proof.
- [x] `GOAL.md` requires `RETRO.md` finalization before completion.
- [x] Stop rules are concrete.
- [x] `RETRO.md` has concrete sections for execution, tracker, review, verification, remote state, forbidden actions, final state, and archive readiness.
- [x] Packet can be executed without chat history.
