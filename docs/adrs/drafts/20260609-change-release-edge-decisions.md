---
slug: change-release-edge-decisions
title: Change and Release Edge Decisions
status: draft
created: 2026-06-09
updated: 2026-06-09
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, changelog-and-versioning]
---

# ADR: Change and Release Edge Decisions

Status: design (SET-42). This records the edge-case decisions needed before implementing source change entries, release state, supports metadata, plugin dependencies, and hook guardrails.

## Context

The source-change and release-provenance model separates normalized source identity, authored reasons, changelog projections, release state, supports metadata, and plugin dependencies. The broad model is settled enough to implement, but a few edge cases need explicit v1 behavior so implementation does not accidentally make silent inheritance, version drift, or release-tool coupling part of the contract.

## Decisions

### Supports Inheritance

`supports` is source-significant metadata for the source unit that declares it. V1 does not implicitly inherit root or plugin `supports` into nested skills, agents, target-native islands, or feature pointers. Root and plugin config may define defaults, aliases, or reusable named support constraints in the future, but a child source unit must explicitly declare or opt into those constraints before they affect its normalized hash, compatibility checks, changelog evidence, or generated notices.

This keeps compatibility constraints visible at the unit that claims support. It also avoids a root package-range edit silently changing the apparent support contract of every child skill. Aggregates such as plugin status may report child support constraints for inspection, but they do not copy inherited constraints into child identity by default.

### Target Update Semantics And Build Metadata

SemVer build metadata remains unsafe as a public update strategy in v1. Current evidence is enough to say build-metadata versions can be syntactically valid in some target tooling, but target install/update behavior for versions that differ only after `+` is not proven for Claude or Codex. V1 therefore uses ordinary precedence-changing SemVer versions for published or generated target artifact versions.

Build metadata may appear only as source/provenance metadata or an explicitly configured private/local strategy after a target-specific smoke test proves the desired behavior. When update behavior is unknown, Skillset must choose the safe default: do not suggest a release version that relies on build metadata to trigger target updates.

### Compact Change IDs And CLI Refs

Pending change entries get a generated `id` once at scaffold time. The stored v1 id is 12 lower-case hexadecimal characters derived from a SHA-256 scaffold seed that includes the initial scope, creation timestamp, entry path, and a random nonce. The id is not derived from mutable reason prose, current source content, or current source hash.

The CLI displays and accepts refs as `@<prefix>`. The displayed prefix is the shortest unambiguous id prefix across pending entries and applied history, with a minimum of 6 hex characters. Ambiguous prefixes fail with candidate refs. If a generated 12-character id collides during scaffold, the CLI regenerates with a fresh nonce before writing.

### Group Semantics

`group` is an inspection, filtering, and reporting aid. It does not imply release grouping by itself. A release plan selects entries by id, scope, explicit filter, or command options; `--group` may be one of those filters, but the release plan must record the selected entries explicitly.

This lets multiple entries share `group: linear:SET-31` or a similar external id without forcing them to release together. It also avoids duplicating the external id as both the entry id and group id. Each change keeps its own generated id; the group points at why several entries may be related.

### Hash-Schema Baselines

Normalizer/hash-schema migrations use an explicit `skillset change baseline` flow. A baseline records the current normalized source-unit hashes under the new hash schema without creating artificial changelog entries or release bumps. The baseline record is append-only and machine-readable, and it must include the hash schema id, previous schema id when known, current source hashes, timestamp, and an authored reason.

Baseline records are not changelog entries. They prove that later `change status` output is comparing against an intentional schema migration point rather than silently treating every source unit as changed. If the user does not run the baseline command, the new normalizer must fail or warn loudly rather than silently reset state.

### Release-Tool Interop

Skillset must not fight Changesets, release-please, package-specific release flows, or package-level changelog tooling. V1 treats those tools as external package release authorities. Skillset may read package versions for `supports`, linked-package version strategies, compatibility checks, and release-plan context, but it does not mutate external release manifests, package changelogs, `.changeset/`, or release-please state by default.

Entity-local Skillset `CHANGELOG.md` projections remain generated Skillset artifacts with generated frontmatter. If an entity lives inside a package that already owns `CHANGELOG.md`, Skillset should require explicit config before writing there, or choose a Skillset-specific projection path. Future interop may generate suggested Changesets or release-please notes, but v1 keeps Skillset release state and external package release state separate unless the user opts into a specific bridge.

## Consequences

These decisions favor explicit source truth over convenience. The cost is more authoring ceremony for inheritance, release grouping, and package-release interop. The benefit is that change status, release planning, and target lowering cannot silently widen support claims, rely on unproven target update behavior, or rewrite another release tool's state.

## References

- [Changelog and Version Bump Workflow](20260604-changelog-and-versioning.md) - earlier changesets-style design, now refined by this edge-case ADR.
- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - source-first and generated-output doctrine.
