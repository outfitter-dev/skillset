---
slug: lowering-outcomes-and-loss-ledger
title: Lowering Outcomes and Loss Ledger
status: draft
created: 2026-06-14
updated: 2026-06-14
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, feature-reference-and-schema-registry, core-library-boundary, deterministic-projection-and-adapter-conformance]
---

# ADR: Lowering Outcomes and Loss Ledger

## Context

Skillset now lowers one source tree into multiple target-native projections, and the interesting failures are no longer limited to "a file did or did not render." A source unit can emit directly, pass through a target-native island, transform into a different target shape, degrade into a useful shim, preserve metadata without target enforcement, skip because the current build scope excluded it, or fail because the target cannot faithfully represent the authored intent.

The feature registry records the static support envelope for a feature: what Skillset believes Claude and Codex can represent. Build results need a different record: what actually happened to a particular source unit for a particular target under this root config, scope, and policy. Without that distinction, generated output can look clean while a lossy or unsupported lowering silently disappears, and reviewers have to infer target drift from warnings instead of structured facts.

Skillset needs a loss ledger: a normalized collection of lowering outcomes that records emitted output, deliberate skips, degraded fallbacks, unsupported surfaces, and future lossy decisions without putting bulky provenance into target-facing files.

## Decision

Skillset treats lowering outcomes as the per-build ledger of what happened when source intent met target reality. The feature registry says what a target is capable of in general; lowering outcomes say what this build did with this source unit.

### Outcome Records

A lowering outcome is a schema-stamped fact with a stable source selector, feature id, optional target, status, policy, reason, output refs, diagnostics, and evidence. The current schema is `skillset-lowering-outcome@1`.

This means:

- `sourceUnit` names the resolved Skillset source selector, such as `skill:<name>`, `plugin:<plugin>.skill:<skill>`, `plugin:<plugin>.feature:<feature>`, `agent:<name>`, or a target-native island selector.
- `featureId` names the registry feature involved, such as `standalone-skills`, `plugin-skills`, `project-instructions`, `dependencies`, `plugin-bin`, or `target-native-islands`.
- `target` is present when the outcome is target-specific and absent for workspace-owned or non-target workflow facts.
- `outputs` list generated paths only when the source unit produced output in the selected build scope.
- `reason` is required for `degraded`, `lossy`, `unsupported`, and `failed` outcomes because those statuses are not self-explanatory enough to review safely.
- `policy` records why an outcome was allowed, excluded, disabled, or routed through an unsupported policy.
- `evidence` links the outcome back to docs, source, tests, fixtures, or provider docs so adapter conformance can audit the claim.

The ledger belongs in structured build results, future lock/report surfaces, doctor/explain output, and conformance fixtures. It should not be rendered into ordinary `SKILL.md`, `CLAUDE.md`, `AGENTS.md`, plugin manifest, hook, app, MCP, or resource files by default.

### Status Vocabulary

Lowering outcomes use a build-result vocabulary, not the feature registry's static support vocabulary.

| Status | Meaning | Default policy |
| --- | --- | --- |
| `emitted` | Skillset emitted a target-native representation that faithfully carries the source intent. | Succeeds when validation passes. |
| `target_native` | The source was intentionally target-owned or opaque, so Skillset passed it through or copied it only to the matching target. | Succeeds when the escape hatch is explicit, validated for path safety, and scoped to the matching target. |
| `transformed` | Skillset changed shape while preserving intent, such as source instructions becoming Claude rules or Codex `AGENTS.md` files. | Succeeds when the transform is implemented, documented, and covered by tests or registry evidence. |
| `metadata_only` | Skillset preserved the fact for provenance, release state, sidecars, or reports, but the target does not enforce the behavior directly. | Succeeds when docs explain that target behavior is not enforced. |
| `degraded` | Skillset emitted a useful fallback that is intentionally weaker than a native target feature. | Succeeds only with a reason, evidence, and visible diagnostics/reporting; policy gates may later let projects fail on degraded output. |
| `lossy` | The available lowering would drop required meaning or behavior. | Fails by default unless a later policy explicitly permits a visible, reviewed exception. |
| `unsupported` | The enabled target cannot represent the authored feature through portable lowering. | Fails by default unless the source is scoped away, the target is disabled, or an explicit unsupported policy records the exception. |
| `externally_managed` | The relevant behavior belongs to install, activation, distribution, marketplace state, or another system outside `skillset build`. | Succeeds when build does not pretend activation happened and points to the external owner. |
| `intentionally_skipped` | Skillset did not emit output because a build scope, target toggle, or explicit policy excluded it. | Succeeds only with a policy such as `scope:excluded`, `target:disabled`, or an explicit unsupported policy. |
| `failed` | Skillset attempted to lower or validate the source unit and could not produce a safe output. | Fails with diagnostics. |

The test for adding a new status is strict: if a reviewer cannot tell from the status whether output exists, whether target behavior is faithful, and whether the build should normally pass, the status is too vague.

### Capability Status Is Not Outcome Status

The feature registry records static capability and support, using target support statuses such as `native`, `pass_through`, `transformed`, `metadata_only`, `degraded`, `externally_managed`, `unsupported`, `lossy`, and `future`. Those rows answer, "Can this target generally represent this feature, and with what caveats?"

Lowering outcomes record build facts, using statuses such as `emitted`, `target_native`, `transformed`, `degraded`, `unsupported`, and `intentionally_skipped`. Those rows answer, "What happened to this source unit during this build?"

The mapping is intentionally not one-to-one. A registry `native` capability usually produces an `emitted` outcome, not a `native` outcome. A registry `pass_through` capability produces `target_native` when the source was explicitly target-owned. A registry `degraded` capability can produce `degraded` only when the build actually emitted the fallback. A registry `unsupported` capability may produce `unsupported`, `intentionally_skipped`, or no outcome at all if the source unit is outside the current build scope.

### Policy Semantics at Drafting

The default unsupported policy is `error`. If source cannot lower faithfully to an enabled target, the safe default is a failing build/check with a structured outcome. Softer policies are escape hatches for migration and provider drift, not proof of portability.

Skillset reserves these policy values:

| Policy | Meaning |
| --- | --- |
| `default` | The normal compiler policy for the selected source and target. |
| `scope:excluded` | The source unit would have an outcome, but the current build scope excluded its output. |
| `target:disabled` | The source unit is valid, but the target is disabled by config or a scoped target toggle. |
| `unsupported:error` | Unsupported or lossy lowering is treated as a build failure. |
| `unsupported:warn` | Unsupported lowering remains visible in diagnostics and reports but does not fail. |
| `unsupported:skip` | Unsupported lowering emits no target output and records the skip as a ledger fact. |
| `unsupported:force` | A future explicit escape hatch allowed output despite unsupported portable semantics; forced output must stay target-native or debug-only and must not pretend portability. |

`warn`, `skip`, and `force` are allowed vocabulary before they are allowed user-facing behavior. SET-84 owns the enforcement work that makes these policies authoritative build gates. Until then, implementation branches should prefer explicit errors for unsafe lowering and must never drop unsupported source silently.

The preceding reservation is preserved as the historical implementation state
of this draft. SET-18 later implemented the non-error gates with warning
diagnostics and lock provenance; [Lossy and Unsupported Output Policy](../0003-lossy-and-unsupported-output-policy.md)
records the current decision and amendment to ADR-0001.

### Clean Generated Output

Generated target files should stay clean by default. Ordinary Claude and Codex output is a native projection for humans and provider runtimes, not a ledger dump. Heavy provenance belongs in `skillset.lock`, structured operation results, reports, doctor/explain output, `.skillset/cache/` artifacts, or recovery material under `.skillset/snapshots/`.

Visible sentinels, source markers, or debug comments in generated target files are deferred. They may be useful for debugging or reverse-inspection modes, but they should be opt-in and must not become the default currency gate. The default check is source plus generated output plus lock/report provenance, not hand-patching generated files.

### Examples

A standalone skill that compiles for both targets produces `emitted` outcomes for `standalone-skills`. The source unit is `skill:<name>`, the target is `claude` or `codex`, and `outputs` points at the generated target `SKILL.md` files.

A target-native Codex `.rules` island produces `target_native`. The source unit records that the author intentionally chose a Codex-only surface, and only Codex output receives the file.

Project instructions produce `transformed`. The source intent is portable instructions; Claude receives rules while Codex receives `AGENTS.md` files. The generated filenames differ because the outcome records the lowering, not a file-copy claim.

A plugin dependency lowered to Claude can be `emitted` because Claude has a native plugin dependency surface. The same dependency lowered to Codex can be `degraded` because Codex currently receives awareness material rather than a native dependency resolver. The degraded Codex outcome requires a reason and evidence.

A plugin-local `bin/` directory for a Codex-enabled plugin is `unsupported` because Codex plugins do not expose a documented plugin-local bin contract. The outcome must be visible through diagnostics, reports, or policy-specific skip/error handling.

Distribution destinations, global installs, marketplace activation, and runtime harness state are `externally_managed` when they appear in a build or distribution report. Skillset can plan or explain those surfaces, but `skillset build` must not claim that activation or trust happened.

## Non-Goals

This ADR does not define reverse sync from generated output to source, generated-output patch acceptance, provider runtime activation checks, public adapter APIs, eval scoring, or the final report file format for persisted outcomes. It also does not make `compile.unsupported: warn|skip|force` a fully implemented user-facing policy; those gates need explicit implementation and tests.

The final sentence preserves the boundary when this draft was written. SET-18
later implemented those gates under `compile.unsupportedDestination`; the
successor policy ADR supersedes that implementation limitation.

## Consequences

### Positive

Future branches can implement lock/report persistence, doctor/explain rendering, policy gates, warning migration, and conformance fixtures against one vocabulary. Reviewers can ask whether a source unit was emitted, transformed, degraded, skipped, or rejected without reading target files by hand.

The distinction between registry capability and build outcome keeps docs honest. A target can have a degraded support row without every build producing degraded output, and a build can record `intentionally_skipped` without changing the feature's support status.

### Tradeoffs

Structured outcomes make result schemas part of the compiler contract. Renaming statuses or changing required fields becomes a compatibility decision, not a local refactor.

The ledger adds a second thing to review alongside generated files. That is intentional: generated files prove bytes, while lowering outcomes prove meaning and target honesty.

### Risks

The current body-level semantic boundary is still limited. Frontmatter and config keys can be classified reliably by schemas and registry rows, but Markdown body contract changes, such as a rewritten invocation section, are harder to detect without author-declared regions. Until those regions exist, change severity and loss detection remain strongest for structured source and weaker for prose.

Policy vocabulary can create false confidence if the compiler records `unsupported:skip` without a clear user-facing gate. SET-84 must make policy enforcement explicit, and SET-82/SET-83 must make persisted/reporting surfaces easy to inspect.

That risk records the pre-implementation state. The current policy
enforcement, diagnostics, and persisted reporting surfaces satisfy the named
prerequisite and must remain inspectable.

## Non-Decisions

This ADR does not decide whether pending lowering outcomes appear in committed generated changelogs, how runtime adapters execute activation probes, how Trails will consume Skillset as a library, or whether future source regions can carry author-declared semantic severity. Those decisions belong to the change/release, tests/evals, Trails integration, and source provenance tracks.

## References

- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - governing source and generated-output doctrine.
- [ADR-0001: Root Compile Policy](../0001-root-compile-policy.md) - root target selection and unsupported policy context.
- [Feature Reference and Schema Registry](20260604-feature-reference-and-schema-registry.md) - static feature capability and registry evidence model.
- [Core Library and CLI Boundary](20260612-core-library-boundary.md) - places structured compiler facts in `@skillset/core`.
- [Deterministic Projection and Adapter Conformance](20260613-deterministic-projection-and-adapter-conformance.md) - uses lowering outcomes with the feature registry for adapter conformance.
- [Lowering Outcomes](../../features/render-results.md) - reader-facing vocabulary and examples.
- [Lossy and Unsupported Output Policy](../0003-lossy-and-unsupported-output-policy.md) - current policy decision and ADR-0001 amendment.
- SET-79, SET-82, SET-83, SET-84, SET-85, and SET-86 - historical implementation stack for vocabulary, persistence, diagnostics, gates, fixtures, and warning migration.
