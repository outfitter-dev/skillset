---
slug: skillset-workspace-layout
title: Skillset Workspace Layout
status: draft
created: 2026-06-27
updated: 2026-06-27
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, unified-source-layout, source-change-release-provenance]
---

# ADR: Skillset Workspace Layout

## Context

Skillset briefly carried two public source shapes:

- ordinary repos with `.skillset/skillset.yaml` and `.skillset/src/`;
- dedicated Skillset repos with root `skillset.yaml` and root `skillset/`.

That split made the compiler more flexible than the product needs to be right
now. It also made the word `root` do too much: repo root, source root, root
config, root manifest, and root-layout Skillset repo all competed for attention.
Authors should not need to decide which layout mode they are in before creating
a useful skill, plugin, rule, or hook.

The cache cutover also changed the shape of `.skillset/`. Rebuildable cache
payloads now resolve through Skillset-owned XDG cache buckets while commands
can keep reporting logical `.skillset/cache/...` paths. That lets `.skillset/`
be the stable authoring workspace instead of a mixed bag of source, generated
cache payloads, and migration leftovers.

## Decision

Skillset uses one workspace layout:

```text
skillset.yaml
.skillset/
  skills/
  plugins/
  rules/
  hooks/
  agents/
  shared/
  _claude/
  _codex/
  changes/
  cache/
  snapshots/
skillset.lock
```

The root `skillset.yaml` is the workspace manifest. It owns build settings,
provider selection, destination roots, workspace identity, schema version,
distribution metadata, and other workspace-level configuration.

`.skillset/` is the workspace source directory. It owns authored source units
and source-adjacent state:

| Path | Meaning |
| --- | --- |
| `.skillset/skills/<skill>/SKILL.md` | Standalone adaptive skills. |
| `.skillset/plugins/<plugin>/` | Plugin source. Plugins always live here. |
| `.skillset/plugins/<plugin>/skillset.yaml` | Plugin manifest/config. |
| `.skillset/rules/**/*.md` | Durable repo guidance rendered to Claude rules and Codex `AGENTS.md`. |
| `.skillset/hooks/` | Workspace hook source, where supported. |
| `.skillset/agents/*.md` | Adaptive project agents. |
| `.skillset/shared/` | Workspace shared resources. |
| `.skillset/_claude/`, `.skillset/_codex/` | Provider-native workspace source. |
| `.skillset/changes/` | Committed change and release ledger. |
| `.skillset/cache/` | Logical cache boundary; physical payloads resolve to XDG cache. |
| `.skillset/snapshots/` | Repo-local recovery snapshots for confirmed output overwrites/deletes. |

Plugin-local config remains `skillset.yaml`. We are not introducing
`plugin.yaml`: the directory under `.skillset/plugins/` already establishes
plugin intent, and keeping the same manifest filename lets workspace and plugin
metadata share schema concepts without a second vocabulary.

Provider-native directories keep their underscore prefix. `_claude` and
`_codex` are explicit provider source, not adaptive source families.

The retired homes are rejected with clear diagnostics instead of remaining
public compatibility modes:

- `.skillset/skillset.yaml`
- `.skillset/config.yaml`
- `.skillset/src/`
- root `skillset/`
- plugin `config.yaml`
- provider directories named `claude` or `codex` instead of `_claude` or
  `_codex`

Migration helpers may normalize old source state for branch-local baselines,
tests, or one-time conversion, but the compiler should not document or preserve
the old shapes as authoring choices.

## Plugin Boundaries

Plugin source stays isolated. A plugin may use its own local source, shared
resources, hooks, native files, and partials, but it must not reach across into
another plugin. Cross-plugin reuse belongs in the workspace:
authors should move shared material to `.skillset/shared/` or another
workspace-level source surface instead of importing from a sibling plugin.

This keeps generated Claude and Codex plugin bundles faithful to provider
boundaries. If the source lets plugins import each other directly, the generated
bundle boundary becomes misleading.

## Consequences

### Positive

- Authors learn one layout.
- Agents can reason from one source root instead of branching on layout mode.
- `.skillset/` is always the default authoring workspace.
- Root `skillset.yaml` avoids confusing `.skillset/skillset.yaml` nesting.
- Plugin source and provider-native source stay visually distinct.
- Old paths fail loudly before new source grows around them.

### Tradeoffs

- The cutover touches many tests, docs, generated guidance, locks, and fixture
  paths because source paths are part of provenance.
- Existing branches using `.skillset/src/` or root `skillset/` need a hard
  migration instead of long-lived compatibility.
- The root repo now has both `skillset.yaml` and `.skillset/`, so docs must be
  clear that the manifest config is root-level while authored units live under
  `.skillset/`.

### What This Does NOT Decide

- Git-backed snapshot and restore internals.
- User/global source repository selection beyond the existing
  `skillset create --global` source checkout.
- Runtime activation, trust, installation, or marketplace publication.

## References

- [Tenets](../../tenets.md) - source-first loadouts and explicit migration.
- [Unified Source Layout](20260618-unified-source-layout.md) - earlier
  intermediate layout design that this draft supersedes for current authoring.
- [Source Change, Release, and Dependency Provenance](20260609-source-change-release-provenance.md) - committed change ledger model.
