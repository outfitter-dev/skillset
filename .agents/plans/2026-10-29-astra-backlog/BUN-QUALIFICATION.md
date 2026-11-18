# Bun 1.4.4 qualification — SET-772

Status: runtime and compatibility evidence supports continued development;
aggregate and native release qualification remain incomplete. Matt explicitly
deferred native trimming to SET-775 without changing the budget or passing the
failed gate. PRs remain draft; no release or readiness transition is authorized.

## Identity

Qualification production/test head: `e24ad983635fc1a4f27b9d83c58dfd3759b4ea3e`.
This layer adds evidence records only. Bun is 1.4.4 on Darwin arm64; the consumer
floor remains 1.4.0. [Compatibility evidence](BUN-COMPATIBILITY.md) records the
lock digest, baseline comparison and output-safety results. The reviewed SET-774
fold-state repair is integrated at `d918da16b`; current owned parent ancestry is
verified. Historical full-gate results preceded that test-only repair; its
focused two-runtime proof passed, as did the restacked focused invocation.

Raw evidence is retained under `.skillset/cache/bun-baselines/` with the
`set-772-` prefix. The native manifest is under
`.skillset/cache/native-qualification-all/`, records the exact head above, and
has SHA-256 `d81681b0c7a478aa50a4842bff5b615a5cd618c8cd9a958a3326635a09dd23fb`.

## Local evidence

| Surface | Command/evidence | Result |
| --- | --- | --- |
| Full gate before fold-state repair | `bun run check`, `set-771-full-check.log` | 3803 pass, 2 skip, 4 todo, 3 native-size failures; 3812 tests / 336 files, one snapshot |
| Current focused repair/compatibility | `test:focused`, `set-771-restack-focused.log` | Pass; no production change from restack |
| Parallel applicability | Same four parser/YAML/path/source-inventory files, serial and `bun test --parallel=2` under sandbox | Both 31 pass / 101 assertions; no policy change or performance claim |
| Source CLI and process behavior | Existing presentation, lookup/reconcile PTY and process suites | 17 pass / 755 assertions, including cancellation and cleanup |
| Source and native CLI | Controlled pipe, 80-column TTY and TTY with NO_COLOR; help/version/unknown command | 18 cases pass, expected exits 0/0/2, TTY color present, NO_COLOR and pipe output uncolored |
| Native runtime smoke | `native:smoke -- --target darwin-arm64` | Pass, including sentinel Bun PATH and runtime-hook behavior |
| Package entrypoints | `scripts/package-smoke.ts` under explicit 1.4.0 and pinned 1.4.4 | Both pass bunx and isolated global-bin help/version smoke |
| JavaScript consumer build | Packaged `apps/cli/dist/cli.js`, copied first-author source only, explicit 1.4.0 and 1.4.4 | Both fresh builds write 8 files, check passes, repeat writes 0, second check passes |
| Safe publication preflight component | `bun run test:sandbox -- bun scripts/publish.ts check` | Pass; release package set and packaging validation only |
| Composite publication preflight | `publish:check` includes the failed full check | Not green; no publication attempted |
| Generated/docs/typecheck | Fresh build, check, CI report, docs and typecheck | Pass, zero self-hosted generated writes |

The CLI probe report SHA-256 is
`1bf94c41e980ce036abe8068e8765db5edd6bcc82b4b638815027ffa7ef136b8`.
There is no FORCE_COLOR contract in the CLI's terminal-color policy; supported
TTY, NO_COLOR and TERM behavior is tested. No broad color stripping, snapshot
refresh or coverage rebaseline was used. Concurrent ledger assertion counts
vary with scheduling and are not coverage or speed evidence.

The first consumer-build probe copied existing outputs and wrote zero files;
it is retained but does not establish fresh generation. The `*-fresh-build-check`
logs supersede it and copy only `.skillset` plus `skillset.yaml`.

## Native matrix and remaining gates

`build:native -- --required --reproducible --out-dir
.skillset/cache/native-qualification-all` built every required target twice.
The builder's byte comparisons passed before archive creation. The final
verification then failed on the first size-policy violation. This is a failed
command with successful compilation/reproducibility substeps, not a passed
native release build.

| Target | Raw bytes | Execution evidence |
| --- | ---: | --- |
| darwin-arm64 | 90,398,208 | Matching local host: native smoke and controlled TTY pass |
| darwin-x64 | 99,915,904 | Local launch fails EBADARCH; matching-host smoke pending |
| linux-arm64-glibc | 110,939,128 | Disposable Debian container: help/version, fresh build/check and repeat pass |
| linux-x64-glibc | 110,880,944 | Same container smoke under local emulation; matching-host evidence pending |
| windows-x64 | 117,029,888 | Compilation only; matching-host smoke pending |

Debian image index reported by both pulls:
`sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3`.
Containers mounted artifacts and probe read-only and were removed on exit. No
Bun interpreter was installed in them. The image lacks Git, so known-Skillsets
index-update warnings remain in the logs; they did not prevent compilation or
check. These smoke probes are narrower than the full release-host matrix.

The unchanged Darwin arm64 budget allows 71,373,720 bytes. The 90,398,208-byte
result remains over budget; no baseline was changed. Three cross-build runtime
stub files left in the worktree were moved into ignored local evidence storage,
not committed or deleted from unrelated locations.

Hosted PR #740 at its original `63af1a0a1` head passed draft fast, generated,
Changesets, provider validation, Windows scripts and both Alpine directory
installation architectures. Those are historical-head results after restacking.
Full check and native release jobs were skipped, not passed. Current-head draft
CI, full verification receipts, matching-host native execution and native-size
acceptance must be reported separately during settlement.

## Recovery boundary

The last pre-pin owned production checkpoint was `a84158945` (now represented
by the repaired/restacked SET-774 layer `d918da16b`). The pin/types/CI image/docs
change is isolated in SET-603, before the compatibility/evidence layers. A
rollback decision should revert that coherent layer and reconcile dependent
tests; it must not edit a ledger, reset another owner's branch or publish a
replacement package automatically.
