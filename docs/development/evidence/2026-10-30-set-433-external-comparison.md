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

The before capture records compiler `364f7235b1bedab3a6543af4f641e95ff1c1bcb8`; after records `8a5d5b282ade4f5aa2fa8e506fe1297890bce037`. Both provenance records identify fixture manifest SHA-256 `18086bcdd282790fa62ac1215d366dd1ce370312821df27e0226f9e2e6439814`. All seven file comparisons were independently recomputed from the retained captures and matched the recorded counts and path sets. The before capture is local historical evidence and also requires durable retention.

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

## Retention and unresolved proof

Raw captures, reports, comparison manifests and capture script were retained in the owned ignored cache under `.skillset/cache/evidence/set433-8a5d/`; archive `raw-captures.tar.gz` SHA-256 `afd4215d47ad407b72dae50b0d87cafa471027be2cf7a01c310c031f69fd9b28`. This cache is not a tracked or durable published authority. Preserve an accessible immutable evidence artifact and verify its hash before relying on it during review; do not create a tracked document link that assumes ignored cache exists on another machine. `scripts/fixtures/external.ts` and `scripts/fixtures/external-report.ts` own the fixture workflow; SET-444 owns fixture infrastructure, SET-439 dependency/curation scope and SET-438 lifecycle readiness. SET-433 still needs current provider evidence, reviewed before/after meaning and the raw timestamp variability and its limited bearing on ADR-0019. No paid runtime or unsupported provider behavior is assumed.
