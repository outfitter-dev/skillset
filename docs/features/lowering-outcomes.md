# Lowering Outcomes

Feature id: `lowering-outcomes`

Related vocabulary: [Feature Reference Vocabulary](README.md#feature-reference-vocabulary)

Lowering outcomes are Skillset's per-build ledger for target truth. They record what happened when a source unit was lowered for a target: output emitted, target-native file passed through, source transformed, metadata preserved, fallback degraded, feature skipped, behavior externally managed, or lowering rejected.

The feature registry answers a static question: "Can Claude or Codex generally represent this feature?" Lowering outcomes answer a build question: "What did this build do with this source unit under this config, scope, and policy?"

See [Lowering Outcomes and Loss Ledger](../adrs/drafts/20260614-lowering-outcomes-and-loss-ledger.md) for the ADR-level decision.

## Current Boundary

The current core schema is `skillset-lowering-outcome@1`. Outcome records are produced by `@skillset/core` and are persisted in structured operation results, generated `.skillset.lock` files, and adopt reports. Future `doctor`, `explain`, and adapter conformance surfaces should read the same ledger instead of inventing parallel diagnostics. Outcomes are not written into ordinary generated `SKILL.md`, `CLAUDE.md`, `AGENTS.md`, plugin manifest, hook, MCP, app, or resource files by default.

| Field | Meaning |
| --- | --- |
| `schema` | Outcome schema stamp. Current value: `skillset-lowering-outcome@1`. |
| `sourceUnit` | Stable source selector for the source unit that was lowered or considered. |
| `sourcePath` | Optional source path used for diagnostics and review. |
| `featureId` | Feature registry id, such as `standalone-skills`, `dependencies`, `plugin-bin`, or `project-instructions`. |
| `target` | Target provider when the fact is target-specific. |
| `status` | Build outcome status. |
| `reason` | Required for degraded, lossy, unsupported, and failed outcomes. |
| `policy` | Why an outcome was allowed, skipped, disabled, or routed through unsupported policy. |
| `outputs` | Generated paths for outputs produced in the selected build scope. |
| `diagnostics` | Structured diagnostic refs when validation or lowering needs a machine-readable pointer. |
| `evidence` | Registry evidence such as docs, source, tests, fixtures, or external provider docs. |

The schema intentionally keeps source identity and target output identity together. A single source feature can produce different outcomes for Claude and Codex without pretending the target files are equivalent.

## Outcome Statuses

| Status | Meaning | Typical example |
| --- | --- | --- |
| `emitted` | Skillset emitted a faithful target-native representation. | A standalone skill rendered to target `SKILL.md`. |
| `target_native` | Explicit target-owned source was passed through or copied only to its target. | A Codex-only target-native island or Claude-only plugin companion. |
| `transformed` | Skillset changed the file shape while preserving the authored intent. | `.skillset/instructions` lowered to Claude rules and Codex `AGENTS.md`. |
| `metadata_only` | Skillset preserved information for provenance or sidecars, but the target does not enforce it directly. | Release changelog projection or tool-intent sidecar. |
| `degraded` | Skillset emitted a useful fallback that is weaker than a native target feature. | Codex dependency awareness material when Claude has native plugin dependencies. |
| `lossy` | Lowering would drop required meaning or behavior. | Future body/contract loss where no faithful target shape exists. |
| `unsupported` | The enabled target cannot represent the authored feature through portable lowering. | Codex plugin-local `bin/` or plugin agents. |
| `externally_managed` | The behavior belongs to install, activation, distribution, marketplace state, or another external owner. | A distribution destination or runtime activation result. |
| `intentionally_skipped` | Skillset did not emit output because scope, target config, or policy excluded it. | `skillset build --scope project` excluding plugin output. |
| `failed` | Skillset attempted lowering or validation and could not produce safe output. | Invalid generated path, malformed target-native file, or unsafe mapping. |

`degraded`, `lossy`, `unsupported`, and `failed` require `reason` because they are review-sensitive. A future report may render them differently, but the machine record should always explain why the outcome exists.

## Policy Values

| Policy | Meaning |
| --- | --- |
| `default` | Normal compiler policy. |
| `scope:excluded` | Output was excluded by the selected build scope. |
| `target:disabled` | Target was disabled by config or source-level target toggle. |
| `unsupported:error` | Unsupported/lossy lowering fails the build. |
| `unsupported:warn` | Unsupported/lossy lowering is reported but does not fail. |
| `unsupported:skip` | Unsupported/lossy lowering emits no target output and is recorded as skipped/unsupported. |
| `unsupported:force` | A future explicit override allows a target-native/debug output without pretending portability. |

The default posture is error. `warn`, `skip`, and `force` are reserved escape hatches until policy gates are implemented, persisted, and documented through the SET-84 branch. When these policies are used internally or transitionally, they must still surface through outcomes, diagnostics, or reports.

## Target Lowering

| Source pattern | Claude outcome | Codex outcome | Notes |
| --- | --- | --- | --- |
| Standalone skill | `emitted` | `emitted` | Both targets can receive a native `SKILL.md` projection. |
| Plugin skill | `emitted` | `emitted` | Plugin boundaries stay intact while target manifests differ. |
| `.skillset/instructions` | `transformed` | `transformed` | Claude receives rules; Codex receives directory-local `AGENTS.md`. |
| Target-native island | `target_native` for matching target | `target_native` for matching target | Non-matching targets do not receive output. |
| Plugin dependencies | `emitted` | `degraded` | Claude has a native dependency surface; Codex receives awareness material. |
| Plugin `bin/` | `target_native` | `unsupported` | Claude receives the plugin-root bin feature output; Codex has no documented plugin-local bin contract. |
| Plugin agents | `target_native` | `unsupported` | Claude can carry plugin agents; Codex plugin output cannot. |
| Change/release metadata | `metadata_only` | `metadata_only` | Preserved for provenance and generated changelog state, not target runtime enforcement. |
| Distribution or activation state | `externally_managed` | `externally_managed` | Build may plan or report it, but does not activate or trust runtimes. |

## Diagnostics

- Unsupported and lossy lowering should fail by default for enabled targets unless a scoped opt-out or explicit unsupported policy applies.
- Degraded outcomes should remain visible because they represent useful but weaker behavior.
- Skipped outcomes need policy provenance so a clean build is not confused with silent omission.
- Explain and doctor output should eventually summarize outcomes by source unit, feature id, target, status, and policy.
- Adapter conformance tests should compare feature-registry support rows with produced outcomes or lowering errors.

## Provenance

Outcome provenance belongs in structured operation results, generated `.skillset.lock` files, and `.skillset/build/adopt/report.json` today. Adopt Markdown reports render a compact count summary and point readers at the structured JSON and isolated lockfiles. Generated target files stay clean by default. Debug sentinels or source markers in target files are a future opt-in, not a default generated-output contract.

## Evidence

- [Lowering Outcomes and Loss Ledger](../adrs/drafts/20260614-lowering-outcomes-and-loss-ledger.md) defines the decision and status semantics.
- [Deterministic Projection and Adapter Conformance](../adrs/drafts/20260613-deterministic-projection-and-adapter-conformance.md) defines how outcomes pair with the feature registry for conformance.
- `packages/core/src/lowering-outcome.ts` defines the current schema, status values, policy values, and validation rules.
- `packages/core/src/lowering-outcome-collector.ts` derives outcomes from generated locks, target-native companions, transformations, and unsupported plugin features.
- `packages/core/src/__tests__/lowering-outcome-build.test.ts` proves emitted, target-native, transformed, unsupported, isolated-path, resolver-error, and scoped outcomes.
