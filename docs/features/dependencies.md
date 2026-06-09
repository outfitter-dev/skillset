# Dependencies

Feature id: `dependencies`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Dependencies declare required plugins. They are distinct from `supports`, which declares compatibility with external packages, tools, APIs, plugins, or version ranges.

## Authoring

Plugin dependencies can be internal selectors resolved from the current Skillset graph or external plugin references with names, ranges, and optional marketplace metadata. Declarations on plugin child source bubble up to the containing plugin because target-native dependency fields live on plugin artifacts, not child files.

```yaml
dependencies:
  plugins:
    - plugin: secrets-vault
    - name: audit-logger
      range: "~1.4.0"
      marketplace: acme-shared
```

## Target Lowering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `dependencies.plugins` | plugin dependency fields | dependency notices/check guidance | `planned` | Claude has native dependency support; Codex has no documented equivalent. |
| Internal plugin selector | resolved native plugin name and version/range | explicit fallback notice | `planned` | Exact release range is the conservative v1 default. |
| External plugin dependency | name/range/marketplace | explicit fallback notice | `planned` | External dependencies should normally require a range. |

## Diagnostics

Dependency declarations should fail or warn loudly when an enabled target cannot represent them. Codex-enabled output must not silently drop dependency edges. Explain/list/doctor should show declared dependencies, hoisted child declarations, emitted Claude dependencies, skipped Codex lowering, and suggested install/check commands.

## Provenance

Dependencies are both source-significant and severity-bearing because they can change required setup. They participate in normalized hashes, change status, lock/explain evidence, and release planning.

## Evidence

See [Source Change, Release, and Dependency Provenance](../adrs/drafts/20260609-source-change-release-provenance.md) and [Change and Release Edge Decisions](../adrs/drafts/20260609-change-release-edge-decisions.md).
