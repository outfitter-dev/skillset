# Render Results

Feature id: `render-results`

Related vocabulary: [Feature Reference Vocabulary](README.md#feature-reference-vocabulary)

Render results are Skillset's per-build report for target truth. They record what happened when a source unit was rendered for a target: output rendered, target-native file passed through, source transformed, metadata preserved, fallback degraded, feature skipped, behavior externally managed, or render rejected.

The feature registry answers a static question: "Can Claude or Codex generally represent this feature?" Render results answer a build question: "What did this build do with this source unit under this config, scope, and policy?"

See the render-results ADR, currently filed as [Lowering Outcomes and Loss Ledger](../adrs/drafts/20260614-lowering-outcomes-and-loss-ledger.md), for the historical decision.

## Current Boundary

The current core schema is `skillset-render-result@1`. Build, diff, and verify render-result records are produced by `@skillset/core` and are persisted in structured operation results, generated `skillset.lock` files, adopt reports, and the `doctor` / `explain` JSON surfaces. Import and adopt reports may also attach render-result records to render-relevant warnings, such as preserved target-native tool-policy frontmatter or recognized survey skips. Pure source invalidity, unknown import metadata, and lint-only authoring problems stay in diagnostics instead of being forced into the render report. Future adapter conformance surfaces should read the same report instead of inventing parallel diagnostics. Render results are not written into ordinary generated `SKILL.md`, `CLAUDE.md`, `AGENTS.md`, plugin manifest, hook, MCP, app, or resource files by default.

| Field | Meaning |
| --- | --- |
| `schema` | Render-result schema stamp. Current value: `skillset-render-result@1`. |
| `sourceUnit` | Stable source selector for the source unit that was rendered or considered. |
| `sourcePath` | Optional source path used for diagnostics and review. |
| `featureId` | Feature registry id, such as `standalone-skills`, `dependencies`, `plugin-bin`, or `project-instructions`. |
| `target` | Provider/runtime adapter (`claude` or `codex`) when the fact is target-specific. |
| `destination` | Concrete output artifact/scope rendered under the `target`, such as `skill`, `plugin-manifest`, `instruction`, `agent`, `provider-source`, `skill-frontmatter`, `skill-tools`, or a plugin feature artifact like `mcp`/`bin`/`agents`. `target` is the provider; `destination` is what is rendered under it. |
| `status` | Build render-result status. |
| `reason` | Required for degraded, lossy, unsupported, and failed render results. |
| `policy` | Why a render result was allowed, skipped, disabled, or routed through unsupported destination policy. |
| `outputs` | Generated paths for outputs produced in the selected build scope. |
| `diagnostics` | Structured diagnostic refs when validation or rendering needs a machine-readable pointer. |
| `evidence` | Registry evidence such as docs, source, tests, fixtures, or external provider docs. |

The schema intentionally keeps source identity and target output identity together. A single source feature can produce different render results for Claude and Codex without pretending the target files are equivalent.

## Render-Result Statuses

| Status | Meaning | Typical example |
| --- | --- | --- |
| `rendered` | Skillset rendered a faithful target-native representation. | A standalone skill rendered to target `SKILL.md`. |
| `target_native` | Explicit provider-specific source was passed through or copied only to its target. | A Codex-only provider source or Claude-only plugin companion. |
| `transformed` | Skillset changed the file shape while preserving the authored intent. | Source-root `rules/` rendered to Claude rules and Codex `AGENTS.md`. |
| `metadata_only` | Skillset preserved information for provenance or sidecars, but the target does not enforce it directly. | Release changelog rendering or tools-policy sidecar. |
| `degraded` | Skillset rendered a useful fallback that is weaker than a native target feature. | Codex dependency awareness material when Claude has native plugin dependencies. |
| `lossy` | A render would drop required meaning or behavior. | Future body/contract loss where no faithful target shape exists. |
| `unsupported` | The enabled target cannot represent the authored feature through a portable render. | Codex plugin-local `bin/` or plugin agents. |
| `externally_managed` | The behavior belongs to install, activation, distribution, marketplace state, or another external owner. | A distribution destination or runtime activation result. |
| `intentionally_skipped` | Skillset did not render output because scope, target config, or policy excluded it. | `skillset build --scope project` excluding plugin output. |
| `failed` | Skillset attempted a render or validation and could not produce safe output. | Invalid generated path, malformed target-native file, or unsafe mapping. |

`degraded`, `lossy`, `unsupported`, and `failed` require `reason` because they are review-sensitive. A future report may render them differently, but the machine record should always explain why the render result exists.

## Policy Values

| Policy | Meaning |
| --- | --- |
| `default` | Normal compiler policy. |
| `scope:excluded` | Output was excluded by the selected build scope. |
| `target:disabled` | Target was disabled by config or source-level target toggle. |
| `unsupported:error` | Unsupported/lossy render fails build, diff, and verify before generated-output freshness is reported. |
| `unsupported:warn` | Unsupported/lossy render is reported but does not fail. |
| `unsupported:skip` | Unsupported/lossy render writes no target output and is recorded as skipped/unsupported. |
| `unsupported:force` | A future explicit override allows a target-native/debug output without pretending portability. |

The default posture is error. Build, diff, and verify enforce `failed`, `lossy`, and `unsupported` render results from the structured report before writing generated output. `warn`, `skip`, and `force` remain reserved escape hatches until their non-error semantics are implemented and documented. When these policies are used internally or transitionally, they must still surface through render results, diagnostics, or reports.

Before non-error unsupported-destination policies become user-facing, every
affected render result must carry enough provenance for a reviewer or CI job to
see what happened without reading generated output by hand:

- source unit and source path;
- provider target;
- destination or scope;
- feature id or event;
- unsupported, lossy, or failed reason;
- selected unsupported-destination policy;
- provider evidence or registry row behind the classification;
- outputs written, outputs skipped, and whether no target output was produced;
- surfaced diagnostic refs in JSON and text output.

The future reserved semantics are:

- `warn` writes supported outputs, keeps unsupported/lossy facts visible, and
  makes warning counts machine-readable.
- `skip` writes supported outputs, omits unsupported outputs, and records the
  skipped source/destination in locks and reports.
- `force` allows only an explicit provider-native or debug output path with
  provenance; it must not pretend unsupported portable behavior became
  faithful.

If an enabled target would produce no usable output under a non-error policy,
the command must still fail. A successful command with no output would be
silent drift, even if the policy name says `warn`, `skip`, or `force`.

## Target Rendering

| Source pattern | Claude result | Codex result | Notes |
| --- | --- | --- | --- |
| Standalone skill | `rendered` | `rendered` | Both targets can receive a native `SKILL.md` rendering. |
| Plugin skill | `rendered` | `rendered` | Plugin boundaries stay intact while target manifests differ. |
| Source-root `rules/` | `transformed` | `transformed` | Claude receives rules; Codex receives directory-local `AGENTS.md`. |
| Provider source | `target_native` for matching target | `target_native` for matching target | Non-matching targets do not receive output. |
| Plugin dependencies | `rendered` | `degraded` | Claude has a native dependency surface; Codex receives awareness material. |
| Plugin `bin/` | `target_native` | `unsupported` | Claude receives the plugin-root bin feature output; Codex has no documented plugin-local bin contract. |
| Plugin agents | `target_native` | `unsupported` | Claude can carry plugin agents; Codex plugin output cannot. |
| Change/release metadata | `metadata_only` | `metadata_only` | Preserved for provenance and generated changelog state, not target runtime enforcement. |
| Distribution or activation state | `externally_managed` | `externally_managed` | Build may plan or report it, but does not activate or trust runtimes. |

## Fixture Coverage

`packages/core/src/__tests__/render-result-build.test.ts` covers the v1 status matrix with successful, scoped, isolated, and unsupported-error fixtures. Current observed statuses are `rendered`, `target_native`, `transformed`, `metadata_only`, `degraded`, `intentionally_skipped`, and `unsupported`.

The remaining status values are intentionally documented deferrals rather than fake fixtures:

| Status | Deferral |
| --- | --- |
| `externally_managed` | Reserved for distribution, activation, marketplace, or runtime-install facts once those workflows emit render results. |
| `failed` | Validation failures still surface as source/build diagnostics today; SET-84 policy tests prove failed render results would block once a producer exists. |
| `lossy` | No v1 target adapter renders lossy output; current lossy cases stay unsupported or fail before rendering. SET-84 policy tests prove lossy render results would block once a producer exists. |

## Diagnostics

- Unsupported, lossy, and failed render results fail by default for enabled targets unless a scoped opt-out or future explicit unsupported destination policy applies.
- Degraded render results should remain visible because they represent useful but weaker behavior.
- Skipped render results need policy provenance so a clean build is not confused with silent omission.
- Adaptive hook attachments that target Codex skill-local or project-agent scopes produce `adaptive-hooks` `unsupported:error` render results, because Codex has no faithful component-local hook destination for those scopes. Codex plugin attachments also produce unsupported render results when the adaptive event is not documented by Codex or when the attachment uses a matcher for an event Codex ignores matchers for. Claude and Codex adaptive attachments also report structured unsupported render results for provider overrides, unsupported plugin `run.args`/`run.cwd` fields, frontmatter `run.env` fields, and frontmatter `run.script` cases that do not yet have stable runtime path proof.
- Friendly warning text can coexist with structured render-result refs when the warning is about target rendering. For example, Codex `AGENTS.md` size warnings remain readable diagnostics and also attach `codex-agents-size` refs to the matching `project-instructions` render result.
- Import reports keep unrecognized frontmatter warnings separate, but target-native Claude tool-policy fields such as `allowed-tools` and `disable-model-invocation` also produce `tools-policy` `target_native` render-result records.
- Adopt survey skips for recognized native surfaces produce `intentionally_skipped` render-result records in the report so planned migrations are visible without pretending the dry-run rendered output.
- Explain output summarizes matching render results by source unit, feature id, target, status, policy, reason, outputs, and diagnostics. Explaining a source path can show every target render result for that source; explaining a generated path stays scoped to the generated output's target.
- Doctor output summarizes non-happy-path render results such as degraded, lossy, unsupported, externally managed, skipped, and failed render results without dumping every rendered file by default.
- `skillset explain --json` and `skillset doctor --json` include full render-result records for agents and automation.
- Adapter conformance tests should compare feature-registry support rows with produced render results or render errors.
- Generated prose, scripts, activation probes, shimmed instructions, helper
  files, and metadata sidecars can explain compatibility behavior, but they do
  not count as policy enforcement unless the provider enforces that surface.

## Provenance

Outcome provenance belongs in structured operation results, generated `skillset.lock` files, the logical `.skillset/cache/adopt/report.json` report backed by the repo's XDG cache bucket, `skillset explain --json`, and `skillset doctor --json` today. Adopt Markdown reports and doctor/explain text output render compact summaries and point readers at structured records when more detail is needed. Generated target files stay clean by default. Debug sentinels or source markers in target files are a future opt-in, not a default generated-output contract.

## Evidence

- The render-results ADR, currently filed as [Lowering Outcomes and Loss Ledger](../adrs/drafts/20260614-lowering-outcomes-and-loss-ledger.md), defines the decision and status semantics.
- [Post-Tools Policy Boundary](../adrs/drafts/20260705-post-tools-policy-boundary.md) defines how `tools`, provider-native policy, generated compatibility material, and unsupported-destination policy fit together after the `tools` cutover.
- [Deterministic Projection and Adapter Conformance](../adrs/drafts/20260613-deterministic-projection-and-adapter-conformance.md) defines how render results pair with the feature registry for conformance.
- `packages/core/src/render-result.ts` defines the current schema, status values, policy values, and validation rules.
- `packages/core/src/render-result-collector.ts` derives render results from generated locks, target-native companions, transformations, and unsupported plugin features.
- `packages/core/src/build.ts` attaches build diagnostic refs, such as Codex `AGENTS.md` size warnings, to matching generated-output render results.
- `apps/skillset/src/import.ts` and `apps/skillset/src/setup.ts` attach render-relevant import/adopt report facts to the same render-result schema without changing user-facing warning prose.
- `packages/core/src/__tests__/render-result-build.test.ts`, `apps/skillset/src/__tests__/contract.test.ts`, and `apps/skillset/src/__tests__/adopt.test.ts` prove rendered, target-native, transformed, unsupported, isolated-path, policy-gated, scoped, warning-linked, import-linked, adopt-linked, and status-matrix render results.
