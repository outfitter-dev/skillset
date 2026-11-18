---
id: 46
slug: provider-only-plugin-components-remain-uncovered
title: Provider-only Plugin Components Remain Uncovered Without Blocking
status: accepted
created: 2026-10-29
updated: 2026-10-29
owners: ['[galligan](https://github.com/galligan)']
depends_on: [3, 18, 19, 28, 37]
amends: [28]
---

# ADR-0046: Provider-only Plugin Components Remain Uncovered Without Blocking

## Context

A Claude-only plugin with commands, hooks, or subagents failed the default
build because its inherent Agent Plugins projection cannot carry those
components. ADR-0028's [minimal-package rule](0028-open-standards-are-the-portability-floor.md#agent-plugins-is-derived-from-existing-plugin-source)
says provider-only components are uncovered and do not invalidate the package.
Its [invalid-component rule](0028-open-standards-are-the-portability-floor.md#invalid-standard-components-never-get-written)
was applied too broadly: a missing component contract was treated like an
invalid instance of a component the standard does carry.

Matt's October 16 and October 28 decisions in SET-686 choose the minimal-package
rule for provider-only plugin components, without requiring a provider island
or a softer workspace policy.

## Decision

Provider-only plugin components are uncovered wherever the destination has no
component contract. They do not block the build under the default unsupported
destination policy. Supported provider projections still render normally.

This applies to package commands, native and adaptive hooks, plugin agents,
rules, apps, LSP, settings, themes, monitors, output styles, and executable
components. The Agent Plugins projection reports their absence. Codex plugin
agents and Codex/Cursor executable components likewise remain uncovered where
those providers have no corresponding component contract.

An uncovered result uses the existing `intentionally_skipped` status with
`policy: default`, the exact destination support reason, source identity,
registry evidence, and diagnostic `plugin-component-uncovered`. It names no
output for that destination. This is the compiler's fixed component-exclusion
policy, not an author-selected skip or a claim that the component works.
Status, explain, structured results, and locks retain the omission. Adapter
conformance accepts this explicit no-output disposition against an unsupported
capability only with its marker, reason, and evidence.

The [shared package](0037-one-shared-plugin-package-per-plugin.md#package-shape)
may physically contain a supported provider's component alongside the portable
manifest. Its presence does not make it an Agent Plugins component or imply
support by another consumer of the same directory.

### Invalid carried content stays blocking

ADR-0028's invalid-component rule still applies to a standard-carried manifest,
skill, or MCP entry that violates its contract, including unsupported operative
MCP fields. A supported hook destination with an unrepresentable event or
matcher remains an unsupported projection. Validation, path containment, and
security failures still block. No result status change fabricates output or
makes unsupported content conforming.

Dependency edges and explicit project-use copy hydration retain their existing
policy. They are semantic requirements, not the package component omission
addressed here. This decision does not authorize silently dropping them.

## Consequences

A provider-only component no longer prevents a useful portable manifest and
supported provider output from being built. Coverage remains reviewable without
claiming full portability. Consumers must inspect uncovered results before
assuming every component works on every target.

The existing status vocabulary and policy engine remain unchanged. The narrow
exception belongs in the component producer; it does not soften arbitrary
`unsupported`, `lossy`, or `failed` results.

## References

- [Tenets](../project/tenets.md) — provider truth, faithful output, and visible provenance.
- [ADR-0028](0028-open-standards-are-the-portability-floor.md) — clarifies the boundary between absent component contracts and invalid carried components.
- [ADR-0037](0037-one-shared-plugin-package-per-plugin.md) — shared physical package and distinct consumer contracts.
- [ADR-0018](0018-render-results.md) — existing result vocabulary and provenance.
- [ADR-0003](0003-lossy-and-unsupported-output-policy.md) — unchanged unsupported and failed policy behavior.
- [SET-686](https://linear.app/outfitter/issue/SET-686) — accepted owner decision and component regression acceptance.
