---
id: 31
slug: agent-instructions-opt-out-owns-shared-agents-md
title: Agent Instructions Opt-Out Owns Shared AGENTS.md
status: accepted
created: 2026-09-12
updated: 2026-09-12
owners: ["[galligan](https://github.com/galligan)"]
depends_on: [28, 30]
amends: [28]
---

# ADR-0031: Agent Instructions Opt-Out Owns Shared AGENTS.md

## Context

[ADR-0028](0028-open-standards-are-the-portability-floor.md#agent-standards-outputs-default-on) made Agent Instructions an independent standard projection while preserving Codex's native `AGENTS.md` rendering during the candidate period. It also said that disabling `compile.agents` or `compile.agents.instructions` would remove only the standard claim and leave Codex free to recreate the same physical file.

That split is not useful to an author. Both projections consume the same adaptive `.skillset/rules/**/*.md` source and converge on the same root and scoped `AGENTS.md` destinations. An author who explicitly disables Agent Instructions reasonably expects Skillset to stop generating those files, not to discover that provider fallback recreated them. At the same time, changing the opt-out must not disable unrelated Codex capabilities or the independent Claude and Cursor instruction renderers.

The candidate-to-adopted transition creates a second requirement. Before adoption, Codex must retain its existing output so the standards work does not cause a silent regression. After adoption, the standard baseline and Codex delta must be separate logical consumers of one physical file, with one owner, stable bytes, and explicit lock and result identities.

## Decision

**The effective Agent Instructions setting is the single generation gate for Skillset-managed root and scoped `AGENTS.md` files.**

When `compile.agents.instructions` resolves to `true`:

- before the Agent Instructions profile is adopted, an enabled Codex target continues to render its existing root and scoped `AGENTS.md` projection;
- after adoption, applicable standard source renders independently of provider selection; and
- when Codex is also enabled, the standard baseline and Codex delta are logical consumers of one physical file. The standard profile owns the coalesced output and both identities remain visible in render results and lock provenance.

When `compile.agents: false` or `compile.agents.instructions: false` resolves the setting to `false`, Skillset renders no root or scoped `AGENTS.md`, even if Codex remains enabled. Provider fallback must not recreate an opted-out file. This suppresses only the shared Agent Instructions artifact; it does not change provider selection or disable other Codex surfaces.

The standard baseline selects all applicable adaptive instruction rules. The Codex delta selects the Codex-enabled subset before adoption. At a destination shared after adoption, the Codex consumer reuses the baseline bytes rather than introducing a second writer. Planning still rejects incompatible physical projections instead of choosing a winner.

Current locks record the physical owner and every logical consumer. Existing schema-v3 locks without those optional fields remain readable through the established Codex instruction fallback and are refreshed by the next reviewed build; pre-v3 locks retain their rebuild-only boundary.

## Consequences

### Positive

- The explicit configuration matches observable generated output.
- Candidate-era Codex users keep their current `AGENTS.md` files until the standard is adopted.
- Adoption and provider removal do not create duplicate writers or remove a file while a remaining logical consumer still owns it.
- Locks and render results explain the standard baseline and provider delta without inventing `target: agents`.

### Tradeoffs

- This narrowly contradicts ADR-0028's earlier provider-only escape-hatch behavior. The predecessor remains unchanged; this accepted amendment is the current decision.
- Disabling Agent Instructions also disables Skillset-generated Codex `AGENTS.md`. Authors who need Codex-specific instruction material while the shared artifact is disabled must use an explicitly provider-native surface outside this renderer's contract.

### What This Does NOT Decide

- Claude `.claude/rules/**/*.md`, Cursor `.cursor/rules/**/*.mdc`, Codex global guidance, fallback filenames, override files, and byte limits are unchanged.
- This does not choose default provider targets or make Cursor opt-in.
- This does not decide whether Claude should consume or generate `CLAUDE.md`.
- It does not adopt the Agent Instructions profile; adoption remains gated on the complete evidence and acceptance matrix in ADR-0028.

## References

- [Tenets](../project/tenets.md) - source-first rendering, provider truth, deterministic output, and inspectable provenance.
- [ADR-0028: Open Standards Are the Portability Floor](0028-open-standards-are-the-portability-floor.md) - establishes the Agent Instructions profile and the behavior amended here.
- [ADR-0030: ChatGPT Product Bundles and Standards-Only Builds](0030-chatgpt-product-bundles-and-standards-only-builds.md) - establishes standards-only selection and immutable predecessor records.
