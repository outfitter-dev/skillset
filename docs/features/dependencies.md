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
| `dependencies.plugins` | plugin manifest `dependencies.plugins` | dependency notice in plugin skill instructions | `implemented` / `target_specific` | Claude receives structured manifest metadata; Codex receives explicit fallback guidance because no native field is documented. |
| Internal plugin selector | resolved plugin name and exact release range | explicit fallback notice | `implemented` | Exact release range is the conservative v1 default. |
| External plugin dependency | name/range/marketplace metadata | explicit fallback notice | `implemented` | External dependencies require `range` unless `unversioned: true` is explicit. |

## Diagnostics

Dependency declarations fail loudly for unknown internal plugin selectors, self-dependencies, malformed ranges, unsupported dependency keys, and external dependencies without either `range` or `unversioned: true`. Child plugin skill declarations are hoisted to the containing plugin artifact because target-native dependency fields live on plugin artifacts, not child files. Codex-enabled output must not silently drop dependency edges; generated notices tell Codex not to install or resolve dependencies by itself and to ask the user to install or enable them through their Skillset or plugin marketplace workflow. `skillset list` and `skillset explain` show compact dependency summaries from lock provenance.

## Provenance

Dependencies are both source-significant and severity-bearing because they can change required setup. They participate in normalized hashes, change status, lock/explain evidence, and release planning.

## Evidence

See [Source Change, Release, and Dependency Provenance](../adrs/drafts/20260609-source-change-release-provenance.md) and [Change and Release Edge Decisions](../adrs/drafts/20260609-change-release-edge-decisions.md).
