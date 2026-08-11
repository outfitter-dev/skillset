---
description: Runtime activation readiness defines observational stages, evidence effects, claim ceilings, reports, and manual next actions.
---

# Runtime Activation Readiness

Runtime [activation](../../glossary.md#activation) readiness describes the prerequisites between [canonical source](../../glossary.md#canonical-source), a current [render result](../../glossary.md#render-result), and behavior that a provider can actually use. It is observational: Skillset does not install, enable, trust, authenticate, or edit provider state while producing the report.

See [ADR-0027](../../adrs/0027-runtime-activation-readiness-is-observational.md) for the normative contract.

## Foundational Model

`@skillset/registry` owns dated Claude, Codex, and Cursor provider evidence. That evidence records:

- exact provider inspection surfaces and observed fields;
- provider versions and evidence sources;
- passive, active, or unavailable observation effects.

`@skillset/core` owns the Skillset activation policy: capabilities, requirement stages, claim ceilings, stable reasons, manual next actions, and fallback semantics. It joins that policy to Registry-owned provider evidence and derives deterministic requirements from the resolved source graph and current render results. Core does not read HOME or XDG state, spawn providers, parse credentials, or read retained CLI runtime caches.

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

Disabled [targets](../../glossary.md#target) are omitted. Optional findings remain visible but do not change the summary. An enabled target with no activation requirements is ready with zero counts. Runtime proof is informational by default.

## Static Subjects

The first Core slice derives:

- internal and external plugin dependencies from normalized dependency source;
- individual MCP server names from structured plugin MCP source;
- plugin app companions from target-native app provenance.

Stable requirement IDs combine target, capability, canonical subject, and stage. When several [source units](../../glossary.md#source-unit) require the same subject, the requirement is deduplicated while retaining every owning source path and source-unit selector.

## Declared Runtime Proof

Only declared runtime tests can claim the informational `proven` stage. Test
probes declare `runtime.claims` using the portable shape:

```yaml
claims:
  - capability: mcp-server
    subject: github
```

Core resolves each claim against the selected target and source [projection](../../glossary.md#projection)
before any provider process starts. The declaration names the canonical
capability and subject, not an internal requirement ID. Missing, ambiguous,
disabled, target-incompatible, and unsupported claims fail before runtime
execution.

The current structured runtime adapters corroborate only `mcp-server` claims.
`app` and `plugin-dependency` remain schema-valid activation vocabulary for
readiness planning, but declared runtime proof rejects them during preflight
until a bounded provider evidence adapter can prove those capabilities.

Runs retain a versioned proof receipt only for resolved claims corroborated by
structured provider invocation evidence for the exact capability and subject.
Final response text, authored substring assertions, and generic process success
cannot mint proof. Each receipt contains the corroborated requirement IDs and
deterministic declaration, source, projection, target, and adapter identity.
Provider binary version is retained as informational evidence but is not a
freshness input. A receipt satisfies `proven` only while the current declaration
still exists and every freshness identity matches.
Deleting the declaration or changing its runtime-relevant prompt, expectations,
claims, or selected projection makes a prior passing receipt `stale`, as does
changing source or generated projection. Failed, cancelled, timed-out, and
successful unclaimed runs leave proof `unverified`. Direct ad hoc tests can
never mint proof.

Skill evals remain ungraded. Their expected output and expectations are retained
for inspection, but completion cannot establish that a capability or subject
was exercised. Eval reports therefore never contain activation proof receipts.

The CLI app reads retained reports and supplies structured receipts to Core.
Core never reads XDG paths or app-owned runtime caches. Independent retained
runs compose. Incomplete, unreadable, malformed, and schema-invalid retained
proof reports remain untrusted advisory evidence: the app ignores them and
leaves the applicable requirement unverified rather than failing activation
inspection.

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

Provider binaries are versioned with the Registry-owned `<binary> --version` surface. One inspector runs once per target and capability, then fans its bounded facts out to matching requirements. Cursor account status is not treated as evidence that any particular MCP server is authenticated; that requirement remains unverified without subject-specific observation or matching runtime proof.

Unsupported app state and Cursor persistent plugin inventory stay unverified. Codex MCP inventory cannot establish connection or credentials. Plugin inventory cannot establish current-session load, bundled MCP startup, hosted policy, or runtime proof.

Observational means Skillset issues no mutation command and writes no provider state directly. It does not promise byte-immutable provider directories: an invoked provider binary may maintain incidental caches or bookkeeping of its own. Tests isolate HOME and XDG roots so those effects remain outside the [workspace](../../glossary.md#workspace) and user configuration.

### Failure And Redaction Boundary

Inspection uses literal Registry argv with no shell or arbitrary arguments. The shared provider-command runner applies timeout, cancellation, descendant cleanup, streaming UTF-8 decoding, and independent stdout and stderr byte limits. It continues draining after a capture limit so provider processes cannot block on full pipes.

Only allowlisted names, enabled booleans, connection tokens, safe binary version text, byte counts, truncation flags, and stable parser summaries survive. Raw provider output, stderr, environment values, tokens, credential material, provider config, and personal paths are not retained. A missing, unsupported, or unrecognized binary version skips every inspector command for that binary. Missing binaries, command failures, timeouts, truncated output, malformed JSON, and unknown shapes make no positive claim; the applicable requirement remains `unverified`.

Bare build, check, status, explain, and CI remain deterministic and launch no provider process.

## CLI

Activation observation is explicit:

```bash
skillset status --activation
skillset status --activation --json
skillset explain .skillset/plugins/tools/.mcp.json --activation
skillset lookup activation
skillset lookup activation mcp --compat codex
```

`status --activation` combines the deterministic Core plan with only the Registry-selected provider inspectors needed by the resolved activation subjects. Human output uses **ready with unverified requirements** for the structured `ready_unverified` summary, lists required actionable findings first, and discloses every inspector's `passive` or `active` effect and outcome. Provider failures remain advisory: activation evidence does not change the existing status exit contract.

`explain <path> --activation` uses source provenance before inspector selection, so unrelated capability inspectors do not run. Its receipts retain only subjects owned by the explained source or generated path and omit provider-wide byte counts and aggregate parser summaries that cannot be attributed to that source.

`lookup activation` is always static. It reads Core-owned activation records joined to Registry provider evidence rather than local provider state. It exposes evidence versions, exact inspector surfaces, effect classes, supported claims, unavailable surfaces, stable reasons, and manual next actions. Capability aliases include `mcp`/`mcp-server`, `plugin`/`plugins`/`plugin-dependency`, and `app`/`apps`; `--compat` selects one or more provider lenses.

Structured status and explain results carry the versioned `skillset.activation-inspection@1` report:

```json
{
  "schema": "skillset.activation-inspection@1",
  "readiness": {
    "schema": "skillset.activation-readiness@1",
    "summary": "ready_unverified",
    "counts": {
      "satisfied": 3,
      "unverified": 3
    }
  },
  "inspections": [
    {
      "inspectorId": "codex.mcp.list",
      "effect": "passive",
      "outcome": "ran"
    }
  ]
}
```

The complete JSON also contains stable requirement ids, source paths, source-unit selectors, reasons, and next actions. Workspace status receipts include bounded byte counts and truncation flags; source-scoped explain receipts omit that provider-wide metadata. The report contract and validator are owned by `@skillset/schema` and published as `activation-inspection.schema.json`. No form contains raw provider output.

## Evidence

- `packages/registry/src/provider-runtime-evidence.ts`
- `packages/registry/src/__tests__/provider-runtime-evidence.test.ts`
- `packages/core/src/activation-policy.ts`
- `packages/core/src/__tests__/activation-policy.test.ts`
- `packages/core/src/runtime-readiness.ts`
- `packages/core/src/__tests__/runtime-readiness.test.ts`
- `packages/schema/src/activation-inspection.ts`
- `packages/schema/src/activation-proof.ts`
- `docs/reference/schemas/0.1.0/activation-inspection.schema.json`
- `docs/reference/schemas/0.1.0/activation-proof-receipt.schema.json`
- `apps/skillset/src/provider-command.ts`
- `apps/skillset/src/activation-parsers.ts`
- `apps/skillset/src/activation-inspection.ts`
- `apps/skillset/src/activation-workflow.ts`
- `apps/skillset/src/activation-presentation.ts`
- `apps/skillset/src/__tests__/activation-cli.test.ts`
- `apps/skillset/src/__tests__/fixtures/activation/provider-outputs.json`
- [SET-131](https://linear.app/outfitter/issue/SET-131/research-mcp-and-app-install-or-activation-assistance-without-runtime)
- [SET-390](https://linear.app/outfitter/issue/SET-390/define-registry-backed-activation-readiness-and-static-planning)
- [SET-391](https://linear.app/outfitter/issue/SET-391/add-bounded-provider-activation-evidence-adapters)
- [SET-392](https://linear.app/outfitter/issue/SET-392/expose-activation-readiness-through-status-explain-and-lookup)
- [SET-393](https://linear.app/outfitter/issue/SET-393/bind-activation-readiness-to-current-declared-runtime-proof)
