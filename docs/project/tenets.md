---
description: The Skillset design tenets define the durable principles and promises that guide compiler and source-contract decisions.
---

# Skillset Design Tenets

> Source-first loadouts: author once, [render](../glossary.md#render) faithfully.

These tenets are Skillset's slow-moving product doctrine. They guide decisions about [canonical source](../glossary.md#canonical-source), [provider adaptation](../glossary.md#provider-native), [generated artifacts](../glossary.md#generated-output), validation, and [runtime authority](../glossary.md#activation). Current fields, commands, paths, and provider support belong in the [reference layer](../reference/README.md); accepted ADRs record consequential design decisions.

When implementation and a tenet disagree, fix the implementation or make an explicit decision to change the tenet. Do not reconcile a conflict only in tactical documentation.

## Principles

### Help the happy path

Authoring a reusable loadout should be easier than maintaining parallel provider trees. A small useful [source unit](../glossary.md#source-unit) should not require repeated identity, duplicated descriptions, hand-selected [destination](../glossary.md#destination) paths, or provider-specific knowledge before that knowledge is necessary.

Defaults and derivation should remove repetition. Validation should explain unsafe or unsupported choices. Explicit escape hatches should remain available when the common path is not faithful.

### Source is the product

The active Skillset [workspace](../glossary.md#workspace) is the authored source of truth. Provider files, manifests, locks, and other [generated output](../glossary.md#generated-output) may be committed and reviewed, but they remain reproducible artifacts.

Changes normally flow from source through [render](../glossary.md#render). Intentional edits discovered on the destination side require explicit reconciliation; they do not silently become source.

### One meaning, one key

When supported providers expose the same semantic feature, Skillset should offer one adaptive source concept for that meaning. Different provider spellings do not justify parallel source vocabulary.

Normalize exact matches before rendering. Keep a provider-specific name only when it represents a real provider-specific contract.

### Render intent, not filenames

Near matches should begin with the author's intended outcome, not the first provider format implemented. The compiler should choose the faithful [provider-native](../glossary.md#provider-native) representation of that intent.

When no faithful representation exists, Skillset should report the limitation, preserve provenance, or require an explicit provider boundary. It should not make unlike artifacts appear equivalent.

### Provider truth beats fake portability

Adaptive source is for behavior Skillset can meaningfully adapt. A provider-native island is preferable to a shared abstraction that erases important semantics or promises enforcement the provider does not offer.

Support claims require provider evidence and implementation evidence. Compatibility prose, shims, sidecars, and generated instructions do not become native support merely because they are useful.

### Derive by default, override when wrong

Authors should supply information only they know. Skillset should derive stable identity, metadata, destinations, and defaults from facts already present in the resolved source graph.

Overrides are healthy when derivation is wrong. They should be explicit, narrowly scoped, validated, and visible in resolved output or provenance. Frequent broad overrides are evidence that the derivation rule needs revision.

### Builds do not imply trust

[Build](../glossary.md#build) and [activation](../glossary.md#activation) have different authority. Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration. The complete operational boundary lives in [Build Versus Activation](../start/build-versus-activation.md).

Publication, installation, registry mutation, runtime trust, and enablement require their own explicit workflows and authority.

### Codify the craft

Skillset should turn durable authoring knowledge into schemas, diagnostics, scaffolds, explainability, fixtures, and checks. Tooling is part of the product when it helps authors create clearer source and understand provider differences earlier.

The compiler should teach through actionable diagnostics and inspectable provenance rather than hidden repair or unexplained rejection.

## Promises

### Generated output is reproducible

The same canonical inputs and compiler contract should produce deterministic, disposable, reviewable artifacts. Nondeterminism is a correctness defect, not harmless formatting [drift](../glossary.md#drift).

### Provider output stays native

Each provider's output should follow that provider's conventions. Skillset may normalize source authoring without forcing destinations into an unnatural common shape.

### Provenance stays inspectable

Provider artifacts should carry only lightweight metadata needed by their contract. Source paths, hashes, support decisions, skipped output, policy, and drift evidence belong in structured operation results and nearby locks.

### Migration is explicit

Imports and migrations should preserve unrecognized material and surface ambiguity for review. Obsolete adaptive vocabulary should not remain indefinitely once a safe cutover exists. Unknown source meaning must fail or stay visibly provider-native.

### Drift becomes visible early

Stale output, unsupported destinations, unsafe mappings, malformed provenance, and unmanaged collisions should be diagnosed before they become runtime surprises.

Fail when a safe artifact cannot be produced. A softer policy may permit only behavior the renderer already defines, with the limitation and resulting output recorded honestly.

## Decision Patterns

### Normalize exact matches

Use one adaptive concept when providers share meaning. Let adapters own spelling and file shape.

### Model near matches by intent

Name the desired behavior first, then define each provider [projection](../glossary.md#projection) and its caveats. Do not promote a compatibility mechanism into a universal source contract without evidence.

### Prefer defaults and scoped overrides

Choose useful defaults for adaptive source. Let narrower source units override or opt out only where the resolver can explain the deciding layer.

### Keep escape hatches visible

Provider-specific source and policy should be obvious, validated for safety, and isolated to the provider that owns it. Escape hatches should not leak into another [target](../glossary.md#target) or disguise themselves as portable behavior.

### Treat tooling as an authoring surface

Checks, imports, scaffolds, inspection, reconciliation, and conformance are how Skillset keeps source and provider behavior honest. New tooling should reinforce ownership rather than inventing another contract.

## Applying the Tenets

Use the [configuration reference](../configuration/README.md) for current source fields, the [feature reference](../reference/features/README.md) and generated [support matrix](../reference/support-matrix.md) for capability facts, and the [development documentation](../development/README.md) for maintainer workflows and package boundaries. The [documentation system](../development/documentation-system.md) explains how those volatile facts remain mechanically current without expanding this doctrine.

A proposal fits these tenets when it makes authoring smaller, preserves provider truth, keeps authority explicit, produces deterministic evidence, and assigns each consequential fact one owner.
