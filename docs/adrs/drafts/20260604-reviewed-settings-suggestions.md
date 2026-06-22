---
slug: reviewed-settings-suggestions
title: Reviewed Settings Suggestions
status: draft
created: 2026-06-04
updated: 2026-06-04
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, global-xdg-managed-installs-and-sync, feature-reference-and-schema-registry]
---

# ADR: Reviewed Settings Suggestions

## Context

Skillset v1 deliberately separates compilation from activation. That boundary is easy to preserve for generated skills, plugins, instructions, hooks, MCP definitions, and target-native islands because the compiler can write deterministic output under managed roots and leave runtime discovery, trust, and user configuration alone.

Settings are different. Claude and Codex both expose settings/config files that can change permissions, plugin availability, sandboxing, approval prompts, MCP servers, hooks, models, and local machine behavior. Those files sit close to target runtime authority:

- Claude Code documents managed, user, project, and local scopes. User settings live under `~/.claude/`; project settings live under `.claude/`; local project settings live at `.claude/settings.local.json`; settings precedence puts managed policy highest, then command-line arguments, local, project, and user settings. Claude also documents plugin-related `enabledPlugins` and marketplace settings in `settings.json`.
- Codex documents user configuration at `~/.codex/config.toml`, project overrides at `.codex/config.toml`, profile files at `~/.codex/<profile>.config.toml`, system config at `/etc/codex/config.toml`, and trust-gated loading for project `.codex/` layers.

Skillset already supports explicit target-native source islands and feature source pointers. A user can author a native file intentionally and ask Skillset to project it into a generated target tree. That is different from Skillset synthesizing a new target settings edit because it noticed a plugin, hook, marketplace, MCP server, permission rule, or model default might need runtime configuration.

SET-29 tracks the future reviewed workflow. It does not implement settings writes.

## Decision

Skillset settings assistance should be a separate reviewed suggestion workflow. It must never be an implicit side effect of `skillset build`, `skillset check`, `skillset diff`, `skillset init`, `skillset create`, plugin generation, or target-native pass-through.

The workflow has three distinct concepts:

1. **Explicit pass-through**: authored target-native settings files that the user placed in source. These are copied only through already-scoped native surfaces, with normal generated-output collision and lock behavior. Pass-through does not mean Skillset understands or recommends the settings.
2. **Synthesized suggestion**: a Skillset-authored proposed settings change derived from source intent, such as enabling a plugin, adding a known marketplace, adding an MCP server reference, setting a local model/profile preference, or adding a permission rule. Suggestions are plans, not writes.
3. **Accepted settings write**: a user-approved mutation to a target settings file. This is a future explicit command surface with confirmation, backups, conflict checks, and a ledger. It is not part of v1.

The future command shape should be plan-first:

```bash
skillset settings suggest --root . --scope project
skillset settings suggest --root . --scope user
skillset settings apply <suggestion-id> --root . --yes
skillset settings reject <suggestion-id> --root .
```

The exact command names can change, but the semantics should not: `suggest` produces reviewable output, `apply` writes only an accepted suggestion, and `reject` records a deliberate no-op when a suggestion would otherwise keep reappearing.

## Target Settings Surface

Skillset should model target settings by scope before modeling individual keys.

| Target | Scope | File | Safety posture |
| --- | --- | --- | --- |
| Claude | managed | platform, MDM, registry, or system `managed-settings.json` | Read-only evidence only. Skillset must not write managed policy. Managed paths vary by platform and deployment; refresh target docs before implementing any managed-settings workflow. |
| Claude | user | `~/.claude/settings.json` | Future explicit user-scope suggestion only; never touched by build. |
| Claude | project | `.claude/settings.json` | Future explicit project-scope suggestion when Skillset synthesizes an edit for an unmanaged target settings file; review as a repo file and preserve team-shared intent. |
| Claude | local | `.claude/settings.local.json` | Future explicit local-scope suggestion when Skillset synthesizes an edit; never commit by default; protect personal overrides. |
| Claude | other state | `~/.claude.json` | Read-only evidence by default; do not synthesize writes without a separate ADR because it mixes auth/session, MCP, trust, and cache state. |
| Codex | system | `/etc/codex/config.toml` | Read-only evidence only. Skillset must not write system policy. |
| Codex | user | `~/.codex/config.toml` | Future explicit user-scope suggestion only; never touched by build. |
| Codex | profile | `~/.codex/<profile>.config.toml` | Future explicit profile-scope suggestion only; profile semantics must be visible in the suggestion id and plan. |
| Codex | project | `.codex/config.toml` | Future explicit project-scope suggestion when Skillset synthesizes an edit for an unmanaged target config file; respect Codex trust-gated project loading. |
| Codex | managed requirements | `requirements.toml` / managed config layers | Read-only evidence unless a later admin-focused ADR defines managed configuration authoring. Managed file paths and supported keys must be refreshed against target docs before implementation. |

Settings suggestions must not treat all target config as one blob. They need a target, scope, file path, key path, merge strategy, and safety class.

This table is about future synthesized suggestions against target settings/config files. It does not reclassify already-authored source islands as suggestions. For example, if a repo intentionally authors `.skillset/src/claude/settings.json` or `.skillset/src/codex/config.toml`, existing target-native island rules apply: the file is source-owned, mirrored only to the matching project target root, protected by unmanaged-collision backups, and recorded as generated output provenance. Skillset still does not understand that authored file as a recommendation, does not merge it with live target state, and must not use it as permission to write user, local, system, managed, or profile settings.

## Suggestion Record

A suggestion should be represented as structured data before any patch is shown:

```yaml
id: claude-project-enabled-plugin-skillset
target: claude
scope: project
file: .claude/settings.json
keyPath: enabledPlugins.skillset@local
operation: set
value: true
reason: "Plugin output exists and source asked for project-level activation."
safety: review-required
source:
  path: .skillset/plugins/skillset/skillset.yaml
conflicts:
  - existingValue: false
    meaning: "Project settings explicitly disable this plugin."
```

The record should carry enough information for `diff`, `explain`, review UI, and audit logs without requiring the user to infer meaning from a raw JSON/TOML patch.

Suggested writes should use target-native parsers and merge rules:

- Claude settings are JSON and can include arrays that merge across scopes. A suggestion must say whether it is replacing a scalar, appending to an array, merging an object, or deleting a key.
- Codex config is TOML with layered precedence. A suggestion must say whether it targets user, profile, project, or system-like configuration and whether the project must be trusted before the setting can take effect.

## CLI UX

Suggested settings should appear as a separate section from generated-output diffs:

```text
skillset: settings suggestions (not applied)
  ? claude project .claude/settings.json set enabledPlugins.skillset@local = true
  ? codex project .codex/config.toml set model = "gpt-5.5"
```

`skillset diff` may show suggestions only when explicitly requested, for example `skillset diff --include settings` or a future `skillset settings suggest`. Ordinary `skillset diff` should continue to mean generated-output drift.

`skillset explain <settings-path>` should be able to say:

- whether the file is unmanaged target runtime config, authored target-native source, generated output, or a suggestion target;
- which suggestion would affect it;
- why Skillset will not write it during build.

`skillset doctor` can report unapplied or conflicting suggestions as advisory diagnostics, not build failures, unless the user explicitly opted into a workflow that requires a suggestion to be accepted.

## Locks, Ledgers, and Provenance

Settings suggestions should not be hidden inside generated-output lock entries as if a target settings file were ordinary generated output. They need a separate reviewed-change ledger because a suggestion can be rejected, accepted manually outside Skillset, become stale after target settings change, or conflict with a local override.

Future state should use two surfaces:

- `skillset.lock` continues to describe generated outputs.
- A settings suggestion ledger, for example `.skillset/settings-suggestions.lock` or Skillset-owned XDG state for user scope, records suggestion ids, source hashes, target file hashes at review time, accepted/rejected status, backups, and timestamps.

The ledger must be scoped. Project suggestions can live in the repo if the team wants to preserve review history. User/global suggestions should live in Skillset-owned user state, not in `~/.claude` or `~/.codex`.

## Conflict Handling

Before applying a suggestion, Skillset must:

- parse the current target settings file with the target-native parser;
- fail loudly on invalid JSON/TOML instead of rewriting it;
- compare the target file hash and key path against the reviewed suggestion;
- refuse to overwrite unmanaged changes unless the user refreshes the suggestion;
- create a backup or reversible patch before writing;
- show scope and precedence, especially when a lower-priority setting may not take effect because a higher-priority target setting wins.

Conflicts should be explained in target vocabulary. For example, a Claude local setting can override a shared project setting, while Codex may skip project `.codex/` layers until the project is trusted.

## Interaction With Plugin Installation

Settings suggestions can help users enable generated or installed plugins, add marketplaces, or configure MCP servers, but they are not plugin installation.

Plugin install/sync remains the activation workflow from the global/XDG ADR. Settings suggestions can be one step inside that workflow only when surfaced as a separate review item. A future install command may say "install plugin output, then review these settings suggestions," but it must not silently write settings as part of copying plugin files.

## Implementation Decision

No part of this workflow graduates into implementation in SET-29.

The only accepted implementation work from this ADR is documentation and future issue shaping. Parser support, suggestion records, settings diff output, ledgers, backups, and apply/reject commands require later issues after target-specific settings schemas and safety prompts are designed.

## Consequences

### Positive

- Preserves the v1 promise that build/check/diff are authoring tools, not activation or runtime mutation tools.
- Gives future settings work a clear shape that can be reviewed before code exists.
- Separates target-native pass-through from synthesized suggestions, so authored native files do not become a loophole for magical settings edits.
- Gives `diff`, `explain`, `doctor`, locks, and user-scope safety a shared vocabulary for settings without forcing them into generated-output semantics.

### Tradeoffs

- Settings assistance stays slower to ship because it needs target-specific parsers, schemas, and safety prompts.
- Users who want "just enable this plugin" still need to do target settings work manually until a later issue implements reviewed suggestions.
- A separate ledger adds conceptual weight, but it keeps accepted/rejected/manual settings changes honest.

### Risks

- Target settings surfaces will keep changing. Mitigation: require live target-doc evidence and target-specific schemas before implementing writes.
- Suggestion plans could become noisy. Mitigation: require stable suggestion ids, rejection records, and a way to hide suggestions that are intentionally out of scope.
- User-scope suggestions can expose personal paths or preferences. Mitigation: store user/global suggestion history in Skillset-owned user state and avoid committing it by default.

## Non-Decisions

- Exact command names for settings suggestions.
- The schema for every Claude and Codex settings key.
- Whether generated plugin output should ever declare "recommended settings" metadata.
- Whether marketplace installation should drive settings suggestions or settings suggestions should drive marketplace installation.
- Whether managed enterprise settings can be authored by Skillset. This remains out of scope.

## References

- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - baseline source-first compiler doctrine.
- [ADR-0001: Root Compile Policy](../0001-root-compile-policy.md) - provider selection and fail-loud unsupported behavior.
- [Global / XDG Managed Installs and Sync](20260604-global-xdg-managed-installs-and-sync.md) - separates build from install/sync/trust and user-level mutation.
- [Feature Reference and Schema Registry](20260604-feature-reference-and-schema-registry.md) - tracks settings as future-only and target-native.
- [Tenets](../../tenets.md) - build does not imply trust and drift should be visible early.
- [Target Surface Evidence Matrix](../../target-surfaces.md) - compact support matrix for target surfaces.
- [Claude Code settings](https://code.claude.com/docs/en/settings) - official settings scopes, settings files, precedence, and plugin settings evidence.
- [Codex config basics](https://developers.openai.com/codex/config-basic) - official config paths, precedence, trust-gated project config, and common settings evidence.
