---
id: 2
slug: cursor-is-a-first-class-provider
title: Cursor Is a First-Class Provider
status: accepted
created: 2026-07-02
updated: 2026-07-20
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1]
---

# ADR-0002: Cursor Is a First-Class Provider

## Context

Skillset originally treated Cursor as a runtime candidate while Claude and Codex
were the only compile targets. That was a reasonable boundary while Cursor
evidence was thin. It is no longer the truth: the schema target registry,
Core target descriptors, provider registry snapshots, renderers, conformance
fixtures, import paths, generated-output checks, and runtime-test command now
all have a Cursor-specific contract.

Cursor is not a Claude- or Codex-shaped alias. Its project skills, `.mdc` rules,
agents, `.cursor-plugin` bundle, hook event names, marketplace, and MCP
destination are native Cursor surfaces. Cursor also has material limits. For
example, portable and Cursor-native tool policy is retained as `metadata_only`
rendering where Cursor does not enforce it, `readonly: true` is a
settings-required fact that build does not write, and Cursor per-skill MCP
enforcement remains unsupported. Those differences must remain visible instead
of being hidden by a narrower default target set.

The remaining policy question was whether Cursor should be opt-in when
`compile.targets` is omitted. The decision follows the accepted source-first
and root-compile doctrine: supported first-class targets participate by default,
while explicit `compile.targets` narrows output for repositories that need a
smaller projection.

## Decision

Cursor is a first-class Skillset compile target and is included when
`compile.targets` is omitted.

`@skillset/schema` owns this default through
`DEFAULT_TARGET_NAMES = TARGET_NAMES`, in canonical order `claude`, `codex`,
`cursor`. Core and application surfaces consume that schema-owned value; they
must not maintain Cursor-specific default lists. An explicit root
`compile.targets` list remains the only supported way to narrow provider output.

Parity means faithful target-native rendering where the target supports the
authored intent, plus explicit and testable classification elsewhere. It does
not mean that Cursor exposes every native capability of Claude or Codex. This
means:

- Cursor project skills render to `.cursor/skills/<skill>/SKILL.md`, rules to
  `.cursor/rules/**/*.mdc`, agents to `.cursor/agents/*.md`, and plugin bundles
  to `plugins/<plugin>/cursor/` with `.cursor-plugin/plugin.json`.
- Registry-backed features may render as native, transformed, or
  `pass_through` only when their Cursor destination evidence supports that
  result.
- Information that Cursor cannot enforce is reported as `metadata_only`
  rendering (and the corresponding `metadata-only` realization tier) rather
  than claimed as native behavior.
- Target behavior that requires configuration outside a build remains
  `settings-required`; build does not install, trust, or write user-level
  Cursor configuration.
- Unsupported Cursor destinations remain unsupported and follow the visible
  `compile.unsupportedDestination` policy. They do not silently disappear and
  `force` does not make them portable.

The runtime proof for this decision is a real local `cursor-agent` invocation
through `skillset test` against an isolated generated workspace and local
generated plugin directory. The command must retain its status, report, and
tail artifacts in the Skillset-owned XDG cache and prove both generated plugin
routing and a successful minimal response. A fake executable remains valid for
deterministic unit coverage but is not parity-gate runtime evidence.

## Concrete Evidence

The merged Cursor correctness prerequisite series is PRs
[#299](https://github.com/outfitter-dev/skillset/pull/299) through
[#305](https://github.com/outfitter-dev/skillset/pull/305), including the
verified merges `c3123238`, `a2d42102`, `d7468f11`, `97165bfc`, `78328aec`,
`2bd969f0`, and `0ea4c96b`. It established Cursor target lists, native
destinations and islands, provider evidence, fixtures, and target topology
without adding a fake compatibility fallback.

The default-output regression in
`apps/skillset/src/__tests__/skillset.test.ts` builds source with omitted
`compile.targets` and proves Claude, Codex, and Cursor outputs appear in the
schema's canonical order. `apps/skillset/src/__tests__/try.test.ts` covers the
same runtime routing shape deterministically with a fake Cursor executable:
`--print --output-format json --mode ask --trust --workspace` and an explicit
generated `--plugin-dir`.

### Runtime Smoke Record

The accepted real local smoke is recorded in the
[SET-313 Cursor runtime smoke receipt](../evidence/2026-07-20-set-313-cursor-runtime-smoke.md).
`skillset test` run
`20260720T195201Z-set313-sandboxed-relocated-config-cursor-agent-d715891d`
built the isolated `set313-cursor-smoke` fixture and its generated local Cursor
plugin, then invoked this safe command shape:

```text
cursor-agent --print --output-format json --mode ask --trust \
  --workspace <isolated latest> \
  --plugin-dir <isolated latest>/plugins/set313-cursor-smoke/cursor \
  <marker prompt>
```

The generated plugin route was
`<isolated latest>/plugins/set313-cursor-smoke/cursor`, whose manifest is
`.cursor-plugin/plugin.json`. The retained status records `state: passed` and
exit `0`. Its normalized result contained `SET313_CURSOR_PLUGIN_SMOKE_OK` after
a brief skill-lookup preamble. That is the declared Skillset runtime contract:
`contains` and `notContains` assertions use substring inclusion and exclusion;
no exact-response assertion was declared.

The one-time local harness inherited authenticated `HOME` unchanged, redirected
Skillset cache plus version-specific Cursor data/config roots beneath a fresh
temporary root, and denied file writes elsewhere. Project, config, Statsig, and
chat state appeared beneath that root. The sandbox denied a hardcoded built-in
skill-sync manifest write and version-scoped background-updater lock write;
both remained nonfatal, all checked normal-home metadata remained unchanged,
and pre/post outside-write canaries remained effective.

The receipt preserves the exact hashes, canaries, earlier failed attempts,
redaction boundary, and accepted brokered-service residual. This sandbox and
its hidden provider roots are local merge evidence only. They are not Skillset
product configuration or an ordinary runtime promise.

## Consequences

### Positive

- Authors get one default provider plan for all current first-class targets and
  can narrow it explicitly when needed.
- Cursor output stays Cursor-native while registry, render-result, and lock
  evidence make narrower capabilities inspectable.
- Default behavior, `init`/`create` flows, schema artifacts, and generated
  output no longer carry competing Cursor policies.

### Tradeoffs

- Repositories that omit `compile.targets` receive Cursor artifacts and must
  review them like the existing Claude and Codex artifacts.
- A successful build proves rendering and visible classification, not that every
  Cursor capability has identical behavior after activation.
- Real runtime proof depends on a locally authenticated `cursor-agent`; its
  redacted receipt is required for this gate but the local harness is
  intentionally not part of ordinary deterministic CI.

### Non-Goals

- This decision does not claim native parity for metadata-only,
  settings-required, or unsupported Cursor behavior.
- It does not install plugins or invoke an explicit Cursor configuration-mutating
  command. The smoke inherited ordinary authentication while its Skillset and
  provider write-state was confined by a local sandbox. That bounded proof does
  not claim every pre-opened descriptor or brokered-service side effect is
  observable, and it does not make the hidden provider roots public Skillset
  configuration.
- It does not refresh broad user-facing Cursor narrative; that reconciliation
  remains owned by SET-339.
- It does not amend ADR-0001. ADR-0001 already establishes root compile policy;
  this ADR records the Cursor-specific evidence and application of that policy.

## References

- [Tenets](../tenets.md) - source-first, provider-native, and fail-loud doctrine.
- [ADR-0000: Source-First Loadouts](0000-source-first-loadouts.md) - source
  remains the product and output remains target-native.
- [ADR-0001: Root Compile Policy](0001-root-compile-policy.md) - root
  `compile.targets` selection and defaults this decision applies to Cursor.
- [Feature Reference and Schema Registry](0005-feature-reference-and-schema-registry.md) - registry-backed capability claims and evidence.
- [Agent / Subagent Source Model](0006-agent-source-model.md) - project and plugin agent boundaries.
- [Render Results](0018-render-results.md) - visible transformed, metadata-only, and unsupported outcomes.
- [Provider Surface Evidence Matrix](../target-surfaces.md#cursor-provider-baseline) - current Cursor destinations and verification notes.
- [Runtime Adapters](../features/runtime-adapters.md) - target/runtime and retained-test boundary.
- [Cursor headless CLI docs](https://cursor.com/docs/cli/headless) - non-interactive CLI mode, checked 2026-07-02.
