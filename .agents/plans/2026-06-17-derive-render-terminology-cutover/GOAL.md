# Goal Prompt

````text
Work in /Users/mg/Developer/outfitter/skillset. Execute the terminology cutover stack in .agents/plans/2026-06-17-derive-render-terminology-cutover/PLAN.md. Objective: complete SET-122/123/124/125/126 so active Skillset code, schemas, config, CLI/help, docs, tests, fixtures, generated guidance, and self-hosted output consistently use derive/render/build, target vs destination, render result, and unsupported destination policy. This tees up the hooks sprint without old naming debt.

Read first: AGENTS.md, docs/tenets.md, .agents/plans/PLANNING.md, packet PLAN.md/REFS.md/RETRO.md, and the five Linear issue briefs. Preserve user work: fixtures/external/repos.yaml has a pre-existing mattpocock-skills edit; do not revert/stage/include it unless Matt explicitly assigns that change.

Use one branch per issue, preferring Linear branch names and stack order: SET-122 set-122-mechanical-rename-to-render-result-vocabulary; SET-123 set-123-cut-config-over-to-compileunsupporteddestination; SET-124 set-124-separate-target-and-destination-in-render-result-data; SET-125 set-125-refresh-docs-and-generated-guidance-for-deriverender; SET-126 set-126-add-terminology-guard-for-deriverender-cutover. Use Graphite if healthy; otherwise vanilla git and record why. Keep packet on the lowest branch if committed. Draft PRs are okay if this run is authorized to submit; do not merge or publish without explicit approval.

Execution contract: first branch should be mechanical/behavior-preserving; second cuts config to compile.unsupportedDestination with no legacy alias unless a hard blocker is documented; third makes target=provider/runtime and destination=concrete output/scope in render-result data; fourth refreshes active docs and generated guidance; fifth adds a terminology guard with explicit allowlists for historical ADR/archive/provider terms. Do not broad-replace blindly; classify old terms as active product/internal/historical/provider/external fixture before editing.

Verification loop: run narrow relevant tests per branch; before handoff run git diff --check, bun run typecheck, bun test, bun run skillset:build, bun run skillset:check, bun run skillset:lint, bun run check, plus the new terminology guard. Inspect generated diffs; .skillset/ remains source truth. Update RETRO.md after every meaningful code/doc/generated/tracker/check/review change and before claiming completion.

Local review loop: launch reviewer subagents for mechanical rename, config/schema, target-destination data model, docs/guidance, and guard quality. Require score /5, summary, P0-P3 findings, and Prompt To Fix With AI for actionable findings. Fix all P0/P1/P2. Fix bounded useful P3s; otherwise create/update Linear follow-ups and record them in RETRO.md. Run a full-stack review after branch reviews and fixes.

Stop rules: stop/ask before user-level Claude/Codex config mutation, install/trust/symlink, publish, adding remotes, retaining old public aliases for compatibility, or proceeding after repeated non-shrinking verification failures. Done only when SET-122..126 are implemented or explicitly deferred with Linear comments, tracker state matches repo/PR state, checks pass or skips are justified, no unresolved P0/P1/P2 remain, and RETRO.md has final state, forbidden-action audit, unresolved P3s, and archive readiness.
````
