---
description: Records the scope, dispositions, evidence links, and remaining review decisions for the SET-433 transform audit.
---

# SET-433 transform inventory overview

**Status: open; this is a reviewable inventory, not issue completion.** Code baseline `5b53799f470916d97eac13a4b7ecb8ab96762648`; external comparison baseline `8a5d5b282ade4f5aa2fa8e506fe1297890bce037`. The hook-binding guard (`f640`) and resource-literal correction (`2a933`) each received independent review 5/5; full verification recorded 4,470 and 4,484 passes respectively, with three known deferred native-size failures in each run. The supports suffix fix (`5b53799f`) received review 5/5 and 223 focused passes; full verification recorded 4,496 passes and the same three deferred native-size failures. None is an aggregate green-gate claim.

This inventory records recognized input, emitted shape, implementation owner, tests, evidence and limitations. It classifies local serialization as such without requiring provider runtime proof. Native file preservation is not proof of provider execution; source normalization and destination equivalence are separate. The [SET-433 issue](https://linear.app/outfitter/issue/SET-433/audit-skillset-for-hard-coded-transforms-and-implicit-target) remains open for evidence review, approved exceptions and external semantic-fidelity work.

## Dispositions

| Code | Meaning |
|---|---|
| D1 | Exact semantic match with evidence at the recognizer's full breadth. |
| D2 | Intentional serialization or format normalization. |
| D3 | Provider-native and kept target-specific. |
| D4 | Ambiguous; preserve verbatim or require explicit author intent. |
| D5 | Lossy or unsupported; make the loss or refusal visible. |
| D6 | Unsafe hard-coded transformation to remove or address in a focused remediation. |

D1 cannot follow from string equality, schema validity or a source URL alone. [ADR-0048](../../adrs/0048-adoption-is-a-reviewable-migration.md) names a narrow positive: unchanged selected Claude manifest name/description with guarded source/canonical/selected-output equality. It does not authorize unrelated transformations. Source-owned selector/path identity and serializers are generally D2, not generic provider semantic claims.

## Evidence pages

- [Search scope and coverage](./2026-10-30-set-433-search-scope.md)
- [Manifest and marketplace fields](./2026-10-30-set-433-field-projections.md)
- [Source lifecycle and migration](./2026-10-30-set-433-source-lifecycle.md)
- [Render and rules](./2026-10-30-set-433-render-rules.md)
- [Hook adaptation](./2026-10-30-set-433-hook-adaptation.md)
- [MCP, licenses and agents](./2026-10-30-set-433-mcp-license-agent.md)
- [Setup, identities and distribution](./2026-10-30-set-433-identity-distribution.md)
- [Readiness and native islands](./2026-10-30-set-433-readiness-islands.md)
- [Guards, guidance and skill helpers](./2026-10-30-set-433-guards-and-guidance.md)
- [Target topology exceptions](./2026-10-30-set-433-topology-exceptions.md)
- [Pinned external comparison](./2026-10-30-set-433-external-comparison.md)

## Current correction and qualification status

- D6 catalog key overwrite and same-name owner attribution mismatch were repaired at `135c11ed` and `002e8103` (PRs 797 and 798). Named and invalid catalog entries now receive warnings; selected metadata assignments remain observations with unknown runtime fidelity.
- D6 accidental hook rebinding across source move/rename was repaired by the `f640` before/after identity guard, including active/draft cases. The `2a933` resource fix protects fenced/inline ordinary links and preserves the distinct marked-reference controls. See verification limits above.
- D6 supports suffix collapse was repaired at `5b53799f`: prereleases are explicitly unsupported, malformed build metadata fails, valid build metadata does not affect precedence. The full gate has 4,496 passes and three deferred native-size failures; no support for prerelease ordering is claimed.
- Active cross-owner workspace shared partials/resources resolve to root, carried skill-local paths move with the skill, or the shadow build fails before applying. Direct and nested `plugin:` references moved plugin→workspace fail; `root:` is retired; `preprocess:false` has no previously realized preprocess binding. These bounded findings replace the earlier broad rebinding hypothesis, not all possible dependency guarantees.
- External A/B/C captured seven pins: four produced selected output and three were blocked. The 88 available generated files repeat byte-identically, but raw release state differs by `updatedAt`. ADR-0019 covers deterministic projection outputs, locks, core facts and reports; the six raw adoption-state timestamps differ. Preserve that variability and do not claim raw-source byte determinism. Byte equality alone does not prove provider semantic fidelity.

## Remaining acceptance review

1. Review the per-family dispositions and current provider evidence at the exact accepted recognizer breadth. In particular, qualify adaptive hook event timing, matcher, payload and output before reading `lossless-adaptive` as provider equivalence; native-lift assessments already retain unknown. MCP proof identity remains D4 for normalized/plugin-scoped names. The confirmed remote acquisition collision is repaired in #804; server-specific alias equivalence remains D4. These are scoped D4 questions, not demands for runtime proof of every D2/D3 row.
2. Confirm negative corpus and coverage where named in the evidence pages; retain explicit unclassified or unsupported behavior and record accountable accepted exceptions. A finite operational search and reasoned exclusions are documented; counts are not proof all strings mean the same thing.
3. The [pinned external comparison](./2026-10-30-set-433-external-comparison.md) now accounts for all 88 available outputs against original sources and retains the raw evidence in a tracked packet. Review the remaining license-notice omission, dependency gap, changed declared skill membership and blocked fixtures; none is accepted by repeatability. Raw timestamp variability remains distinct from ADR-0019 projection scope. SET-439 owns dependency/curation, SET-438 lifecycle scan/readiness and SET-444 fixture infrastructure; SET-433 owns mapping dispositions and exception closeout.
4. Keep revision-specific verification visible: draft PRs [799](https://github.com/outfitter-dev/skillset/pull/799), [800](https://github.com/outfitter-dev/skillset/pull/800), and [801](https://github.com/outfitter-dev/skillset/pull/801) carry the hook-binding, resource-literal and supports fixes respectively. All have exact final reviews of 5/5 and three deferred native-size failures; no aggregate passing receipt or provider execution is claimed.

## Reconciled draft outcome map

| Outcome | Current evidence and remaining scope |
| --- | --- |
| Finite inventory and search | Family pages and search-scope record enumerate owners, shapes, tests and bounded exclusions. Counts are coverage evidence, not semantic proof. |
| Confirmed unsafe mappings/reporting | Hook status #803 and remote origin #804 are reviewed draft repairs; native notice #806 preserves lone notices and blocks ambiguous imports. Their family pages record exact limits. |
| External preservation | Historical #805 retains all 88 source-relative qualifications. The subsequent [license recapture](./2026-10-30-set-433-external-comparison.md#license-boundary-recapture) records three selected projections and four blocked fixtures; historical A/B/C repeatability is not transferred to this single capture. |
| Provider semantics | D2 local serialization and bounded D3 native representation have structural/source evidence. Hook payload/environment/matcher and MCP source-owner proof remain D4. No universal provider-runtime equivalence is accepted. |
| Focused follow-ups | SET-439 owns missing runtime dependencies and explicit membership shape; SET-438 lifecycle scan/readiness; SET-442 field/provenance review; SET-444 fixture infrastructure and expectations. Linked work is not completed by this inventory. |
| Exceptions | None accepted. Historical notice loss, missing dependencies and changed declared membership remain documented gaps; preserving D4 unknowns is not an exception. SET-433 remains open for final evidence/acceptance review. |

Drafts [#805](https://github.com/outfitter-dev/skillset/pull/805) and [#806](https://github.com/outfitter-dev/skillset/pull/806) publish the retained evidence and license correction. Exact verification and release-record limits are stated on the comparison page. Nothing here marks the campaign merged, runtime-qualified or complete.
