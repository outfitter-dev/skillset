---
id: 35
slug: rule-scope-and-provenanced-instruction-sections
title: Rule Scope and Provenanced Instruction Sections
status: accepted
created: 2026-09-16
updated: 2026-09-16
owners: ['[galligan](https://github.com/galligan)']
depends_on: [18, 28, 32, 33]
amends: [28]
---

# ADR-0035: Rule Scope and Provenanced Instruction Sections

## Context

Agent Instructions require local scope, but a rule's authored location and its
rendered destination can disagree when scope is carried only by frontmatter.
That makes source topology decorative and makes it possible for two distinct
directories to collapse onto one output after punctuation is normalized.

Codex adds a separate problem. It reads only the first instruction filename it
recognizes in a directory. A generated `AGENTS.md` beside an unmanaged
`AGENTS.override.md` looks present while being silently disabled. Concatenated
rules also need stable section provenance so `explain` can identify the source
of each contribution without merging semantically named sections.

## Decision

A rule's location below `rules/` defines its directory scope. Its optional
`paths:` frontmatter narrows that scope; it cannot broaden it. The source tree
therefore expresses the same locality as the rendered instruction tree.

Only `[.]` and `[...]` are reserved path segments. `[.]` matches one directory
level and `[...]` matches any depth. Every other segment, including `[slug]`,
`[...slug]`, and `(marketing)`, is a literal source directory name. A wildcard
scope is an unsupported destination until SET-574 can expand it against the
repository tree; it never falls back to root.

Claude and Cursor outputs mirror literal names below `.claude/rules/` and
`.cursor/rules/`. Claude escapes literal brackets only in its derived glob and
never rewrites the output path. Cursor keeps those characters unescaped and
records the unverified transform as degraded until committed registry and
fixture evidence proves it; SET-550 owns the evidence pin rather than this ADR.

Skillset never emits `AGENTS.override.md`. When an unmanaged override is found
beside a planned Codex `AGENTS.md`, checks warn that Codex will prefer the
override and disable the generated file in that directory.

Generated `AGENTS.md` uses XML sections when a file combines more than one rule
or when one rule carries `paths:` narrowing that would otherwise disappear.
A single rule without `paths:` stays bare. The `.skillset/RULES.md` front page
also stays bare above any wrapped rules.

The tag name comes from frontmatter `name` when present and otherwise from the
filename stem. Skillset lowercases it, replaces each run outside `[a-z0-9]`
with `_`, trims edge underscores, prefixes `_` when the result begins with a
digit, and uses `rule` when nothing remains. Duplicate tag names are allowed
because the `source` attribute distinguishes them.

Each opening tag has exactly two attributes, one per line, in this order:
`source` is the authored repository-relative path and `applies_to` is the
derived scope signal. A directory scope produces `<dir>/**`; an unscoped rule
produces `**`; `paths:` entries join to the scope, sort, and use comma-space
separation. Literal bracket and parenthesis directories remain unescaped in
the attribute, and no value contains a backtick. `applies_to` communicates
intent to the reader; it does not give Codex file-level enforcement.

The canonical byte layout is:

```plain
<coding_guidance
  source=".skillset/rules/engineering/coding-guidance.md"
  applies_to="engineering/**/*.ts" >

# Coding guidance
...

</coding_guidance>
```

The opening tag is followed by one blank line and the body is followed by one
blank line before the closing tag. The generated file's existing top-level
provenance header remains; XML replaces per-rule `<!-- source: ... -->`
comments so the boundary survives every provider's processing.

`## Code Review Rules` is a semantically named section. If more than one rule
contributing to the same destination contains that heading, lint reports the
duplicates with their source paths. Skillset does not merge those sections,
because a merge would destroy the one-source-per-section provenance boundary.

### Superseded statements

This ADR replaces the current placement statements below while leaving their
broader standards decisions intact:

- `docs/adrs/0028-open-standards-are-the-portability-floor.md`: “Agent
  Instructions | `.skillset/rules/**/*.md` | root and nested `AGENTS.md` files
  using the existing directory-scoped instruction mapping.” The mapping is now
  the source-position and narrowing contract defined here.
- `docs/adrs/0028-open-standards-are-the-portability-floor.md`: “Its standard
  profile covers plain Markdown, repository and nested placement, and
  increasingly local scope.” Generated Codex instructions now preserve each
  rule as a source-attributed XML section and diagnose unmanaged overrides.

## Consequences

Moving a rule changes its scope visibly. Literal directory names remain
injective at provider destinations, while only glob syntax needs escaping.
Codex override precedence becomes an actionable check rather than a hidden
runtime surprise. Section-level provenance remains inspectable even when many
rules contribute to one `AGENTS.md`.

SET-557 implements scope derivation, reserved segments, mirrored provider paths,
and override warnings. SET-583 implements the exact XML rendering,
duplicate-heading lint, and focused fixtures recorded here.

## References

- [Tenets](../project/tenets.md) - render intent faithfully and make drift visible early.
- [ADR-0018: Render Results](0018-render-results.md) - structured explainability for rendered and unsupported destinations.
- [ADR-0028: Open Standards Are the Default Portability Floor](0028-open-standards-are-the-portability-floor.md) - Agent Instructions profile amended here.
- [ADR-0032: Standards Compilation Is Inherent](0032-standards-compilation-is-inherent.md) - applicable instructions render without a standards selector.
- [ADR-0033: Workspace Authoring Model](0033-workspace-authoring-model.md) - canonical `RULES.md` and `rules/` source topology.
- [SET-550](https://linear.app/outfitter/issue/SET-550/cursor-doc-library-and-parity-fixtures) - Cursor registry evidence and parity fixture owner.
- [SET-557](https://linear.app/outfitter/issue/SET-557/rule-scoping-and-instruction-rendering) - implementation owner.
- [SET-574](https://linear.app/outfitter/issue/SET-574/rule-wildcard-expansion-literal-directory-escaping-and-portability) - wildcard expansion and remaining escaping evidence.
- [SET-583](https://linear.app/outfitter/issue/SET-583/mark-concatenated-agentsmd-sections-with-source-and-applies-to) - XML section and duplicate-heading implementation owner.
