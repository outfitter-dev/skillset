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

A marked link both renders a path relative to its emitted Markdown file and implies a file copy:

```markdown
Read @{{shared:references/common.md}}.
Run @{{plugin:scripts/check.sh}}.
```

The first segment after `shared:` or `plugin:` must be exactly `references`, `scripts`, `assets`, or `templates`, followed by a file path. By default the destination is the same `<group>/<rest>` path beneath the generated skill. Repeating the same source deduplicates the copy. Two different sources that map to one destination fail as a collision.

Marked links in inline code or fenced code blocks stay literal and copy nothing, including fences inside lists and blockquotes. Protection ends when the containing block ends, even if the fence has no closing marker. Raw HTML blocks are boundaries for Markdown code parsing: backticks or fence-like lines inside them do not make an explicit marked reference literal. References in those blocks still follow the normal preprocessing rules. `skillset.preprocess: false` also leaves them literal and copy-free. Copied Markdown processes its own links and partials unless that file carries the opt-out. Non-Markdown resources remain byte-preserving. Nested skill Markdown and the primary body share one copy inventory.

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

Ordinary Markdown links such as `[guide](shared:references/common.md)` remain declaration-only. They are rewritten only when an explicit resource covers the source. Otherwise build and lint reject the undeclared link and suggest `@{{shared:references/common.md}}`; keep explicit resources when the source is a directory, unlinked, or remapped. Link-shaped examples in fenced, inline or indented code, HTML comments, or escaped brackets stay literal and do not create resource or plugin-script dependency diagnostics. A real link may contain inline code in its label; its destination still follows the declared-resource mapping.

## Provider output

Every eligible enabled [target](../../glossary.md#target) receives the effective resources beneath its generated skill directory. This includes provider skill bundles, flattened Agent Skills projections, and Agent Plugins skill packages where the source layout is eligible for those standards.

Source executable intent is authoritative. On Unix, executable inputs lower to `0755` and other generated files to `0644`; a script filename or shebang does not imply executability. Windows skips physical Unix-mode enforcement and records `0644` when the checkout exposes no executable bit.

Generated Cursor `SKILL.md` keeps the same leading `@` text. The copied path is real and portable, but Skillset does not translate the text into or promise Cursor-native UI mention behavior.

## Errors and boundaries

Skillset rejects missing inputs, invalid marked-link groups, plugin resources in standalone skills, path traversal, canonical symlink escapes, generated control-file targets, source-to-target collisions, and collisions with skill-local files. Marked links accept files only. Declared scripts without source executable bits produce a lint diagnostic; set the source bit with `chmod +x`.

Skillset validates source paths through the same declared-resource containment rules before copying. Refusal happens before managed output writes. Avoid declaring large directories when one file is sufficient because every selected byte participates in generated [drift](../../glossary.md#drift).

## Plugin-level shared files

A plugin subagent, hook command, or emitted script using a marked shared reference lifts the resource into `plugins/<plugin>/shared/<group>/<rest>`. Skill-owned references still copy inside the skill: the referrer's portable unit determines the destination. Plugin `shared/` support files also travel with the shared package. Repeated references deduplicate the same output, and the plugin lock records preprocessing dependencies.

If the plugin authors `shared/references/common.md` and plugin-level content also links the workspace `shared:references/common.md`, build fails with `shared-reference-collision`, naming both sources even if their bytes agree. The diagnostic recommends `skillset move plugins/<plugin>/shared/references/common.md shared/references/common.md` so the author can promote the material deliberately. The build does not perform the move.

Subagent Markdown links are relative to the emitted Markdown file. [Hook and script arguments](hooks.md#shared-files-in-plugin-hooks-and-scripts) preserve `@` and have explicit shell and runtime-path boundaries; copying a file alone does not qualify an arbitrary command. Cursor plugin rules and provider-native islands are outside this lifting path.

## Size advisories

`skill-resource-size` warns when a physical skill's emitted supporting files exceed 1 MiB (1,048,576 bytes). It counts each output path once, after preprocessing, excluding the primary `SKILL.md` and generated license/tool/agent controls. Multiple provider consumers of the same physical skill do not multiply its size. The warning is advisory and the build continues; it is a Skillset packaging threshold, not a provider installation limit.

`rule-import-size` warns when a rule with shared preprocessing dependencies exceeds 256 KiB (262,144 bytes) in either its final rendered content or its unique shared dependency bytes. The message reports both measurements separately because inlined text can occur in both. This conservative threshold encourages smaller eager context; it is not an estimate of tokens or a provider hard limit. Claude's [memory documentation](https://code.claude.com/docs/en/memory#my-claudemd-is-too-large) states that imports load with their parent, recommends short instruction files, and documents a 4 MiB skip limit for files loaded at launch. On-demand files have separate limits.

Both advisories use the selected output scope and appear during builds, diffs, and generated-output checks. A large rule without shared preprocessing dependencies does not receive the import advisory.

## Provenance

The generated skill's `skillset.lock` entry records copied paths, normalized modes, content hashes, and preprocessing dependencies. [`skillset check --only outputs`](../cli/check.md) detects content-only and mode-only drift, and [`skillset explain`](../cli/explain.md) shows the declaring skill and effective mapping.

## Ordinary links in emitted distributions

Build validates ordinary Markdown links and images in each emitted primary
`SKILL.md` against that skill's final distribution, after resource copying and
marked-reference rewriting. A file existing only in source does not satisfy a
link. Another skill's output cannot satisfy it either. Declare the resource or
use a marked resource reference so the destination is bundled.

The same check covers a plugin's root `README.md` and copied subagent Markdown
with known source ownership, using the shared plugin package as the boundary.
Missing or escaping destinations fail before output writes, with the source
path, emitted Markdown path, and destination in the diagnostic. Portable-only
projection runs the same check.

Inline and reference-style links and images are parsed as CommonMark. Code
examples and HTML comments are not links. Percent-encoded paths are decoded;
query strings and fragments do not affect file lookup. Fragment anchors are not
validated. A directory link requires an emitted descendant. Link dot segments (`.` and `..`) normalize before inventory lookup; this checks the resolved link target, not raw filesystem traversal of every spelled segment. External schemes,
network URLs, and fragment-only destinations are outside this file check.
Dynamic destinations containing substitutions are unvalidated; this check does
not prove runtime paths. Copied resource Markdown (including a resource named
`SKILL.md`) and opaque islands are not recursively checked. Their nested link
graph remains outside this primary-file validation.
