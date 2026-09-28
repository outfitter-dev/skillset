---
description: Defines Skillset Markdown preprocessing variables, prompt arguments, exact partials, marked links, escapes, and failure behavior.
---

# Preprocessing

Skillset preprocesses Markdown [source](../../glossary.md#canonical-source) before [target](../../glossary.md#target) serialization. The language substitutes known document and path context, expands exact partials, and resolves marked links without becoming a general template engine.

Preprocessing applies to supported Markdown source, including skills and [rules](rules.md). Invalid reserved expressions fail with the source path and relevant name. Unrelated double-brace text, such as JSX object literals, remains unchanged.

## Document values

Use `{{this.<field>}}` to read shared frontmatter from the current document:

```markdown
This source is maintained by {{this.metadata.owner}}.
```

Nested dot paths are supported. Missing fields fail rather than producing an empty string. Strings, numbers, and booleans serialize as text. Objects and arrays serialize as fenced JSON in Markdown prose, as indented JSON when already inside a fenced block, and as compact JSON when the [destination](../../glossary.md#destination) is a structured sidecar.

Triple braces preserve a recognized token literally. `{{{this.description}}}` renders as `{{this.description}}` instead of substituting the field.

## Source and parent context

All preprocessed files can use:

| Expression | Meaning |
| --- | --- |
| `{{skillset.source_path}}` | Current source path relative to the [workspace](../../glossary.md#workspace). |
| `{{skillset.source_dir}}` | Directory containing the current source file. |
| `{{skillset.source_root}}` | Canonical Skillset [source root](../../glossary.md#source-root). |
| `{{parent.name}}` | Name of the owning source scope. |
| `{{parent.dir}}` | Directory of the owning source scope. |
| `{{parent.tree}}` | Deterministic tree for the owning source scope. |
| `{{parent.tree depth:<depth>}}` | The same tree limited to a depth from `0` through `8`. |

Rules additionally support `{{skillset.repo_root}}`, `{{skillset.output_dir}}`, and `{{skillset.source_rule}}`. They resolve for each concrete [destination](../../glossary.md#destination), so one rule can produce different correct paths for Claude, Codex, and Cursor.

## Prompt arguments

Skill Markdown can contain `{{$ARGUMENTS}}`, positional forms such as `{{$ARGUMENTS[0]}}`, and named forms such as `{{$ARGUMENTS.topic}}`. Claude receives its native `$ARGUMENTS...` form. Codex retains the marker and receives a short replacement instruction. Cursor retains the marker without the Codex notice.

The workspace setting `compile.features.promptArguments` defaults to enabled. When disabled, Skillset-owned prompt argument expressions are rejected. See [project configuration](../../configuration/project-configuration.md) for the owning setting.

## Exact partials

Use `{{> ...}}` to insert another Markdown file. Names resolve to one exact file; Skillset does not search by basename or fall back between workspace and plugin roots.

| Expression | Exact source |
| --- | --- |
| `{{> intro}}` | `<source-root>/shared/partials/intro.md` |
| `{{> writing/tone}}` | `<source-root>/shared/partials/writing/tone.md` |
| `{{> plugin:intro}}` | Current plugin `shared/partials/intro.md` |
| `{{> plugin:writing/tone}}` | Current plugin `shared/partials/writing/tone.md` |
| `{{> shared:references/common.md}}` | `<source-root>/shared/references/common.md` |
| `{{> shared:partials/intro.md}}` | `<source-root>/shared/partials/intro.md` |
| `{{> plugin:references/common.md}}` | Current plugin `shared/references/common.md` |

`plugin:` requires plugin-bound source. Missing files report the workspace or plugin scope and the single expected repository-relative path. Included Markdown is recursively preprocessed, dependencies are recorded in generated provenance, unsafe traversal is rejected, and recursive cycles fail with the include chain.

Bare `{{shared:...}}`, `{{plugin:...}}`, `{{@...}}`, relative-path partials, `root:`, and plugin-basename aliases are retired grammar and fail with current-syntax guidance.

## Marked links

Use a leading `@` outside the braces to resolve a path without inserting its contents:

```markdown
Read @{{shared:references/common.md}}.
Use @{{plugin:templates/checklist.md}}.
```

The accepted scopes are `shared:` and `plugin:`. `plugin:` is available only to plugin-bound source. For a skill body, the first path segment must be exactly `references`, `scripts`, `assets`, or `templates`. The linked file becomes an effective skill resource, defaults to the same `<group>/<rest>` destination beside `SKILL.md`, and the rendered text keeps the leading `@`, such as `@references/common.md`. An explicit `resources` exact-file or directory `to:` mapping wins and changes the rendered target.

For rules and project agents, marked links resolve to the appropriate committed source path; they do not create a skill resource. Code spans and fenced code blocks preserve marked-link text literally and imply no copy. Copied Markdown resources are opaque files and are not recursively preprocessed.

Missing files, invalid groups, unsafe traversal, symlink escapes, and destination collisions fail before output writes. Marked links accept files only; use explicit [`resources`](../features/resources.md) for directories, unlinked files, and destination remaps.

Cursor receives the same literal leading-`@` text as the other generated skill formats. Skillset copies the target file and validates the path, but it does not claim that Cursor interprets that text as a native UI context mention.

## Disable preprocessing

Set `skillset.preprocess: false` in source frontmatter to preserve all recognized preprocessing syntax literally:

```yaml
skillset:
  preprocess: false
```

The control is source-only and is removed from [generated output](../../glossary.md#generated-output). No partial expands and no marked link implies a resource while preprocessing is disabled. Use it for documents whose double-brace syntax belongs to another language; do not use it to hide a missing field, broken partial, or unsafe reference.
