---
id: 22
slug: workflow-oriented-cli
title: Workflow-Oriented CLI With A Flat Loop And Explicit Domains
status: accepted
created: 2026-07-12
updated: 2026-07-20
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 5, 12, 19]
---

# ADR-0022: Workflow-Oriented CLI With A Flat Loop And Explicit Domains

## Context

Before the hard cut, the Skillset CLI had grown to 28 top-level commands. The
surface exposed implementation history rather than one authoring model:

- setup is split across `init`, `create`, and `adopt` even though init already surveys adoptable source;
- readiness is split across `check`, `lint`, `verify`, `doctor`, `change status`, and `ci` with overlapping reports and write modes;
- declared tests and ad hoc runtime tries share runners and retained evidence but use different top-level commands and cache vocabulary;
- managed output edits are described through the implementation-shaped `suggest-source` command instead of the source/output conflict the author must resolve;
- maintainer-only provider evidence refresh is shipped beside user-facing loadout commands;
- static feature knowledge is split between `features` and `lookup`;
- mutation intent is expressed through overlapping `--yes`, `--dry-run`, `--fix`, `--write`, and `--apply` flags.

Skillset is pre-1.0 and has no adoption burden that justifies carrying deprecated aliases. This is the cleanest point to cut the surface to the workflows the product owns.

## Decision

Skillset ships a 21-command workflow-oriented CLI. Frequent authoring and compilation actions remain flat, related lifecycle operations share one domain command, maintainer-only operations leave the public CLI, and obsolete names are removed without aliases.

### Governing rules

1. **Public commands solve author problems.** Repository maintenance belongs in package scripts.
2. **Keep the daily loop flat.** `check`, `build`, `update`, `diff`, and `reconcile` do not gain a noun-shaped middle layer.
3. **Group one domain, not vaguely related capabilities.** `change`, `release`, `test`, `marketplace`, and `hooks` own real state or lifecycle operations.
4. **Make drift direction explicit.** Ordinary source rendering, provider-format migration, and source/output conflict resolution are different operations.
5. **Checks write only narrowly classified ordinary drift.** They never hide provider-format evolution or target-side edits.
6. **Cut cleanly.** Removed commands, bins, flags, environment variables, help entries, docs, and generated guidance disappear rather than aliasing.
7. **Treat structured output as a separate contract.** Command consolidation does not mechanically add `--json` everywhere.

### Final command roster

| Area | Commands |
| --- | --- |
| Onboard | `create` · `init` · `import` |
| Author | `new` · `check` · `dev` · `reconcile` |
| Compile and maintain | `build` · `update` · `diff` · `restore` |
| Inspect | `status` · `list` · `explain` · `lookup` |
| Test | `test` |
| Ledgers | `change` · `release` |
| Distribution | `marketplace` · `distribute` |
| Runtime | `hooks` |

### Onboarding has three explicit owners

`skillset create [name]` creates a new named child repository. `skillset init
[directory]` initializes an existing directory and specializes the [one-action
adoption survey](0024-one-action-repo-adoption.md#adoption-surveys-the-whole-repo-not-just-manifests)
through repo-local `--adopt`. `skillset import <source>` remains the repeated-use
converter for a local path or provider-default root; its `--from` value selects
the provider origin rather than an acquisition location.

When a TTY is available and adopt-compatible sources are detected, init offers
to adopt all candidates, select individual candidates, or scaffold only. It
prints the complete plan before final confirmation. The original target-native
tree stays untouched; adoption writes Skillset source and retained provenance
only. In non-interactive runs, adoption never happens merely because a generic
write confirmation is present, and `init --yes` cannot silently expand
scaffolding into adoption.

Public `init --from`, Git URL acquisition, a top-level `adopt` command, and the
`create-skillset` package bin are unsupported. The `create` route remains part
of the current public CLI.

### Check is the one readiness family

`skillset check` answers one question: **is this workspace ready?** It combines source/schema validation, graph resolution, Workbench diagnostics, provider compatibility advisories, generated-output drift, change coverage, and relevant package Changesets policy.

| Command | Contract |
| --- | --- |
| `skillset check` | Comprehensive, read-only local readiness report. |
| `skillset check --only outputs` | Narrow generated-output assertion; replaces top-level `verify`. |
| `skillset check --write` | After all other checks pass, materialize only ordinary source-derived output drift. |
| `skillset check --ci` | The same engine with strict baseline resolution, non-interactive behavior, CI reporting, and stable automation exits. |
| `skillset check --ci --fix` | Repair only the same narrowly classified ordinary drift allowed by local `--write`. |

`check --write` and `check --ci --fix` refuse provider/compiler format migrations, managed output-side edits, lossy or unsupported destination changes, ambiguous ownership, unmanaged collisions, and every write when a non-drift check fails.

The narrow verification primitive remains reusable internally, but top-level `lint`, `verify`, and `ci` are removed. This preserves the [deterministic projection boundary](0019-deterministic-projection-and-adapter-conformance.md#projection-comparison): check composes compiler evidence rather than inventing a second renderer.

### Three drift directions have three owners

| Situation | Owner |
| --- | --- |
| Source changed and rendered output is stale | `build`, or narrow `check --write` after a clean readiness pass |
| Compiler/provider output format evolved without a source edit | `update` |
| Managed output was edited or source/output ownership conflicts | `reconcile` |

`skillset update` previews and applies registered, source-preserving provider/compiler format migrations. It refuses ordinary source drift, target-side edits, unregistered migrations, lossy changes, and manual-review cases. Check diagnoses update-shaped drift and prints the exact update command without applying it.

`skillset reconcile <managed-path>` replaces `suggest-source` and resolves a concrete source/output conflict. Its default is a read-only diagnosis and plan:

- `--use source` re-renders affected managed output when safe;
- `--use output` moves a proven single-source, lossless output edit into source when safe.

Reconcile reports ownership, lock provenance, affected paths, available resolutions, and refusal reasons. Generated changelog edits keep routing to `change reason`, `change amend`, or `release amend`, where those ledgers own the truth. Top-level `suggest-source` and its `--write --yes` grammar are removed.

### Test is one evidence family

`skillset test` owns committed declarations and ad hoc runtime evidence. This extends the separation between deterministic tests and evals in [Fixtures, Tests, Dogfooding, and Evals](0012-fixtures-tests-dogfooding-and-evals.md#deterministic-tests-are-implemented-product-surface): the distinction is input and assertion strength, not a second top-level verb.

```bash
skillset test [name]
skillset test --target codex --prompt "What skills can you see?"
skillset test --target claude --prompt-file prompts/smoke.md --background
skillset test status [run-id]
skillset test tail [run-id] --lines 80
skillset test list
```

A named declaration runs deterministic checks and any explicit committed runtime blocks. A flag-driven ad hoc test builds an isolated rendering and invokes the selected provider without claiming a committed assertion passed.

All runs share one retained model and index under the logical `.skillset/cache/tests/` namespace, with run kind and deterministic/runtime evidence recorded explicitly. Lifecycle names such as `status`, `tail`, and `list` are reserved from declaration names.

Top-level `try`, `.skillset/cache/runtime-tests/`, and every `SKILLSET_TRY_*` variable are removed. Runtime overrides use `SKILLSET_TEST_*` names only.

### Inspection commands have explicit boundaries

- `status` replaces `doctor` as the read-only human workspace health and advisory view. It may summarize check and change facts but does not replace their exit contracts.
- `list` inventories resolved source/output relationships without repurposing the existing source-root flag as a boolean selector.
- `explain <path>` reports workspace-specific source/output provenance.
- `lookup` teaches the static Skillset contract. `lookup features [id]` absorbs the feature registry command and continues to draw facts from the [registry-owned support model](0005-feature-reference-and-schema-registry.md#decision).

Top-level `doctor` and `features` are removed.

### Maintainer operations leave the public CLI

`skillset providers check|diff|update` fetches upstream provider evidence and rewrites this repository's registry snapshots. That is Skillset maintainer work, not a loadout author workflow. The functionality moves behind repository package scripts:

```bash
bun run providers:check
bun run providers:diff
bun run providers:update
```

The shipped CLI has no `providers` route. Ordinary checks and builds remain offline.

### Commands with distinct ownership stay distinct

- `marketplace` and `distribute` remain separate because catalog readiness and downstream distribution have different ownership.
- `import` remains distinct from one-time init/adoption because it is a repeated-use asset converter.
- `build` remains the explicit compile operation even though check has a narrow convenience write mode.
- `change` and `release` remain ledger domains with their own lifecycle operations.
- `hooks` remains the runtime integration domain.

### The hard-cut mapping is complete

| Today | Final contract |
| --- | --- |
| `init` | `init` |
| `create` | `create [name]` |
| `adopt` | `init [directory] --adopt …` |
| `import` | `import` |
| `new` | `new` |
| `suggest-source` | `reconcile` |
| `check` | comprehensive `check` family |
| `lint` | removed; source diagnostics live in `check` |
| `verify` | `check --only outputs` |
| `ci` | `check --ci` / `check --ci --fix` |
| `dev` | `dev` |
| `build` | `build` |
| `update` | `update` |
| `diff` | `diff` |
| `restore` | `restore` |
| `doctor` | `status` |
| `list` | `list` |
| `explain` | `explain` |
| `features` | `lookup features [id]` |
| `lookup` | `lookup` |
| `test` | declared and ad hoc `test` family |
| `try` | flag-driven `test` plus `test status|tail|list` |
| `change` | `change` |
| `release` | `release` |
| `providers` | removed; repository package scripts |
| `marketplace` | `marketplace` |
| `distribute` | `distribute` |
| `hooks` | `hooks` |

### Hard cut means no compatibility surface

No compatibility aliases are added:

- removed commands fail as unknown;
- removed package bins disappear from package metadata;
- removed environment variables are not read as fallbacks;
- removed flags fail as unknown;
- help, errors, tests, fixtures, docs, examples, workflows, generated guidance, and retained report labels use only the final contract;
- historical ADRs, changelogs, and completed issue evidence may retain old vocabulary when clearly historical.

### Structured output remains a separate decision

ADR-0023 defines the structured-output contract: versioned envelopes, stdout purity, structured failures, canonical command identity, common result shapes, JSON versus streaming formats, exceptions, schemas, and contract tests.

The completed flag audit ran before the parser-heavy implementation and reviewed retired or duplicated vocabulary, including `--layout`, `--source`, `--dist`, and the mutation flag family.

## Non-Goals

- No source-contract, target-rendering, lock-format, trust, install, activation, or publishing changes.
- No marketplace/distribution merge.
- No eval or subjective grading framework.
- No compatibility layer for pre-1.0 command names.
- No requirement that every command emit one finite JSON document.

## Consequences

### Positive

- Twenty-one top-level commands map to workflows rather than implementation history.
- Onboarding, readiness, tests, and managed drift each have one obvious entry point.
- Ordinary writes, provider-format updates, and source/output reconciliation cannot silently collapse into each other.
- Maintainer-only network refresh no longer expands the public product surface.
- Hard cutovers reduce code, tests, docs, and future removal work.

### Tradeoffs

- This intentionally breaks every script or local habit using removed names.
- Check becomes broader and needs one shared report model with precise selection and exit contracts.
- Test run storage and environment variables change again shortly after the try cutover.
- Interactive init requires a deterministic non-interactive equivalent and stable candidate identifiers.

### Risks

- `check --write` could become a general build shortcut. It therefore writes only ordinary source-derived drift after a fully clean check.
- `check --ci --fix` could hide meaningful conflicts. Update-shaped and reconcile-shaped drift always fail with explicit next actions.
- Flag-driven ad hoc tests could become ambiguous with named declarations. Runtime flags and lifecycle words are reserved and validated before execution.
- Reconcile could imply unsafe bidirectional sync. Both directions remain explicit, plan-first, provenance-backed, and allowed only when losslessness is proven.

## Completed Implementation Map

- [SET-274](https://linear.app/outfitter/issue/SET-274) - parent execution program.
- [SET-276](https://linear.app/outfitter/issue/SET-276) - promote this ADR into the repository.
- [SET-275](https://linear.app/outfitter/issue/SET-275) - audit and normalize the public flag vocabulary.
- [SET-277](https://linear.app/outfitter/issue/SET-277) - unify init and adoption.
- [SET-278](https://linear.app/outfitter/issue/SET-278) - consolidate check, verification, and CI behavior.
- [SET-279](https://linear.app/outfitter/issue/SET-279) - preserve update as the provider-format migration workflow.
- [SET-280](https://linear.app/outfitter/issue/SET-280) - unify declared and ad hoc tests.
- [SET-281](https://linear.app/outfitter/issue/SET-281) - extract provider maintenance into repository scripts.
- [SET-282](https://linear.app/outfitter/issue/SET-282) - replace source suggestions with reconcile.
- [SET-283](https://linear.app/outfitter/issue/SET-283) - consolidate status and lookup inspection surfaces.
- [SET-284](https://linear.app/outfitter/issue/SET-284) - define structured output separately.
- [SET-285](https://linear.app/outfitter/issue/SET-285) - reconcile documentation, workflows, fixtures, and generated guidance.

## Acceptance Evidence (2026-07-20)

SET-312 and SET-366 verified the final onboarding grammar and roster before
this decision was accepted. Skillset has 21 top-level commands: `build`,
`change`, `check`, `create`, `dev`, `diff`,
`distribute`, `explain`, `hooks`, `import`, `init`, `list`, `lookup`,
`marketplace`, `new`, `release`, `reconcile`, `restore`, `status`, `test`, and
`update`.

Onboarding has three distinct owners. `create [name]` creates a named child
repository. `init [directory]` initializes an existing directory and owns
repo-local `--adopt`. `import` repeatedly converts a local path or
provider-default root; its `--from` value selects provider origin. Public
`init --from`, Git URL acquisition, and a top-level `adopt` command are
unsupported. The old `create-skillset` package bin remains removed, but the
`create` route is current. `cli-commands.ts`, `cli-contract.ts`, parser parity
tests, `docs/reference/cli-flags.md`, and layout/adoption tests prove this final
roster and hard cut.

## References

- [Tenets](../tenets.md) - source-first, no-trust, and visible-drift doctrine governing the command boundary.
- [ADR-0000: Source-First Loadouts](0000-source-first-loadouts.md) - source remains the authored truth while commands inspect or render it.
- [One-Action Repo Adoption](0024-one-action-repo-adoption.md) - adoption survey, lowering, provenance, and original-tree guarantees specialized by `init`.
- [Fixtures, Tests, Dogfooding, and Evals](0012-fixtures-tests-dogfooding-and-evals.md) - separates deterministic tests, runtime evidence, and evals.
- [Deterministic Projection and Adapter Conformance](0019-deterministic-projection-and-adapter-conformance.md) - compiler verification primitives composed by check.
- [Feature Reference and Schema Registry](0005-feature-reference-and-schema-registry.md) - registry-backed static support facts exposed through lookup.
- [Tests and Evals](../features/tests-and-evals.md) - current declared and ad hoc shared-runner behavior.
- [Source Suggestions](../features/source-suggestions.md) - current managed-output recovery safety model replaced by reconcile.
- [Target Surfaces](../target-surfaces.md) - provider evidence and safe update boundaries.
- [Linear working ADR](https://linear.app/outfitter/document/adr-draft-workflow-oriented-cli-flat-loop-explicit-domains-56e12cc1025b) - discussion history and implementation map.
- [SET-274](https://linear.app/outfitter/issue/SET-274) - parent implementation program for SET-275 through SET-285.
