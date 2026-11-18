---
id: 47
slug: native-root-agents-md-is-authored-rule-source
title: Native Root AGENTS.md Is Authored Rule Source
status: accepted
created: 2026-10-29
updated: 2026-10-29
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 32, 33, 35, 39]
amends: [33, 35, 39]
---

# ADR-0047: Native Root AGENTS.md Is Authored Rule Source

## Context

An existing repository often already authors its guidance in root `AGENTS.md`.
Requiring that file to move into `.skillset/RULES.md` creates adoption work and
leaves a generated file at the location agents naturally edit. First build can
also encounter that authored file as an unmanaged output collision.

Matt accepted native root `AGENTS.md` in SET-726. His October 28 decision
supersedes the October 20 managed-index proposal: automatically retain the root
file as source, never insert a managed block, and reject competing unscoped
root rules. This is a narrow exception to the September 16 adoption decision
that unmanaged content moves into `.skillset/`.

## Decision

A workspace can use its authored root `AGENTS.md` as its unscoped rule front
page. Native mode makes that file an explicit source input, not generated
output that the compiler adopts by overwriting it.

### Discover once and record the source choice

`init`, `create`, adopt, and first build automatically select native mode when
they find an existing root `AGENTS.md` that Skillset does not own. They record
the choice in root `skillset.yaml` and name the retained file in their result.
There is no selection prompt or refusal merely because the file exists.
Subsequent builds use the persisted choice.

Existing generated output does not become source through this discovery rule.
Ownership comes from the existing provenance and output-safety checks; a
modified managed file remains a drift/reconciliation case. Other unmanaged
collisions retain their existing protection. Native mode is not permission to
back up, overwrite, or adopt arbitrary destination files.

Read-only operations may diagnose the needed source choice but never persist
configuration or modify source. Applying operations retain their existing
transaction, containment, and concurrent-change checks.

### The root file stays authored

Skillset reads and hashes root `AGENTS.md` as source, records its actual source
path in provenance, and never writes, reformats, replaces, or deletes it. There
is no generated header, marker block, or rule index inside this authored file.
An edit changes source evidence rather than becoming an output-edit conflict.

This preserves the source-first tenet: the workspace explicitly declares which
file is source. It does not silently reverse-incorporate changes from an output
or transfer ownership of any other provider artifact.

### One unscoped front page

Native mode and `<source-root>/RULES.md` are mutually exclusive. Having both is
an error that names both sources and explains the choice; the compiler never
chooses one silently or merges their contents.

Unscoped root rules under `<source-root>/rules/` are rejected in native mode.
The diagnostic points authors to root `AGENTS.md` for that guidance. The October
20 proposal to write `.agents/rules/` and append an index to `AGENTS.md` is not
part of this contract. Directory-scoped rules continue to generate nested
`AGENTS.md` files under the existing scope and provenance contract.

A repository opts out by moving its authored front-page content into
`<source-root>/RULES.md` and removing native mode from `skillset.yaml`. That is
an explicit author action, not a build-time move or deletion.

### Provider output and source ownership remain separate

The authored root `AGENTS.md` supplies the native root guidance surface without
being claimed as a managed output. Applicable provider projections still derive
from the declared source. Claude receives generated `CLAUDE.md` at the existing
configured placement; scoped provider rule outputs retain their existing
mapping. No provider gains support merely because native mode is selected.

A Claude `@path` import is not required by this decision. It may replace copied
front-page prose only with verified provider semantics, containment, and
conformance evidence. Until then, the existing faithful rendering path remains
the implementation baseline. Native mode does not change provider selection,
standards applicability, or activation authority.

### Amended statements

This decision narrowly amends the following contracts; their other rules stay
in force:

- [ADR-0033](0033-workspace-authoring-model.md#decision):
  `<source-root>/RULES.md` remains the default front-page source. Native mode is
  the explicit exception using authored root `AGENTS.md` outside that tree.
- [ADR-0039](0039-rules-name-authored-guidance-source.md#rule-is-the-skillset-vocabulary):
  native root guidance is still a rule source. Source identity and diagnostics
  use the rule vocabulary even though its filename is provider-native.
- [ADR-0035](0035-rule-scope-and-provenanced-instruction-sections.md#decision):
  the root concatenation behavior applies to generated front pages. Native
  mode rejects unscoped root rules and never concatenates into the authored
  root file; nested generated sections retain the existing contract.
- The September 16 adoption decision quoted in SET-726 gains only this root
  front-page exception. Other imported material still enters owned source.

## Consequences

Repositories keep guidance where their authors and agents already edit it.
Source hashing, diagnostics, and generated Claude output must follow that
choice consistently. Native mode adds an ownership distinction that build,
status, explain, adoption, cleanup, and drift checks must preserve.

SET-689 implements configuration, source discovery, first-build behavior, and
collision/status diagnostics. SET-691 integrates adoption, and SET-707 owns
onboarding documentation. The schema spelling belongs to the shared schema
implementation; this ADR does not advertise an unimplemented configuration key.
Those changes must prove byte-for-byte preservation of the authored file,
persisted repeat-build behavior, source-change detection, conflict diagnostics,
scoped output, and protection of other unmanaged files. This accepted decision
is not evidence that those runtime paths have already shipped.

## References

- [Tenets](../project/tenets.md) — declared source authority and visible migration.
- [ADR-0033](0033-workspace-authoring-model.md) — amended workspace source topology.
- [ADR-0039](0039-rules-name-authored-guidance-source.md) — unchanged rule vocabulary.
- [ADR-0035](0035-rule-scope-and-provenanced-instruction-sections.md) — amended root concatenation; preserved nested scope.
- [ADR-0032](0032-standards-compilation-is-inherent.md) — inherent standards applicability remains intact.
- [SET-726](https://linear.app/outfitter/issue/SET-726) — accepted October 28 decision and historical adoption premise.
- [SET-689](https://linear.app/outfitter/issue/SET-689) — first-build implementation and diagnostics.
- [SET-691](https://linear.app/outfitter/issue/SET-691) — adoption integration.
- [SET-707](https://linear.app/outfitter/issue/SET-707) — onboarding documentation.
