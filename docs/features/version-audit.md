# Version Audit

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `version-audit` | `implemented` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:feature-support:end -->

Feature id: `version-audit`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Version audit is a read-only check across version loci: source authority, release state, generated target manifests, and future destination/runtime manifests.

## Boundary

Version audit complements source-hash provenance. It does not decide whether a source unit changed, does not compute release bumps, and does not mutate generated files. It answers a narrower question: does the version field visible in a generated or destination artifact still match the authority Skillset would render now?

`supports` ranges are compatibility metadata, not artifact versions. A skill can support `@acme/docs-cli ^2.4.0` without its own `metadata.version` being `2.4.0`.

## CLI

```bash
skillset release audit
```

The command builds the current rendering in memory, extracts expected versions, reads matching files on disk, and reports each locus. It exits nonzero only for concrete generated-output issues: `stale-generated`, `missing`, or `malformed`.

## Statuses

| Status | Meaning |
| --- | --- |
| `in-sync` | The on-disk version matches the current source or release-state authority. |
| `stale-generated` | The on-disk generated artifact exists but has a different version from the current authority. |
| `missing` | The generated artifact is absent on disk. |
| `malformed` | The generated artifact exists but the expected version field is absent or unreadable. |
| `destination-owned` | A future destination audit owns this version field outside Skillset source. |
| `externally-managed` | A package manager, marketplace, or runtime owns the version field. |
| `unsupported` | Skillset recognizes the surface but cannot currently audit its version field. |

## Current Loci

Current audits cover generated provider plugin manifests, plugin skill manifests, standalone skill manifests, marketplace metadata versions, and marketplace plugin entry versions. The authority is release state when a release scope exists, otherwise source version metadata and inheritance rules.

Future extensions can add downstream distribution manifests and package metadata by classifying each locus with the same shape: path, field, scope, target, expected version, actual version, authority, and status.

## Evidence

- [Releases And Changelogs](releases.md) - source release state and generated version behavior.
- [Distributions](distributions.md) - destination-owned metadata and future sync boundaries.
- [SET-111 contract test](../../apps/skillset/src/__tests__/contract.test.ts) - read-only audit and stale generated version detection.
