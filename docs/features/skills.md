# Skills

Feature id: `skills`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Skills are the core portable source unit. A skill can live inside a plugin at `<source-root>/plugins/<plugin>/skills/<skill>/SKILL.md` or as a standalone repo skill at `<source-root>/skills/<skill>/SKILL.md`, where `<source-root>` is `.skillset/`.

## Authoring

Skill source is Markdown with YAML frontmatter. Skillset derives machine identity from the directory and accepts top-level `name`, `title`, `summary`, `description`, `version`, `resources`, `implicit_invocation`, `allowed_tools`, `tools`, and target-specific provider blocks such as `claude`, `codex`, and `cursor`. The active frontmatter contract is generated from `@skillset/schema`; see [schema reference](../reference/schemas/README.md) and [skill frontmatter examples](../reference/examples/skill-frontmatter.yaml) for the current field set, including common metadata blocks, dependencies, generated metadata, `supports`, and provider override blocks. Skill-local `skillset.name`, `skillset.id`, and `skillset.version` are rejected; use top-level `name` and `version`. Skill Markdown bodies and generated Codex `agents/openai.yaml` sidecars support preprocessing with nested `{{this.<field>}}` frontmatter references, scalar values, object and array JSON rendering, `{{skillset.*}}` / `{{parent.*}}` context variables, triple-brace literal escapes such as `{{{this.description}}}`, prompt argument placeholders such as `{{$ARGUMENTS}}`, `{{$ARGUMENTS[0]}}`, `{{$ARGUMENTS[1]}}`, and `{{$ARGUMENTS.name}}`, path partials such as `{{shared:path.md}}`, `{{plugin:path.md}}`, or a file path relative to the current source file, and named partials such as `{{> intro}}`. Named partials resolve from `.skillset/partials/` first, then from the current plugin's `partials/` when plugin-bound; `{{> <plugin>.<name>}}` can explicitly address the current plugin's own partial namespace, and cross-plugin partial references fail. Skill prose can also include template guidance placeholders such as `{ Customer name }` or `[Customer name]`; those are reader-facing examples, not preprocessing variables.

Use `skillset new skill <name>` to create a minimal valid skill source file in the detected source root. The command plans by default and writes only with `--yes`. It derives a kebab-case id from the display name unless `--id` is provided; `--name` can keep a prettier display title separate from the stable id. `--in <plugin-name>` writes into an existing plugin container. Skill presets can add common support surfaces: `support` creates `references/`, `assets/`, and `scripts/`; `evals` creates `evals/evals.json`; `reference-file` and `examples-file` create `REFERENCE.md` or `EXAMPLES.md` when one file is enough. `assets/` is the broad static-resource home; examples, starter files, and template-like artifacts can live there until they need stronger semantics.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| Plugin skill source | `plugins/<plugin>/claude/skills/<skill>/SKILL.md` | `plugins/<plugin>/codex/skills/<skill>/SKILL.md` plus sidecars when needed | `portable` / `implemented` | Plugin boundaries are preserved per target. |
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
