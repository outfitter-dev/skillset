# References: Workbench Check And Authoring Correctness

## Tracked / Portable Sources

- `AGENTS.md` - repo operating rules, commands, generated-output constraints.
- `docs/tenets.md` - source contract and tooling doctrine.
- `.agents/plans/PLANNING.md` - repo planning/review preferences.
- `.agents/plans/2026-06-20-workbench-check-authoring-correctness/PLAN.md` - execution plan.
- `.agents/plans/2026-06-20-workbench-check-authoring-correctness/RETRO.md` - durable execution ledger.

## Untracked / Local-Only Sources

- `.scratch/design/2026-06-20-workbench-validation-rulesets.md` - scratch design note for Workbench command naming, presets, parser strategy, ast-grep proof, and rule scopes. Summarized into `PLAN.md` and Linear issues so execution does not depend on ignored files alone.

## Tracker Records

- Project: Skillset Workbench check and authoring correctness - implementation project with milestones M1-M5.
- `SET-153` - roadmap parent.
- `SET-154` - M1 command cutover.
- `SET-155`, `SET-156` - M2 diagnostics/presets/lint bridge.
- `SET-157`, `SET-158` - M3 parsers/schema.
- `SET-159`, `SET-160`, `SET-161` - M4 graph/resource/runtime/fixtures.
- `SET-162`, `SET-163`, `SET-164` - M5 ast-grep/docs/final verification.

## Branches

- `set-154-cut-cli-semantics-to-skillset-check-and-skillset-verify`
- `set-155-introduce-skillsetworkbench-diagnostic-primitives`
- `set-156-add-workbench-presets-rules-and-existing-lint-bridge`
- `set-157-add-bun-yamltoml-and-markdown-parser-backed-workbench-checks`
- `set-158-add-schema-backed-workbench-rules-for-source-contracts`
- `set-159-add-graph-and-provider-compatibility-workbench-rules`
- `set-160-add-resource-and-runtime-workbench-rules`
- `set-161-add-workbench-fixture-suite-for-good-and-bad-skillset-inputs`
- `set-162-add-bounded-ast-grep-backed-selector-rule-proof-point`
- `set-163-document-workbench-check-verify-presets-and-rule-authoring`
- `set-164-run-full-workbench-stack-verification-and-release-readiness`

## Validation Commands

- `bun test` - full test suite.
- `bun run typecheck` - TypeScript type safety.
- `bun run skillset:build` - regenerate self-hosted outputs.
- `bun run skillset:lint` - existing lint checks until folded into Workbench.
- `bun run skillset:check` - source authoring diagnostics after the M1 rename.
- `bun run check` - full repo gate.
- `bun ./apps/skillset/src/cli.ts check --root .` - Workbench smoke after M1/M2.
- `bun ./apps/skillset/src/cli.ts verify --root .` - generated-output smoke after M1.
