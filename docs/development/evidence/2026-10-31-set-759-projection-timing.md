---
description: Bounded current-host phase measurements for the historical deterministic-projection timeout, with explicit attribution limits.
---

# SET-759 Deterministic Projection Timing

The historical five-second timeout was **not reproduced** in nine current-source samples on the present Darwin arm64 host. Source copying and the two isolated builds dominate the measured projection phases; no observed phase explains the earlier timeout. This is a bounded unresolved investigation, not a timeout fix or a performance improvement.

[SET-759](https://linear.app/outfitter/issue/SET-759) records two earlier Bun 1.4.0 timeouts at historical commit `990079e85a93e903ca2fbaf957ce55f540e963a4`. That Git object is unavailable in the local clone. A cached 1.4.0 binary exists, but running it against newer source would not replay the historical workload. This investigation used the current pin and does not establish that the current hardware or load matches the original observation.

## Inputs and method

Capture: October 31, 2026, America/New_York (November 1, 03:40 UTC). Current source is `99f9c8f83e3ec81b83b4595444c89688496c8d0d`, tree `58a238cfb5749b88973ba38ab156a644165c8bfc`, with Bun 1.4.4. Host: Apple M4 Pro, 14 logical CPUs, 64 GiB memory, Darwin 27.2.0 arm64. The preceding full verification had terminated before sampling. The observed one-minute load was 4.83–5.07; other applications remained active. This was not an idle-machine or controlled cache experiment.

Three owner/fresh-checkout pairs ran in predeclared AB, BA, AB order, followed by three instrumented-clone samples. Every sample ran the original named self-hosted test through the repository sandbox and `scripts/measure-gate.ts`:

```bash
bun run test:sandbox -- bun test packages/core/src/__tests__/deterministic-projection.test.ts --test-name-pattern "proves the self-hosted workspace source selection deterministically"
```

The existing five-second per-test timeout, six assertions, temporary-output cleanup and source selection remained unchanged. Ten other tests were filtered out: these are named-test observations, not the entire conformance suite. All nine commands succeeded, each reporting one pass and no failures. No retries or discarded samples occurred.

The fresh control and instrumented checkouts were local clones at the exact revision. Dependencies were installed from the existing cache with `bun install --offline --frozen-lockfile --ignore-scripts`. The existing version-scoped interpreter was verified by version and SHA-256; its identity, source and dependency manifests, Git state and lock/pin digests were unchanged before and after sampling.

The selected `.skillset` and `skillset.yaml` inputs matched across all three checkouts: 1,063 files and 2,493,226 bytes, with identical file contents and modes. The census excluded the runner's `.skillset/cache` and `.skillset/snapshots` subtrees. Its SHA-256 is `1a8019a7076711e10316e735e8d1c6b0885556048b2e7b15c954142bf2467bc3`, calculated over sorted records of relative path, kind, permission mode, byte length and SHA-256, serialized with Python's sorted-key JSON defaults. This census includes filesystem files rather than assuming a clean Git diff proves selected-source identity.

The two fresh dependency trees matched exactly. The owner had 372 additional stale Bun 1.4.0 type-package files and 12 permission-only differences in dependency executables (0777 versus 0755); every shared dependency file's bytes matched. These differences are disclosed, not normalized away or blamed for timing. No selected-source modes differed.

## Attribution and observed command times

[Machine-readable observations](2026-10-31-set-759-measurements.json) retain all samples, host loads, input identities, attribution reasons, phase measurements and raw report/log hashes. This is a normalized extract; the unmodified raw harness files and complete inventories remain local. Absolute checkout/interpreter paths are omitted from the published extract.

| Checkout | Sample 1 command / runner ms | Sample 2 command / runner ms | Sample 3 command / runner ms | Attribution |
| --- | --- | --- | --- | --- |
| Existing owner | 1066.35 / 1000 | 1065.74 / 1004 | 1069.11 / 1008 | Diagnostic only: pre-existing untracked outcome note makes the tree dirty |
| Fresh control | 1086.62 / 1022 | 1083.40 / 1020 | 1058.95 / 997 | Harness attributable to the clean exact commit |
| Instrumented clone | 1093.67 / 1031 | 1068.58 / 1004 | 1081.91 / 1017 | Diagnostic only: instrumentation modifies the module |

Command time includes the sandbox wrapper and process startup. Runner time is Bun's whole single-test-run summary, including module loading, test assertions and cleanup; it is not a separately measured test-body duration. No speedup, statistical difference or cache condition is inferred from these three samples per condition. The instrumented and owner runs explicitly retain `attributable: false`; they must not be presented as clean-commit performance receipts. CPU totals are not used for the conclusion.

## Instrumented phase observations

The [retained patch payload](2026-10-31-set-759-instrumentation.json) was applied only to a disposable clone. The JSON payload retains the exact unified diff and its SHA-256 without introducing trailing whitespace from blank diff-context lines. It records monotonic boundaries around the existing operations, preserves awaited order and both comparisons, and emits one JSON record after the function completes. The production module, test file, timeout, hooks and CI remain unchanged. An independent method review found no ordering or assertion change.

| Phase, milliseconds | Sample 1 | Sample 2 | Sample 3 |
| --- | --- | --- | --- |
| Initial graph and copy exclusions | 41.05 | 40.31 | 41.10 |
| Left plus right source copy | 350.64 | 332.68 | 339.16 |
| Left plus right separate graph loads | 64.67 | 64.01 | 64.22 |
| Left plus right isolated builds | 367.97 | 361.38 | 363.69 |
| Output-tree plus operation-result comparison | 21.73 | 21.79 | 23.56 |
| Instrumented function total | 847.56 | 820.66 | 832.20 |

The function total includes root creation and unlisted orchestration overhead, but excludes the test's later manifest assertions and recursive cleanup because the test requests `keepTemp: true`. The build phase includes all work within `buildSkillsetResult`, not pure rendering. Copy time includes traversal/filtering and copying, so it does not isolate filesystem latency. Instrumentation itself adds overhead and these phase samples are not exact unmodified-tree evidence.

## Disposition and next evidence

Current selected-source runs are comfortably below the existing bound, but they cannot explain or disprove the historical 1.4.0 observations. There is no evidence here to raise the timeout, remove coverage, add retries, blame Dagger or filesystem latency, or claim a production repair.

A later recurrence should retain the exact failing source, resolved interpreter, host/load and last completed phase before altering behavior. An exact historical replay needs the missing commit/workload and original-condition evidence; comparing current 1.4.4 success with historical 1.4.0 failure is not a controlled runtime comparison. This report supplies the issue's permitted bounded unresolved outcome, with draft integration and any follow-up diagnosis still distinct from a root-cause fix.
