---
description: Skillset version audit compares current version authority with supported generated Claude and Codex artifacts.
---

# Version Audit

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `version-audit` | `implemented` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Version audit is a read-only comparison between source or release-state authority and supported generated version fields. It does not decide whether source changed, compute a release bump, repair [generated output](../../glossary.md#generated-output), or publish anything.

## Run the Audit

```bash
skillset release audit
skillset release audit --json
```

The command renders expected versions in memory, reads matching files on disk, and reports each supported locus. It exits nonzero when any locus is `stale-generated`, `missing`, or `malformed`; an all-`in-sync` report exits zero. Exact syntax lives in the generated [`release` reference](../cli/release.md).

Example human report:

```text
in-sync         plugin:review  claude  plugins/review/claude/.claude-plugin/plugin.json  1.4.0
stale-generated skill:lint     codex   .agents/skills/lint/SKILL.md                       1.3.0 -> 1.4.0
```

## Current Audit Boundary

The current implementation audits:

- Claude and Codex generated plugin manifests;
- Claude and Codex plugin-bound and standalone skill manifests;
- Claude `.claude-plugin/marketplace.json` plugin-entry versions.

Cursor version loci are not currently audited. Codex marketplace metadata is also outside the current audit because Skillset does not emit a Codex-owned marketplace index. The generated support marker describes the workflow's registry status, not a claim that every provider has an audited version surface.

Release state is authoritative when a release scope exists; otherwise source version metadata and inheritance rules supply the expected version. A `supports` range is dependency compatibility metadata, not the artifact's own version.

## Current Statuses

| Status | Meaning | Recovery |
| --- | --- | --- |
| `in-sync` | Disk matches current version authority | None |
| `stale-generated` | A supported generated artifact has another version | Preview and confirm a build or release apply |
| `missing` | The expected generated artifact is absent | Rebuild the selected output |
| `malformed` | The expected version field is missing or unreadable | Inspect the artifact and regenerate it from trusted source |

The internal model reserves vocabulary for future [destination](../../glossary.md#destination)-owned, externally managed, and unsupported loci, but the current audit does not emit those as inspected records.

## Diagnose a Mismatch

Use [`skillset explain <path>`](../cli/explain.md) to identify source and lock ownership. If the source version should change, follow [Releases and Changelogs](releases.md) and the [publishing guide](../../guides/publishing.md). If source is already correct, preview the build before repairing the generated artifact. A version audit never changes either side.

## Provenance

Each record carries the path, version field, source scope, provider [target](../../glossary.md#target), expected and actual values, authority, and status. Version audit complements source hashes and lock provenance; it does not replace them.

## Evidence

The implementation lives in `packages/core/src/version-audit.ts`; the read-only CLI and stale-version contract are covered by `apps/skillset/src/__tests__/contract.test.ts`.
