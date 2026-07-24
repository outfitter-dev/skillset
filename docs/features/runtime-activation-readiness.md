# Runtime Activation Readiness

Runtime activation readiness describes the prerequisites between canonical Skillset source and behavior that a provider can actually use. It is observational: Skillset does not install, enable, trust, authenticate, or edit provider state while producing the report.

See [ADR-0027](../adrs/0027-runtime-activation-readiness-is-observational.md) for the normative contract.

## Foundational Model

`@skillset/registry` owns dated Claude, Codex, and Cursor provider evidence. That evidence records:

- exact provider inspection surfaces and observed fields;
- provider versions and evidence sources;
- passive, active, or unavailable observation effects.

`@skillset/core` owns the Skillset activation policy: capabilities, requirement stages, claim ceilings, stable reasons, manual next actions, and fallback semantics. It joins that policy to Registry-owned provider evidence and derives deterministic requirements from the resolved source graph and current render results. It does not read HOME or XDG state, spawn providers, parse credentials, or read retained CLI runtime caches.

## Requirement Stages

| Stage | Meaning |
| --- | --- |
| `declared` | Canonical source requires the capability. |
| `rendered` | Current provider output or a truthful fallback represents it. |
| `discoverable` | Provider evidence says the runtime can locate it. |
| `enabled` | Provider evidence says it is enabled where applicable. |
| `authenticated` | Provider evidence says required authentication is present where observable. |
| `connected` | Provider evidence says the runtime connection is live where observable. |
| `proven` | A matching current declared runtime claim exercised it. |

Each requirement also carries a finite state, evidence origin, observation effect, stable reason, source provenance, and structured manual next actions. Rendering never satisfies a later runtime stage by implication.

## Summary

Summary precedence is deterministic:

1. A required authoritative block yields `blocked`.
2. Otherwise, required missing or stale evidence yields `attention`.
3. Otherwise, required unverified evidence yields `ready_unverified`.
4. Otherwise the report is `ready`.

Disabled targets are omitted. Optional findings remain visible but do not change the summary. An enabled target with no activation requirements is ready with zero counts. Runtime proof is informational by default.

## Static Subjects

The first Core slice derives:

- internal and external plugin dependencies from normalized dependency source;
- individual MCP server names from structured plugin MCP source;
- plugin app companions from target-native app provenance.

Stable requirement IDs combine target, capability, canonical subject, and stage. When several source units require the same subject, the requirement is deduplicated while retaining every owning source path and source-unit selector.

## Provider Observation

Provider execution is deliberately outside the foundational Core planner. CLI-app adapters consume Core activation policy, which joins Registry-owned provider facts with Skillset-owned claims, reasons, actions, and fallback semantics, then supply sanitized observations. Active health checks may start configured processes or make connections; their effect is explicit and opt-in.

The accepted inspection matrix is:

| Provider | Capability | Exact command | Effect | Maximum claims |
| --- | --- | --- | --- | --- |
| Claude | Plugin dependency | `claude plugin list --json` | passive | discoverable, persisted enabled state |
| Claude | MCP server | `claude mcp list` | active | discoverable, provider-reported connection |
| Codex | Plugin dependency | `codex plugin list --json` | passive | discoverable, persisted enabled state |
| Codex | MCP server | `codex mcp list --json` | passive | configured discovery |
| Cursor | MCP server | `cursor-agent mcp list` | active | discoverable, provider-reported connection |
| Cursor | Authentication | `cursor-agent status --format json` | passive | provider-reported authentication |

Provider binaries are versioned with the Registry-owned `<binary> --version` surface. One inspector runs once per target and capability, then fans its bounded facts out to matching requirements. Provider-scoped Cursor authentication likewise runs once and cannot imply plugin or MCP availability.

Unsupported app state and Cursor persistent plugin inventory stay unverified. Codex MCP inventory cannot establish connection or credentials. Plugin inventory cannot establish current-session load, bundled MCP startup, hosted policy, or runtime proof.

Observational means Skillset issues no mutation command and writes no provider state directly. It does not promise byte-immutable provider directories: an invoked provider binary may maintain incidental caches or bookkeeping of its own. Tests isolate HOME and XDG roots so those effects remain outside the workspace and user configuration.

### Failure And Redaction Boundary

Inspection uses literal Registry argv with no shell or arbitrary arguments. The shared provider-command runner applies timeout, cancellation, descendant cleanup, streaming UTF-8 decoding, and independent stdout and stderr byte limits. It continues draining after a capture limit so provider processes cannot block on full pipes.

Only allowlisted names, enabled booleans, connection tokens, authentication booleans, safe binary version text, byte counts, truncation flags, and stable parser summaries survive. Raw provider output, stderr, environment values, tokens, credential material, provider config, and personal paths are not retained. A missing, unsupported, or unrecognized binary version skips every inspector command for that binary. Missing binaries, command failures, timeouts, truncated output, malformed JSON, and unknown shapes make no positive claim; the applicable requirement remains `unverified`.

Bare build, check, status, explain, and CI remain deterministic and launch no provider process.

## Evidence

- `packages/registry/src/provider-runtime-evidence.ts`
- `packages/registry/src/__tests__/provider-runtime-evidence.test.ts`
- `packages/core/src/activation-policy.ts`
- `packages/core/src/__tests__/activation-policy.test.ts`
- `packages/core/src/runtime-readiness.ts`
- `packages/core/src/__tests__/runtime-readiness.test.ts`
- `apps/skillset/src/provider-command.ts`
- `apps/skillset/src/activation-parsers.ts`
- `apps/skillset/src/activation-inspection.ts`
- `apps/skillset/src/__tests__/fixtures/activation/provider-outputs.json`
- [SET-131](https://linear.app/outfitter/issue/SET-131/research-mcp-and-app-install-or-activation-assistance-without-runtime)
- [SET-390](https://linear.app/outfitter/issue/SET-390/define-registry-backed-activation-readiness-and-static-planning)
- [SET-391](https://linear.app/outfitter/issue/SET-391/add-bounded-provider-activation-evidence-adapters)
