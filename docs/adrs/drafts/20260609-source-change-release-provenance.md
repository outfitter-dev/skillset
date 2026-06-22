---
slug: source-change-release-provenance
title: Source Change, Release, and Dependency Provenance
status: draft
created: 2026-06-09
updated: 2026-06-09
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, changelog-and-versioning, change-release-edge-decisions]
---

# ADR: Source Change, Release, and Dependency Provenance

Status: design (SET-33). This promotes the settled parts of the source-change scratch packet into durable project docs. Implementation is handled by SET-34 through SET-41.

## Context

Skillset already reads authored versions from root config, plugin config, and skill frontmatter, lowers them into generated plugin manifests and generated skill metadata, and records output hashes in `skillset.lock`. That is enough to detect stale generated output, but it couples ordinary content edits to mechanical release counters and does not explain why a source unit changed.

The change and release model separates content identity, authored reason, release state, generated target metadata, support constraints, and plugin dependency behavior. Source files carry durable authored content. Change entries carry human reasons and structured evidence. Release state carries version counters and last released hashes. Generated changelog projections are readable output derived from reviewed entries. Locks and explain/status surfaces carry the heavier provenance.

## Decision

Adopt a source-first change and release model with these v1 surfaces:

- Normalized source-unit hashes identify meaningful source content and dependency inputs.
- Pending change entries live under `.skillset/changes/`.
- Applied change history and release records are append-only state, such as `.skillset/changes/history.jsonl` and `.skillset/changes/releases.jsonl`.
- Entity-local `CHANGELOG.md` files are generated, tracked projections with generated frontmatter.
- Pending changes are visible through CLI status/preview, not committed pending sections in tracked changelog files.
- Release state resolves generated artifact versions without forcing source authors to edit inline version fields for every content change.
- `supports` is source-significant provenance and compatibility metadata, but it does not inherently raise release severity.
- Plugin dependencies are distinct from `supports`; Claude can lower to native dependency fields, while Codex degrades with explicit notices/check tooling until it has native support.
- Hook integration is snippet/print-first and does not take over `.git/hooks` or mutate user-level Claude/Codex runtime config.

## Source Units And Hashes

A source unit is any source object Skillset can reason about independently: a standalone skill, plugin skill, plugin config, feature source pointer, instruction file, project agent, target-native island, declared dependency, or support constraint. SET-34 owns the initial inventory.

Normalized hashes should separate source significance from release severity. Significant regions participate in source hashes, change status, history, and explain output. Severity-bearing regions may also influence suggested bump levels. `supports` is significant but not severity-bearing by default. Tools, commands, dependencies, MCP/app/bin pointers, target support, identity, and required setup are both significant and severity-bearing. Body prose is significant, but body severity is heuristic in v1.

V1 must name the residual body-contract risk plainly: schema-backed frontmatter and config keys can be classified reliably, but body-level invocation contract changes cannot be fully detected by heading patterns alone. Author-declared body regions are the future mechanism that closes that gap.

## Change Entries

Pending entries are small Markdown files with YAML frontmatter and prose body. The body is the authored reason and changelog source. Frontmatter carries structured scope, bump, generated id, group metadata, base/source hashes, evidence, and overrides.

```markdown
---
id: a83f2c91d4e7
group:
  provider: linear
  id: SET-31
scope: plugin.skillset.skill:use-skillset
bump: minor
baseHash: sha256:abc123
sourceHash: sha256:def456
suggestedBump: patch
evidence:
  - body
---

Clarified scoped rebuild behavior for generated plugin output so agents can choose the narrower regeneration path before falling back to a full build.
```

The stable id and group semantics are defined in [Change and Release Edge Decisions](20260609-change-release-edge-decisions.md). One entry may cover multiple scopes only when the reason is one coherent intent. Repo-scoped and user/global changes should not share an entry because they have different baselines and output destinations.

`skillset change status` is a source coverage command: it compares current source against a baseline and reports changed units with or without covering entries. `skillset change history` reads applied history. The two commands must not collapse into one meaning.

## Changelog Projections

Generated changelogs are reverse chronological projections placed beside the source entity they describe, such as a plugin directory or skill directory. They carry generated frontmatter and are refreshed by release/apply workflows, not hand-edited as source truth.

Committed projections contain applied/released sections only. Pending changes appear in `skillset change status`, `skillset change history --pending`, or explicit preview output. If a future command renders `## Pending changes`, that output must be preview-only or excluded from generated-output currency checks to avoid churn.

Plugin changelogs aggregate child skill, agent, and component entries. Where practical, a plugin changelog should include the child change id or version and link to the child changelog heading.

## Release State

Release state is optional source-controlled state that maps releasable scopes to versions and last released hashes. It is separate from source content, pending entries, applied history, and generated target metadata.

`skillset release plan` reads pending entries and current hashes, suggests or resolves version changes, and previews changelog sections without writing. `skillset release apply` updates release state, generated changelog projections, append-only history/release records, locks, and generated target outputs. It should not rewrite source content merely to bump counters.

Stacked pending entries keep one strict evidence rule: every entry must carry evidence for the current source hash of each declared scope. A Graphite stack can therefore end with multiple pending entries pointing at the same source unit and final hash. That is allowed, and `change check` should make it visible as stacked evidence rather than warning. A stale entry for the same scope still fails even if another entry has the current hash. This preserves the invariant that each branch reason remains attached to the state being released instead of borrowing coverage from a later branch.

Published or marketplace-facing artifacts default to ordinary SemVer. Build metadata is not a public update strategy in v1 because target install/update behavior for build-metadata-only version differences remains unproven.

## Supports

`supports` declares compatibility with external packages, tools, APIs, plugins, or version ranges. It is not the artifact's own version and does not mean "install this dependency." A supports-only edit participates in source provenance and status/history. It should not automatically suggest a minor or major bump; default severity is `none`, or `patch` when emitted user-facing metadata changes.

## Plugin Dependencies

Plugin dependencies declare required plugins. Claude has native plugin dependency fields, so Skillset can lower compatible dependency declarations there. Codex has no documented equivalent, so v1 must not silently drop dependency edges. Codex output should surface dependency awareness through generated notices, explain/doctor output, or future install guidance, and it should tell the user what to install instead of trying to resolve dependencies silently.

## Hook Guardrails

Skillset hook guardrails are opt-in workflow snippets, not activation side effects. Git hook integration should print snippets for existing hook runners such as lefthook, Husky, pre-commit, or Git fallback hooks. Agent runtime hook suggestions for Claude/Codex can nudge agents when `.skillset/**` changes, but Skillset must not mutate user-level runtime config during build/check/diff/import/init/create.

## Consequences

This model adds authoring ceremony: meaningful source changes need reasons, release application needs explicit selection, and release metadata becomes its own source-controlled state. The payoff is that source content stays durable, release counters stop polluting every content edit, changelog output becomes derived from reviewed reasons, and target drift becomes visible through status, history, release records, and locks.

The model also keeps Skillset from pretending target differences do not exist. Claude dependency lowering can be native while Codex remains a visible fallback. Supports metadata can be significant without forcing release bumps. External package release tools remain external unless a future bridge is explicitly configured.

## Open And Deferred

SET-42 resolves the immediate edge questions for v1. Future work may add author-declared body contract regions, model-based reason review cached by normalized source hash, settings/marketplace suggestion workflows, first-class set install plans, and native Codex dependency lowering if Codex adds one.

## References

- [Changelog and Version Bump Workflow](20260604-changelog-and-versioning.md) - earlier changesets-style design.
- [Change and Release Edge Decisions](20260609-change-release-edge-decisions.md) - SET-42 edge decisions.
- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - source-first doctrine.
