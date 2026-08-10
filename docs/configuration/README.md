---
description: Choose the Skillset configuration layer that owns a project-level authoring decision.
---

# Configuration

Skillset configuration is layered. Start with the narrowest layer that expresses the intent, then use a provider override only when the shared form cannot carry the same meaning.

| If you need to... | Start here |
| --- | --- |
| Select providers or configure project-wide compilation | [Project configuration](project-configuration.md) |
| Add metadata to a skill, agent, or instruction | [Frontmatter](frontmatter.md) |
| Change one provider's output or behavior | [Target overrides](target-overrides.md) |
| Express portable or [provider-native](../glossary.md#provider-native) tool intent | [Tools policy](tools-policy.md) |

## How the Layers Relate

A Skillset [workspace](../glossary.md#workspace) supplies project-wide settings. Defaults then flow through a [cascade](../glossary.md#cascade): workspace defaults, plugin defaults, [source-unit](../glossary.md#source-unit) fields, and finally provider-specific fields. A more specific layer should refine the shared intent rather than define a second copy of it.

For the files behind those layers, see the [workspace layout](../reference/source/workspace-layout.md), [instruction source](../reference/source/instructions.md), and [preprocessing reference](../reference/source/preprocessing.md).

## Exact Contracts and Inspection

The [generated schemas and examples](../reference/schemas/README.md) are the exhaustive field reference. Use [`skillset check`](../reference/cli/check.md) to validate source, [`skillset lookup`](../reference/cli/lookup.md) to inspect schema and compatibility facts, and [`skillset explain`](../reference/cli/explain.md) to trace how a source unit resolves for each provider.
