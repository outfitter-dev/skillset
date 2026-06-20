# Skills

Feature id: `skills`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Skills are the core portable source unit. A skill can live inside a plugin at `.skillset/src/plugins/<plugin>/skills/<skill>/SKILL.md` or as a standalone repo skill at `.skillset/src/skills/<skill>/SKILL.md`.

## Authoring

Skill source is Markdown with YAML frontmatter. Skillset derives machine identity from the directory and accepts top-level `name`, `title`, `summary`, `description`, `version`, `resources`, `implicit_invocation`, `allowed_tools`, `tool_intent`, and target-specific `claude` / `codex` blocks. Skill-local `skillset.name`, `skillset.id`, and `skillset.version` are rejected; use top-level `name` and `version`. Skill Markdown bodies and generated Codex `agents/openai.yaml` sidecars support preprocessing with nested `{{this.<field>}}` frontmatter references, scalar values, object and array JSON rendering, `{{skillset.*}}` / `{{parent.*}}` context variables, triple-brace literal escapes such as `{{{this.description}}}`, prompt argument placeholders such as `{{$ARGUMENTS}}`, `{{$ARGUMENTS[0]}}`, `{{$ARGUMENTS[1]}}`, and `{{$ARGUMENTS.name}}`, and partials such as `{{shared:path.md}}`, `{{plugin:path.md}}`, or a file path relative to the current source file. Skill prose can also include template guidance placeholders such as `{ Customer name }` or `[Customer name]`; those are reader-facing examples, not preprocessing variables.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| Plugin skill source | `plugins-claude/plugins/<plugin>/skills/<skill>/SKILL.md` | `plugins-codex/plugins/<plugin>/skills/<skill>/SKILL.md` plus sidecars when needed | `portable` / `implemented` | Plugin boundaries are preserved per target. |
| Standalone skill source | `.claude/skills/<skill>/SKILL.md` | `.agents/skills/<skill>/SKILL.md` plus sidecars when needed | `portable` / `implemented` | Standalone roots are configured by target skill output paths. |
| Release state / inline version fields | `metadata.version` and plugin manifest version | `metadata.version` and plugin manifest version | `metadata_only` / `implemented` | Release state wins after `skillset release apply`; inline versions remain the fallback. `skillset verify` reports generated version drift. |
| `{{$ARGUMENTS...}}` source placeholders | native `$ARGUMENTS...` placeholders | preserved `{{$ARGUMENTS...}}` markers plus a one-line replacement instruction | `shimmed` / `implemented` | Enabled by default through `compile.features.promptArguments`; disable to reject the source markers. |
| `compile.skillset.metadata: false` | suppress generated Skillset metadata | suppress generated Skillset metadata | `implemented` | Locks still carry provenance. |

## Diagnostics

- Reject unsupported source schema versions and malformed semver product versions.
- Reject identity conflicts between directory names and top-level `name`; reject skill-local `skillset.name`, `skillset.id`, and `skillset.version`.
- Reject unknown portable frontmatter keys unless they are accepted target-native fields inside a target block.
- Warn for top-level `model` unless every enabled target has an exact target model through file-level fields or defaults.
- Reject stale generated skills and manifests in `skillset verify`.

## Provenance

Generated skill and plugin lock entries record source paths, output paths, hashes, version state, target state, skipped target-specific skill versions, copied resources, preprocessing dependencies, and generated metadata policy. Partial files referenced from skill Markdown or generated Codex YAML participate in source hashes so `skillset verify`, `skillset explain`, and `skillset list` can show why a generated skill became stale.

## Tests and Fixtures

Fixtures cover plugin and standalone skill rendering, identity conflicts, old metadata-key rejection, version drift, metadata suppression, target defaults, target opt-outs, generated sidecars, and import preservation.
