# 03 — ADRs and feature docs lag settled implementation

The code moved; the decision record and docs didn't. Not cosmetic: the decision
map actively misstates what's settled, an accepted ADR contradicts shipping
behavior, and the feature docs mislead about default build output.

## ADR / governance

### 03.1 — ADR-0001 (accepted) says warn/skip/force are "reserved, not enabled"; code ships all three (confirmed, HIGH)
- `docs/adrs/0001-root-compile-policy.md:41,63` vs
  `packages/core/src/build.ts:116-119,379-399`, `render-result-policy.ts`,
  schema enum `packages/schema/src/contracts.ts:14`.
- Enablement was authorized only by the unpromoted draft
  `20260705-post-tools-policy-boundary` (SET-18).
- **Fix:** amend ADR-0001 (or supersede) to record the enablement.

### 03.2 — ~10 drafts are accepted-in-practice but still `status: draft` (confirmed, MEDIUM-HIGH)
- Code hard-depends on: `20260702-portable-agent-authority-intent`,
  `20260705-post-tools-policy-boundary`, `20260614-lowering-outcomes-and-loss-ledger`,
  `20260712-workflow-oriented-cli`, `20260712-versioned-structured-output`,
  `20260627-named-partials`, `20260627-skillset-workspace-layout`,
  `20260630-reason-only-change-ledger-derived-state`,
  `20260613-deterministic-projection-and-adapter-conformance`, and (contested —
  see note 01.5) `20260702-cursor-is-a-first-class-provider`.
- **Fix:** a promotion batch via the `skillset-adrs` skill/scripts.

### 03.3 — `unified-source-layout` is dead but records no supersession (confirmed, MEDIUM)
- No `.skillset/src/` exists; `20260627-skillset-workspace-layout` supersedes it
  in prose (lines 140-141) but both sit at `draft`, `superseded_by: null`.
- **Fix:** record the supersession (promote workspace-layout, mark
  unified-source-layout superseded).

### 03.4 — `decision-map.json` cannot express reality (confirmed, MEDIUM)
- Generated from frontmatter only
  (`.skillset/skills/skillset-adrs/scripts/lib/decision-map.ts:385-396`);
  supersession is written only on `promote`. With nothing promoted: 28 uniform
  drafts, zero supersessions. Mechanically accurate, substantively misleading.
- **Fix:** falls out of 03.2/03.3. Optionally add an `accepted-in-practice`
  interim status if promotion is deliberately slow.

### 03.5 — "Lowering outcomes" renamed to "render results" without ADR update (confirmed, LOW)
- Schema is `skillset-render-result@1` (`packages/core/src/render-result.ts:5`)
  vs the ADR's `skillset-lowering-outcome@1`; vocabulary otherwise matches.
- **Fix:** amend the ADR during the 03.2 promotion pass.

### 03.6 — try→test cutover not byte-clean (confirmed, LOW)
- `SKILLSET_TRY_*` env names persist in `scripts/cli-contract.ts:44-47`;
  `try-cli.ts` still imported by `test-cli.ts` — against the workflow-CLI ADR's
  "removed names disappear."
- **Fix:** rename env vars, fold/rename `try-cli.ts`.

### 03.7 — Not-yet-audited drafts (open)
- Spot-checked only: `path-references-resolve-and-rename-together`,
  `source-manifest-listing-metadata`, `changelog-and-versioning`,
  `change-release-edge-decisions`, `fixtures-tests-dogfooding-and-evals`,
  `source-test-selection-shape`, `yaml-formatting-and-bun-native-apis`,
  `global-xdg-managed-installs-and-sync`, `feature-reference-and-schema-registry`,
  `core-library-boundary`, `source-change-release-provenance`. Follow-up pass
  worthwhile on the first three.

## Feature docs

### 03.8 — Cursor lag in target-rendering tables (confirmed; itemized in note 01.6-01.8)
- Significant: `commands.md`, `hooks.md`, `skills.md`, `instructions.md`,
  `layout.md` rendering sections, `quickstart.md` output listings.
- Moderate: `agents.md`, `mcp-servers.md`, `resources.md`, `plugins.md`.
- Minor: `marketplaces.md`, `executables.md`, `target-native-islands.md`.
- Everything else checked clean, including the entire recent CLI grammar
  cutover (init/create/`--from`/removed flags) — accurately documented
  everywhere. `target-surfaces.md`, `runtime-adapters.md`, `tools-policy.md`
  show what "done" looks like.

### 03.9 — Root cause: target tables are hand-written prose mirroring `feature-registry.ts` (decided-needed, the leverage point)
- Every stale table duplicates data the registry already owns
  (`packages/core/src/feature-registry.ts` support matrix). The repo already
  generates provider guidance from source.
- **Direction:** generate the per-feature "Target Rendering" tables from the
  feature registry (or add a docs-drift check comparing table rows to registry
  rows). Turns pattern 03.8 from a recurring chore into a guard. This is the
  "satisfied by one change" candidate for the whole docs cluster.

### 03.10 — `source-suggestions.md` status row to verify (plausible, LOW)
- "Provider-native output with no adaptive round trip → Refuse … `planned`"
  (`docs/features/source-suggestions.md:31`) — unverified whether that refusal
  path is wired. Check when touching reconcile (note 02.7).

## Batch shape
One ADR promotion/amendment batch (03.1-03.5) via the skillset-adrs tooling;
one docs batch that ideally lands as table-generation (03.9) rather than 12
hand-edits; 03.6 rides any nearby CLI PR.
