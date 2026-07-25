---
id: 27
slug: runtime-activation-readiness-is-observational
title: Runtime Activation Readiness Is Observational
status: accepted
created: 2026-07-24
updated: 2026-07-24
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 5, 12, 19, 22, 23]
---

# ADR-0027: Runtime Activation Readiness Is Observational

## Context

Skillset can prove that source is valid, provider output is current, and a declared runtime test completed. Between rendering and runtime proof, however, providers may still require a marketplace, plugin discovery, enablement, workspace trust, authentication, an MCP connection, or a host-level app policy.

Those facts are not interchangeable:

- a generated MCP file does not prove that the server is approved or connected;
- an installed plugin does not prove that it is enabled in the current session;
- an enabled app does not prove that credentials are valid;
- a successful ad hoc prompt does not prove a particular declared dependency;
- an unavailable inspection API does not prove that activation is missing.

Without a shared model, each CLI route would either repeat provider-specific logic or imply more certainty than its evidence supports. The opposite failure is to make `build` or ordinary `check` inspect ambient runtime state, breaking determinism and the tenet that builds do not imply trust.

## Decision

**Skillset models activation readiness as an explicit observational evidence report. It never treats rendering as activation, issues no provider mutation command, and writes no provider or user state while assessing readiness.**

### Requirements, not one activation boolean

An activation requirement is one concrete prerequisite between authored source and successful runtime behavior. Each requirement has:

```ts
import type { ActivationTarget } from "@skillset/schema";

interface ActivationRequirement {
  id: string;
  target: ActivationTarget;
  capability: "plugin-dependency" | "mcp-server" | "app";
  subject: string;
  stage:
    | "declared"
    | "rendered"
    | "discoverable"
    | "enabled"
    | "authenticated"
    | "connected"
    | "proven";
  state:
    | "satisfied"
    | "missing"
    | "blocked"
    | "unverified"
    | "stale"
    | "not_applicable";
  origin: "declared" | "derived" | "observed" | "proven";
  observationEffect: "none" | "passive" | "active";
  required: boolean;
  reason: string;
  nextActions: readonly ActivationNextAction[];
}
```

Stages are not a universal linear state machine. They are a vocabulary for capability-specific requirements:

| Capability | Common requirements |
| --- | --- |
| Plugin dependency | declared, rendered, discoverable, enabled, proven |
| MCP server | declared, rendered, discoverable, authenticated, connected, proven |
| App | declared, rendered, discoverable, enabled, authenticated, proven |

`not_applicable` keeps provider differences explicit. `unverified` means the provider exposes no safe or sufficiently authoritative evidence. `stale` is reserved for prior proof whose source, rendering, target, or adapter identity no longer matches.

Readiness is a derived summary, not another requirement stage. The aggregation algorithm is total and uses this precedence:

1. Ignore disabled targets. Optional requirements remain visible but never change the summary.
2. If any required requirement has an authoritative `blocked` observation, the summary is `blocked`.
3. Otherwise, if any required requirement is `missing` or `stale`, the summary is `attention`.
4. Otherwise, if any required requirement is `unverified`, the summary is `ready_unverified`, rendered as **ready with unverified requirements**.
5. Otherwise the summary is `ready`.

An enabled target with no activation requirements is `ready` with zero counts. Unavailable authentication, unsupported inspection, malformed output, and timeouts are `unverified`, not `blocked`. A `proven` requirement is informational by default and does not gate readiness unless a future source contract explicitly makes that proof required.

### Evidence ownership

The implementation keeps responsibilities in their existing packages:

- `@skillset/registry` owns dated provider evidence: provider versions,
  citations, fixed inspection command surfaces, output formats, and observed
  provider-native fields. It does not decide Skillset activation semantics.
- `@skillset/schema` owns any persisted or public versioned report shape. It does not add authoring keys merely to support inspection.
- `@skillset/core` owns activation capabilities, requirement stages, claim
  ceilings, reason/action templates, fallback semantics, and evidence
  interpretation. It composes Registry evidence with the resolved source graph,
  render results, drift, locks, and optional observations.
- The CLI app owns process execution, timeouts, output parsing, redaction, retained runtime-report reading, and terminal/JSON presentation.

Core never reads HOME, provider configuration, credential stores, or retained app-owned reports. Provider adapters cannot reinterpret source declarations or render paths independently of Core.

### Static, observed, and proven evidence

Evidence strength is explicit:

1. `declared` comes from canonical Skillset source.
2. `derived` comes from the resolved graph, registry, render results, locks, or generated-output drift.
3. `observed` comes from an allowlisted provider-native read surface.
4. `proven` comes only from a matching current declared runtime test.

Ad hoc `skillset test --prompt` and eval runs remain useful exploration but
cannot prove a named requirement. Declared runtime probes use the explicit claim
item `{ capability, subject }` under `runtime.claims`. Core resolves each claim
to a stable requirement id before provider execution. A persisted runtime
receipt may carry a resolved claim id only when the provider adapter returns
capability-specific evidence that the named subject was exercised. Generic
process success and response-text assertions are test outcomes, not
subject-invocation evidence. The receipt must also carry deterministic
source/rendering/target/adapter identity before it can satisfy `proven`.
Overall run success never proves an unclaimed requirement. Runtime binary
version is retained as evidence but does not invalidate proof in the first
contract.

### Explicit local inspection

Environment-sensitive inspection is opt-in. The following is planned CLI syntax
that becomes available only when the implementation slice lands:

```bash
skillset status --activation
skillset status --activation --json
skillset explain <path> --activation
```

Bare `skillset status`, `build`, ordinary `check`, and CI remain deterministic and launch no provider processes. `explain <path>` may show statically derived requirements without the flag; the flag adds local observations. `skillset lookup` remains static and reports provider observability and supported evidence, never workspace-local activation state.

Activation findings are advisory and do not change the normal `status` exit contract. A future explicit enforcement mode requires its own decision.

### Provider posture

Provider descriptors state what Skillset can inspect and the maximum claim each observation can satisfy. The first-release matrix was verified on 2026-07-24:

| Provider and version | Capability | Allowlisted argv or surface | Effect | May satisfy | Must not satisfy |
| --- | --- | --- | --- | --- | --- |
| Claude Code 2.1.219 | Plugin | `claude plugin list --json` | passive | discoverable, persisted enabled state | current-session load, authentication, proven |
| Claude Code 2.1.219 | MCP | `claude mcp list` | active | configured discovery and reported connection state | credentials, provider policy, proven |
| Claude Code 2.1.219 | App | no stable CLI inventory | none | unverified | discovery, enablement, authentication, proven |
| Codex 0.146.0-alpha.3.1 | Plugin | `codex plugin list --json` | passive | discoverable, persisted enabled state | bundled MCP connection, hosted policy, proven |
| Codex 0.146.0-alpha.3.1 | MCP | `codex mcp list --json` | passive | configured discovery | connection, credentials, proven |
| Codex 0.146.0-alpha.3.1 | App | no authoritative local host-policy surface | none | unverified | availability, enablement, authentication, proven |
| Cursor Agent 2026.07.23-e383d2b | Plugin | no persistent plugin inventory | none | unverified | discovery, enablement, current-session load, proven |
| Cursor Agent 2026.07.23-e383d2b | MCP | `cursor-agent mcp list` | active | configured discovery and reported status | credentials, provider policy, proven |

`passive` inspectors read provider-maintained inventory without intentionally starting configured workloads. `active` inspectors may start a configured process, make a network connection, or health-check a server even though Skillset issues no mutation subcommand. Both are allowed only behind `--activation`, with fixed argv, no shell interpolation, a timeout and child cleanup, clear human/JSON disclosure, and no ambient CI use. Unknown output versions and fields degrade to `unverified`.

Provider account status does not establish subject-specific authentication.
Cursor MCP `authenticated` requirements remain `unverified` unless a bounded
subject-specific MCP observation or matching runtime proof establishes them.
The Registry may catalog Cursor account-status evidence for other consumers,
but activation inspection does not invoke it or fan it into MCP requirements.

Observational means Skillset issues no mutation command and writes no provider state directly. It does not promise byte-immutable provider directories: an invoked provider binary may maintain incidental caches or bookkeeping of its own. Tests isolate HOME and XDG roots so those effects remain outside the workspace and user configuration.

### Safety boundary

Every inspector is allowlisted, injectable in tests, time-bounded, and mapped to one fixed provider command. Inspection:

- never asks the provider to install, enable, trust, authenticate, register a marketplace, edit settings, create symlinks, or write an activation ledger;
- discloses whether each inspector is passive, active, skipped, timed out, or unavailable;
- never reads credential files or serializes tokens, environment contents, personal paths, or raw sensitive provider configuration;
- degrades missing binaries, malformed output, timeouts, unavailable auth, and unsupported provider state to explicit advisory evidence;
- never turns rendered output into proof of live availability.

Suggested next actions are structured guidance, not executable plans. Each action identifies the provider-native manual step and whether it would mutate runtime state. Skillset does not execute those actions in this workflow.

### Relationship to future workflows

Activation readiness does not implement the XDG `install`/`sync` design or reviewed settings suggestions. Those workflows may consume readiness reports later, but they retain separate preview, confirmation, ownership, rollback, and trust boundaries.

## Consequences

### Positive

- Authors can see the real gap between correct output and usable runtime state.
- Provider differences remain visible instead of becoming fake parity.
- Static planning is reusable by status, explain, lookup, tests, and future install/settings workflows without duplicating provider rules.
- Ordinary build and CI remain deterministic and credential-free.
- Runtime receipts become stronger evidence through explicit freshness identity.

### Tradeoffs

- Claude and Cursor may report more `unverified` requirements than Codex until stable machine-readable inspection improves.
- Explicit `--activation` adds one step, but makes process/network-sensitive inspection visible and intentional.
- A typed requirement report is more detailed than a single green/red status, but avoids misleading claims and supports compact summaries.

### Risks

- Provider commands and output schemas can drift. Mitigation: registry evidence, parser fixtures, tolerant failure to `unverified`, and current provider-doc review.
- Guidance could become noisy. Mitigation: deterministic grouping, compact summaries, stable requirement ids, and actionable missing/blocked items before opaque optional facts.
- Inspector output could expose sensitive values. Mitigation: parse only allowlisted fields, redact before serialization, and test hostile fixtures.

## Non-Goals

- A top-level `activate` command.
- Global XDG source, install, sync, uninstall, or activation ownership.
- Settings suggestion application or provider config editing.
- Automatic dependency installation, marketplace registration, trust, or authentication.
- Reading user settings or credential stores in the first release.
- Grading model quality or treating all successful prompts as proof.
- Requiring identical activation observability across providers.

## Implementation Gate

SET-131 owns this decision and closes after a clean contract review plus implementation issue creation. Implementation proceeds in bounded slices for:

1. registry/Core requirements and static planning;
2. provider observation adapters with explicit effect classes;
3. status/explain/lookup presentation;
4. runtime-proof receipt identity and correlation.

## References

- [Tenets](../tenets.md) - builds do not imply trust and provider truth beats fake portability.
- [ADR-0005: Feature Reference and Schema Registry](0005-feature-reference-and-schema-registry.md) - registry evidence and runtime-support separation.
- [ADR-0012: Fixtures, Tests, Dogfooding, and Evals](0012-fixtures-tests-dogfooding-and-evals.md) - behavioral evidence boundaries.
- [ADR-0019: Deterministic Projection and Adapter Conformance](0019-deterministic-projection-and-adapter-conformance.md) - render conformance is not activation.
- [ADR-0022: Workflow-Oriented CLI](0022-workflow-oriented-cli.md) - status, explain, lookup, test, and eval ownership.
- [ADR-0023: Versioned Structured Output](0023-versioned-structured-output-for-cli-automation.md) - machine-readable command contracts.
- [Global / XDG Managed Installs and Sync](drafts/20260604-global-xdg-managed-installs-and-sync.md) - future explicit activation mutation, out of scope here.
- [Reviewed Settings Suggestions](drafts/20260604-reviewed-settings-suggestions.md) - future settings planning and apply boundary.
- [Ungraded Cross-Provider Eval Runs](drafts/20260723-ungraded-cross-provider-eval-runs.md) - current provider runtime evidence.
- [Claude MCP](https://code.claude.com/docs/en/mcp) and [plugins](https://code.claude.com/docs/en/discover-plugins) - approval, connection, installation, enablement, and reload evidence.
- [Codex MCP](https://developers.openai.com/codex/mcp), [CLI reference](https://developers.openai.com/codex/cli/reference), and [authentication](https://developers.openai.com/codex/auth) - machine-readable inventory and auth evidence.
- [Cursor plugins](https://cursor.com/docs/plugins) and [headless CLI](https://cursor.com/docs/cli/headless) - plugin and runtime inspection boundaries.
- [Linear SET-131](https://linear.app/outfitter/issue/SET-131/research-mcp-and-app-install-or-activation-assistance-without-runtime) - design owner.
