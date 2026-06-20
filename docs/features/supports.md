# Supports

Feature id: `supports`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

`supports` declares compatibility with external packages, tools, APIs, plugins, or version ranges. It is not the artifact's own version and it is not a plugin dependency.

## Authoring

Support constraints may appear on source units that can make a compatibility claim. V1 does not implicitly inherit root or plugin constraints into nested skills, agents, provider source, or feature pointers. A child source unit must explicitly declare or opt into a support constraint before the constraint affects that child's hash, status, history, or generated notice.

Compact form:

```yaml
supports:
  - "@acme/docs-cli@>=2.4 <3"
```

Expanded form:

```yaml
supports:
  packages:
    - name: "@acme/docs-cli"
      range: ">=2.4 <3"
      source: repo:packages/docs-cli/package.json
      onMismatch: warn
```

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `supports` metadata | not rendered by default | not rendered by default | `implemented` / `metadata_only` | Significant for provenance and diagnostics; not target-enforced by default. |

## Diagnostics

Support constraints participate in normalized source hashes and `change status`. A supports-only edit is significant but not inherently severity-bearing. The default suggested bump is `none`, or `patch` when rendered user-facing metadata changes. V1 validates compact strings and expanded `supports.packages` entries with common semver-like comparators, caret ranges, and tilde ranges. `repo:<path>` package sources are read as package JSON; `skillset verify` and `doctor` warn by default, or fail when `onMismatch: error` is set, when the local version falls outside the declared range.

## Provenance

Support constraints appear in source-unit provenance, history evidence, and explain/doctor output. Aggregates may report child supports for inspection, but they do not copy constraints into child identity by default.

## Evidence

See [Source Change, Release, and Dependency Provenance](../adrs/drafts/20260609-source-change-release-provenance.md) and [Change and Release Edge Decisions](../adrs/drafts/20260609-change-release-edge-decisions.md).
