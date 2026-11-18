# Bun upgrade baseline — SET-770

Status: initial evidence captured; full-gate qualification remains incomplete.

## Identity and retained evidence

The clean starting revision is `771bb00572a8aeff9f3e3287a6d80dbd71d21274`,
tree `501ab4098b392b81c5e53625624ef4b941c7b89e`, based on trunk
`24800e02ed4e7150ea1bc7130c35603c98ea9da2`. The lock SHA-256 is
`f56d07d5830859e4a30e91a8e0ef4a7aabe5daecddb99bf149a15d7c1d16c83c`.
Host: Darwin 27.2.0, arm64, Apple M4 Pro, 14 CPUs. Frozen install succeeded
under `/Users/mg/.cache/skillset/bun/darwin-arm64/1.4.0/bin/bun`.

Local raw evidence lives in the execution worktree
`/Users/mg/Developer/outfitter/skillset-astra/.skillset/cache/`:

- `measure/set-770-bun-140-baseline-2026-10-29T15-24-33-589Z-aa1c41cb.json`
  and its log: full `bun run check`, attributable, interrupted after 300.67 s,
  exit 143. Guards, typecheck and package build passed before the test phase.
  Pending-ledger merge timed out, then later tests timed out while the test
  process consumed about 1,275% CPU. This is not a green gate or speed benchmark.
- `bun-baselines/pending-ledger-focused-140.log`: the two tests failed at their
  existing 15-second limits on 1.4.0. The explicit candidate log
  `pending-ledger-focused-144-explicit.log` reproduces the overlap timeout on
  1.4.4. SET-774 owns the bounded test repair and full baseline rerun.
- `measure/set-770-bun-140-projections-v2-2026-10-29T15-31-10-372Z-87795864.json`
  and `measure/set-770-bun-144-runtime-only-projections-2026-10-29T15-32-38-280Z-ac9ee153.json`
  record attributable projection captures and index digests.
- `bun-baselines/bun-140-v2/` and `bun-baselines/bun-144-runtime-only/` contain
  runtime identity, per-run build results, resolved graphs, raw-byte manifests,
  conformance reports and failure records. Raw retained trees are under
  `/Users/mg/Developer/outfitter/skillset-astra-evidence/<capture-label>/`.
- `bun-baselines/runtime-only-comparison.json` SHA-256:
  `0ed14d053e94bd94e13b66f4a3ff9b4c6834c877baff6117573b30d8afca3e08`.

The disposable capture invocation uses existing `runDeterministicProjection`
with `keepTemp`, `tempParentPath` and `afterProjection`. Raw manifests hash the
original bytes, including locks; they do not rely on the conformance helper's
JSON normalization. Graph comparison replaces only each temporary workspace
prefix. The capture script SHA is recorded in `runtime.json`. This is local
evidence invocation, not a new committed test framework.

Both comparisons use unchanged source and dependencies. The candidate is the
versioned Homebrew executable `/opt/homebrew/Cellar/bun/1.4.4/bin/bun`, invoked
explicitly through `env` inside the canonical sandbox. The normal sandbox
deliberately replaces a direct executable named `bun` with the repository pin;
the earlier `pending-ledger-focused-144.log` therefore actually ran 1.4.0 and
is not candidate evidence. The repository pin remains 1.4.0.

## Projection results

| Source | Generated files | Cross-runtime result |
| --- | ---: | --- |
| Self-hosted `.skillset/` | 95 | Raw bytes/modes and resolved graph identical |
| `fixtures/kitchen-sink` | 26 | Identical |
| `fixtures/authoring-model` | 55 | Identical |
| `fixtures/cursor-parity` | 25 | Identical |
| `fixtures/standards-adoption` | 12 | Identical |
| `examples/first-author` | 8 | Identical |
| `fixtures/adaptive-hooks` | — | Same conflicting Claude/Codex hook writers |
| `fixtures/workbench-clean` | — | Same rejected legacy resource path |
| `fixtures/workbench-invalid` | — | Same intentionally invalid config diagnostics |

Each successful case also passed same-runtime two-root deterministic comparison.
The first capture attempted a temp destination beneath `.skillset/cache`; the
self-host copy correctly refused copying into itself. Moving temp trees outside
the repository fixed the invocation. Other first-capture outputs inherited Git
ignore context and emitted extra automatic SessionStart hooks. Those captures
are retained but excluded from the cross-runtime comparison. Version 2 uses the
same outside-repository topology for both runtimes; Git-context-sensitive hook
behavior must still be covered by normal lifecycle/golden-path tests.

All tracked top-level fixture workspaces and the first-author example were
attempted. Plugin-local configs are covered within their parent fixtures.
External network fixtures were not run; they remain an explicitly selected
slow lane. No coverage threshold exists in ordinary scripts; coverage has not
been collected or rebaselined. Complete test identities/results remain pending
the repaired full-gate run.

## Applicability map

- Compiler YAML parse/render uses `packages/core/src/yaml.ts`; authored edits
  preserve the `yaml` AST in `source-document.ts`. Workbench's `parser.ts` uses
  Bun YAML/TOML. Scalar/invalid-input parity deserves focused regression proof.
- Generated TOML has a local serializer plus Bun validation in
  `structured-output.ts`; errors already have general catches. Do not quote
  boolean/number values or replace nonexistent BuildMessage checks.
- Actual Bun glob patterns in change entries/status, package metadata and docs
  are ordinary `*.md`, `**/*` and workspace paths. Core discovery uses sorted
  filesystem traversal. Compare membership; no current extglob pattern requires
  speculative escaping.
- Source/output hashes include raw bytes and path/mode facts (`build.ts`,
  `output-safety.ts`). Preserve algorithms and edit/collision protection.
- Native compilation uses `--compile --minify`; reproducibility and smoke tests
  already exist. FFI uses `dlopen`, not `cc`. Publishing is npm with tags and
  provenance. Consumer floor and repository pin are distinct policies.
- `skillset dev` uses `node:fs.watch`; only the old `--watch` flag is retired.
  CLI color is explicit, and width/wrapping already use Bun built-ins.
- No production Bun JSONC/JSON5/Markdown/TOML.stringify or shell interpolation
  was found. `resetAllMocks` is unused. Optional adoption belongs to SET-773.
- The [1.4.4 filesystem fixes](https://bun.sh/blog/bun-v1.4.4#nodefs) warrant
  containment probes for realpath through symlinks and literal POSIX backslashes.
  Existing path tests cover direct escaping symlinks but not those combinations.
- Existing subprocess, native, frozen-install and atomic-rename suites cover
  substantial [1.4.1](https://bun.sh/blog/bun-v1.4.1) and
  [1.4.3](https://bun.sh/blog/bun-v1.4.3) runtime exposure. Optional bounded pipe
  backpressure and constrained-Linux concurrency probes should follow actual
  risk; do not invent broad infrastructure for upstream fixes.

## Remaining proof

Repair SET-774, complete and classify the full 1.4.0 baseline, check parser and
actual-glob membership probes, then proceed through SET-603/771/772. No runtime
upgrade, fixture regeneration, release or readiness transition is claimed here.
