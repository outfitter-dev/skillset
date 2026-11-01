---
description: Current loss-accounting reproduction, bounded coverage inventory, and non-ratifying contract options for SET-492.
---

# SET-492 Loss Accounting Investigation

Seven authored listing values disappear from both manifests in a Claude-only fixture without a render-result diagnostic. The eighth historical value, `display_name`, now survives. This investigation establishes a current accounting gap and a bounded implementation path; it does **not** ratify a contract, change policy, or establish provider runtime fidelity.

Inspected revision: `8483eb123460f2309a53e3c848a7700daadda10d`, 346 commits ahead and zero behind the locally recorded `origin/main` at `24800e02ed4e7150ea1bc7130c35603c98ea9da2`. This is campaign-branch evidence, not a claim about shipped main. Capture date: October 31, 2026, America/New_York.

## Reproduction and retained evidence

A public `buildSkillsetResult` probe creates two independent disposable workspaces with a plugin skill, contained asset files, and eight canonical listing fields. One selects Claude; the other Claude and Codex. Default unsupported-destination policy remains unchanged.

| Selection | Physical output | Returned accounting |
| --- | --- | --- |
| Claude | Claude manifest contains `displayName`; neither it nor the Agent Plugins baseline contains the other seven values | Success; standard and Claude plugin-manifest results are rendered; no diagnostics |
| Claude and Codex | Claude output is unchanged; shared manifest's OpenAI interface serializes all eight values | Success; standard, Claude and Codex plugin-manifest results are rendered; no diagnostics |

The seven values are `screenshots`, `capabilities`, `privacy_policy_url`, `terms_of_service_url`, `color`, `composer_icon`, and `default_prompt`. A physically present standard baseline does not preserve these particular fields. Matching serialized values in a Codex extension establishes a structural observation, not provider execution or semantic equivalence.

- [Probe results](2026-10-31-set-492-probe.json) retain exact output objects and result summaries.
- [Reproduction script](../../../.agents/notes/2026-10-31-set-492/probe.ts) retains the synthetic source recipe. From the repository root, run `bun run test:sandbox -- bun .agents/notes/2026-10-31-set-492/probe.ts`; it prints JSON and uses only disposable fixture roots.
- [Field census](2026-10-31-set-492-fields.md) accounts for 15 canonical listing fields, five recognized portable-manifest keys, and 27 known presentation aliases. Open extras and other source families remain outside this finite census.
- [Production inventory](2026-10-31-set-492-producers.md) covers result construction, attached renderer evidence, collection, policy and persistence.

The four historical regressions remain covered by current local repairs. At this revision, `bun run test:focused -- packages/core/src/__tests__/render-result-build.test.ts packages/core/src/__tests__/output-state.test.ts` passed 123 tests and 554 assertions. Those controls do not prove complete field accounting.

## What changed since the earlier investigation

The [SET-492 issue](https://linear.app/outfitter/issue/SET-492) retains historical comments describing eight missing fields, no renderer-to-collector channel, and approximately 28 rendering sites. Current source has Claude display-name rendering and optional `RenderedFile.renderResults` attachments used by hooks and marketplace assets. Static production search finds 35 `defineRenderResult` calls plus its definition, with no named aliases found. These are lexical call sites, not 35 independent projection families or a proof that arbitrary result construction cannot occur.

The issue's later archaeology comment records the maintainer's **warning-first rollout preference**. Its original description still suggests blocking by default; the later comment takes precedence for this proposal. Existing ADR-0003 policy for already-classified lossy/unsupported outcomes is separate and must remain intact unless explicitly amended. A new result wire shape would also affect persisted locks despite private workspace packages; private packaging does not remove compatibility costs.

## Why the current type cannot establish completeness

`packages/core/src/render-result.ts` validates each constructed result. Runtime validation requires a string reason for degraded, lossy, unsupported and failed; evidence is optional. Static registry references explain a support judgment but do not identify the operation's omitted source field. A stronger discriminated type could reject malformed reported loss, but cannot reject a result that was never constructed or an incorrectly clean rendered result.

The collector combines lock-derived defaults, optional renderer attachments and separate graph analyses. Its default rendered classification proves output existence, not complete source-field preservation. Recomputing effective values independently from the renderer creates another potential divergence. Remote marketplace asset reporting already demonstrates a useful narrower pattern: compare effective source and actual output from the same rendering snapshot, then attach facts to the output.

## Options and recommended bounded direction

| Approach | Guarantee within its scope | Limit and cost |
| --- | --- | --- |
| Discriminated result type | Reported loss must carry operation-specific facts and a reason | Cannot detect a missing result or false rendered label; persisted readers and callers need migration |
| Renderer-owned accounting | Files and explicit accounted/omitted facts originate from the same effective projection | An empty fact list can still be wrong; conversion and negative tests are required per family |
| Collector reconciliation | Expected obligations are compared with reported facts, catching missing or duplicate claims within declared coverage | Requires a complete semantic inventory; duplicating renderer logic centrally can recreate drift |

Recommend a plugin-listing pilot combining schema-bound expected obligations with renderer-origin effective projection facts. Type tightening is a supplement. Use the 15 canonical fields and known alias normalization as the finite input boundary, and prove missing-claim detection before expanding to other families. Do not infer the meaning of every open metadata key. The five recognized portable-manifest fields require their own precedence and identity controls before joining the pilot.

An obligation must identify source unit and field, effective selection/scope, destination subject and actual output disposition. A sibling destination counts only when materialized in the same effective selection with the relevant value; an enabled flag or registry capability alone is insufficient. Native overrides may intentionally replace values, so the semantic treatment of replacement must be explicit. Standard and provider subjects can share a physical file and must remain distinguishable.

This is a recommendation for review, not an accepted field-routing framework. Start with the existing renderer/collector seam; do not invent a global ledger or require every byte-copy renderer to enumerate arbitrary fields.

## Acceptance and migration matrix

| Obligation | Required positive and negative controls |
| --- | --- |
| Finite coverage | Every canonical pilot field and registered target has a disposition; adding a schema field or target fails coverage until handled; alias normalization and shadowing are explicit |
| Missing evidence | Remove one producer claim or renderer assignment and prove the reconciliation identifies the unaccounted field; a clean rendered result cannot conceal it |
| Faithful sibling | Equal emitted value with selected artifact; disabled, scoped-away, missing and overridden sibling controls cannot claim preservation |
| Selection and identity | Workspace/plugin enablement, project-only scope, native manifest names, inherited authors and custom catalogs retain source identity |
| Policy | Newly discovered unaccounted cases are visible under the recorded warning-first rollout; existing strict lossy/unsupported and always-failed behavior stay unchanged; soft no-usable-output preserves carried evidence |
| Legitimate absence | Explicit scope exclusion, externally managed root guidance, native imports, adoption skips and ADR-0046 uncovered components remain distinct from silent loss |
| Historical locks | Existing result versions remain readable as historical evidence; no concrete loss facts are invented from old reasons or URLs; new writers and legacy readers have separate validation obligations |
| Reports and persistence | Build/diff/inspection/import/adopt, status/explain, conformance, output-less lock association and deterministic provenance preserve the same facts |

If persisted shape changes, design explicit wire versioning and legacy handling before implementation; do not tighten existing `@2` parsing in place. If the pilot uses existing fields only, prove that its new diagnostics and policy representation preserve reader behavior. Neither path follows automatically from this investigation. Scope, granularity, treatment of intentional replacement and warning presentation remain review decisions.

The governing boundaries are [ADR-0018](../../adrs/0018-render-results.md), [ADR-0003](../../adrs/0003-lossy-and-unsupported-output-policy.md), [ADR-0046](../../adrs/0046-provider-only-plugin-components-remain-uncovered.md), the [tenets](../../project/tenets.md), and [schema ownership](../schema-contracts.md). Any accepted amendment follows the repository ADR process as a new decision; this evidence does not edit accepted doctrine.

## Status

Investigation and finite pilot inventory are delivered for review. Structural enforcement, mutation controls, migration and broader-family coverage are not implemented. SET-492 remains open. The four local historical fixes, schema typing work and provider-conformance work retain their own narrower acceptance; none closes this class.
