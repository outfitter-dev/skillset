# Tools Policy

Feature id: `tools-policy`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

`tools` records portable skill-local tool policy where providers have different
native names and enforcement models. It is open-world: unset means provider
default, `true` grants or preapproves where possible, `false` constrains where
possible, and unsupported realizations must stay visible.

The post-tools policy boundary is deliberately narrow: Skillset does not have a
separate user-facing `policy` source family. Tool availability intent belongs
in `tools`; provider-native policy strings belong under `tools.<provider>`;
settings, trust, install, activation, and managed-policy changes remain
reviewed suggestions or external workflows. Generated prose, scripts, shims,
and metadata sidecars can explain or preserve policy intent, but they do not
count as enforcement unless the provider enforces that surface.

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
| Portable `tools` | `allowed-tools` / `disallowed-tools` preapproval and denial rules | `.skillset.tools.yaml` metadata | `.skillset.tools.yaml` metadata | `transformed` / `metadata_only` |
| Provider `tools.claude.allow` / `deny` | native Claude rule strings | n/a | n/a | `target_native` |
| Provider `tools.codex.allow` / `deny` | n/a | `.skillset.tools.yaml` target-native metadata | n/a | `metadata_only` |
| Provider `tools.cursor.allow` / `deny` | n/a | n/a | `.skillset.tools.yaml` target-native metadata | `metadata_only` |
| `allowed_tools` | Claude `allowed-tools` | unset or false only | unset or false only | separate Claude preapproval escape |

Claude MCP rendering emits provider-native glob strings such as `mcp__github`,
`mcp__github__get_*`, `mcp__linear`, and `mcp__*`; Skillset does not emit
regex-style `mcp__.*__.*` rules.

Policy-like target behavior that cannot be enforced through the rendered
provider surface must remain visible as `metadata_only`, `degraded`,
`unsupported`, `externally_managed`, or another structured render-result
status. For example, Codex and Cursor skill-local tools policy is preserved as
metadata today, while Claude receives native frontmatter rules. If a future
provider surface can enforce the same portable intent, the realization registry
should be updated first and renderers should consume the registry fact.

## Realization Registry

`packages/core/src/tools-realization.ts` is the source of truth for how each
portable aspect is realized per provider. Each fact records the realization
tier (`native`, `transformed`, `derived`, `approximate`, `advisory`,
`metadata-only`, `settings-required`, or `unsupported`), the surface (skill
frontmatter, agent definition, hook, project/user config, managed policy,
settings suggestion, metadata, or nowhere), the emitted field/rule family, the
residual-risk diagnostic, and the evidence backing the claim. Renderers,
render results, lookup, and explain consume these facts instead of duplicating
support claims inline; provider-specific transforms stay in code and the
registry cites their output.

Rendered v1 facts: Claude realizes portable keys as `transformed`
skill-frontmatter rules and native overlay strings as `native`; Codex and
Cursor realize portable and target-native policy as `metadata-only`
`.skillset.tools.yaml` sidecars. Non-rendered facts record stronger provider
surfaces Skillset deliberately does not drive: Codex
`sandbox_mode = "read-only"` and Cursor agent `readonly: true` are
`settings-required` for `write: false`, the experimental Agent Skills
`allowed-tools` field is `advisory` for Codex, and Cursor per-skill MCP
enforcement is `unsupported`. No `derived` or `approximate` row is claimed
until a provider realization is proven.

Inspect the matrix and per-unit plans:

```bash
skillset lookup skill tools --compat claude,codex,cursor --json
skillset explain .skillset/skills/<skill>/SKILL.md --json
```

`skillset explain` reports a per-target resolution table for source units that
author portable `tools`: intent key, deciding layer (macro expansion, base,
provider override, or native overlay), realization tier, emitted field/rule,
and residual-risk diagnostics. Unknown native rules stay valid and appear as
unclassified, provenance-only entries.

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

Generated Codex and Cursor `.skillset.tools.yaml` sidecars and lock entries
make portable policy and target-native metadata reviewable without mutating
runtime trust, settings, or user-level provider configuration. Tools-policy
render results cite realization-registry evidence and carry
`tools-policy-realization` diagnostic refs for residual-risk and
metadata-honesty notes.

See the [Post-Tools Policy Boundary ADR](../adrs/drafts/20260705-post-tools-policy-boundary.md)
for the rule that a generated instruction, probe, shim, helper script, or
sidecar is compatibility/provenance material unless the provider itself
enforces the behavior.

## Tests and Fixtures

Fixtures cover `tools: readonly`, strict key validation, provider overrides,
native contradiction detection, Claude MCP glob rendering, Codex and Cursor
metadata sidecars, retired `tool_intent` diagnostics, and `allowed_tools`
fail-loud behavior. `packages/core/src/__tests__/tools-realization.test.ts`
pins the realization registry seed (tier and surface vocabularies, honest
per-tier coverage, exactly one rendered fact per provider/aspect/direction)
and the planner (macro/base/provider-override/native-overlay deciding layers,
per-aspect emitted rules, unclassified native rules staying valid).
