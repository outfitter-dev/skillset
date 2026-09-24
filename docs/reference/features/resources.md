---
description: Resources define marked-link copies, explicit shared file selection, destination mapping, executable modes, path safety, and drift.
---

# Resources

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `resources` | `implemented` | `native` | `native` | `native` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Resources copy workspace or plugin shared files into a generated skill. [Workspace](../../glossary.md#workspace) inputs live under `<source-root>/shared/`; plugin inputs live under `<source-root>/plugins/<plugin>/shared/` and are available only to skills in that plugin.

## Linked files

A marked link both renders a skill-root-relative path and implies a file copy:

```markdown
Read @{{shared:references/common.md}}.
Run @{{plugin:scripts/check.sh}}.
```

The first segment after `shared:` or `plugin:` must be exactly `references`, `scripts`, `assets`, or `templates`, followed by a file path. By default the destination is the same `<group>/<rest>` path beneath the generated skill. Repeating the same source deduplicates the copy. Two different sources that map to one destination fail as a collision.

Marked links in inline code or fenced code blocks stay literal and copy nothing. `skillset.preprocess: false` also leaves them literal and copy-free. Copied Markdown is opaque resource content; Skillset does not preprocess links or partials inside it.

## Explicit resources

Use `resources` frontmatter for directories, files that are not linked from the skill body, and custom destinations. The accepted groups are `references`, `scripts`, `assets`, and `templates`.

```yaml
resources:
  references:
    - shared:references/unlinked.md
  scripts:
    - plugin:scripts/check.sh
  templates:
    - from: shared:templates/report.md
      to: templates/review-report.md
```

A string preserves its group-relative path. An object maps `from` to an explicit skill-relative `to` [destination](../../glossary.md#destination). A declared directory copies its complete tree. `shared:` selects the workspace shared root. `plugin:` selects the current plugin's shared root and is invalid for a standalone skill. The generated [skill-frontmatter schema](../schemas/README.md) owns the exact field shapes; [workspace layout](../source/workspace-layout.md) owns source placement.

When a marked link names a source already covered by a declared exact file or declared directory, that declaration wins. Its `to:` mapping determines the rendered `@` path and copy destination. Declared and implied resources then form one effective resource set for copying, collision checks, modes, locks, hashes, explain output, drift detection, and deterministic projection.

Ordinary Markdown links such as `[guide](shared:references/common.md)` remain declaration-only. They are rewritten only when an explicit resource covers the source. Otherwise build and lint reject the undeclared link and suggest `@{{shared:references/common.md}}`; keep explicit resources when the source is a directory, unlinked, or remapped.

## Provider output

Every eligible enabled [target](../../glossary.md#target) receives the effective resources beneath its generated skill directory. This includes provider skill bundles, flattened Agent Skills projections, and Agent Plugins skill packages where the source layout is eligible for those standards.

Source executable intent is authoritative. On Unix, executable inputs lower to `0755` and other generated files to `0644`; a script filename or shebang does not imply executability. Windows skips physical Unix-mode enforcement and records `0644` when the checkout exposes no executable bit.

Generated Cursor `SKILL.md` keeps the same leading `@` text. The copied path is real and portable, but Skillset does not translate the text into or promise Cursor-native UI mention behavior.

## Errors and boundaries

Skillset rejects missing inputs, invalid marked-link groups, plugin resources in standalone skills, path traversal, canonical symlink escapes, generated control-file targets, source-to-target collisions, and collisions with skill-local files. Marked links accept files only. Declared scripts without source executable bits produce a lint diagnostic; set the source bit with `chmod +x`.

Skillset validates source paths through the same declared-resource containment rules before copying. Refusal happens before managed output writes. Avoid declaring large directories when one file is sufficient because every selected byte participates in generated [drift](../../glossary.md#drift).

## Provenance

The generated skill's `skillset.lock` entry records copied paths, normalized modes, content hashes, and preprocessing dependencies. [`skillset check --only outputs`](../cli/check.md) detects content-only and mode-only drift, and [`skillset explain`](../cli/explain.md) shows the declaring skill and effective mapping.
