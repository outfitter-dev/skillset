---
description: Dependencies define internal and external plugin requirements, provider rendering, validation, and provenance.
---

# Dependencies

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `dependencies` | `implemented` | `native` | `degraded` | `planned` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Dependencies declare plugins required by a plugin artifact. They differ from [supports](supports.md), which records compatibility without creating a required plugin edge.

## Source Contract

`dependencies.plugins` accepts internal selectors and external references:

```yaml
dependencies:
  plugins:
    - plugin: secrets-vault
    - name: audit-logger
      range: "~1.4.0"
      marketplace: acme-shared
```

`plugin` selects another plugin in the current Skillset graph. The compiler resolves its name and exact release range, which is the conservative default for internal edges. An external reference requires `name` and `range`; use `unversioned: true` only when the external source genuinely has no version contract. `marketplace` records where a user can obtain that plugin.

Declarations on plugin-owned child source are hoisted to the containing plugin because provider dependency fields belong to plugin artifacts. The generated [frontmatter schemas](../schemas/README.md) own the exact accepted shapes.

## Provider Output

Claude receives structured `dependencies.plugins` in the generated plugin manifest. Codex has no documented native plugin-dependency field, so generated plugin skill instructions include an explicit fallback notice. The notice tells the user to install or enable the dependency through Skillset or their plugin marketplace; it does not install, resolve, or activate anything. Cursor support remains planned as shown in the generated matrix.

Compiler-generated dependency fields are authoritative. A competing `claude.manifest.dependencies` override fails instead of shadowing source declarations.

## Errors and Caveats

Skillset rejects unknown internal selectors, self-dependencies, malformed ranges, unsupported keys, and external entries without either `range` or explicit `unversioned: true`. A Codex build cannot silently omit an edge; the degraded notice is required output.

Dependency changes are source-significant and severity-bearing because they can change required setup. Marketplace discovery and distribution are separate from declaring the edge; see the [marketplaces guide](../../guides/marketplaces.md).

## Provenance

Normalized dependencies participate in hashes, change status, lock entries, [`skillset explain`](../cli/explain.md), and release planning. The release rules are recorded in [ADR 0014](../../adrs/0014-source-change-release-provenance.md) and [ADR 0016](../../adrs/0016-change-release-edge-decisions.md).
