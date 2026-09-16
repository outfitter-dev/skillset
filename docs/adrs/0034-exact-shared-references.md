---
id: 34
slug: exact-shared-references
title: Exact Shared References
status: accepted
created: 2026-09-16
updated: 2026-09-16
owners: ['[galligan](https://github.com/galligan)']
depends_on: [9, 33]
---

# ADR-0034: Exact Shared References

## Context

ADR-0010 made partial lookup convenient through workspace-first cascading,
plugin fallback, dotted plugin names, and recursive unique-basename search.
Those rules hide ownership. Adding a workspace file can redirect an existing
plugin reference, and moving a same-named file can change which content a build
selects without changing the authoring expression.

References also require authors to declare a file as a resource and then name
it again when linking. Nested Markdown in a skill does not consistently receive
the same preprocessing contract as the skill body, and a package can depend on
workspace files that are absent when the package is moved by itself.

## Decision

Shared references resolve exactly and never cascade. `shared:` addresses the
workspace `shared/` root, and `plugin:` addresses the current plugin's
`shared/` root. Source outside a plugin cannot use `plugin:`, and no source can
read a sibling plugin's shared files.

`{{> X}}` inlines the referenced Markdown. `@{{X}}` links to the referenced
file using a rendered `@path`, matching Claude's import syntax where that
provider supports it. A link implies that the referenced file must be included;
authors do not separately repeat it in `resources:`. The undocumented
`{{root:...}}` prefix is retired and produces a check error naming the
`shared:` rewrite.

Skill Markdown below the main `SKILL.md` receives the same preprocessing pass.
An implied copy that originates inside a skill remains inside that skill's
output tree. It cannot escape into its plugin or workspace destination.

When a package uses workspace shared files, Skillset lifts those files into the
package so the result is self-contained. Two lifted or package-local resources
that resolve to the same package path must have compatible ownership and bytes;
otherwise the build fails. No source shadows another by lookup precedence.

### Superseded statements

This ADR wholly supersedes ADR-0010. In particular, it replaces these exact
statements from `docs/adrs/0010-named-partials.md`:

- “Named partials live in dedicated partial roots” followed by
  `.skillset/partials/` and plugin `partials/` trees.
- “Resolution is workspace-first.”
- “`{{> name}}` looks in `.skillset/partials/`.”
- “If the source file is plugin-bound and the workspace has no match, it looks
  in that plugin's `partials/`.”
- “`{{> <plugin>.<name>}}` may explicitly address the current plugin's own
  partial namespace when `<plugin>` matches the current plugin directory.”
- “If no direct path exists, Skillset may fall back to a unique basename match
  such as `partials/section/name.md`.”
- “Path partials remain supported.”

None of ADR-0010's partial root, cascade, recursive basename fallback, or dotted
plugin namespace remains current.

## Consequences

Every reference says who owns it and resolves to one path. Builds become stable
under unrelated file additions, and portable packages carry the shared bytes
they need. Authors give up implicit fallback and basename convenience in return
for deterministic resolution and visible package ownership.

SET-551 owns the retired-layout diagnostic, and SET-556 implements the new
syntax, nested-skill preprocessing, implied copy, lifting, and collision tests.

## References

- [Tenets](../project/tenets.md) - deterministic output, visible ownership, and target-native truth.
- [ADR-0009: Skillset Workspace Layout](0009-skillset-workspace-layout.md) - earlier workspace and plugin boundaries.
- [ADR-0033: Workspace Authoring Model](0033-workspace-authoring-model.md) - canonical `shared/partials/` roots.
- [ADR-0010: Named Partials](0010-named-partials.md) - decision superseded in full.
- [SET-551](https://linear.app/outfitter/issue/SET-551/source-layout-rulesmd-subagents-sharedpartials-grouping-drafts) - retired `{{root:...}}` diagnostic owner.
- [SET-556](https://linear.app/outfitter/issue/SET-556/shared-references-x-inlines-and-x-links) - implementation owner.
