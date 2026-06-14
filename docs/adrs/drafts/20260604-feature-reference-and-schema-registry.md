---
slug: feature-reference-and-schema-registry
title: Feature Reference and Schema Registry
status: draft
created: 2026-06-04
updated: 2026-06-14
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1]
---

# ADR: Feature Reference and Schema Registry

## Context

Skillset covers a broad and growing source surface: skills, plugin manifests, instructions, hooks, MCP servers, apps, resources, tool intent, agents, commands, executables, themes, monitors, LSP servers, supports metadata, dependencies, distributions, tests, release state, target-native islands, and future runtime adapters. The compiler cannot keep that surface honest with prose alone.

The pressure is not just documentation completeness. A feature can drift in several ways:

- The docs say a source feature lowers to a target, but the compiler does not.
- The compiler supports a target feature, but the docs do not explain the target nuance or unsupported cases.
- A near-match feature is accidentally treated as portable because Claude and Codex use similar words for different behavior.
- A diagnostic correctly rejects source, but the rejection is not traceable to the feature contract it protects.
- A fixture proves emitted bytes, but not the target-support claim those bytes are supposed to represent.

Skillset needs a typed feature registry that is intentionally smaller than a public plugin system and stricter than a hand-written support matrix. It should be the internal authority for feature capability claims, docs ownership, adapter evidence, validation ownership, and future conformance checks.

## Decision

Skillset maintains a typed feature registry in `@skillset/core` and a manual reader-facing feature reference under `docs/features/`. The registry records static feature capability; lowering outcomes record per-build facts.

The keeper sentence is: the feature registry says what Skillset claims a feature can do; lowering outcomes say what a build actually did.

### Registry Purpose

The registry is the typed version of Skillset's support matrix. Each entry names a feature, its source shape, current maturity, target support, evidence, docs, lowering owner, and validation owner.

The registry is allowed to answer:

- What stable feature id should docs, diagnostics, locks, outcomes, reports, and tests use?
- Is the feature implemented, planned, reserved, deferred, future-only, or unsupported as a Skillset source feature?
- Can Claude represent this feature, and by what support shape?
- Can Codex represent this feature, and by what support shape?
- Which source file or module owns lowering?
- Which source file or module owns validation?
- What docs, source, tests, fixtures, or external provider docs justify the claim?

The registry is not allowed to become a dumping ground for every target file, every CLI flag, every generated path, or every runtime activation result. Those details can reference registry entries, but the registry row should stay compact enough to read and review.

### Feature Reference

`docs/features/` remains the human-readable explanation layer. Feature pages describe how authors write source, how enabled targets lower it, which diagnostics apply, what provenance exists, and what is intentionally unsupported.

The docs are manual in v1. Future generated tables can come from the typed registry only after the page shape has proven stable. Generated docs are a convenience, not the core contract.

### Capability Status Is Static

Feature capability status is static. It describes what Skillset believes it can support in general. It does not prove that a particular build emitted, skipped, degraded, or rejected a particular source unit.

The registry has three related vocabularies:

| Vocabulary | Scope | Example values |
| --- | --- | --- |
| Feature entry status | Whether Skillset owns the feature at all. | `implemented`, `planned`, `reserved`, `deferred`, `future`, `unsupported` |
| Target support status | Whether a target can represent the feature. | `native`, `pass_through`, `transformed`, `metadata_only`, `degraded`, `externally_managed`, `not_applicable`, `unsupported`, `lossy` |
| Runtime support status | Whether a runtime/harness/distribution can activate or observe the feature. | same values as target support, including `shimmed` |

Lowering outcome statuses are separate. A target support row that says `native` usually produces an `emitted` outcome when source is built. A target support row that says `pass_through` usually produces a `target_native` outcome. A target support row that says `unsupported` may produce `unsupported`, `intentionally_skipped`, or no outcome when the source unit is not in scope.

### Markdown Is Not The Core IR

Markdown files are input and output formats, not Skillset's core intermediate representation. This is true even when Markdown is the user-authored source format.

This means:

- Source `SKILL.md` is parsed into a Skillset source skill with frontmatter, body, resources, target toggles, preprocessing settings, and normalized target options.
- Generated `SKILL.md` is a target artifact, not a source truth or IR node.
- `CLAUDE.md`-style files when imported or carried through target-native source, generated Claude rules, and generated Claude agent Markdown are Claude-native artifacts.
- Generated `AGENTS.md` files are Codex-native project guidance artifacts.
- Target-native islands may intentionally copy Markdown, TOML, JSON, YAML, binary files, or unknown sidecars, but opaque target-owned files are still recorded as target-native output, not portable IR.

The core representation is the resolved source graph plus typed feature entries, target support rows, lowering outcomes, diagnostics, locks, and operation results. Those facts can serialize to Markdown, JSON, YAML, TOML, or target-specific directories, but the serialization does not define the semantic contract.

The test: if changing a generated filename would not change the author's source intent, the filename is not the IR. If changing a source feature row would change validation, lowering, or support claims, that row is part of the contract.

### Adapter Evidence

Adapter support claims require evidence without overpromising runtime behavior. Evidence may be:

- `docs`: Skillset docs or ADRs that define the source contract.
- `source`: compiler modules that parse, validate, lower, or report the feature.
- `test`: tests that prove the feature behavior or registry guard.
- `fixture`: fixture cases that exercise target output or adoption behavior.
- `external-docs`: provider docs with a verification date.
- `assumption`: an explicit bounded assumption that should be replaced by stronger evidence before the feature graduates.

External provider docs prove that a target surface exists; they do not prove Skillset's lowering is correct. Source and tests prove Skillset behavior; they do not prove provider runtime activation. Runtime support and activation probes must stay separate from compile-target support.

### Boundary With Adapters

The registry describes capabilities across adapters, but it is not a public adapter API. Claude and Codex adapter code can evolve internally, and future targets such as Cursor, Gemini, Devin, Droid, or OpenCode can add registry rows or runtime support records without making adopters learn a new plugin system.

The portable feature layer answers, "What did the author mean?" The target adapter layer answers, "Can this target represent that meaning, and what native files should be emitted?" The runtime support layer answers, "Can a runtime, distribution, or harness activate or observe it?"

### Diagnostics And Conformance

Diagnostics should reference feature ids where useful, but readable error messages remain primary. A user should see what is wrong and how to fix it; a machine-readable feature id is supporting evidence for tooling and conformance.

Conformance checks should consume the registry and lowering outcomes together. A registry row that says `degraded` should produce a visible degraded outcome when that source feature is built for the target. A row that says `unsupported` should produce an unsupported outcome, a clear lowering error, or an intentionally skipped outcome with policy provenance. Silent omission is not a valid conformance result.

## Non-Goals

This ADR does not define a public adapter plugin API, generate all feature docs from schemas, reverse-sync generated output into source, mutate provider runtime config, implement graph mutation, or require Trails adoption. It also does not turn target Markdown files into canonical source truth.

Settings suggestions, grouped sets, model/reasoning aliases, global managed installs, richer runtime activation, generated docs, public adapters, and full schema generation remain separate decisions.

## Consequences

### Positive

The registry gives future implementation branches a stable place to attach diagnostics, drift checks, feature inspection, lowering outcomes, and conformance fixtures. It also gives docs a way to say "this is target-native" or "this is degraded" without burying that truth in a prose paragraph.

Separating capability status from lowering outcomes keeps build reports honest. A feature can be generally supported while a particular source unit is skipped by scope, and a feature can be generally degraded without every build producing degraded output.

Treating Markdown as serialization rather than IR protects the source-first model. The compiler can continue to use Markdown where it is ergonomic while still validating source intent through typed records and registry evidence.

### Tradeoffs

The registry creates another contract to maintain. A feature implementation now needs docs, tests, evidence, and registry rows to stay aligned. That is work, but it is cheaper than discovering target drift through runtime surprises.

The first registry is typed TypeScript rather than generated JSON Schema. That keeps the v1 implementation small and close to the compiler, but it means external consumers should treat the root API as pre-release until a public schema story is explicitly accepted.

### Risks

A registry can become stale if checks do not verify references and evidence. SET-77 owns drift checks for docs, tests, fixtures, and support claims.

Registry ids can make diagnostics look machine-first. SET-76 must keep human-readable messages primary and add feature ids as structured context, not as replacements for explanations.

## References

- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - baseline source-first compiler doctrine.
- [ADR-0001: Root Compile Policy](../0001-root-compile-policy.md) - provider selection and unsupported-policy boundary.
- [Feature Reference](../../features/README.md) - reader-facing feature index and vocabulary.
- [Feature Registry](../../features/feature-registry.md) - feature-facing documentation for the typed registry contract.
- [Lowering Outcomes and Loss Ledger](20260614-lowering-outcomes-and-loss-ledger.md) - per-build outcome vocabulary that stays separate from registry capability status.
- [Deterministic Projection and Adapter Conformance](20260613-deterministic-projection-and-adapter-conformance.md) - conformance model that consumes registry support and lowering outcomes together.
- [Target Surface Evidence Matrix](../../target-surfaces.md) - compact target evidence matrix that feature pages expand.
