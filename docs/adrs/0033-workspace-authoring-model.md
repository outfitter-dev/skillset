---
id: 33
slug: workspace-authoring-model
title: Workspace Authoring Model
status: accepted
created: 2026-09-16
updated: 2026-09-16
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 2, 6, 9]
amends: [2, 6, 9]
---

# ADR-0033: Workspace Authoring Model

## Context

The existing workspace record makes the root inventory behave like an implicit
plugin. It mixes workspace skills with plugin-owned skills, calls portable
project roles `agents/`, separates `shared/` from `partials/`, and gives grouping
folders accidental identity. That shape creates additive manifests, whole-repo
snapshots, special `internal/` conventions, and root configuration that grows
whenever plugin behavior needs another exception.

Skillset currently has only internal consumers. This redesign is therefore a
hard cutover: old source layouts, config and CLI spellings, internal APIs, JSON
reports, and lock formats gain no aliases, dual readers, adapters, or automatic
migration merely for compatibility. Known workspaces may use a small manually
run helper described by the internal authoring-model cutover playbook. Current
validation, provider conformance, provenance, ownership safety, durable user
decisions, ledger history, and unknown-file protections remain required.
Earlier upgrade-diagnostic and co-release obligations do not apply to this
internal cutover; this exception does not weaken the accepted new model.

Cursor support requires one additional boundary. Cursor layout claims must be
backed by committed registry provenance and parity fixtures. Until SET-550
provides that pin, `cursor-agents-md-root` is a named fixture gap rather than a
supported destination.

## Decision

The canonical workspace source layout is:

```text
skillset.yaml
.skillset/
  RULES.md
  skills/
    _drafts/
  plugins/
    <name>/
      skillset.yaml
      skills/
        _drafts/
      rules/
      subagents/
      shared/
        partials/
      _claude/
      _codex/
      _cursor/
  rules/
  subagents/
  shared/
    partials/
  _claude/
  _codex/
  _cursor/
  changes/
  cache/
  snapshots/
skillset.lock
```

Plugins exist only below `.skillset/plugins/<name>/`. The root
`.skillset/skills/` directory is the workspace's own standalone inventory;
directory membership curates that inventory without making it a plugin.
`.skillset/RULES.md` is the unscoped instruction source. No supported provider
discovers a file by that name, so authored source does not masquerade as live
provider configuration.

Portable project roles use `subagents/`. The name distinguishes the source kind
from `.agents/`, `AGENTS.md`, and a rendered plugin `agents/` component while
matching provider terminology. Workspace and plugin reusable files live below
`shared/`, with Markdown fragments below `shared/partials/`.

Ordinary directories may group source at any depth. Grouping directories do not
change source identity, output identity, or destination path. An underscore
directory is compiler-meaningful and cannot be used as an ordinary group.
Within a workspace or plugin skill tree, `_drafts/` joins provider-native
`_claude/`, `_codex/`, and `_cursor/` as a compiler-owned island; draft
contents do not enter ordinary shipped projections.

The existing provider config keys `claude.plugins.path`, `codex.plugins.path`,
and `cursor.plugins.path` map to `plugins.output.<tool>.path`. The retired
spellings are check errors that name the exact rewrite. This records a direct
internal cutover, not a compatibility alias. The vocabulary mapping makes no
new Cursor destination claim; the SET-550 evidence gate above still applies.

### Superseded statements

The following historical statements remain in their original ADRs as evidence,
but this ADR replaces them as current instruction:

- `docs/adrs/0002-cursor-is-a-first-class-provider.md`: “Cursor project skills
  render to `.cursor/skills/<skill>/SKILL.md`, rules to
  `.cursor/rules/**/*.mdc`, agents to `.cursor/agents/*.md`, and plugin bundles
  to `plugins/<plugin>/cursor/` with `.cursor-plugin/plugin.json`.” The
  destination claims remain gated by SET-550 registry provenance and fixtures;
  the source role is now authored below `subagents/`.
- `docs/adrs/0006-agent-source-model.md`: “Portable and implemented:
  project-scoped specialized roles authored as `.skillset/agents/*.md` and
  rendered to Claude, Codex, and Cursor project-agent destinations with
  target-specific validation.” The source path is now `.skillset/subagents/`.
- `docs/adrs/0009-skillset-workspace-layout.md`: “Skillset uses one workspace
  layout” followed by the tree whose siblings include `agents/`, `shared/`, and
  `partials/`. The tree in this ADR is canonical.
- `docs/adrs/0009-skillset-workspace-layout.md`: “`.skillset/agents/*.md` |
  Adaptive project agents.” The source path is now `subagents/**/*.md`, with
  grouping folders excluded from identity.
- `docs/adrs/0009-skillset-workspace-layout.md`: “`.skillset/partials/` | Named
  workspace partials.” Partials now live at `.skillset/shared/partials/`.
- `docs/adrs/0009-skillset-workspace-layout.md`: “A workspace uses root
  `skillset.yaml` with flat canonical source under `.skillset/`, including
  `plugins/`, `skills/`, `rules/`, `agents/`, `shared/`, workspace and plugin
  `partials/`.” The canonical source now uses `RULES.md`, `subagents/`,
  `shared/partials/`, grouping directories, and `_drafts/` as defined above.

## Consequences

Authors see a smaller distinction: workspace inventory stays at the root and
reusable packages are explicit plugins. Source grouping can follow a repository
without changing stable identity. Retired paths must fail with a diagnostic
that names their replacement, so source does not split silently across models.

SET-551 implements the relocated layout, rejection diagnostics, and the
`fixtures/authoring-model/` executable acceptance case. SET-585 implements
grouping, draft, and reserved-rule-segment discovery against that fixture.
Until those issues land, the fixture path is a required future proof named here
rather than live evidence.

## References

- [Tenets](../project/tenets.md) - source-first ownership, derivation, and visible migration.
- [ADR-0000: Source-First Loadouts](0000-source-first-loadouts.md) - authored source remains the product.
- [ADR-0002: Cursor Is a First-Class Provider](0002-cursor-is-a-first-class-provider.md) - Cursor remains first class subject to pinned evidence.
- [ADR-0006: Agent / Subagent Source Model](0006-agent-source-model.md) - project-role semantics amended by the `subagents/` source name.
- [ADR-0009: Skillset Workspace Layout](0009-skillset-workspace-layout.md) - workspace topology amended by this decision.
- [SET-550](https://linear.app/outfitter/issue/SET-550/cursor-doc-library-and-parity-fixtures) - registry provenance and parity fixtures required before new Cursor claims ship.
- [SET-551](https://linear.app/outfitter/issue/SET-551/source-layout-rulesmd-subagents-sharedpartials-grouping-drafts) - implementation and fixture owner.
- [SET-585](https://linear.app/outfitter/issue/SET-585/recognize-grouping-folders-drafts-and-reserved-rule-segments) - grouping, draft, and reserved-rule-segment discovery owner.
- [Internal authoring-model cutover playbook](https://linear.app/outfitter/document/internal-authoring-model-cutover-playbook-08c333c9dde4) - one-time internal from/to procedure.
