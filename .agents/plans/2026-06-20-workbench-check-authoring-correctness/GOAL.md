# Goal Prompt: Workbench Check And Authoring Correctness

Paste this into the goal runtime:

````markdown
/goal From `/Users/mg/Developer/outfitter/skillset`, execute `.agents/plans/2026-06-20-workbench-check-authoring-correctness/PLAN.md` end to end; use `.agents/plans/2026-06-20-workbench-check-authoring-correctness/RETRO.md` as the durable ledger.

Read first: `AGENTS.md`, `docs/tenets.md`, `PLAN.md`, `REFS.md`, `.scratch/design/2026-06-20-workbench-validation-rulesets.md`, and Linear `SET-153` through `SET-164`.

Objective: implement Workbench as Skillset's source/workspace correctness surface: `skillset check` becomes Workbench, generated-output freshness becomes `skillset verify`, and the stack adds diagnostics, `WorkbenchPreset`/presets, parser/schema checks, graph/resource/runtime checks, fixtures, ast-grep proof, docs, and generated guidance.

Work loop: build a Graphite stack in issue order `SET-154`..`SET-164`. For each milestone branch: implement the slice, update tests/docs/generated output, run focused checks, update `RETRO.md`, then launch local reviewer subagents for API/architecture, correctness/tests, and docs/DX. Require score */5 plus line-level P0-P3 findings. Fix every P0-P3 finding and repeat until 5/5 and no P0-P3, then move up the stack.

Validation ladder: run narrow tests after each slice; before each branch handoff run relevant targeted tests plus `bun run typecheck` when code changed; before stack ready run `bun test`, `bun run skillset:build`, `bun run check`, `skillset check` and `skillset verify` smoke tests, fixture JSON checks, generated drift checks, and terminology guard. If skipped, record why and substitute proof.

Hard rules: clean cutover only, no old `check` compatibility alias; no package publish, no merge, no user/global Claude/Codex config mutation, no plugin activation/trust install; do not execute untrusted hook/script fixture code; use Bun YAML/TOML primitives where sufficient; keep ast-grep bounded and optional/proven.

Done only when all milestone branches and PRs are ready for review, local reviews are 5/5 with no P0-P3, checks pass, Linear state is current, docs/generated guidance are updated, and `RETRO.md` has final tracker, PR, review, verification, forbidden-action, risk, and archive-readiness state. Final transcript must name the proof.

Stop/ask if plan/repo/tracker truth diverges, command/package boundary scope changes are needed, required external secrets/systems are missing, unrelated verification fails after focused retry, or Graphite cannot safely create/submit the stack.
````
