---
id: 14
slug: source-change-release-provenance
title: Source Change, Release, and Dependency Provenance
status: accepted
created: 2026-06-09
updated: 2026-07-20
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0]
---

# ADR-0014: Source Change, Release, and Dependency Provenance

Status: accepted and implemented through the source-change and release ledger.

## Context

Skillset reads source and release state, renders resolved versions into generated
metadata, and records output hashes in `skillset.lock`. Content edits need
durable human reasons without turning mechanical ids, hashes, or counters into
authoring fields.

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
- Plugin dependencies are distinct from `supports`; per-target registry evidence owns native, degraded, and unsupported behavior without silent loss.
- Hook integration is snippet/print-first and does not take over `.git/hooks` or mutate user-level Claude, Codex, or Cursor runtime config.

## Source Units And Hashes

A source unit is any source object Skillset can reason about independently: a standalone skill, plugin skill, plugin config, feature source pointer, instruction file, project agent, target-native island, declared dependency, or support constraint. SET-34 owns the initial inventory.

Normalized hashes should separate source significance from release severity. Significant regions participate in source hashes, change status, history, and explain output. Severity-bearing regions may also influence suggested bump levels. `supports` is significant but not severity-bearing by default. Tools, commands, dependencies, MCP/app/bin pointers, target support, identity, and required setup are both significant and severity-bearing. Body prose is significant, but body severity is heuristic in v1.

V1 must name the residual body-contract risk plainly: schema-backed frontmatter and config keys can be classified reliably, but body-level invocation contract changes cannot be fully detected by heading patterns alone. Author-declared body regions are the future mechanism that closes that gap.

## Change Entries

Pending entries are reason-only Markdown files. The prose body is the authored
reason and changelog source; readable `Bump:`, `Group:`, and `Scope:` directives
carry the small amount of author-owned release intent. Generated ids,
normalized selectors, source hashes, hash-schema evidence, and coverage live in
the schema-versioned append-only ledger. Legacy frontmatter is explicit
migration input, not alternate source truth.

The stable id and group semantics are defined in [Change and Release Edge Decisions](0016-change-release-edge-decisions.md). One entry may cover multiple scopes only when the reason is one coherent intent. Repo-scoped and user/global changes should not share an entry because they have different baselines and output destinations.

`skillset change status` is a source coverage command: it compares current source against a baseline and reports changed units with or without covering entries. `skillset change history` reads applied history. The two commands must not collapse into one meaning.

## Changelog Projections

Generated changelogs are reverse chronological projections placed beside the source entity they describe, such as a plugin directory or skill directory. They carry generated frontmatter and are refreshed by release/apply workflows, not hand-edited as source truth.

Committed projections contain applied/released sections only. Pending changes appear in `skillset change status` or explicit preview output; `skillset change history` reads applied history only. If a future command renders `## Pending changes`, that output must be preview-only or excluded from generated-output currency checks to avoid churn.

Plugin changelogs aggregate child skill, agent, and component entries. Where practical, a plugin changelog should include the child change id or version and link to the child changelog heading.

## Release State

Release state is source-controlled provenance derived from append-only release
events, history, and current source facts. Compatibility projections remain
separate from authored reasons and generated target metadata.

`skillset release plan` reads pending entries and current hashes, suggests or resolves version changes, and previews changelog sections without writing. `skillset release apply` updates release state, generated changelog projections, append-only history/release records, locks, and generated target outputs. It should not rewrite source content merely to bump counters.

Stacked pending entries keep one strict evidence rule in the machine ledger:
every reason must resolve to current coverage for each declared scope. Multiple
stacked reasons may point at the same source unit and final hash; stale evidence
still fails even when a sibling reason is current.

Published or marketplace-facing artifacts default to ordinary SemVer. Build metadata is not a public update strategy in v1 because target install/update behavior for build-metadata-only version differences remains unproven.

## Supports

`supports` declares compatibility with external packages, tools, APIs, plugins, or version ranges. It is not the artifact's own version and does not mean "install this dependency." A supports-only edit participates in source provenance and status/history. It should not automatically suggest a minor or major bump; default severity is `none`, or `patch` when emitted user-facing metadata changes.

## Plugin Dependencies

Plugin dependencies declare required plugins. Skillset renders them according
to registry-backed target evidence and surfaces degraded or unsupported edges
through generated notices, status/explain facts, or render errors. It never
silently drops an edge or installs dependencies.

## Hook Guardrails

Skillset hook guardrails are opt-in workflow snippets, not activation side
effects. Git hook integration prints snippets for existing hook runners. Agent
runtime suggestions may cover Claude, Codex, and Cursor, but Skillset does not
mutate user-level runtime config during compiler workflows.

## Consequences

This model adds authoring ceremony: meaningful source changes need reasons, release application needs explicit selection, and release metadata becomes its own source-controlled state. The payoff is that source content stays durable, release counters stop polluting every content edit, changelog output becomes derived from reviewed reasons, and target drift becomes visible through status, history, release records, and locks.

The model also keeps Skillset from pretending target differences do not exist.
Registry-backed rendering can be native for one target and visibly degraded or
unsupported for another. Supports metadata can be significant without forcing
release bumps. External package release tools remain external unless a future
bridge is explicitly configured.

## Open And Deferred

The implemented edge decisions are recorded in ADR-0016. SET-363 still owns the
unresolved baseline-record semantics. Future work may add author-declared body
contract regions, model-based reason review, settings/marketplace suggestion
workflows, first-class set install plans, and new provider-native dependency
surfaces when evidence exists.

## Acceptance Evidence (2026-07-20)

Humans author reason-only `.skillset/changes/*.md` entries with
readable `Bump:`, `Group:`, and `Scope:` directives. Generated ids, normalized
selectors, source hashes, hash-schema evidence, and coverage belong to the
schema-versioned append-only `.skillset/changes/ledger.jsonl`. Legacy
frontmatter is compatibility input only and crosses the boundary explicitly
through `skillset change migrate --yes`.

Append-only history and release records, amendments, release state, source-hash
baselines, and tombstones preserve provenance while ledger-derived state is
authoritative where reconstructible. `change add`, `reason`, `refresh`,
`ignore`, `migrate`, and `check`, plus `release plan`, `apply`, and `amend`,
retain their current explicit preview/write boundaries. Generated changelogs
project applied history; pending entries never become generated source truth.
`supports` stays source-significant without forcing severity, plugin dependency
gaps remain visible per target, and no change or release command activates or
trusts provider output. Current evidence is in the change/release feature pages,
`change-ledger.ts`, `release-state.ts`, workflow code, and contract tests.

## References

- [Changelog and Version Bump Workflow](0013-changelog-and-versioning.md) - earlier changesets-style design.
- [Change and Release Edge Decisions](0016-change-release-edge-decisions.md) - SET-42 edge decisions.
- [ADR-0000: Source-First Loadouts](0000-source-first-loadouts.md) - source-first doctrine.
