---
slug: first-class-sets
title: First-Class Sets
status: draft
created: 2026-06-04
updated: 2026-06-04
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, feature-reference-and-schema-registry, global-xdg-managed-installs-and-sync, reviewed-settings-suggestions]
---

# ADR: First-Class Sets

## Context

Skillset v1 deliberately keeps build scopes and entity selectors separate. `--scope repo`, `--scope plugins`, `--scope project`, `--scope user`, and `--scope all` describe destination classes. Typed selectors such as `plugin:<name>`, `plugin.<plugin>.skill:<name>`, `skill:<name>`, `agent:<name>`, and a future `set:<name>` describe authored entities inside those destinations.

That split keeps build planning understandable. A scope answers "where may this command write or inspect?" A selector answers "which source-owned thing am I focusing?" Mixing the two would make `--scope` behave like an arbitrary collection system and weaken lock explanations, dry-run safety, and future install workflows.

Sets are still useful future vocabulary. Authors may want a durable name for a curated marketplace, a plugin bundle, a project onboarding loadout, a team review pack, or a mixed collection of plugins, project agents, instructions, and target-native islands. The future design needs to answer what a set owns without making v1 silently treat every group of files as a set.

## Decision

Keep first-class sets deferred in SET-31. Reserve `sets` as a future root-owned source concept for curated collections of existing Skillset entities. A set is not a new destination scope, not a replacement for plugin boundaries, and not a magical filesystem bucket.

The future source layout should live under `.skillset/sets/<set-name>/`:

```text
.skillset/
  sets/
    review-pack/
      set.yaml
      README.md
```

`set.yaml` should be the authoritative manifest for the collection:

```yaml
skillset:
  name: review-pack
  title: Review Pack
  summary: Project review loadout for code and docs review.

members:
  - "plugin:skillset"
  - "plugin.skillset.skill:use-skillset"
  - "agent:reviewer"
  - "instruction:project"

marketplaces:
  claude:
    collection: review-tools
    title: Review Tools

bundles:
  codex:
    name: review-pack
    title: Review Pack
```

The manifest references existing source entities by typed selectors. It does not inline skill, plugin, agent, instruction, or target-native island source. Members continue to live in their native source locations, retain their own validation and target support, and remain buildable without the set.

## Source Layout and Schema

The future schema should be strict:

- `.skillset/sets/<set-name>/set.yaml` is required for each set.
- The directory name and `skillset.name` must match when both are present.
- Set names use the same lowercase slug rules as plugins and skills.
- `skillset.title`, `skillset.summary`, `skillset.description`, and `skillset.version` are optional set metadata.
- `members` is a non-empty ordered array of typed-selector strings.
- Member selectors must be known, unambiguous, and resolvable in the current source graph.
- Accepted member selector prefixes in the first design are `plugin:`, `skill:`, `agent:`, and `instruction:`.
- Singleton object member syntax such as `- plugin: skillset` is rejected in the first implementation slice. Keeping members as strings makes the same typed selector grammar usable in source manifests, CLI flags, diagnostics, and lock provenance.
- `marketplaces` and `bundles` are optional target-keyed objects with explicit target pairs: `marketplaces.claude` and `bundles.codex`.
- `marketplaces.codex`, `bundles.claude`, and any other marketplace or bundle target key fail loudly until a target-specific ADR accepts that output shape.
- Unknown top-level keys fail before rendering.

Sets should not use a generic `components` object. A set member must say what kind of entity it references, because each entity type has different target support, lock provenance, diagnostics, and future install behavior.

Target-native islands may participate only through typed selectors that name their source-owned entity or through a future explicit `island:<target>/<path>` selector. The first implementation slice should avoid island selectors until explain/list output can make the target-native ownership clear.

## CLI Selectors and Conflict Behavior

Future CLI support should add entity selectors without changing build scopes:

```bash
skillset build --scope plugins --select set:review-pack --dry-run
skillset diff --select set:review-pack
skillset list --select set:review-pack
skillset explain set:review-pack
```

`--scope` remains destination filtering. `--select` or an equivalent typed selector flag filters source entities. The exact flag name can change, but the concepts should not merge.

Conflict behavior should fail loudly:

- Unknown selectors fail with the selector and nearest known candidates.
- Ambiguous selectors fail and suggest the explicit typed form.
- `--scope user` with a set that has no user-scope generated output returns an empty plan with an explanation, not a fallback to plugin or repo output.
- A set member that cannot lower to an enabled target fails through the member's existing unsupported-target diagnostic.
- A set that references another set should fail in the first implementation slice. Nested sets can be reconsidered after lock provenance and cycle diagnostics are designed.
- A set member cannot override the member's target options in the set manifest. Overrides stay on the source entity or target defaults so one entity has one meaning.

This preserves the dry-run and lock model from build scopes: the same rendered output entries exist with or without a selector; the selector only narrows the plan.

## Marketplaces, Plugin Bundles, and Target Scopes

Sets may eventually drive marketplace and bundle authoring, but they should do it as derived indexes over existing entities.

Claude marketplaces are collection/index surfaces. A set can define future `marketplaces.claude` metadata such as collection name, title, description, and ordering, then derive a Claude marketplace index that points at the generated plugin outputs for its plugin members. It must not install or enable the marketplace in user settings.

Codex does not currently need a fake marketplace analogue from Skillset, so `marketplaces.codex` must fail. A Codex bundle can be a Skillset-authored distribution manifest or packaging index only after Codex target docs and plugin distribution semantics justify it. Until then, `bundles.codex` is reserved future vocabulary, not emitted output. If the first set parser lands before Codex bundle semantics are accepted, it should reject `bundles.codex` with a reserved/future diagnostic rather than silently accepting unused config.

Claude bundle output is likewise undefined. `bundles.claude` must fail unless a later ADR gives Claude a target-native bundle surface distinct from marketplace indexes and plugin output roots.

Build scopes interact with sets by destination:

- `--scope plugins --select set:<name>` plans generated plugin outputs for plugin members and plugin-bound skills.
- `--scope repo --select set:<name>` plans standalone skill outputs only for standalone skill members.
- `--scope project --select set:<name>` plans project instructions, project agents, and project target-native islands only when those selector forms are supported.
- `--scope user --select set:<name>` stays reserved until user/global build outputs are implemented.
- `--scope all --select set:<name>` combines the destination classes that have set members.

Install, sync, trust, settings suggestions, marketplace activation, and user-level config mutation remain separate workflows. A future install command may accept `set:<name>` as an install target, but `skillset build --select set:<name>` must remain a generated-output command.

## Lock and Explain Semantics

Set provenance should not replace member provenance. Locks should record generated files against the member entity that produced them, with optional `selectedBy` or `sets` metadata when a focused command used a set selector. This keeps stale-output checks stable when a file belongs to several sets.

`skillset explain set:<name>` should summarize:

- set metadata;
- member selectors and resolved source paths;
- generated outputs reachable under the current target plan;
- unsupported or future-only members;
- marketplace or bundle plans that are not applied;
- whether a command scope hides some members.

`skillset list --select set:<name>` should show the same generated output entries that an unfiltered list would show, narrowed by set membership. It should not invent synthetic generated files unless a future marketplace or bundle output is explicitly implemented and locked.

## Implementation Decision

No part of this workflow graduates into implementation in SET-31.

This ADR defines future vocabulary so later work can implement the smallest safe slice: parse `.skillset/sets/<name>/set.yaml`, resolve non-nested typed members, and support read-only `list`/`explain` selector output before allowing build writes through a set selector. Marketplace index generation, install/sync integration, nested sets, target-native island selectors, and Codex bundle output require later issues.

## Consequences

### Positive

- Gives authors a future way to name curated loadouts without weakening plugin, skill, agent, or instruction ownership.
- Keeps `--scope` as destination selection and reserves typed selectors for entity selection.
- Lets marketplace and bundle work build from source-owned membership rather than directory accidents.
- Preserves fail-loud unsupported lowering because members keep their existing adapter diagnostics.

### Tradeoffs

- Authors must maintain membership explicitly in `set.yaml`.
- A set cannot override a member for one collection, so variants need separate source entities or future target defaults.
- The first implementation stays intentionally narrow and mostly inspection-oriented.

### Risks

- Sets could become another broad configuration surface. Mitigation: allow only typed member selectors and target-keyed marketplace/bundle metadata.
- Sets could blur build and install. Mitigation: keep build generated-output-only and route activation through separate install/sync/settings workflows.
- Marketplace semantics may drift by target. Mitigation: only emit a target marketplace or bundle when target docs justify the output shape and lock provenance records it.

## Non-Decisions

- Exact CLI flag name for typed selectors.
- Whether nested sets should ever be allowed.
- Whether sets can select target-native islands directly.
- Exact Claude marketplace output shape for set-derived indexes.
- Whether Codex should have a bundle distribution manifest.
- Whether install/sync workflows should accept `set:<name>`.
- Whether sets should support dependency constraints, version pins, or remote package references.

## References

- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - source-first and generated-output doctrine.
- [ADR-0001: Root Compile Policy](../0001-root-compile-policy.md) - provider selection and target-specific config boundaries.
- [Feature Reference and Schema Registry](20260604-feature-reference-and-schema-registry.md) - tracks first-class sets as future-only and keeps scopes/selectors separate.
- [Build Scopes](../../features/build-scopes.md) - destination scopes, dry-run safety, and lock semantics.
- [Feature Source Pointers](../../features/feature-source-pointers.md) - typed feature ownership instead of generic component buckets.
- [Global / XDG Managed Installs and Sync](20260604-global-xdg-managed-installs-and-sync.md) - separates build from install, sync, trust, and user-level mutation.
- [Reviewed Settings Suggestions](20260604-reviewed-settings-suggestions.md) - keeps settings and marketplace activation out of build.
- [Tenets](../../tenets.md) - build does not imply trust, target truth beats fake portability, and drift should be visible early.
