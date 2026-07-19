# Drift Audit — 2026-07-18

Comprehensive intent-vs-implementation sweep of the Skillset codebase: where the
code has drifted from documented/decided intent, where structures are
hand-maintained and drift-prone, and where consolidation would simplify.
Organized by **cross-cutting pattern**, not by file area, so related findings can
be batched into fewer issues/changes.

This repository-maintained corpus is durable engineering evidence. Linear owns
execution workflow status; [FINDING-DISPOSITIONS.md](FINDING-DISPOSITIONS.md)
maps each finding to its current disposition, one owning issue, and merged proof
when resolved. Add new evidence to the matching pattern note and add exactly one
row to that map.

## Notes

| Note | Pattern | Findings | Severity center |
| --- | --- | --- | --- |
| [00-cli-vs-mcp.md](00-cli-vs-mcp.md) | There is no MCP surface — the premise itself was drift | 3 | info |
| [01-cursor-rollout.md](01-cursor-rollout.md) | Cursor first-class rollout is half-landed everywhere | 9 | high |
| [02-schema-runtime-contract-gaps.md](02-schema-runtime-contract-gaps.md) | Schema accepts what runtime rejects, ignores, or never reads | 7 | high |
| [03-governance-and-docs-lag.md](03-governance-and-docs-lag.md) | ADRs and feature docs lag settled implementation | 10 | medium |
| [04-derive-dont-enumerate.md](04-derive-dont-enumerate.md) | Hand-enumerated subsets where a derived source of truth exists | 8 | medium-high |
| [05-boundaries-and-command-shell.md](05-boundaries-and-command-shell.md) | Operations misfiled in the CLI + no shared command shell | 8 | medium |
| [06-workflow-ergonomics.md](06-workflow-ergonomics.md) | Asymmetric verbs and buried recovery paths | 6 | medium |

## The load-bearing observations

1. **Cursor is the epicenter.** The single largest cluster: Cursor was made a
   default compile target, but the attachment parser drops it, the island loader
   never loads `_cursor/**`, ~12 feature docs omit it, its ADR draft explicitly
   says it should *not* be default yet, and a hand-maintained event-casing map
   will silently emit malformed `hooks.json` when the registry gains an event.
   One "finish the Cursor cutover" sweep closes ~9 findings (note 01).

2. **The `readProviders` bug is a *class*, not an instance.** The same shape —
   enumerate two of three targets, or an if/else with a `.cursor` fallback —
   appears in at least 8 places (notes 01, 04). A lint/guard banning target
   literals outside designated modules would prevent recurrence, not just fix
   instances.

3. **Schema-wider-than-runtime is the recurring contract failure.** Provider
   overrides, `run.*` fields, `status:`, `codex: {mode: symlink}`, workspace
   top-level keys: schema validates, runtime rejects/ignores/throws. The tenets
   say drift should be visible early; these are exactly where it isn't (note 02).

4. **~10 ADR drafts are accepted-in-practice**; the decision map cannot express
   that, and accepted ADR-0001 now contradicts shipping code. One promotion +
   supersession batch fixes the governance record (note 03).

5. **The docs drift is one story, not thirty.** Feature-doc target-rendering
   tables lag the Cursor default; everything else checked out clean — the recent
   CLI grammar cutover is accurately documented everywhere (note 03).

6. **Boundary moves unlock the rest.** Moving `test-runner`, `ciSkillset`, and
   provider maintenance to their owning packages removes most of the app's 55
   `core/internal` imports; a shared command shell then deletes the 13-way
   duplication of json/exit/render scaffolding (note 05).

## Suggested batching (fewest changes, most cleanup)

- **Batch A — Cursor completion sweep** (note 01, plus cursor rows in 03/04):
  parser fix, island loader, derived event casing, docs tables, ADR promotion
  decision on default-target status. Mostly mechanical once the default-target
  question is decided.
- **Batch B — contracts single-sourcing** (notes 02, 04): core imports schema
  contract key sets; semver/target-list/retired-surface literals derived; add a
  guard test. Small, high drift-prevention payoff.
- **Batch C — ADR promotion + docs refresh** (note 03): promote
  accepted-in-practice drafts, record supersessions, amend ADR-0001, update
  feature-doc tables (can be largely templated from `feature-registry.ts`).
- **Batch D — command shell + report renderer** (note 05): one `runCommand`
  shell, one scaffold-report renderer; then the per-command files shrink.
- **Batch E — workflow verbs** (note 06): `change refresh`, `change discard`,
  `restore --list`, terminal recovery hints. Independent, user-facing wins.

## Linear tracking (2026-07-19)

This audit is now tracked as the Linear project **"Drift-audit remediation:
intent, contracts, and consolidation"**
(https://linear.app/outfitter/project/drift-audit-remediation-intent-contracts-and-consolidation-ed53f43d61e4),
with the findings doc mirrored at
https://linear.app/outfitter/document/drift-audit-findings-and-evidence-2026-07-18-3278cc4a3cbb.
Issues SET-313–SET-351 span seven milestones (Execution readiness; Cursor
cutover completion; Contract single-sourcing; Governance record catch-up;
Command shell and core boundaries; Workflow recovery ergonomics; Discovered
follow-ups). MCP (note 00) is explicitly out of that project's scope. Update
Linear for workflow status and update the disposition map only when ownership,
disposition, or merged proof changes.

## Status legend

Findings carry: **confirmed** (code-verified this session) / **plausible**
(single-agent report, not independently verified) / **decided-needed** (requires
a product/design decision before mechanical work).

Two findings already have durable owners (do not double-file):

- `readProviders` cursor drop ([SET-314](https://linear.app/outfitter/issue/SET-314/fix-readproviders-silently-dropping-cursor-from-hook-attachment-provider-lists))
- change-coverage recovery hint in terminal ([SET-328](https://linear.app/outfitter/issue/SET-328/print-structured-recovery-guidance-for-skillset-check-ci-failures))
