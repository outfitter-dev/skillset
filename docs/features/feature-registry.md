# Feature Registry

Feature id: `feature-registry`

Related vocabulary: [Feature Reference Vocabulary](README.md#feature-reference-vocabulary)

The feature registry is Skillset's typed support matrix. It records the features Skillset knows about, what source shape they use, whether each target can represent them, which module owns rendering, which module owns validation, and what evidence supports those claims.

The registry is internal compiler infrastructure, not a public plugin system. It exists so docs, diagnostics, render results, drift checks, and future conformance tests can use the same feature ids and support vocabulary.

See [Feature Reference and Schema Registry](../adrs/drafts/20260604-feature-reference-and-schema-registry.md) for the ADR-level decision.

## Current Boundary

The current seed lives in `packages/core/src/feature-registry.ts`. It is a typed registry because the compiler already runs in TypeScript and the first goal is to keep local support claims reviewable.

Each entry records:

| Field | Meaning |
| --- | --- |
| `id` | Stable feature id used by docs, diagnostics, render results, reports, and future conformance checks. |
| `title` | Reader-facing feature name. |
| `summary` | One-sentence feature description. |
| `kind` | Broad feature family such as source, metadata, workflow, plugin component, target-native, adoption, or change management. |
| `status` | Feature entry status: implemented, planned, reserved, deferred, future, or unsupported. |
| `sourceShape` | Source path, config key, frontmatter key, or generated fact shape that defines the feature. |
| `targetSupport` | Per-target capability records for Claude and Codex. |
| `targetSupport.<target>.provider` | Optional provider evidence links: adopted destination-format snapshot id, adopted JSON Schema snapshot ids, docs-only manual overlay ids, and unsupported destination keys. |
| `runtimeSupport` | Optional runtime, distribution, or harness support records. |
| `renderOwner` | Module or workflow that owns rendering/reporting behavior. |
| `validationOwner` | Module or workflow that owns validation behavior. |
| `docs` | Reader-facing docs that explain the feature. |
| `evidence` | Docs, source, tests, fixtures, external docs, or bounded assumptions supporting the claim. |

The registry row should stay compact. Detailed authoring examples, generated-output snippets, and caveats belong on feature pages.

## Capability Vs Render Result

Registry target support is static capability. Render results are build facts.

For example:

- `dependencies` has Claude target support `native` and Codex target support `degraded`.
- A particular build can render the Claude dependency surface and generate a degraded Codex awareness notice.
- If the build scope excludes plugins, the same source may produce `intentionally_skipped` render results instead.

This separation keeps docs from overpromising and keeps build reports from pretending skipped or degraded output is native support.

## Markdown Is Serialization

Skillset uses Markdown because skills, rules, agents, and instructions are authored and consumed as Markdown in target ecosystems. Markdown is still not the core IR.

Source `SKILL.md` is parsed into a source skill record. Generated `SKILL.md` is a target artifact. `CLAUDE.md`-style files when imported or carried through target-native source, Claude rules, Claude agent files, and Codex `AGENTS.md` files are target-native renderings. Provider source can copy opaque files, but those files remain target-owned output.

The core contract is the resolved source graph plus typed feature entries, target support rows, render results, diagnostics, locks, and operation results.

## Evidence

Evidence should be strong enough for the claim:

| Evidence kind | Use |
| --- | --- |
| `docs` | Skillset docs or ADRs that define the contract. |
| `source` | Compiler modules that implement parsing, rendering, validation, or reporting. |
| `test` | Tests proving behavior, schema guards, or drift checks. |
| `fixture` | Fixture cases proving generated output or adoption behavior. |
| `external-docs` | Provider docs with verification dates for target surfaces. |
| `provider-snapshot` | Checked-in `@skillset/provider-formats` snapshot ids for adopted destination formats. |
| `provider-schema` | Checked-in `@skillset/provider-formats` schema snapshot ids for adopted rolling-latest provider JSON Schema sources. |
| `provider-overlay` | Checked-in manual overlay ids for destination areas where provider docs are prose-only and no adopted JSON Schema source exists. |
| `assumption` | Explicit bounded assumption to replace with stronger evidence before graduation. |

Provider snapshots are the preferred evidence for implemented Claude and Codex destination-format claims. They carry source URLs, fetch timestamps, and content hashes in `@skillset/provider-formats`, so normal build and check paths can stay deterministic and offline. Target support rows can also point to provider schema snapshots and manual overlays through their `provider` block. The registry remains the support decision surface: provider snapshots strengthen a row with evidence, while the row's `status`, `reason`, and optional `unsupportedDestinations` still express Skillset's support decision.

External docs remain useful for future or exploratory rows before a destination format is adopted. Neither evidence type proves Skillset's rendering is correct or that a runtime activation path works; runtime support and activation probes stay separate from compile-target support.

## Diagnostics

Diagnostics carry stable feature ids where useful, but user-facing messages remain readable. A message like `skillset: Codex plugins do not support plugin-local bin/ helpers` is better than a bare `plugin-bin unsupported`; the feature id belongs in structured output, lock/report evidence, or a suffix where it helps agents inspect the issue. Render results inherit target-support evidence, so a skipped, degraded, or unsupported destination can cite the provider destination-format snapshot or schema overlay that justified the support fact without adding a second provider matrix.

The current diagnostic ownership slice covers core build/write diagnostics, selected resolver errors for plugin manifests, root hook placement, and provider source support, plus lint diagnostics for skill source, plugin hooks, resource declarations, and tool intent. Broader source invalidity that still throws before an operation result exists may remain message-only until the surrounding operation is converted to structured diagnostics.

## Provenance

Feature ids can appear in render results, `skillset.lock`, reports, doctor/explain output, and conformance fixtures. They should not be injected into ordinary generated target files by default.

## Future Work

- SET-77 adds drift checks for docs, tests, fixtures, and evidence refs.
- SET-78 exposes capability inspection through authoring CLI surfaces.
- SET-82 through SET-86 persist render results, render them through diagnostics, gate policies, add matrix fixtures, and migrate warnings onto render-result codes.

## Evidence

- [Feature Reference and Schema Registry](../adrs/drafts/20260604-feature-reference-and-schema-registry.md) defines the decision.
- `packages/core/src/feature-registry.ts` defines the current typed registry.
- `packages/provider-formats/src/index.ts` stores adopted provider destination-format snapshots used as registry evidence.
- `packages/provider-formats/src/schema-snapshots.ts` stores adopted provider JSON Schema snapshots and manual overlays used as registry evidence.
- `packages/core/src/__tests__/feature-registry.test.ts` pins registry ids, vocabulary, evidence expectations, and guard behavior.
- [Render Results](render-results.md) explains the separate build-result report.
