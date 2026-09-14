---
id: 33
slug: root-claude-instructions-come-from-canonical-source
title: Root Claude Instructions Come From Canonical Source
status: accepted
created: 2026-09-14
updated: 2026-09-14
owners: ['[galligan](https://github.com/galligan)']
depends_on: [9, 32]
amends: [9]
---

# ADR-0033: Root Claude Instructions Come From Canonical Source

## Context

Projects use `.skillset/` to maintain instructions for working inside their own repository, independently of plugin distribution. The maintainer requires that source to produce both the inherent `AGENTS.md` baseline and Claude's root `CLAUDE.md`. Previously every Claude-enabled instruction became a separate `.claude/rules/` file, so there was no generated root entry point.

This narrowly amends ADR-0009's instruction destination mapping. The canonical source layout and the inherent standards contract remain unchanged.

## Decision

Claude-enabled instructions without `paths` aggregate into root `CLAUDE.md`. Instructions with nonempty `paths` remain separate files under `.claude/rules/`, preserving their relative source paths and Claude's native path-scoping frontmatter. An unscoped instruction is emitted to only one Claude destination, avoiding duplicate loading.

The aggregate uses deterministic source order and source-boundary comments, preprocesses each body for its actual destination, and preserves Claude-native wording. It is a Claude-owned artifact recorded in the workspace lock. `claude: false` remains an effective provider control; no Claude-enabled unscoped source means no generated root `CLAUDE.md`. The root filename is independent of the provider project configuration directory.

Agent Instructions continues to produce root and scoped `AGENTS.md` from applicable adaptive source independently of provider controls. `CLAUDE.md` does not import `AGENTS.md`: that baseline can contain Claude-disabled rules and transformed Claude-dialect text, and its destination-relative preprocessing can differ. Sharing that physical file would erase these distinctions.

The normal output planner protects existing unmanaged `CLAUDE.md`, detects conflicting writers, and uses verified ownership for stale-output cleanup. Changing a destination does not authorize overwriting authored guidance. Source-only metadata stays out of both instruction outputs.

## Consequences

- A project can author one instruction set and receive native root guidance for both Claude and the Agent Instructions standard.
- Existing managed unscoped Claude rules move to the root aggregate on a reviewed rebuild. Path-scoped Claude rules retain their existing destinations and loading semantics.
- Provider opt-outs, dialect fidelity, deterministic output, preprocessing provenance, and collision protection remain testable through ordinary build and check operations.
- This does not introduce alternate source directories, change plugin ownership or distribution, or activate provider configuration.

## References

- [Tenets](../project/tenets.md) - source-first authoring, provider truth, derivation, and explicit ownership.
- [ADR-0009: Skillset Workspace Layout](0009-skillset-workspace-layout.md#decision) - the instruction destination mapping amended here.
- [ADR-0032: Standards Compilation Is Inherent](0032-standards-compilation-is-inherent.md#decision) - the unchanged independent standards baseline.
- [Instructions](../reference/source/instructions.md) - current authoring, destination, and collision behavior.
- [Claude Code memory](https://code.claude.com/docs/en/memory) - provider evidence for root `CLAUDE.md`, modular rules, and conditional `paths` loading, verified 2026-09-14.
