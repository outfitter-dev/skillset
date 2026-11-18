---
description: Records pinned before-and-after fixture comparisons, repeat behavior, and evidence limitations.
---

# SET-433 pinned external comparison

Code baseline `5b53799f470916d97eac13a4b7ecb8ab96762648`; historical inspections and fixture baselines are named where they differ. Test names cite evidence and are not claims that this documentation pass ran them. See the [overview](./2026-10-30-set-433-transform-inventory.md) for disposition categories and acceptance status.

## Pinned inputs

| Fixture | Repository | Ref | Selected targets |
|---|---|---|---|
| compound-engineering-plugin | https://github.com/EveryInc/compound-engineering-plugin | `4719dc509fdc45656a830e3ed6060f674e206076` | Claude |
| browserbase-claude-code-plugin | https://github.com/browserbase/claude-code-plugin | `b399af34a1b1cc365d1e1c0089823c4fa5e10ea5` | Claude |
| claude-review-loop | https://github.com/hamelsmu/claude-review-loop | `244f4c7bc15e98552af7cc5a67e70dfcdea9ab12` | Claude |
| cursor-browser-motion-plugin | https://github.com/dusa89/cursor-browser-motion-plugin | `c892f0982756e4d39ad4a007b0aa0e45908b88f1` | Cursor |
| mattpocock-skills | https://github.com/mattpocock/skills | `00ff03cac21a8a845b06256d826d183122f58c5e` | Claude |
| emilkowalski-skills | https://github.com/emilkowalski/skills | `de33dbed000212b54400a33767d1e4d03654db2a` | Claude, Codex |
| last30days-skill | https://github.com/mvanhorn/last30days-skill | `3fa91fce9009731ed68e2e8a14ce9683253720e8` | Claude, Codex |

The compiler was captured in a disposable shared clone with a frozen install. The first A run failed report identity because its disposable clone origin was a local path; that failed log was retained. Its origin was changed only inside the disposable clone to the existing real GitHub URL and A was rerun. B repeated with the same warm XDG; C used a fresh XDG. No original checkout or provider installation was changed. External fixture evaluation is opt-in (`bun run conformance:external`); this command may fetch/reset fixture clones and writes cache, so it is not a read-only reproducibility step.

## A/B/C repeat comparison

Across four successful fixture projections, 88 generated files were byte-identical between repeated A, B and C captures. A and C each contain 636 files in the captured comparison tree: 630 identical and six differing `.skillset/changes/state.json` files, whose observed JSON differences are per-scope `updatedAt`. A/B similarly differ in those six state files and four raw reports; the latter are affected by warm-cache write counts. This is not raw source byte determinism. ADR-0019 concerns deterministic projection outputs, locks, core facts and reports; these raw adoption-state timestamps do not establish an ADR-0019 violation. Retain and report raw variability, without claiming raw-source byte determinism. D2 is not D1 provider equivalence.

## Before/after projection comparison

The before capture records compiler `364f7235b1bedab3a6543af4f641e95ff1c1bcb8`; after records `8a5d5b282ade4f5aa2fa8e506fe1297890bce037`. Both provenance records identify fixture manifest SHA-256 `18086bcdd282790fa62ac1215d366dd1ce370312821df27e0226f9e2e6439814`. All seven file comparisons were independently recomputed from the retained captures and matched the recorded counts and path sets. The before capture is historical evidence retained with the after captures in the tracked packet below.

| Fixture | Before → after selected projection files | Result and disposition |
|---|---:|---|
| browserbase-claude-code-plugin | 8 → 8 | Six identical; plugin manifest and hook JSON changed. Current hook JSON equals the preserved original; inspect manifest and selected native hook semantics separately. D3/D4, no runtime execution. |
| claude-review-loop | 7 → 8 | Five identical; plugin manifest and hook JSON changed; `hooks/stop-hook.sh` added and matches original bytes and executable mode. Original command declaration was already present in the baseline. D3/D4, not a blanket semantic pass. |
| cursor-browser-motion-plugin | 8 → 8 | Eight byte-identical; byte identity only. D3/D4. |
| mattpocock-skills | 64 → 64 | 64 byte-identical; byte identity only. D3/D4. |
| compound-engineering-plugin | 0 → 0 | Blocked by native metadata conflict; no projection to compare. D5. |
| emilkowalski-skills | 0 → 0 | Unattributed frontmatter decision blocks output; current run has 14 flags, historical run had three collision findings. D4/D5; preserved/flagged does not establish provider portability. |
| last30days-skill | 0 → 0 | Agent Skills string-map metadata requirement blocks nested `metadata.openclaw`; current run has 56 flags, previous run had two. Source metadata remains valid canonical data and native hook variables stay unknown; D4/D5. |

Totals: before 87 available files, after 88; 83 byte-identical, four changed and one added. The three blocked fixtures contribute zero available files, not successful empty projections. Changed artifacts and restored dependency need file-specific source/destination review; no semantic grade follows solely from a byte diff.

## Source-relative semantic qualification

The [five changed/added artifacts](../../../.agents/notes/2026-10-30-set-433-external-evidence/semantic-changed-artifacts.md) and [83 repeat-identical artifacts](../../../.agents/notes/2026-10-30-set-433-external-evidence/semantic-unchanged-artifacts.md) have now been compared with pinned originals. The [per-file manifest](../../../.agents/notes/2026-10-30-set-433-external-evidence/semantic-unchanged-artifacts.json) records the original path, output/source hashes, fields, body comparisons, modes, disposition and caveats for all 83. This qualifies the historical captures above; it does not recapture the latest compiler or establish provider execution.

| Observed artifact | Bounded finding | Remaining owner |
|---|---|---|
| Two native hook JSON files and restored review-loop stop script | After bytes equal pinned original; before hook JSON objects are equivalent despite formatting. Restored script matches committed executable intent. Native default hook discovery is documented; execution is untested. | SET-433 records D2/D3; SET-439 owns wider runtime dependencies. |
| Browserbase and review-loop native manifests | Browserbase after JSON equals original. Review-loop retains the existing generated default commands path; removing the redundant hook declaration restores source default discovery. | SET-433; no new maintainer exception is established by these fields alone. |
| 37 copied files; 35 skill files | Copied bytes match source. Skill bodies and every original parsed frontmatter field match, with generated metadata added; paths can be flattened. | D2/D3 for these specific representations, without a runtime-equivalence claim. |
| Cursor license notices | Full original MIT text and copyright are absent from both selected generated notices. Retaining an SPDX name is insufficient evidence of source-notice preservation. | License/import provenance follow-up remains open; no legal conclusion or accepted omission. |
| Cursor MCP declaration | Command and arguments are preserved, but referenced `server/dist/index.js` exists only in the original archive. | SET-439 dependency closure; D5, not a passing package-runtime result. |
| Matt Pocock skill declaration | Explicit 17 paths become `./skills/` with 34 emitted skills; fallback description/version are added. Claude also performs additive default discovery, so original runtime membership of exactly 17 is unproven. | SET-439 scope classification and SET-444 expectations must distinguish explicit declarations from actual discovery. |
| Three blocked fixtures | No selected projection is available. Preserve the reports and blocking classifications. | SET-442/SET-444; zero files is not a successful semantic comparison. |

The reports cite current provider discovery documentation and separate native preservation from runtime proof. Pinned Git executable modes (`100644`/`100755`) are recorded separately from original tar permission bits (`0664`/`0775`); no tar-mode identity is claimed. The captured Git tree listings are observational evidence, not a self-verifying Git object chain.

## Retention and unresolved proof

The [tracked evidence packet](../../../.agents/notes/2026-10-30-set-433-external-evidence/README.md) contains immutable before/after archives, seven pinned originals, raw reports, failed and successful run logs, comparison manifests, the capture driver, Git tree listings and an offline verifier. It retains raw timestamp variability. The after archive is losslessly recompressed from the original gzip: both decompress to tar SHA-256 `e74faabff9a36dd783c2b85d971aefbe6df3a57e88178c42ee88ccf3596abc6f`. The packet's SHA-256 manifest covers every payload. Retained machine paths in historical reports are provenance only; reviewers can use the packet without those directories.

Run `python3 .agents/notes/2026-10-30-set-433-external-evidence/verify.py` to validate payload hashes, compiler/fixture provenance, the 87→88 comparison, A/B/C projection byte equality, all 83 recorded source mappings and the restored native hook bytes. It reads archives without extracting, fetching or invoking captured code. The original archive includes macOS AppleDouble metadata sidecars; the verifier excludes those from projection-file counts. It does not validate every semantic judgment or establish runtime behavior.

SET-433 remains open for per-family evidence and exception closeout; this packet does not accept the license omission, missing runtime or changed declared membership. SET-439 owns dependency/curation scope, SET-438 lifecycle scan/readiness, and SET-444 fixture infrastructure. `scripts/fixtures/external.ts` and `scripts/fixtures/external-report.ts` own the opt-in fixture workflow. No paid runtime or unsupported provider behavior is assumed.
