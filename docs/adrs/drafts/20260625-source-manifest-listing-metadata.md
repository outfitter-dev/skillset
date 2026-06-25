---
slug: source-manifest-listing-metadata
title: Source Manifest Listing Metadata
status: draft
created: 2026-06-25
updated: 2026-06-25
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, source-change-release-provenance, one-action-repo-adoption]
---

# ADR: Source Manifest Listing Metadata

## Context

Skillset's current source metadata grew from provider manifests. The compiler
already derives much of what authors should not have to repeat, but the source
vocabulary still asks authors to think in target-shaped terms:

- `title`, `summary`, `category`, and `presentation.*` mostly feed Codex's
  `interface` block and Claude marketplace metadata.
- `summary` wins over `description` for the generated Claude plugin
  `description`, while `description` becomes Codex's longer interface copy.
- `owner` and `author` overlap, even though authors usually need one identity.
- `version` is still author-visible even though release state is the durable
  owner for generated artifact versions.
- `strict` sits beside display metadata even though it is install or marketplace
  policy, not listing copy.

That shape violates the "one meaning, one key" and "derive by default" tenets.
It also makes the first-author path harder than it needs to be: a new author
sees several plausible description-like keys before they have written a useful
plugin.

The compiler's generated output already points to the better model. Claude and
Codex both need plugin identity and description. Codex additionally has a rich
`interface` block, and Claude marketplace entries have listing metadata. Those
fields are not core identity; they are optional listing metadata for publishing,
discovery, and presentation.

## Decision

Skillset source manifests separate core identity from listing metadata.

### Core Plugin Metadata

The canonical core metadata lives under `skillset` in root and plugin config.
The minimal author-facing shape for a plugin is:

```yaml
skillset:
  name: review-tools
  description: Source-first review helpers for Claude and Codex.
  author:
    name: Outfitter
```

This means:

- `skillset.name` is the plugin identity. It derives from the source directory
  when absent. An explicit value is allowed when the directory name is wrong for
  generated output.
- `skillset.description` is the canonical long description of what the source
  unit does. New scaffolds and docs should teach it as the one description a
  useful plugin needs.
- `skillset.author` is the canonical author identity. A string is shorthand for
  `author.name`; an object can carry structured author fields. Plugin author
  defaults should derive from the nearest root author before falling back to a
  maintainer default.
- `homepage`, `repository`, `license`, and `keywords` remain source-significant
  package or distribution metadata. They are not listing copy, though listing
  fields can use them as fallbacks.
- `skillset.schema` remains the source-contract marker. It is not content
  versioning.

### Listing Metadata

Optional publishing and presentation fields live under `skillset.listing`.

```yaml
skillset:
  name: review-tools
  description: Source-first review helpers for Claude and Codex.
  author:
    name: Outfitter
  listing:
    display_name: Review Tools
    summary: Review helpers for everyday code and docs work.
    category: Productivity
    capabilities:
      - Read
      - Write
    color: "#B06DFF"
```

`listing` is the canonical source name because it describes the author's
purpose: how the unit should appear when listed, published, or browsed. It is
not named `presentation` because that is vague, and it is not named `interface`
because that leaks Codex's output vocabulary into portable source.

The canonical listing fields are snake_case:

| Source field | Meaning |
| --- | --- |
| `display_name` | Human-facing title for marketplace cards and Codex `interface.displayName`. |
| `summary` | Short listing description for cards, search, and Codex `interface.shortDescription`. |
| `description` | Optional listing-specific long description; falls back to `skillset.description`. |
| `category` | Listing category. |
| `keywords` | Search/discovery keywords when the target supports them. |
| `capabilities` | Short capability labels for Codex interface and future registries. |
| `color` | Brand/listing color, rendered as Codex `brandColor` where supported. |
| `website_url` | Public website/listing URL; falls back to `homepage` or `repository`. |
| `privacy_policy_url` | Listing privacy policy URL where the target has a slot. |
| `terms_of_service_url` | Listing terms URL where the target has a slot. |
| `default_prompt` | Codex interface default prompt suggestions. |
| `composer_icon`, `logo`, `screenshots` | Target-supported listing media. |

Targets render listing metadata in their native shape:

| Source | Claude plugin manifest | Claude marketplace | Codex plugin manifest |
| --- | --- | --- | --- |
| `skillset.name` | `name` | entry `name` | `name` |
| generated release state | `version` | entry `version` | `version` |
| `skillset.description` | `description` fallback | entry description fallback | top-level `description`, `interface.longDescription` fallback |
| `listing.summary` | `description` when present | entry description when present | `interface.shortDescription` |
| `listing.display_name` | not rendered | marketplace display/title when supported | `interface.displayName` |
| `author.name` | `author` | marketplace owner fallback | `interface.developerName` |
| `listing.category` | not rendered | entry category when supported | `interface.category` |
| `listing.capabilities` | not rendered | not rendered unless marketplace supports it | `interface.capabilities` |
| `listing.color` | not rendered | not rendered unless marketplace supports it | `interface.brandColor` |

If a target lacks a matching slot, the listing field stays source-significant
and may appear in locks, explain output, or distribution reports, but Skillset
must not invent fake target behavior.

### Policy And Version Placement

`strict` is not listing metadata. The immediate source contract keeps
`skillset.strict` as a top-level policy field because it already renders to
Claude marketplace policy and no broader install-policy block exists yet.
Future install policy fields may justify a dedicated `install` or `policy`
block, but this ADR does not introduce that block for one field.

`version` is not a normal authored manifest field for new source. Generated
plugin manifest versions and generated skill `metadata.version` come from
release state, with existing inline `version` fields treated as compatibility
baselines or explicit overrides until the release-state migration is complete.
New scaffolds, quickstarts, and examples should not teach authors to write
`skillset.version` or skill `version` for ordinary content edits.

`owner` is not the expected authoring field. `author.name` drives generated
author/developer/owner slots by default. `owner` may remain as an advanced
publisher override only when the publisher genuinely differs from the author,
and it should be documented as such rather than presented beside `author`.

### Migration And Compatibility

`listing` is the canonical source contract. Existing fields become legacy
aliases or migration inputs:

| Legacy source | Canonical destination |
| --- | --- |
| `presentation.*` | `listing.*` with snake_case canonical keys |
| top-level `title` | `listing.display_name` |
| top-level `summary` | `listing.summary` |
| top-level `category` | `listing.category` |
| `owner` | `author` when it is the same identity; otherwise an explicit publisher override |
| `version` | release-state baseline or explicit compatibility override |

The cutover should be staged:

1. Add `listing` support and render it before legacy `presentation` fields.
2. Update scaffolds, examples, quickstart, README, target-surface docs, and
   generated guidance to emit only canonical fields.
3. Teach import/adopt/migration paths to rewrite mechanical legacy fields into
   canonical source.
4. Emit actionable diagnostics for legacy fields during the 0.x migration
   window.
5. Before 1.0, decide whether legacy aliases fail by default or remain only
   behind an explicit migration compatibility mode.

This keeps old repos movable without letting new docs and examples reinforce
the old vocabulary.

### Implementation Split

The implementation that follows this ADR should update these surfaces in order:

1. `@skillset/schema`
   - Add `listing` to `SOURCE_METADATA_KEYS` and `sourceMetadataSchema`.
   - Validate `listing` as a structured object with known snake_case keys.
   - Keep legacy fields visible as deprecated or compatibility-only, not as the
     preferred example shape.
   - Regenerate `docs/reference/schemas/**` and
     `docs/reference/examples/**`.
2. Compiler rendering
   - Read `metadata.listing` before `metadata.presentation`.
   - Render Codex `interface` camelCase fields from `listing` snake_case fields.
   - Render Claude marketplace fields from the same listing/core split.
   - Preserve target-specific `claude.manifest`, `claude.marketplace`, and
     `codex.interface` overrides as explicit provider-native escape hatches.
3. Scaffolds, import, and migration
   - Stop generating top-level `title`/`summary` or `presentation`.
   - Rewrite import/adopt metadata when the mapping is mechanical.
   - Report ambiguous owner/version migrations instead of guessing silently.
4. Docs and fixtures
   - Update `docs/target-surfaces.md`, quickstart/example docs, README routing,
     schema examples, and golden tests.
   - Add fixture coverage that proves legacy aliases still lower during the
     migration window and canonical `listing` lowers to identical target output.

## Consequences

### Positive

The first-author manifest is smaller and more honest: identity and description
are core, listing metadata is optional, and target-specific escape hatches stay
visible.

The Codex interface and Claude marketplace mappings become easier to explain
because `summary` and `description` no longer look like two competing top-level
truths.

The source contract lines up with release-state doctrine: versions are generated
from reviewed change/release state instead of being routine authored manifest
ceremony.

### Tradeoffs

This is a source-contract cutover. Schema, docs, import/adopt, golden fixtures,
and generated output need coordinated changes so authors do not see two equal
vocabularies for the same concept.

`owner` remains awkward during migration because some existing manifests use it
as author identity and some may use it as publisher identity. Automated
migration can collapse the obvious cases, but ambiguous cases need diagnostics.

Keeping `strict` top-level is intentionally conservative. It avoids creating a
one-field policy abstraction now, but a future install-policy ADR may move it
once there is enough policy surface to justify the block.

### What This Does NOT Decide

This ADR does not implement Blueprints, registries, install/sync, trust,
signing, or runtime activation.

This ADR does not redesign the change ledger. It relies on the source-change and
release-provenance model for generated artifact versions.

This ADR does not decide a complete install-policy schema. It only keeps
`strict` outside `listing` and outside display metadata.

## References

- [Tenets](../../tenets.md) - source-first loadouts, one meaning/one key, derive by default, and target truth.
- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - baseline source vocabulary doctrine.
- [ADR-0001: Root Compile Policy](../0001-root-compile-policy.md) - compile concerns stay under `compile`, target-native options stay provider-specific.
- ADR: Source Change, Release, and Dependency Provenance (draft) - release state owns generated artifact versions.
- ADR: One-Action Repo Adoption (draft) - import/adopt paths should rewrite mechanical target-shaped fields into canonical source.
- [Target Surface Evidence Matrix](../../target-surfaces.md) - current Claude and Codex manifest/interface render targets.
- Linear: SET-203 - manifest `listing` block and source vocabulary cutover.
- Linear document: Skillset DX - manifest and change-state redesign.
