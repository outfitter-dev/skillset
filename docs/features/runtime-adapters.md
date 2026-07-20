# Runtime Adapters

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `runtime-adapters` | `planned` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:feature-support:end -->

Feature id: `runtime-adapters`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Runtime adapters describe how a Skillset rendering can be used by an actual agent runtime, distribution surface, or harness. They are deliberately separate from `compile.targets`.

## Status

Runtime adapter records describe how a generated provider rendering can be
smoke-tested or consumed by a concrete runtime. `skillset test` can
run non-interactive Claude, Codex, and Cursor prompts against isolated local
renderings while retaining inspectable run artifacts under the logical
`.skillset/cache/tests/ad-hoc` path.

Cursor is a first-class provider target, not a runtime-only compatibility
candidate. It participates in the default provider plan alongside Claude and
Codex; explicit `compile.targets` narrows that provider set when a repo wants a
smaller projection.

## Authoring

Authors do not add runtimes to `compile.targets`:

```yaml
compile:
  targets:
    - claude
    - codex
```

Future runtime and distribution configuration should live beside compilation, not inside it. A runtime can consume a target rendering, a distribution package, a generated activation test harness, or a manual install path, but it should not change what `compile.targets` means.

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

`shimmed` is intentionally distinct from `degraded`. A shim is a deliberate compatibility mechanism that can work in practice but is not enforced by the target. A degraded render loses important target semantics.

## Target And Runtime Boundary

| Concept | Meaning | Current examples |
| --- | --- | --- |
| Build target | A provider rendering Skillset can render directly. | `claude`, `codex`, `cursor` |
| Runtime adapter | A concrete runtime or harness that can consume a rendering or compatibility shim. | `claude-code`, `codex-cli`, `codex-app`, `cursor` |
| Distribution surface | A repo, marketplace, extension root, or package shape a rendering may be synced into. | Implemented `distributions.*` plan config; sync/publish remains future |
| Activation harness | A generated test surface that asks whether a runtime notices or invokes a skill, agent, or plugin. | Declared assertions and ad hoc non-interactive runs share the `skillset test` family. |

The test: adding a runtime must not make `compile.targets` accept a new value. It should add evidence and support records first, then a specific adapter or distribution flow only when the target behavior is proven.

## Runtime Support

| Runtime | Status | Notes |
| --- | --- | --- |
| Claude Code | `native` for current Claude target renderings | Claude project agents, plugin agents, plugin manifests, skills, hooks, and related surfaces remain target-native Claude output. |
| Codex CLI | `native` for current Codex target renderings, `shimmed` for some near-match behavior | Codex TOML agents are native. Claude-style agent skill metadata is approximated through deterministic developer-instruction prefaces. |
| Codex App | `externally_managed` where app/runtime activation is involved | Build can render app definitions, but activation and trust stay outside build. |
| Cursor | `native` for current Cursor target renderings | Runtime smoke uses the local `agent` / `cursor-agent` CLI with isolated workspaces, `--print`, `--output-format json`, `--mode ask`, `--trust`, `--workspace`, and `--plugin-dir`. |
| Gemini CLI | `planned` | Needs current extension/distribution docs and fixture evidence before Skillset claims rendering or distribution support. |
| Devin | `future` | Tracked as a possible runtime, not a current target. |
| Droid | `future` | Tracked as a possible runtime, not a current target. |
| OpenCode | `planned` | Tracked as a possible runtime, but Skillset still needs target docs before claiming support. |

## Diagnostics

Runtime support diagnostics should name whether behavior is native, pass-through, transformed, shimmed, degraded, lossy, externally managed, unsupported, or planned.

When behavior is shimmed, diagnostics must identify the mechanism and caveat. For example, a Codex agent can receive an instruction to load skills first, but Skillset should not say Codex has native Claude-style agent `skills` metadata.

`skillset test status` reports live harness state as `queued`, `building`, `running`, `passed`, or `failed`, and `skillset test tail` reads retained output from the logical `.skillset/cache/tests/ad-hoc` path backed by XDG storage.

## Provenance

Runtime support records are registry evidence, not generated target files. Distribution plans, activation probes, and status output can reference them, but ordinary build output should stay target-native and compact.

## Evidence

- [Feature registry](../adrs/drafts/20260604-feature-reference-and-schema-registry.md) - schema-backed support and evidence direction.
- [Cursor provider ADR](../adrs/drafts/20260702-cursor-is-a-first-class-provider.md) - first-class Cursor provider contract.
- [Provider Surface Evidence Matrix](../target-surfaces.md#cursor-provider-baseline) - Cursor evidence baseline and milestone boundary.
- [Agents](agents.md) - project-agent support and Codex skill-preface shim.
- [Tests and Evals](tests-and-evals.md) - activation/eval boundary.
- `fixtures/external/repos.yaml` - pinned external adoption fixtures across current targets.
