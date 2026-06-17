# Derive/Render Terminology Cutover Plan

## Objective

Complete the derive/render/destination terminology cutover as a focused stacked branch push. The work should remove old vocabulary from active code, schemas, config, CLI/help output, docs, generated Skillset guidance, fixtures, and tests where it is not intentionally historical, while preserving behavior until the deliberate config/data-model changes land.

The intended outcome is a clean foundation for the next hooks sprint. New hook work should not have to carry `lowering`, `projection`, or overloaded `target` terminology debt forward.

## Included Issues

| Order | Issue | Branch | Scope |
| --- | --- | --- | --- |
| 1 | [SET-122](https://linear.app/outfitter/issue/SET-122/mechanical-rename-to-render-result-vocabulary) | `set-122-mechanical-rename-to-render-result-vocabulary` | Mechanical, behavior-preserving rename pass. No config contract changes here unless required to keep tests compiling. |
| 2 | [SET-123](https://linear.app/outfitter/issue/SET-123/cut-config-over-to-compileunsupporteddestination) | `set-123-cut-config-over-to-compileunsupporteddestination` | Canonical config key becomes `compile.unsupportedDestination`; remove old key from active source, docs, schemas, tests, and generated guidance unless explicitly historical. |
| 3 | [SET-124](https://linear.app/outfitter/issue/SET-124/separate-target-and-destination-in-render-result-data) | `set-124-separate-target-and-destination-in-render-result-data` | Make `target` mean provider/runtime adapter and `destination` mean concrete output/scope under that target in render-result data. |
| 4 | [SET-125](https://linear.app/outfitter/issue/SET-125/refresh-docs-and-generated-guidance-for-deriverender-vocabulary) | `set-125-refresh-docs-and-generated-guidance-for-deriverender` | Refresh active docs, self-hosted `.skillset/` guidance, generated `.agents`/`.claude` outputs, and examples. |
| 5 | [SET-126](https://linear.app/outfitter/issue/SET-126/add-terminology-guard-for-deriverender-cutover) | `set-126-add-terminology-guard-for-deriverender-cutover` | Add a guard/check so old terminology does not drift back into active surfaces; keep explicit allowlists for historical ADR/plan/archive context and third-party/provider terms. |

## Current State

- Repo branch at planning time: `main`, synced to `origin/main`.
- Open GitHub PRs at planning time: none.
- Latest package/release at planning time: `v0.13.4`.
- Graphite current stack at planning time: just `main`.
- Pre-existing local edit to preserve: `fixtures/external/repos.yaml` adds a `mattpocock-skills` external fixture. Do not revert, stage, or include this file unless Matt explicitly assigns that separate change.
- Linear status at planning time: SET-122 through SET-126 are all Backlog in project `Skillset derive/render terminology cutover`.

## Vocabulary Contract

Use these terms in active code and adopter-facing docs:

- `build`: end-user operation that produces or checks generated files.
- `derive`: source-to-plan/source-to-intermediate reasoning where the compiler determines names, defaults, relationships, and intended output.
- `render`: materializing native output content from resolved source/plan data.
- `target`: provider/runtime adapter such as `claude`, `codex`, future `gemini`, etc.
- `destination`: concrete output or scope under a target, such as plugin hook aggregate, generated skill file, project instruction file, project agent file, plugin manifest, or user/global destination.
- `render result`: structured result/evidence for what a render/build did.
- `unsupported destination` / `unsupported destination policy`: policy for a destination that cannot represent source faithfully.

Avoid in active adopter-facing language:

- `lowering`, `lower`, `lowered`, except where retained for historical ADR/plan context, direct prior-art quotes, or third-party/provider terminology.
- `projection`, except where describing a truly mathematical/design concept in historical context or an external tool's vocabulary.
- `lowering outcome`, `loss ledger`, and similar old names in active schemas, CLI output, generated guidance, feature docs, and tests.

## Execution Strategy

Use one branch per issue in the order above. Prefer Graphite if its local state is healthy; otherwise use ordinary git branches and record the reason in `RETRO.md`.

Keep the first branch mechanical. It may rename files/types/functions/tests and update references, but it should not also change the public config key or semantic behavior. If a pure mechanical pass is impossible because the old names are embedded in schema contracts, record that boundary and keep the smallest compatibility-free cutover that still compiles.

Do not preserve deprecated aliases merely for compatibility. This repo is still pre-adoption enough to cut cleanly. Unknown obsolete config/schema keys should fail unless the source is explicitly historical or target-native.

## Likely Surfaces

Start with targeted searches, then update deliberately:

- `packages/core/src/**` for build/render/result/policy/types.
- `apps/skillset/src/**` for CLI help, commands, diagnostics, and generated output checks.
- `docs/tenets.md`, `docs/layout.md`, `docs/target-surfaces.md`, and `docs/features/**`.
- `.skillset/**` source guidance and generated `.agents/**` / `.claude/**`.
- `fixtures/**` and tests that assert old wording, schema names, config keys, lock/report structures, or CLI output.
- `package.json` scripts if the new guard needs a named command and should be part of `bun run check`.

Be careful with broad search-and-replace. Classify each hit before editing:

- active product surface: update;
- internal active code/schema: update;
- historical ADR/archived packet: usually allowlist;
- provider-native or third-party quote: preserve and allowlist if needed;
- external fixture content: preserve unless Skillset generated it.

## Validation Ladder

Use narrow checks while developing each branch, then run the full ladder before final handoff:

- `git diff --check`
- `bun run typecheck`
- `bun test`
- `bun run skillset:build`
- `bun run skillset:check`
- `bun run skillset:lint`
- `bun run check`

Also run terminology-specific checks once SET-126 exists. If generated output changes, inspect it and keep `.skillset/` as source truth.

## Local Review Loop

Use local subagents as reviewers before finalizing branch slices and again on the full stack.

Review request shape:

```markdown
Overall score: n/5

Summary:
<one short prose judgment>

Findings:
- P0/P1/P2/P3 — <file:line> — <finding>
  Prompt To Fix With AI:
  <concise fix prompt>

No-findings statement:
<what was inspected and what residual risk remains>
```

Required review lanes:

- Mechanical rename reviewer: hunts accidental semantic changes, missed old active names, and wrong historical rewrites.
- Config/schema reviewer: checks `compile.unsupportedDestination`, schema/config validation, CLI/docs examples, and clean rejection of obsolete active keys.
- Data/model reviewer: checks target/destination boundary, lock/report/render-result structures, and no fake compatibility.
- Docs/guidance reviewer: checks adopter-facing language, generated guidance, tenets alignment, and no old names in active docs.
- Guard reviewer: checks the terminology guard is useful, not noisy, and has explicit allowlists.

Fix all P0/P1/P2 findings. Fix P3 findings when bounded and useful; otherwise create or update Linear follow-up issues and record them in `RETRO.md`.

## Source-Control And Tracker Expectations

- Start from `main`.
- Keep the plan packet on the lowest branch in the stack if committing it.
- Open draft PRs if the execution environment/user asks for PR submission; keep them draft until local checks and local review are clean.
- Do not merge or publish unless Matt explicitly authorizes that phase.
- Move Linear issues to In Progress when work starts; move to In Review when PRs are ready; move to Done only after merge/accepted completion. Record any divergence in Linear comments and `RETRO.md`.

## Stop Rules

Stop and ask if:

- the work would mutate user-level Claude/Codex config, install/trust/symlink runtime artifacts, publish packages, or add remotes;
- official/provider docs or local Grid docs contradict the target/destination assumptions;
- a public compatibility alias appears necessary despite the clean-cutover direction;
- full verification stays broken after a focused retry and the failing surface is not shrinking;
- the pre-existing `fixtures/external/repos.yaml` edit blocks clean branching or test execution.

## Completion

The goal is complete only when:

- SET-122 through SET-126 are implemented, reviewed, verified, and tracker-aligned, or any explicitly deferred slice has a Linear comment and `RETRO.md` entry;
- active source, schema, CLI/help, tests, docs, generated guidance, and self-hosted output use the new vocabulary consistently;
- the terminology guard is installed in the right local gate;
- local reviewer subagents report no unresolved P0/P1/P2 findings;
- all required checks pass or skips are justified;
- `RETRO.md` records branch/PR/tracker state, checks, review rounds, unresolved P3s, forbidden-action audit, and final state.
