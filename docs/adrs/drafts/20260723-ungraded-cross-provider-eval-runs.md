---
slug: ungraded-cross-provider-eval-runs
title: Ungraded Cross-Provider Eval Runs
status: draft
created: 2026-07-23
updated: 2026-07-23
owners: ['[galligan](https://github.com/galligan)']
amends: [12, 22]
---

# ADR: Ungraded Cross-Provider Eval Runs

## Context

Portable skill-local declarations now provide a deterministic case-by-target
matrix, but declaration inspection alone cannot retain evidence from an actual
provider invocation. ADR-0012 correctly keeps deterministic tests separate
from behavioral evaluation, while ADR-0022 reserves a narrow eval command
family for declaration inspection rather than a second test harness.

The missing slice is an opt-in execution path that is honest about provider
differences. It must use the existing isolated target-native process adapter,
preserve case ownership when plugins and standalone skills share an id, and
never mistake an authored expectation for an automated judgment.

## Decision

`skillset eval run` executes the deterministic portable declaration matrix as
one ungraded provider trial per standalone-or-plugin-owned case and target.
`eval status` and `eval tail` inspect retained eval-owned evidence. This is an
explicit runtime surface under the existing `eval` command family, not
deterministic `skillset test`, a restored `try` command, or a second provider
harness.

Each target receives its own isolated rendering before the trial workspace is
prepared. Each case gets a fresh retained workspace copied from that selected
target rendering; declared `files` are staged at their authored relative paths
so the prompt can use them without host state. The shared app-owned runtime
probe adapter constructs Claude, Codex, and Cursor commands and captures their
events. Eval lifecycle, cache paths, reports, and status/tail output remain
eval-owned under logical `.skillset/cache/evals/`.

Reports retain typed owner identity, case id, target, prompt and authored
expectations, command, workspace, final response when available, duration,
model/token/tool-call metadata when supplied, and the explicit outcome.
`non_lowering` and `unavailable` identify preparation failures, including a
missing local activation path. Plugin-owned Codex trials are unavailable until
the Codex adapter can activate a local generated plugin bundle rather than
merely rendering it. Provider auth/binary/render/setup/runtime/timeout/cancel
outcomes are infrastructure failures. A provider process that completes is a
completed trial, not a quality verdict against `expected_output` or
`expectations`.

## Consequences

- Eval execution is visible, retained, and target-native without entering
  default checks or CI.
- Plugin-owned and standalone skills with the same id cannot overwrite trial
  evidence because ownership is part of the execution plan and artifact path.
- Foreground AbortSignal cancellation terminates the active shared probe and
  records a cancelled infrastructure outcome. Durable cross-process/background
  cancellation needs a separate owned-process protocol and remains out of
  scope.
- Graders, judges, scoring, baselines, comparisons, repeated-trial
  orchestration, and human review remain deferred machine-local work.

## References

- [ADR-0012: Fixtures, Tests, Dogfooding, and Evals](../0012-fixtures-tests-dogfooding-and-evals.md) - amended only for the explicit ungraded execution boundary.
- [ADR-0022: Workflow-Oriented CLI With A Flat Loop And Explicit Domains](../0022-workflow-oriented-cli.md) - amended for the narrow eval runtime family, without making evals deterministic tests.
- [Tests and Evals](../../features/tests-and-evals.md) - current command, retention, and non-grading contract.
