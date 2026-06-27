---
slug: named-partials
title: Named Partials
status: draft
created: 2026-06-27
updated: 2026-06-27
owners: ['[galligan](https://github.com/galligan)']
depends_on: [skillset-workspace-layout]
---

# ADR: Named Partials

## Context

Skillset already supports path partials in preprocessed Markdown:

- `{{shared:path.md}}` for workspace shared files;
- `{{plugin:path.md}}` for plugin-local shared files;
- source-relative file paths.

Those forms are useful when the author knows the physical file location, but
they are awkward for reusable prose fragments that should feel like named
authoring units. They also make plugin boundaries easy to blur if authors start
using paths to reach sideways into sibling plugins.

The workspace layout decision establishes `.skillset/` as the source workspace
and `.skillset/plugins/<plugin>/` as the plugin boundary. Partials should follow
that same shape: workspace material is shared; plugin material is local to that
plugin.

## Decision

Skillset supports first-class named partials in Markdown preprocessing:

```md
{{> intro}}
{{> release.notes}}
{{> kitchen.recipe}}
```

Named partials live in dedicated partial roots:

```text
.skillset/
  partials/
    intro.md
  plugins/
    kitchen/
      partials/
        recipe.md
```

Names use dot-separated segments. Each segment may contain letters, digits,
underscores, and hyphens. A named partial resolves to Markdown with the same
preprocessing pass as the source document, including recursive partial
expansion and final `{{this.*}}` / `{{skillset.*}}` variable expansion.

Resolution is workspace-first:

1. `{{> name}}` looks in `.skillset/partials/`.
2. If the source file is plugin-bound and the workspace has no match, it looks
   in that plugin's `partials/`.
3. `{{> <plugin>.<name>}}` may explicitly address the current plugin's own
   partial namespace when `<plugin>` matches the current plugin directory.
4. Cross-plugin references are rejected. Shared material belongs in
   `.skillset/partials/`, not in a sibling plugin.

Within a partial root, Skillset first tries the direct path `<name>.md`; dots
remain part of the logical partial name rather than becoming directory
separators. If no direct path exists, Skillset may fall back to a unique
basename match such as `partials/section/name.md`. Multiple basename matches
are ambiguous and fail loudly.

Recursive partials are allowed. Cycles are rejected with the partial chain so
authors can find the loop.

Path partials remain supported. Named partials are an authoring convenience for
stable reusable fragments; they do not replace explicit shared resources or
source-relative includes when physical placement matters.

## Consequences

### Positive

- Common fragments can be reused without long relative paths.
- Workspace partials provide the obvious place for cross-plugin shared prose.
- Plugin-local partials stay useful while preserving generated plugin
  boundaries.
- Unique basename fallback keeps simple names ergonomic without making
  ambiguous layouts silent.
- Recursive expansion lets authors compose larger fragments from smaller ones.

### Tradeoffs

- `{{> name}}` now means a real include, so literal examples need
  `skillset.preprocess: false` or triple-brace escaping.
- Basename fallback is intentionally conservative: authors must disambiguate
  once a partial root has competing files with the same basename.
- Plugin authors cannot import sibling plugin partials directly; they must move
  shared content to workspace partials.

### What This Does NOT Decide

- A public partial registry or lookup CLI surface.
- Non-Markdown partial file types.
- Cross-plugin dependency management.
- Git-backed snapshot and restore internals.

## References

- [Skillset Workspace Layout](20260627-skillset-workspace-layout.md) - canonical workspace and plugin boundaries.
- [Layout](../../layout.md) - current source tree and preprocessing contract.
- [Skills](../../features/skills.md) - skill body preprocessing behavior.
- [Instructions](../../features/instructions.md) - rule body preprocessing behavior.
