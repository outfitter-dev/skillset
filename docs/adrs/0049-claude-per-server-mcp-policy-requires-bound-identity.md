---
id: 49
slug: claude-per-server-mcp-policy-requires-bound-identity
title: Claude Per-Server MCP Policy Requires Bound Identity
status: accepted
created: 2026-10-30
updated: 2026-10-30
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 18, 20, 21, 27]
amends: [20]
---

# ADR-0049: Claude Per-Server MCP Policy Requires Bound Identity

## Context

[ADR-0020's MCP examples](0020-portable-skill-tools-policy.md#mcp) interpolate literal portable server names into Claude tool rules. That does not establish the identity of the intended server. Claude normalizes characters, scopes plugin servers, and interprets some server-name prefixes differently for grants and denials. A configured name and a native tool-name segment are not interchangeable.

The current [Claude permission documentation](https://code.claude.com/docs/en/permissions#mcp), checked 2026-10-30, describes normalization, plugin scope and ambiguous names. Distinct configured names such as `team.db` and `team_db` can normalize to the same segment. A whole-server wildcard for `reports` can also include `reports__v2`. Replacing a bare rule with a wildcard therefore does not establish exact scope. Even an ordinary alphanumeric key does not bind a server's source origin or exclude collisions elsewhere in the runtime.

Version-scoped static qualification of the published Claude Code 2.1.312 Darwin ARM64 executable corroborates these boundaries: SHA-256 `6b5ec691195e551b02c41df9f7d723f4ea61eaa03c2df90acefe3736f1aeb620`, 275,988,512 bytes. Name normalization starts at byte 217337872; MCP rule parsing at 217656387; tool-name construction at 217656533; parsed matching at 217659393; and permission matching at 223077604 checks full-name globs before the parsed allow identity guard. Exact qualification windows are retained with the campaign evidence. This is static evidence for that artifact, not a live permission or installation test.

## Decision

Amend only ADR-0020's automatic Claude per-server realization. Preserve the provider-neutral source shape, but reject every nonempty effective portable MCP server map when rendering Claude. The rejection applies after provider overrides and before any output writes, through the same transform used by rendering and realization planning. Unsupported-output policies, including `warn`, `skip` and `force`, cannot authorize an undefined mapping or silently discard a denial.

Keep global `mcp: false`: it intentionally covers all MCP tools and emits `mcp__*`. An empty map emits nothing and has no realization entry. Codex and Cursor continue preserving portable maps as reviewable metadata. Explicit `tools.claude.allow` and `deny` remain authored native rules, subject to existing contradiction validation; their preservation does not prove portable equivalence or runtime enforcement.

Diagnostics explain the missing identity and collision evidence and direct authors to explicitly scoped native policy. Do not infer plugin scope, normalize names automatically, replace all server grants with wildcards, or introduce an opt-in claim of exactness without evidence. A future portable per-server realization needs an explicit identity contract, source-origin binding, collision handling and qualified matching across the full accepted name space.

The existing incomplete per-server contradiction parser cannot authorize a Claude map: the entire unsupported map is rejected independently. All-MCP denial still rejects every native MCP allow. Provider-specific contradiction semantics for metadata-only targets are outside this amendment.

## Consequences

Existing Claude builds using portable per-server maps now fail with an actionable diagnostic. Authors must choose explicit native rules after verifying their scope, keep the policy on metadata-only targets, or intentionally use global denial. A provider override with an empty map does not erase inherited entries because the existing map merge remains additive.

This gives up a convenient but unproven conversion. It preserves source intent and makes the missing provider contract visible. It does not change MCP server configuration rendering, discovery, activation, global configuration, or the provider-neutral schema. It does not claim that every native rule is unsafe or that the compiler knows the complete runtime server inventory.

## References

- [ADR-0020](0020-portable-skill-tools-policy.md#mcp): narrowly amended Claude per-server realization; source vocabulary and other capabilities remain unchanged.
- [ADR-0018](0018-render-results.md): rendering and evidence reporting boundaries.
- [ADR-0027](0027-runtime-activation-readiness-is-observational.md): runtime evidence remains observational and separate from builds.
- [Meaning before syntax](../project/tenets.md#recognize-meaning-before-rewriting-syntax): exact mappings require collision analysis and evidence at their full breadth.
- [Tools policy reference](../reference/features/tools-policy.md): current authoring and realization behavior.
