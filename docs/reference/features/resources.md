---
description: Resources define shared file selection, destination mapping, executable modes, path safety, and drift.
---

# Resources

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `resources` | `implemented` | `native` | `native` | `native` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Resources let a skill select shared files or directories for copying into its generated folder. [Workspace](../../glossary.md#workspace) inputs live under `.skillset/shared/`; plugin-local inputs live under `.skillset/plugins/<plugin>/shared/` and are available only to skills in that plugin.

## Source Contract

`resources` accepts the groups `references`, `scripts`, `assets`, and `templates`. A string preserves the group-relative path. An object maps `from` to an explicit skill-relative `to` [destination](../../glossary.md#destination).

```yaml
resources:
  references:
    - shared:references/common.md
  scripts:
    - plugin:scripts/check.sh
  templates:
    - from: shared:templates/report.md
      to: templates/review-report.md
```

`shared:` selects the workspace shared root. `plugin:` selects the current plugin's shared root and is invalid for a standalone skill. A declared directory copies its complete tree. The generated [skill-frontmatter schema](../schemas/README.md) owns the exact field shapes; [workspace layout](../source/workspace-layout.md) owns source placement.

## Provider Output

Every enabled [target](../../glossary.md#target) receives the declared resource beneath the generated skill directory. Links from the skill or copied resources are rewritten to the mapped destination where required. A custom `to` therefore becomes the only valid generated path.

Source executable intent is authoritative. On Unix, executable inputs lower to `0755` and other generated files to `0644`; a script filename or shebang does not imply executability. Windows skips physical Unix-mode enforcement and records `0644` when the checkout exposes no executable bit.

## Errors and Caveats

Skillset rejects missing inputs, undeclared shared-resource links, ambiguous bare links after custom mapping, path traversal, generated-file collisions, and plugin resources referenced by standalone skills. Declared scripts without source executable bits produce a lint diagnostic; set the source bit with `chmod +x`.

Resources are copied, unlike resolve-only references described by [source preprocessing](../source/preprocessing.md). Avoid declaring large directories when one file is sufficient because every selected byte participates in generated [drift](../../glossary.md#drift).

## Provenance

The generated skill's `skillset.lock` entry records copied paths, normalized modes, content hashes, and preprocessing dependencies. [`skillset check --only outputs`](../cli/check.md) detects content-only and mode-only drift, and [`skillset explain`](../cli/explain.md) shows the declaring skill and mapping.
