---
description: Support constraints define compatibility ranges, mismatch policy, inheritance, and source-unit provenance.
---

# Supports

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `supports` | `implemented` | `metadata_only` | `metadata_only` | `planned` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

`supports` declares compatibility with an external package, tool, API, plugin, or version range. It does not set the [source unit's](../../glossary.md#source-unit) own version and does not create a plugin dependency.

## Source Contract

Compact entries combine package name and range:

```yaml
supports:
  - "@acme/docs-cli@>=2.4 <3"
```

Expanded entries can identify a local package source and mismatch policy:

```yaml
supports:
  packages:
    - name: "@acme/docs-cli"
      range: ">=2.4 <3"
      source: repo:packages/docs-cli/package.json
      onMismatch: warn
```

The generated [frontmatter schemas](../schemas/README.md) own accepted shapes. `range` accepts the documented comparator, caret, and tilde forms. `source: repo:<path>` resolves package JSON relative to the repository. `onMismatch` defaults to `warn`; `error` makes a detected local-version mismatch fail validation.

Constraints apply only to the source unit that declares them. [Workspace](../../glossary.md#workspace) or plugin constraints do not implicitly [cascade](../../glossary.md#cascade) to nested skills, agents, provider source, or feature pointers.

## Provider Output

Claude and Codex retain support constraints as provenance and diagnostics rather than target-enforced metadata. Cursor support remains planned as shown in the generated matrix. A constraint can therefore document and validate compatibility without claiming that a provider installs or enforces the dependency.

## Errors and Caveats

Skillset rejects malformed compact entries, invalid ranges, invalid package names or repository source paths, and mismatches configured with `onMismatch: error`. Checks and status warn for the default mismatch policy.

A supports-only edit is source-significant but is not inherently severity-bearing: the default suggested release bump is `none`, or `patch` when the change alters rendered user-facing metadata. Use [dependencies](dependencies.md) when another plugin is required for operation.

## Provenance

Normalized constraints participate in hashes, history evidence, [`skillset status`](../cli/status.md), and [`skillset explain`](../cli/explain.md). Aggregates may report child constraints for inspection, but they do not copy them into child identity.

The release rationale is recorded in [ADR 0014](../../adrs/0014-source-change-release-provenance.md) and [ADR 0016](../../adrs/0016-change-release-edge-decisions.md).
