# Tools Policy

Feature id: `tools-policy`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

`tools` records portable skill-local tool policy where providers have different
native names and enforcement models. It is open-world: unset means provider
default, `true` grants or preapproves where possible, `false` constrains where
possible, and unsupported realizations must stay visible.

## Authoring

Use lowercase portable keys at the top level. Native provider rule strings live
only under provider blocks:

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

  claude:
    deny:
      - Bash(rm *)
```

`tools: readonly` is pure sugar for:

```yaml
tools:
  read: true
  search: true
  write: false
```

The first implementation supports `read`, `search`, `write`, `shell`, and
`mcp`. `read`, `search`, and `write` are boolean-only. `shell` accepts
`true`, `false`, or a flat list of shell patterns. `mcp` accepts `false` or a
map of literal server names to `true`, `false`, or tool glob lists. Wildcard MCP
server names are not portable.

## Target Rendering

| Source | Claude output | Codex output | Cursor output | Status |
| --- | --- | --- | --- | --- |
| Portable `tools` | `allowed-tools` / `disallowed-tools` preapproval and denial rules | `.skillset.tools.yaml` metadata | metadata-only until a proven skill-local surface exists | `transformed` / `metadata_only` |
| Provider `tools.claude.allow` / `deny` | native Claude rule strings | n/a | n/a | `target_native` |
| Provider `tools.codex.allow` / `deny` | n/a | `.skillset.tools.yaml` target-native metadata | n/a | `metadata_only` |
| `allowed_tools` | Claude `allowed-tools` | unset or false only | unset or false only | separate Claude preapproval escape |

Claude MCP rendering emits provider-native glob strings such as `mcp__github`,
`mcp__github__get_*`, `mcp__linear`, and `mcp__*`; Skillset does not emit
regex-style `mcp__.*__.*` rules.

## Diagnostics

- Reject retired `tool_intent`; use `tools`.
- Reject unknown portable keys.
- Reject top-level native `tools.allow` / `tools.deny`; native strings belong
  under `tools.<provider>.allow` / `tools.<provider>.deny`.
- Reject target-local `claude.tools` / `codex.tools` / `cursor.tools`; provider
  overrides belong under the top-level `tools` block.
- Reject native `allow` strings that contradict an effective portable
  `false`, such as `tools.write: false` plus `tools.claude.allow: [Write]`.
- Reject shared or Codex-targeted `allowed_tools` unless Codex is explicitly
  false.

## Provenance

Generated Codex `.skillset.tools.yaml` sidecars and lock entries make portable
policy and target-native metadata reviewable without mutating runtime trust,
settings, or user-level provider configuration.

## Tests and Fixtures

Fixtures cover `tools: readonly`, strict key validation, provider overrides,
native contradiction detection, Claude MCP glob rendering, Codex metadata
sidecars, retired `tool_intent` diagnostics, and `allowed_tools` fail-loud
behavior.
