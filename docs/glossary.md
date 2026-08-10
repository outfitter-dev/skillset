---
description: Defines the core terms used by Skillset's source, build, provider, and activation workflows.
---

# Glossary

## Adaptive source

Repository-owned Skillset source that expresses a shared authoring intent and can be transformed into one or more faithful provider-native destinations. Adaptive does not mean every provider supports every feature.

## Activation

A provider or user action that makes generated material discoverable, trusted, enabled, or connected at runtime. Activation is outside ordinary Skillset build operations.

## Build

The deterministic derivation and rendering of validated Skillset source into repo-local provider-native files. Builds preview by default and write only with explicit authority.

## Canonical source

The one authored location that owns a fact or source unit. Generated projections and explanatory summaries refer back to that owner instead of becoming competing truth.

## Cascade

The scoped inheritance of workspace and plugin defaults into a source unit, with narrower explicit configuration taking precedence. Cascade does not mean arbitrary filesystem inheritance.

## Destination

One concrete output location and format owned by a target adapter, such as a Claude skill directory, a Codex `AGENTS.md`, or a Cursor rule file.

## Drift

A difference between current canonical source and its expected generated output, or between a generated contract and its checked-in documentation projection.

## Generated output

Provider-native files derived from Skillset source. Generated output may be committed and reviewed, but it is disposable and is not the authored source of truth.

## Loadout

A reusable collection of agent-facing skills, instructions, agents, hooks, plugins, and related resources prepared for one or more providers.

## Projection

A deterministic set of generated artifacts derived from canonical source or a typed contract. A projection is checked for freshness but is not edited as source truth.

## Provider-native

Data or files shaped for a provider's own supported interface rather than forced into a lowest-common-denominator format.

## Render

To transform validated source intent into one target's provider-native destination shape without installing or activating the result.

## Render result

A structured record of what one renderer emitted, skipped, degraded, or could not support, including the evidence needed for diagnostics and provenance.

## Source root

The directory containing authored Skillset units. In the canonical workspace layout it is `.skillset/`, configured by the root `skillset.yaml`.

## Source unit

One addressable authored item—such as a skill, instruction, agent, hook, plugin, or resource—that Skillset can validate, track, and project.

## Target

An enabled provider adapter that receives rendered output. Skillset's canonical targets are Claude, Codex, and Cursor; current per-feature status lives in the [support matrix](reference/support-matrix.md).

## Target-native island

Explicit provider-specific source preserved when a concept cannot or should not be represented as adaptive source.

## Workspace

A repository configured by `skillset.yaml`, including its source root, selected targets, destination configuration, and generated provenance.
