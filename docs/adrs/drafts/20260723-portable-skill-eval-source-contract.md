---
slug: portable-skill-eval-source-contract
title: Portable Skill Eval Source Contract
status: draft
created: 2026-07-23
updated: 2026-07-23
owners: ['[galligan](https://github.com/galligan)']
amends: [12, 22]
---

# ADR: Portable Skill Eval Source Contract

## Context

ADR-0012 correctly separated deterministic tests from behavioral eval
execution, but its original two-provider pointer is now stale. ADR-0022 also
reserved evals from the top-level CLI while it treated runtime execution as the
only eval surface. Skill authors need a small portable way to keep behavioral
cases beside a skill without turning provider execution, grading, baselines,
or benchmark retention into a compiler test feature.

Anthropic's current `skill-creator` source convention supplies a concrete
interoperable starting point: a skill-local `evals/evals.json` with
`skill_name`, `evals`, case `id`, `prompt`, `expected_output`, optional
`files`, and optional `expectations`. Its schema reference treats those
optional fields as lists without requiring a non-empty or unique collection,
so existing declarations such as `expectations: []` and repeated file paths
remain compatible. The public Agent Skills prose should not be treated as a
formal cross-provider standard, and provider execution still has target-native
differences.

## Decision

Skillset accepts one portable skill-local declaration at
`<skill>/evals/evals.json`. The document preserves the `skill-creator` base
fields without rewrites. Skillset extensions live only in a case-local
`skillset` object; its sole v1 field is `targets`.

`skillset.targets` narrows a case to targets already enabled for its owning
skill. A case without it derives every enabled target from the build graph.
Shared `@skillset/schema` validation rejects unknown fields, duplicate case
IDs, unsafe or missing skill-root-relative files, and impossible target
selections. Workbench consumes the same structural validator.

`skillset eval list` is a narrow read-only inspection family. It validates
source and prints the derived case/target matrix in human or finite JSON output,
but never invokes a provider or writes a run workspace. This is the exception
to ADR-0022's prior no-eval-verb rule: declaration discovery is an inspection
operation, while evaluation execution and grading remain deferred runner work.
`skillset new skill --preset evals` scaffolds an empty compatible document
using the new skill's identity.

## Consequences

### Positive

- Authors keep a portable behavioral-case declaration beside the skill it
  describes.
- Existing `skill-creator` documents with `files: []`, `expectations: []`,
  repeated file paths, or no `expectations` validate unchanged.
- Target selection remains build-graph truth rather than an independent
  provider list.

### Tradeoffs

- This declaration is intentionally narrower than a runner configuration.
- A case-level `skillset.targets` extension is useful only for target
  narrowing; all other Skillset behavior stays out of the upstream-shaped
  fields.

### Non-Decisions

This amendment does not add provider execution, grading or judges, trials,
baselines, trigger optimization, cache retention, benchmark reports, or human
review. Those are machine-local execution concerns and must not become part of
deterministic `skillset test`, ordinary checks, or build output.

## References

- [ADR-0012: Fixtures, Tests, Dogfooding, and Evals](../0012-fixtures-tests-dogfooding-and-evals.md) - amended to define the portable declaration boundary while retaining its execution separation.
- [ADR-0022: Workflow-Oriented CLI With A Flat Loop And Explicit Domains](../0022-workflow-oriented-cli.md) - amended for the narrow read-only declaration-inspection exception; execution remains outside `test`.
- [Anthropic skill-creator schema reference](https://github.com/anthropics/skills/blob/1f630fdf9259cec4a14913127dfd7c3b69ef72eb/skills/skill-creator/references/schemas.md) - pinned primary source for the compatible base declaration fields and list semantics.
- [Skillset Design Tenets](../../tenets.md) - source-first, one-meaning, and provider-truth guidance.
- [Tests and Evals](../../features/tests-and-evals.md) - current product reference and portable/machine-local boundary.
