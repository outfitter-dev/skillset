---
description: Express portable and provider-specific tool intent without overstating enforcement.
---

# Tools Policy

`tools` records skill-local tool intent. It is not a complete sandbox, trust, or managed-policy system: a provider may enforce the intent, transform it, or preserve it as reviewable metadata. The [tools-policy feature reference](../reference/features/tools-policy.md) records the current realization for every provider.

## Express Portable Intent

Use lowercase portable keys at the top level:

```yaml
tools:
  read: true
  search: true
  write: false
  shell:
    - git status
    - git diff *
  mcp:
    github:
      - get_*
      - list_*
```

The portable keys are `read`, `search`, `write`, `shell`, and `mcp`. Unset means provider default. Boolean values grant or constrain where the provider has an appropriate surface; lists narrow shell patterns or MCP tools.

For the common read-only intent, use the macro:

```yaml
tools: readonly
```

It expands to `read: true`, `search: true`, and `write: false`.

## Add Native Provider Rules Last

[Provider-native](../glossary.md#provider-native) allow and deny strings belong under `tools.<provider>`:

```yaml
tools:
  write: false
  claude:
    deny:
      - Bash(rm *)
```

Resolution proceeds from macro expansion to the portable base and then to a provider overlay. A native allow rule that contradicts an effective portable denial fails validation. Unknown native rules may remain valid, but Skillset keeps them visible as unclassified provenance rather than claiming portable meaning.

Do not put `allow` or `deny` directly under `tools`, and do not put a separate `tools` object inside a [source unit's](../glossary.md#source-unit) `claude`, `codex`, or `cursor` block.

## Keep `allowed_tools` Separate

`allowed_tools` is a narrow Claude preapproval compatibility field, not an alias for portable `tools`. Shared, Codex-targeted, or Cursor-targeted uses are rejected unless each unsupported [target](../glossary.md#target) is explicitly disabled. Prefer `tools` for new portable policy.

## Inspect Realization and Residual Risk

Inspect the provider matrix and a source unit's resolved plan rather than inferring enforcement from generated prose or metadata:

```bash
skillset lookup skill tools --compat claude,codex,cursor --json
skillset explain .skillset/skills/<skill>/SKILL.md --json
```

See [`skillset lookup`](../reference/cli/lookup.md) and [`skillset explain`](../reference/cli/explain.md) for the current command shapes. The exhaustive [tools-policy reference](../reference/features/tools-policy.md) owns provider rendering, realization tiers, diagnostics, provenance, and fixture evidence.
