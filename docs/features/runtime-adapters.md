# Runtime Adapters

Feature id: `runtime-adapters`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Runtime adapters describe how a Skillset projection can be used by an actual agent runtime, distribution surface, or harness. They are deliberately separate from `compile.targets`.

## Status

Runtime adapter records are `planned`. The registry can now describe runtime support, but Skillset still only builds the Claude and Codex target projections. Gemini, Cursor, Devin, Droid, and OpenCode are tracked as runtime candidates, not build targets.

## Authoring

Authors do not add runtimes to `compile.targets`:

```yaml
compile:
  targets:
    - claude
    - codex
```

Future runtime and distribution configuration should live beside compilation, not inside it. A runtime can consume a target projection, a distribution package, a generated activation test harness, or a manual install path, but it should not change what `compile.targets` means.

## Schema

Runtime support records live in the feature registry as `runtimeSupport` rows. A row names the runtime, support status, mechanism, evidence, caveats, setup requirements, and diagnostics.

```ts
{
  runtimeSupport: {
    "codex-cli": {
      status: "shimmed",
      mechanism: "Skillset renders Codex TOML agents and inserts a skill-loading preface.",
      caveats: [
        "Codex receives skill-loading intent as developer instructions; it is not target-enforced skill metadata.",
      ],
    },
  },
}
```

`shimmed` is intentionally distinct from `degraded`. A shim is a deliberate compatibility mechanism that can work in practice but is not enforced by the target. A degraded lowering loses important target semantics.

## Target And Runtime Boundary

| Concept | Meaning | Current examples |
| --- | --- | --- |
| Build target | A provider projection Skillset can lower directly. | `claude`, `codex` |
| Runtime adapter | A concrete runtime or harness that can consume a projection or compatibility shim. | `claude-code`, `codex-cli`, `codex-app` |
| Distribution surface | A repo, marketplace, extension root, or package shape a projection may be synced into. | Implemented `distributions.*` plan config; sync/publish remains future |
| Activation harness | A generated test surface that asks whether a runtime notices or invokes a skill, agent, or plugin. | Implemented manual activation probe assets under `skillset test`; runtime execution remains future |

The test: adding a runtime must not make `compile.targets` accept a new value. It should add evidence and support records first, then a specific adapter or distribution flow only when the target behavior is proven.

## Runtime Support

| Runtime | Status | Notes |
| --- | --- | --- |
| Claude Code | `native` for current Claude target projections | Claude project agents, plugin agents, plugin manifests, skills, hooks, and related surfaces remain target-native Claude output. |
| Codex CLI | `native` for current Codex target projections, `shimmed` for some near-match behavior | Codex TOML agents are native. Claude-style agent skill metadata is approximated through deterministic developer-instruction prefaces. |
| Codex App | `externally_managed` where app/runtime activation is involved | Build can emit app definitions, but activation and trust stay outside build. |
| Cursor | `planned` | Needs current target docs and fixture evidence before Skillset claims lowering or distribution support. |
| Gemini CLI | `planned` | Needs current extension/distribution docs and fixture evidence before Skillset claims lowering or distribution support. |
| Devin | `future` | Tracked as a possible runtime, not a current target. |
| Droid | `future` | Tracked as a possible runtime, not a current target. |
| OpenCode | `planned` | Superpowers provides fixture evidence, but Skillset still needs target docs before claiming support. |

## Diagnostics

Runtime support diagnostics should name whether behavior is native, pass-through, transformed, shimmed, degraded, lossy, externally managed, unsupported, or planned.

When behavior is shimmed, diagnostics must identify the mechanism and caveat. For example, a Codex agent can receive an instruction to load skills first, but Skillset should not say Codex has native Claude-style agent `skills` metadata.

## Provenance

Runtime support records are registry evidence, not generated target files. Future distribution plans, activation probes, and doctor output can reference them, but ordinary build output should stay target-native and compact.

## Evidence

- [Feature registry](../adrs/drafts/20260604-feature-reference-and-schema-registry.md) - schema-backed support and evidence direction.
- [Agents](agents.md) - project-agent support and Codex skill-preface shim.
- [Tests and Evals](tests-and-evals.md) - activation/eval boundary.
- `fixtures/external/repos.yaml` - pinned external multi-runtime fixture manifest, including Superpowers.
