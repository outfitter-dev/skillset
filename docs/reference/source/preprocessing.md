---
description: Defines Skillset Markdown preprocessing variables, prompt arguments, path references, named partials, escapes, and failure behavior.
---

# Preprocessing

Skillset preprocesses Markdown [source](../../glossary.md#canonical-source) before [target](../../glossary.md#target) serialization. The language is deliberately small: it substitutes known document and path context, resolves declared references, and expands local partials without becoming a general template engine.

Preprocessing applies to supported Markdown source, including skills and [instructions](instructions.md). Invalid reserved expressions fail with the source path and relevant name. Unrelated double-brace text, such as JSX object literals, remains unchanged.

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

Instructions additionally support `{{skillset.repo_root}}`, `{{skillset.output_dir}}`, and `{{skillset.source_rule}}`. They resolve for each concrete [destination](../../glossary.md#destination), so one instruction can produce different correct paths for Claude, Codex, and Cursor.

## Prompt arguments

Skill Markdown can contain `{{$ARGUMENTS}}`, positional forms such as `{{$ARGUMENTS[0]}}`, and named forms such as `{{$ARGUMENTS.topic}}`. Claude receives its native `$ARGUMENTS...` form. Codex retains the marker and receives a short replacement instruction. Cursor retains the marker without the Codex notice.

The workspace setting `compile.features.promptArguments` defaults to enabled. When disabled, Skillset-owned prompt argument expressions are rejected. See [project configuration](../../configuration/project-configuration.md) for the owning setting.

## Path references

A path partial inserts another file's content:

```markdown
{{shared:references/common.md}}
{{plugin:references/plugin.md}}
{{references/local-fragment.md}}
```

`shared:` resolves under `.skillset/shared/`. `plugin:` resolves under the current plugin's `shared/` directory and is available only to plugin-bound source. Relative references resolve from the current source file. Unsafe traversal outside the owning source scope is rejected.

Prefix a path reference with `@` to resolve it without copying its content:

```markdown
See {{@shared:references/common.md}}.
See {{@references/local-fragment.md}}.
```

A resolve-only reference validates the source file and renders a path appropriate to the source family. Instructions and project agents point back to committed `.skillset/` source. Skills point to a skill-local or declared generated resource destination so the reference remains valid beside the rendered skill. Resolve-only references do not copy files by themselves. Adaptive workspace instructions cannot use `plugin:` references because they have no plugin owner.

## Named partials

Named partials use `{{> name}}`. Resolution checks the workspace `.skillset/partials/` root and, for plugin-bound source, the current plugin's `partials/` root according to the compiler's scoped precedence. A direct `<name>.md` wins within a root. If no direct file exists, a unique recursive basename match is accepted.

Plugin-bound source may explicitly spell its own namespace as `{{> <plugin>.<name>}}`. It may not reach into another plugin. Missing partials, multiple basename matches, unsafe paths, and recursive cycles fail loudly; cycle diagnostics include the partial chain. Included partials may themselves contain supported expressions and partials, and their dependencies are recorded in generated provenance.

## Disable preprocessing

Set `skillset.preprocess: false` in source frontmatter to preserve all recognized preprocessing syntax literally:

```yaml
skillset:
  preprocess: false
```

The control is source-only and is removed from [generated output](../../glossary.md#generated-output). Use it for documents whose double-brace syntax belongs to another language; do not use it to hide a missing field, broken partial, or unsafe reference.
