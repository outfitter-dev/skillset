---
slug: post-tools-policy-boundary
title: Post-Tools Policy Boundary
status: draft
created: 2026-07-05
updated: 2026-07-05
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, portable-agent-authority-intent, lowering-outcomes-and-loss-ledger, feature-reference-and-schema-registry, reviewed-settings-suggestions, cursor-is-a-first-class-provider]
---

# ADR: Post-Tools Policy Boundary

## Context

Skillset now has a real portable `tools` source surface. It lets authors write
small source such as `tools: readonly` or `tools.write: false`, then renders the
strongest provider-native representation Skillset can prove. The provider facts
live in the tools realization registry, not scattered through docs and
renderers.

That creates a tempting next abstraction: a broader `policy` source family for
tool authority, sandbox settings, hooks, provider permissions, unsupported
destinations, activation checks, marketplace policy, and generated fallback
instructions. That would be premature. Those concerns are related, but they do
not all have the same owner or enforcement model:

- `tools` describes author intent for tool availability and preapproval.
- Provider-native `tools.<provider>.allow` / `deny` strings deliberately leave
  the adaptive layer.
- Provider config, trust, install, activation, and managed settings remain
  external to `skillset build`.
- Render results describe what a build actually did for each source unit,
  target, destination, policy, and output.
- `compile.unsupportedDestination` gates unsupported, lossy, and failed render
  results; only `error` is implemented today.

The failure mode is fake portability. If Skillset treats generated prose,
scripts, or metadata sidecars as policy enforcement, a build can look
synchronized while the provider still does not enforce the promised behavior.
If Skillset creates a broad `policy` family before the provider matrix is
settled, authors have to learn Skillset's internal buckets instead of writing
the one small semantic source key that matches their intent.

## Decision

Do not add a new policy source family for the next release line. The post-tools
policy boundary is this:

1. **Portable policy meaning starts in `tools`.** Use portable `tools` keys for
   author-facing tool availability and preapproval intent. Add new portable
   keys only when at least two providers have a meaningful realization and the
   key removes repeated provider authoring.
2. **Provider-native policy stays visibly provider-native.** Use
   `tools.<provider>.allow` / `deny`, provider blocks, target-native islands,
   or reviewed settings suggestions when the source is intentionally tied to
   one provider.
3. **Build truth belongs in render results.** Unsupported, lossy, degraded,
   metadata-only, shimmed, externally managed, skipped, and failed behavior must
   be visible in structured render results, diagnostics, reports, locks,
   `doctor`, or `explain`.
4. **Generated prose and scripts are never policy enforcement.** A Codex skill
   preface, an activation probe, a shimmed instruction, or a generated helper
   script can be useful compatibility material, but it cannot satisfy a policy
   enforcement claim unless the provider itself enforces that surface.
5. **`compile.unsupportedDestination` can soften unsupported/lossy render
   results only when provenance stays visible.** `error` remains the default,
   `failed` render results always block, and `warn`, `skip`, and `force` must
   preserve diagnostics and lock/report evidence.

This means `tools` can grow more capable without becoming a catch-all policy
object. Future provider surfaces such as Codex sandbox suggestions, Cursor
`readonly`, Claude permission modes, hook interception, MCP scoping, or managed
settings are realization facts behind a portable key, provider-native escape
hatches, or reviewed settings suggestions. They are not a reason to create a
parallel `policy.yaml` or `policy:` tree now.

### Provider Matrix

| Surface | Claude | Codex | Cursor | Boundary |
| --- | --- | --- | --- | --- |
| Portable `tools.read/search/write/shell/mcp` | Renders to skill frontmatter rules where supported | Emits reviewable `.skillset.tools.yaml` metadata until runtime enforcement is proven | Emits reviewable `.skillset.tools.yaml` metadata until runtime enforcement is proven | Portable source; realization tier must come from the registry. |
| `tools.<provider>.allow` / `deny` | Native Claude rule strings | Target-native metadata only today | Target-native metadata only today | Provider-native escape hatch; not portable. |
| `allowed_tools` | Claude preapproval escape | Rejected unless explicitly disabled | Rejected unless explicitly disabled | Legacy/native source, not the portable policy model. |
| Project-agent skill orchestration | Native `skills` metadata | Shimmed developer-instruction preface | Native project-agent metadata | Shimmed Codex prose is compatibility material, not policy enforcement. |
| Provider config, trust, install, managed settings | Reviewed suggestion or external workflow | Reviewed suggestion or external workflow | Reviewed suggestion or external workflow | Externally managed; build must not mutate live runtime authority. |
| Unsupported plugin components such as unsupported `bin` or `agents` destinations | Target-native where documented | Structured `unsupported:error` render result | Structured `unsupported:error` when unsupported | Governed by render-result policy, not `tools`. |
| Adaptive hook attachments without a faithful target destination | Native or transformed where supported | Structured unsupported/degraded result where unsupported | Native or transformed where supported | Hook fallbacks must not be called enforcement. |

### SET-18 Implementation Bar

SET-18 can enable `warn`, `skip`, and `force` because the implementation proves
these facts for every affected render result:

- source unit and source path;
- provider target;
- destination or scope;
- feature id or event;
- unsupported/lossy/failed reason;
- selected unsupported-destination policy;
- provider evidence or registry row that justified the classification;
- outputs written, outputs skipped, or clear no-output provenance;
- surfaced diagnostic refs in JSON and text output.

The semantics are:

| Policy | Required behavior |
| --- | --- |
| `error` | Current behavior: fail build, diff, and verify before generated-output freshness can look clean. |
| `warn` | Write supported outputs, keep unsupported/lossy facts visible, and make warning counts machine-readable. |
| `skip` | Write supported outputs, omit unsupported outputs, and record the skipped source/destination in locks and reports. |
| `force` | Allow the build to continue with explicit unsupported/lossy provenance; never pretend unsupported portable behavior became faithful. |

If an enabled target would produce no usable output under a non-error policy,
the command must still fail. A clean build with no output is silent drift in a
different costume.

### The Test

Ask two questions before adding any policy-like source:

1. Is this author-facing intent already expressible as `tools`, a provider
   block, a target-native island, or a reviewed settings suggestion?
2. Can the provider enforce the behavior, or are we only generating prose,
   metadata, or helper material?

If the provider cannot enforce the behavior, the implementation may still emit
useful compatibility output, but the render result must say `metadata_only`,
`degraded`, `unsupported`, `externally_managed`, or another honest status.

## Consequences

### Positive

Authors keep one small tool-policy surface instead of learning a second policy
tree. Provider-native differences remain visible, and the compiler's public
contract lines up with the tenets: source is portable where the provider truth
supports it, and unsupported behavior is visible instead of papered over.

SET-18 becomes an implementation problem with a crisp bar: provenance first,
softer unsupported-destination policies second. That makes `warn`, `skip`, and
`force` safer to add because they cannot hide lost output.

### Tradeoffs

Some useful provider authority remains metadata-only, advisory, or externally
managed until Skillset has runtime evidence and reviewed settings flows. That
is less magical in the short term, but it prevents generated output from
claiming enforcement the provider does not supply.

The `tools` registry has to carry more precise realization facts as providers
gain surfaces such as sandboxing, readonly agents, hook interception, or MCP
scope controls. That keeps complexity in internal evidence instead of the
authoring contract.

### What This Does NOT Decide

This ADR does not make `warn`, `skip`, or `force` override `failed` render
results. A compiler failure still means Skillset could not produce safe output.

This ADR does not define install, activation, trust, marketplace approval, or
managed-settings workflows. Those remain external or reviewed-suggestion
surfaces unless a later ADR deliberately changes the boundary.

This ADR does not freeze the portable `tools` vocabulary. It freezes the rule
that new portable policy meaning needs provider evidence and registry-backed
render truth.

## References

- [Tenets](../../tenets.md) - source-first, provider-native, fail-loud design principles.
- [ADR-0001: Root Compile Policy](../0001-root-compile-policy.md) - root provider selection and reserved unsupported-destination policy.
- [Portable Tools Policy and Agent Authority](20260702-portable-agent-authority-intent.md) - `tools` source shape and registry-backed realization model.
- [Lowering Outcomes and Loss Ledger](20260614-lowering-outcomes-and-loss-ledger.md) - render-result status and policy semantics that this ADR specializes.
- [Feature Reference and Schema Registry](20260604-feature-reference-and-schema-registry.md) - feature ids, support evidence, and conformance expectations.
- [Reviewed Settings Suggestions](20260604-reviewed-settings-suggestions.md) - authority-changing provider settings remain reviewed plans, not build side effects.
- [Cursor Is a First-Class Provider](20260702-cursor-is-a-first-class-provider.md) - Cursor provider evidence and activation boundary.
- [Tools Policy](../../features/tools-policy.md) - current authoring and realization reference.
- [Render Results](../../features/render-results.md) - current structured build-truth report.
