---
description: Skills define portable source, identity, provider output, validation, and generated provenance.
---

# Skills

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-skills` | `implemented` | `native` | `native` | `native` |
| `standalone-skills` | `implemented` | `native` | `native` | `native` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

A skill is a portable [source unit](../../glossary.md#source-unit) stored in one of two locations under the `.skillset/` [source root](../../glossary.md#source-root):

| Kind | Source path | Default generated roots |
| --- | --- | --- |
| Standalone | `.skillset/skills/<skill>/SKILL.md` | `.claude/skills/`, `.agents/skills/`, `.cursor/skills/` |
| Plugin-owned | `.skillset/plugins/<plugin>/skills/<skill>/SKILL.md` | `plugins/<plugin>/<target>/skills/` for each enabled [target](../../glossary.md#target) |

The directory name is the stable skill identity. Top-level `name`, when present, must agree with it. Skill-local `skillset.name`, `skillset.id`, and `skillset.version` are invalid; version authority uses top-level `version` until [workspace](../../glossary.md#workspace) release state supersedes it.

## Source Contract

Skill source is Markdown with YAML frontmatter and a body:

```markdown
---
name: docs-review
description: Review documentation for contract accuracy and usable navigation.
tools: readonly
---

# Docs Review

Check claims against their [canonical source](../../glossary.md#canonical-source) before proposing edits.
```

The generated [skill-frontmatter schema and example](../schemas/README.md) own the complete field set and value constraints. The [frontmatter reference](../../configuration/frontmatter.md) explains field ownership; [target overrides](../../configuration/target-overrides.md), [tools policy](../../configuration/tools-policy.md), and [resources](resources.md) own their specialized configuration.

Skill bodies support the expressions documented in [source preprocessing](../source/preprocessing.md). `compile.features.promptArguments` defaults to enabled, and `compile.skillset.metadata` defaults to enabled; [project configuration](../../configuration/project-configuration.md) owns those workspace settings.

## Provider Output

Every enabled [target](../../glossary.md#target) receives its native `SKILL.md` shape. Plugin boundaries remain intact. Codex may also receive compiler-owned sidecars such as `agents/openai.yaml` and `.skillset.tools.yaml` when authored policy requires them.

Release state supplies generated version metadata after `skillset release apply`; inline versions remain the fallback before release state exists. Disabling generated Skillset metadata does not remove lock provenance.

`{{$ARGUMENTS...}}` expressions become native Claude placeholders. Codex preserves the marker and adds replacement guidance; Cursor preserves the marker without the Codex notice.

## Errors and Caveats

Skillset rejects identity conflicts, unsupported source schema versions, malformed versions, invalid preprocessing expressions, unsafe resource paths, and output collisions. A top-level `model` is not portable: it warns unless each enabled target receives an explicit provider model through a file override or defaults.

Generated skills are [generated output](../../glossary.md#generated-output), not authoring surfaces. [`skillset check --only outputs`](../cli/check.md) reports missing, stale, or edited managed files; [`skillset explain`](../cli/explain.md) shows the deciding source, target, resources, preprocessing dependencies, and policy realization.

Use [`skillset new skill`](../cli/new.md) to scaffold a skill. The command previews without `--yes` in non-interactive use and writes only when confirmation is explicit.

## Provenance

Nearby `skillset.lock` entries record source and output paths, hashes, target state, version authority, copied resources, preprocessing dependencies, generated metadata policy, and any compiler-owned sidecars.
