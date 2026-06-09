# Skills

Feature id: `skills`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Skills are the core portable source unit. A skill can live inside a plugin at `.skillset/plugins/<plugin>/skills/<skill>/SKILL.md` or as a standalone repo skill at `.skillset/skills/<skill>/SKILL.md`.

## Authoring

Skill source is Markdown with YAML frontmatter. Skillset derives machine identity from the directory and accepts top-level `name`, `title`, `summary`, `description`, `version`, `resources`, `implicit_invocation`, `allowed_tools`, `tool_intent`, and target-specific `claude` / `codex` blocks. `skillset.name` and `skillset.id` remain compatibility metadata when imported source still carries them.

## Target Lowering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| Plugin skill source | `plugins-claude/plugins/<plugin>/skills/<skill>/SKILL.md` | `plugins-codex/plugins/<plugin>/skills/<skill>/SKILL.md` plus sidecars when needed | `portable` / `implemented` | Plugin boundaries are preserved per target. |
| Standalone skill source | `.claude/skills/<skill>/SKILL.md` | `.agents/skills/<skill>/SKILL.md` plus sidecars when needed | `portable` / `implemented` | Standalone roots are configured by target skill output paths. |
| Release state / inline version fields | `metadata.version` and plugin manifest version | `metadata.version` and plugin manifest version | `metadata_only` / `implemented` | Release state wins after `skillset release apply`; inline versions remain the fallback. `skillset check` reports version drift. |
| `compile.skillset.metadata: false` | suppress generated Skillset metadata | suppress generated Skillset metadata | `implemented` | Locks still carry provenance. |

## Diagnostics

- Reject unsupported source schema versions and malformed semver product versions.
- Reject identity conflicts between directory names, top-level `name`, `skillset.name`, and `skillset.id`.
- Reject unknown portable frontmatter keys unless they are accepted target-native fields inside a target block.
- Warn for top-level `model` unless every enabled target has an exact target model through file-level fields or defaults.
- Reject stale generated skills and manifests in `skillset check`.

## Provenance

Generated skill and plugin lock entries record source paths, output paths, hashes, version state, target state, skipped target-specific skill versions, copied resources, and generated metadata policy.

## Tests and Fixtures

Fixtures cover plugin and standalone skill rendering, identity aliases and conflicts, version drift, metadata suppression, target defaults, target opt-outs, generated sidecars, and import preservation.
