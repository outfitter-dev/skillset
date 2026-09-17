---
description: Skills define portable source, identity, provider output, validation, and generated provenance.
---

# Skills

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-skills` | `implemented` | `native` | `native` | `native` |
| `skill-invocation-policy` | `implemented` | `transformed` | `transformed` | `transformed` |
| `standalone-skills` | `implemented` | `native` | `native` | `native` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

A skill is a portable [source unit](../../glossary.md#source-unit) stored in one of two locations under the `.skillset/` [source root](../../glossary.md#source-root):

| Kind | Source path | Default generated roots |
| --- | --- | --- |
| Standalone | `.skillset/skills/<skill>/SKILL.md` | `.claude/skills/`, `.agents/skills/`, `.cursor/skills/` |
| Plugin-owned | `.skillset/plugins/<plugin>/skills/<skill>/SKILL.md` | `plugins/<plugin>/skills/<skill>/` shared by the standard baseline and enabled targets |

The roots in this table have different owners. Provider targets select their native skill projections. When Agent Skills is adopted, applicable standalone skills inherently render into `.agents/skills/`. When Agent Plugins 1.0 is adopted, plugin-owned skills inherently render once inside `plugins/<plugin>/skills/`. A repository-local copy of a plugin skill is a separate project-use projection, not a second standard placement. Neither standard projection has an `agents` provider target or an opt-out field.

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

Skills may be organized beneath plain or parenthesized group directories. For example, `skills/engineering/tdd/SKILL.md` and `skills/(engineering)/tdd/SKILL.md` both retain the identity `tdd`, and `skillset list` and `skillset explain` report the crossed group. Generated skills flatten to the leaf: standalone output uses `<skill-root>/tdd/SKILL.md`, and plugin-owned output uses the immediate-child `plugins/<id>/skills/<effective-id>/SKILL.md` package path. Duplicate leaves across groups fail because their generated paths would collide.

Place an unpublished counterpart under `_drafts/<skill>/`, or add `status: draft` to its frontmatter. Discovery reports the draft status and its origin, but drafts do not enter generated output or packages until a draft-rendering mode explicitly selects them. An `_drafts/<skill>/` counterpart may share the live skill's leaf within the same group; other duplicate leaves fail with both source paths.

Skill bodies support the expressions documented in [source preprocessing](../source/preprocessing.md). `compile.features.promptArguments` defaults to enabled, and `compile.skillset.metadata` defaults to enabled; [project configuration](../../configuration/project-configuration.md) owns those workspace settings.

## Provider Output

Every enabled [target](../../glossary.md#target) receives its native `SKILL.md` shape. Agent Skills and Agent Plugins baselines are derived independently from adopted profile lifecycle and source applicability. Codex may share a compatible Agent Skills `SKILL.md` while retaining compiler-owned sidecars such as `agents/openai.yaml` and `.skillset.tools.yaml` as provider deltas.

Release state supplies generated version metadata after `skillset release apply`; inline versions remain the fallback before release state exists. Disabling generated Skillset metadata does not remove lock provenance.

`{{$ARGUMENTS...}}` expressions become native Claude placeholders. Codex preserves the marker and adds replacement guidance; Cursor preserves the marker without the Codex notice.

## Standalone Agent Skills Publication

An adopted Agent Skills projection makes eligible standalone skills discoverable at `.agents/skills/<skill>/`. The generated tree preserves the rendered body, preprocessing result, declared resources, resolved license, and nearby lock provenance. Commit that generated tree when downstream consumers install standalone skills directly from the repository; see [Prepare Skillset Work for Publication](../../guides/publishing.md#publish-individual-agent-skills).

Plugin-owned skills are published through their Agent Plugins package. They do not receive a standard-owned `.agents/skills/<skill>/` duplicate. Any project-use copy keeps the same source identity but has separate destination ownership and provenance.

## Errors and Caveats

Skillset rejects identity conflicts, duplicate skill leaves across groups, unsupported source schema versions, malformed versions, invalid draft status values, invalid preprocessing expressions, unsafe resource paths, and output collisions. Agent Plugins diagnostics also reject package skill layouts the portable package would not discover. A top-level `model` is not portable: it warns unless each enabled target receives an explicit provider model through a file override or defaults.

Generated skills are [generated output](../../glossary.md#generated-output), not authoring surfaces. [`skillset check --only outputs`](../cli/check.md) reports missing, stale, or edited managed files; [`skillset explain`](../cli/explain.md) shows the deciding source, target, resources, preprocessing dependencies, and policy realization.

Use [`skillset new skill`](../cli/new.md) to scaffold a skill. The command previews without `--yes` in non-interactive use, writes only when confirmation is explicit, and rejects ids outside Agent Skills naming: 1 to 64 lowercase letters or digits separated by single hyphens.

## Provenance

Nearby `skillset.lock` entries record source and output paths, hashes, target state, version authority, copied resources, preprocessing dependencies, generated metadata policy, projection role, and any compiler-owned sidecars. Standard placements use `role: standard`; provider bundles use `role: bundle`.
