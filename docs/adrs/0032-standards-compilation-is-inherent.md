---
id: 32
slug: standards-compilation-is-inherent
title: Standards Compilation Is Inherent
status: accepted
created: 2026-09-12
updated: 2026-09-12
owners: ['[galligan](https://github.com/galligan)']
depends_on: [28, 30]
amends: [28, 30]
---

# ADR-0032: Standards Compilation Is Inherent

## Context

ADR-0028 established adopted open standards as Skillset's portability floor,
but exposed that floor through `compile.agents` and its `instructions`,
`skills`, and `plugins` switches. ADR-0030 added standards-only builds and
shared-path ownership. ADR-0031 then made the Agent Instructions switch own
the shared `AGENTS.md` generation gate.

That configuration is an internal policy exposed as authoring work. A source
unit that faithfully maps to an adopted standard should not need an author to
enable the standard, keep a family selector in sync, or discover that a
provider selection changes the portable artifact. Conversely, a source unit
that does not map to an adopted standard must remain visibly provider-native or
diagnose; a switch must not turn an unsupported mapping into a standards claim.

The earlier escape hatch has also blurred two distinct choices. Provider
selection decides whether Skillset renders a provider-native delta. Standards
describe the portable result of applicable adaptive source. They are separate
identities in results and locks, but the portable result is inherent once the
profile is adopted.

## Decision

**Skillset always renders every applicable adopted standard projection; users
cannot enable, disable, or select standards through source configuration.**

### Applicable adopted standards derive from source and the registry

The compiler derives standard projections from the adopted profile registry and
the resolved adaptive source inventory. It renders an adopted profile only for
the source kinds that profile actually covers:

| Adopted profile | Applicable source | Standard output |
| --- | --- | --- |
| Agent Instructions | adaptive instruction rules | root and scoped `AGENTS.md` |
| Agent Skills | portable standalone and plugin-owned skills | repository `.agents/skills/<identity>/` |
| Agent Plugins | portable plugin source | `plugins/<plugin>/agents/` package |

Project-agent roles under `.skillset/agents/` do not acquire a standard
projection merely because their source kind contains the word "agent". Nor do
provider-native islands become portable output. A standard renderer either
preserves the declared applicable meaning, records the supported transformation,
or follows the established unsupported-destination policy. It never invents an
empty or approximate standard artifact to make the plan look complete.

The Agent Instructions, Agent Skills, and Agent Plugins 1.0 profiles are
adopted, so applicable source renders their standard projections in normal
builds. Future candidate and retired profiles remain excluded from normal
output, locks, and claims. Their lifecycle, pinned evidence, offline validation,
fixtures, real-client conformance, and drift/retirement requirements remain the
adoption gate. The repository-internal candidate conformance route remains
isolated from normal builds and must not mutate production outputs, locks, or
registry state.

### Standards switches are removed instead of relocated

Remove `compile.agents` and all nested standards family switches. Do not move
them to root `agents`, plugin configuration, skill frontmatter, instruction
frontmatter, or project-agent frontmatter. There is no compatibility alias and
no replacement boolean map.

Root `agents` remains unavailable as a standards configuration home. The
existing terms `.skillset/agents/` and `defaults.<provider>.agents` retain their
project-agent meanings. This preserves the distinction between a source role
and a standard profile without adding a second configuration vocabulary.

The source-contract consequences are direct:

- A combined root `skillset.yaml` removes the `compile.agents` shape from its
  shared schema, validator, example, and parser.
- In a split workspace, `.skillset/config.yaml` removes the same shape. The
  root source manifest continues not to carry compile policy.
- Plugin `skillset.yaml` manifests continue to omit compile policy. Skill,
  instruction, and project-agent frontmatter continue to express only their
  documented provider-specific fields; none gains a standards selector.
- Generated provider-native files retain only provider-native fields. Skillset
  source-control metadata does not leak into generated frontmatter or manifests.

Schema changes use the shared `@skillset/schema` contract and generated
artifacts, rather than preserving a Core-only parser exception.

### Provider configuration stays provider configuration

`compile.targets` continues to select provider targets. Root provider
boolean-or-object blocks, including `claude: false`, continue to refine that
selection; plugin and source-unit provider overrides continue to control only
the corresponding native provider output. Claude remains enabled by default
unless explicitly turned off. This decision does not change Codex or Cursor
defaults and adds no provider alias or target syntax.

An enabled provider may become a logical consumer of a physical path that an
adopted standard already owns. The planner keeps one writer, requires matching
bytes, ownership, mode, and source identity, and records the standard owner and
all logical consumers in current locks and render results. Removing a provider
consumer must not remove a file still owned by the standard; removing a stale
standard or target path remains subject to validated current-lock provenance
and unmanaged-content protections.

Standards-only builds retain the ADR-0030 rule: `compile.targets: []` is valid
only when at least one applicable adopted standard projection remains. No
standard projection and no provider projection is an actionable no-projections
failure, never a fake provider target.

### The implementation enforces this contract

The source schema no longer accepts `compile.agents`, and the compiler derives
the three adopted projections from source applicability and registry lifecycle.
The planner and result model retain standards identity, shared physical output
ownership, resource and license fidelity, native package components,
unsupported diagnostics, and safe stale cleanup without an author opt-out path.

Each adopted profile is bound to its checked-in candidate receipt by registry
evidence. Normal repository checks validate the complete current profile
snapshot and fixture tree, then reproduce the receipt's standard-owned bytes
through the ordinary compiler path. That durability proof is offline and does
not depend on a clean working tree or Git ancestry; clean renderer identity and
pinned real-client evidence remain properties of the immutable candidate
receipt.

## Consequences

### Positive

- Adaptive source has one portable result whenever an adopted profile covers
  it, independent of provider default selection.
- Authors retain provider controls where a provider behavior or native output
  is actually being selected, including the existing `claude: false` override.
- The source contract becomes smaller: one standards configuration family and
  its nested variants disappear from schema, examples, docs, scaffolds, and
  source migration.
- Shared `AGENTS.md`, skills, and package paths retain deterministic ownership
  rather than allowing selection flags to make generated state ambiguous.

### Tradeoffs

- There is no provider-only escape hatch for applicable adopted standard
  output. An author who needs a behavior outside the adopted mapping must use a
  provider-native island or receive an unsupported diagnostic.
- Existing source containing `compile.agents` requires the accepted direct
  internal source/configuration cutover; it is not preserved through a
  backward-compatible alias.
- The decision removes a configuration and migration matrix, but does not
  reduce the necessary renderer, adoption, client evidence, lock, cleanup, or
  fidelity work.

### Existing release and migration decisions remain in force

This ADR preserves the already accepted one-time rebuild treatment for pre-v3
generated locks and direct reviewed source/configuration updates in internal
repositories. Old or untrusted locks remain rebuild-only and never grant
cleanup authority. It also preserves the already accepted minor package bump
for the fixed package group. Those decisions are recorded in the portable
skills interview packet; this ADR neither broadens release policy nor adds new
publication, installation, trust, or activation requirements.

## What This Does Not Decide

- Whether Codex or Cursor should be default-enabled, or any change to their
  existing defaults.
- A `chatgpt` target, provider alias, or migration from the existing `codex`
  target/configuration/runtime identity.
- A portable projection for project-agent roles, opaque provider islands, or
  source kinds without an adopted profile mapping.
- Relaxing adoption evidence, candidate conformance containment, provider
  truth, native-package fidelity, output collision handling, or cleanup safety.
- Global configuration mutation, plugin trust, runtime activation, package
  publication, or release execution.

## References

- [Tenets](../project/tenets.md) - source-first rendering, provider truth,
  derived defaults, visible diagnostics, and explicit build authority.
- [Schema Contracts](../development/schema-contracts.md) - shared schema,
  validator, generated-artifact, and consumer update obligations.
- [ADR-0028: Open Standards Are the Default Portability Floor](0028-open-standards-are-the-portability-floor.md) - amended to remove user standards selection while retaining adoption and profile identity.
- [ADR-0030: ChatGPT Product Bundles and Standards-Only Builds](0030-chatgpt-product-bundles-and-standards-only-builds.md) - amended to make standards-only eligibility inherent for applicable adopted source while retaining package and lock safety.
- [ADR-0031: Agent Instructions Opt-Out Owns Shared AGENTS.md](0031-agent-instructions-opt-out-owns-shared-agents-md.md) - superseded because its opt-out generation-gate premise is wholly replaced.
