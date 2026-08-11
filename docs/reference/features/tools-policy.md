---
description: Tools policy defines portable intent, provider overlays, realization tiers, conflicts, and residual risk.
---

# Tools Policy

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `tools-policy` | `implemented` | `transformed` | `metadata_only` | `metadata_only` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

`tools` records portable, skill-local tool intent where providers use different names and enforcement surfaces. Unset keys defer to the provider. `true` grants or preapproves where the [target](../../glossary.md#target) permits it; `false` constrains where possible. A recorded policy is not enforcement unless the provider enforces the generated surface.

## Source Contract

Portable keys are `read`, `search`, `write`, `shell`, and `mcp`. The first three are booleans. `shell` accepts a boolean or a flat list of command patterns. `mcp` accepts `false` or literal server names mapped to a boolean or tool-glob list. [Provider-native](../../glossary.md#provider-native) rule strings belong under `tools.<provider>`.

```yaml
tools:
  read: true
  search: true
  write: false
  shell:
    - git status
    - git diff *
  claude:
    deny:
      - Bash(rm *)
```

`tools: readonly` expands to `read: true`, `search: true`, and `write: false`. Provider overlays refine that base for one [target](../../glossary.md#target). The [configuration guide](../../configuration/tools-policy.md) explains authoring decisions; generated [frontmatter schemas](../schemas/README.md) own exact value shapes.

`allowed_tools` is a separate Claude preapproval escape hatch. It may be unset or false for unsupported targets; it does not replace portable `tools`.

## Provider Output

| Intent | Claude | Codex | Cursor |
| --- | --- | --- | --- |
| Portable `tools` | transformed `allowed-tools` / `disallowed-tools` rules | `.skillset.tools.yaml` metadata | `.skillset.tools.yaml` metadata |
| Native allow/deny overlay | native Claude rule strings | target-native metadata | target-native metadata |

Claude MCP rules use native globs such as `mcp__github__get_*`; Skillset does not emit regex-style MCP rules. Codex and Cursor sidecars preserve reviewable intent but do not mutate runtime trust, settings, managed policy, or user-level configuration.

The realization registry classifies each provider/aspect as `native`, `transformed`, `derived`, `approximate`, `advisory`, `metadata-only`, `settings-required`, or `unsupported`. [`skillset lookup skill tools`](../cli/lookup.md) shows the matrix; [`skillset explain`](../cli/explain.md) shows the deciding layer, emitted rule, tier, and residual-risk diagnostic for one [source unit](../../glossary.md#source-unit).

## Errors and Caveats

Skillset rejects retired `tool_intent`, unknown portable keys, native `allow` or `deny` at the wrong level, target-local duplicate `tools` blocks, and a native allow rule that contradicts an effective portable denial. Wildcard MCP server names are not portable.

Codex `sandbox_mode = "read-only"` and Cursor agent `readonly: true` require settings outside a skill; per-skill Codex and Cursor policy therefore remains metadata-only today. Generated prose, scripts, shims, and sidecars explain or preserve intent but do not become enforcement by assertion.

## Provenance

Lock entries and generated sidecars record effective intent, overlays, realization evidence, and residual-risk diagnostics. The boundary is defined by [ADR 0021](../../adrs/0021-post-tools-policy-boundary.md).
