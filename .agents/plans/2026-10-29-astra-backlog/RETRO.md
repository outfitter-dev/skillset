# Execution ledger

## Initial preparation checkpoint (historical)

At the initial packet-writing checkpoint, the operating packet was prepared and implementation had not started. Later planning and execution checkpoints supersede that status.

This packet records the agreed single-owner workflow, draft PR horizon, disjoint-stack rule, asynchronous review/repair integration, two-round local review budget, and proactive Linear maintenance with necessary durable comments and simple milestone-completion project updates. The initial packet-writing step changed no Linear records, Notion pages, existing PRs, implementation branches, runtime configuration, or release state. The later Bun planning amendment below records its authorized Linear changes separately.

No new Linear issue was assigned to the documentation task. The executor should use the existing Skillset issues rather than create a duplicate campaign tracker. The six-project catch-up snapshot contained 148 open issues including coordination parents and deferred work; refresh the inventory instead of treating that count as a target.

Preparation branch: docs/agents/astra-backlog-execution. Baseline: 24800e02ed4e7150ea1bc7130c35603c98ea9da2. Validation results and handoff commit are recorded by the preparing thread; the executing thread must record its own actual paths, refs, ownership, and runtime.

## Current execution state

- Owner: primary Astra campaign thread; user activated the goal October 29.
- Owned worktree: `/Users/mg/Developer/outfitter/skillset-astra`; primary stack is `main` ← `docs/agents/astra-backlog-execution` ← `set-770-capture-bun-140-baseline-and-map-skillsets-144-compatibility`. Trunk/base `24800e02e`; planning head and baseline start `771bb0057`.
- First candidate: SET-770 baseline, then SET-603 → SET-771 → SET-772 Bun foundation after live ownership/dependency checks. SET-748 follows as the first ordinary backlog candidate.
- Existing work to reconcile: SET-554 In Review; SET-708 In Progress; refresh all live evidence.
- Review: Terra high round 1 accepted packet `24800e02e..771bb0057` at 5/5, no actionable findings; no separate fast control exposed. Reviewer worktree `/Users/mg/Developer/outfitter/skillset-astra-review-plan` is read-only. Read-only research mapped Bun exposure; no implementation delegated yet.
- SET-770 is In Progress. [Bun baseline](BUN-BASELINE.md) records exact identity, artifacts, failures and runtime-only parity for 221 generated files. SET-774 tracks the reproduced pending-ledger overlap-test runaway; it blocks final qualification.
- External work: #735 release head `e7610c87` has successful check/skillset-ci/provider validation, still unmerged; #726/#727 Dagger and #623 prerelease work remain externally owned. Matt said to move past #623 as an overlap blocker; scoped Bun documentation edits may proceed without touching that PR branch or release behavior.
- Existing evidence: SET-554's PR #514 merged September 21, but acceptance/status reconciliation remains pending; SET-708's PR #659 merged and its comment preserves two residual docs items (collision entry and all-or-nothing repair wording). Do not restart either implementation.
- Cumulative primary-stack touched paths currently consist of the four packet Markdown files plus BUN-BASELINE.md. No production edits or runtime pin changes yet; baseline capture driver/raw artifacts are ignored local evidence.
- Next action: commit the baseline checkpoint, repair SET-774 in the same stack, then finish the full baseline and proceed with the Bun foundation.

## Preparation validation and review

- Local Markdown links and git diff --check passed. Pre-commit repo sanity, whitespace, and generated-output checks passed (95 generated files).
- Independent GPT-6.1 Terra high review of f7cebc756 reported one concern based on interpreting "local" as private/unpushed. That concern was withdrawn after checking Matt's explicit request to commit the repository document for reviewers. No findings remained. No separate fast-mode setting was exposed by the review runtime.
- The full bun run check was invoked. Guards, typecheck, and package build passed; the test phase encountered failures in untouched surfaces: docs golden-path generated-output drift, adopted standards receipt/fixture identity, and a pending-ledger merge test timeout. No green full-gate claim is made. Do not repair unrelated implementation as part of this packet-writing task.
- A separate bun run docs:check failed on the same golden-path generated-output drift. The packet is under .agents/, outside the product documentation gate. These failures are evidence for the executor to classify against its current baseline, not proof of a new defect caused by the packet.
- Latest user steering is incorporated: proactive Linear hygiene, issue comments only for necessary future reference, and a simple project update for each genuinely completed milestone.

## Checkpoint format

### October 29 Bun foundation planning amendment

- User authorized updating the plan and existing project set to include Bun 1.4.4; implementation remains on hold until kickoff.
- Read the supplied proposal, current code owners and official 1.4.0–1.4.4 release materials. Corrected compiler-versus-Workbench YAML ownership, YAML workspace/TOML provider distinction, filesystem-versus-glob discovery, npm publishing, retired watch flag, and pin-versus-consumer-floor/native-size policy assumptions. Full applicability probing remains SET-770 work.
- Updated SET-603 from the stale 1.4.2 brief to 1.4.4, high priority. Created SET-770 (baseline), SET-771 (compatibility) and SET-772 (qualification), high priority; SET-773 (optional built-ins research), medium priority. All remain Backlog in Developer workflow and verification, using existing milestones. Dependency chain: SET-770 blocks SET-603, which blocks SET-771, which blocks SET-772; SET-770 also blocks optional SET-773.
- No milestone completed, so no completion update was posted. No unrelated issues, existing owners or release state changed. Shared Linear agent context was unavailable (`Tool get_agent_context not found`); ordinary issue reads/writes worked.
- Planning checkout: `docs/agents/astra-backlog-execution`, observed head `0e4c68754`; no execution worktree established. Shell Bun 1.4.4 versus repository pin 1.4.0 remains unchanged. No baseline tests, installs, regeneration or production edits performed.
- Updated existing milestone 1 and 2 descriptions to name the Bun foundation while preserving SET-760/SET-629 and their existing done criteria. No new project or milestone was created.
- Planning validation: local-link existence and `git diff --check` passed. Linear read-back verified Backlog state and dependency relations at that checkpoint. Full runtime gates were not run because only agent working records changed. No baseline-green claim was made. The amendment was subsequently committed on the preparation branch as `771bb00572a8aeff9f3e3287a6d80dbd71d21274`.
- Next action: owner kickoff, live inventory, then SET-770. Optional built-in adoption does not block runtime qualification.

### Checkpoint template

Append or replace compact checkpoints with: issue and acceptance; owner/worktree; stack/branch/base/head; cumulative stack file ownership; implementation and test evidence; review round count and exact reviewed SHA; findings and disposition; repair/integration SHAs; external reviews deferred or acted on; Linear changes; blockers; next eligible action.

Keep raw logs and generated inventories outside tracked notes unless needed for durable evidence. Finalize this ledger at handoff, record skipped gates and unresolved risks, and follow the repository archival policy when the campaign completes.

### SET-774 bounded overlap repair

- Owner: primary thread in `skillset-astra`; new gh-stack layer `set-774-bound-the-pending-ledger-overlap-test-so-it-cannot-starve` above SET-770 checkpoint `3ae77bf19`.
- Replaced unbounded queued ledger reads with one awaited read at a time, retaining the concurrent folded-record assertions. Both probe and release settle before propagating either failure. No production behavior or timeout changes.
- Focused two-test file passes under pinned Bun 1.4.0 (1577 assertions) and explicit Bun 1.4.4 (1641 assertions); actual versions printed by each test process. `git diff --check` passes. Original failing logs remain retained. Full pinned gate rerun and independent commit review pending.
- Matt explicitly authorized focused repair PR layers for encountered errors and reiterated gh-stack. These repairs are part of this campaign; the historical packet-preparation restriction does not block them.
- Cumulative primary stack now also owns `apps/skillset/src/__tests__/pending-ledger-merge.test.ts`. No separate delivery stack created.

### SET-603 candidate toolchain

- SET-770 baseline and SET-774 repair are independently reviewed at 5/5: `3ae77bf19` and `a8415894525e8f13e65691c7338c95561021eddf`. Full pinned 1.4.0 gate at clean `a84158945` passed: 3797 pass, 2 skip, 4 todo, 0 fail; 3803 tests across 334 files, 68419 assertions, one snapshot. Generated, docs and packaging checks pass. Measure report `set-774-bun-140-repaired-baseline-2026-10-29T15-39-39-442Z-6a807c55.json` is attributable; CPU accounting is suspect. Original interrupted baseline remains retained. Historical docs/standards failures separately reran 8/8 green.
- Runtime-only parser/glob probe results match on 1.4.0 and 1.4.4 (`.skillset/cache/bun-baselines/parser-glob-{140,144}.json`). Literal NUL in quoted YAML differs between compiler and Workbench on both versions; classify as existing parser disparity, not an upgrade regression. Probe source SHA-256 `c359fc8572ae6023655bb809bdbe3e50845a9397f3b0a10f0cc3d1b050640a30`.
- Created next gh-stack layer `set-603-upgrade-skillsets-pinned-toolchain-to-bun-144` above `a84158945`. SET-603 is In Progress; SET-770 is In Review with durable baseline acceptance evidence. Neither is closed.
- Pin and compatible types become 1.4.4; consumer floor remains >=1.4.0 and native-size baseline is unchanged. The generated lock refreshes stale local workspace metadata from 0.29.0 to existing manifest version 0.30.0; registry resolution changes only @types/bun and bun-types. Frozen install passes. Types expose numeric subprocess signals, so owned-process and measurement signal types now follow Bun's type. Cold-bootstrap fixtures shadow ambient Bun because the shell deliberately appends common install paths; this keeps installation assertions meaningful when Homebrew matches the pin.
- Typecheck and 126 focused tests pass on actual Bun 1.4.4 (472 assertions). Alpine source no-replace primitives (9 tests), competing workspace transaction (1 test), and compiled primitive smoke pass for arm64 and x64 using children of pinned OCI index `sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a`; x64 runs through local emulation. Image lacks Git, so optional sandbox lease diagnostics are recorded, not hidden; the disposable containers exit cleanly. Hosted exact-head qualification remains required.
- Watcher thread `01a1883c-c6ed-7dd1-955b-a3cc23d52d9a` must be notified for blockers/approval needs. Its delegated Docker recovery restored OrbStack; local retry and actual Alpine runs succeeded. Matt authorized similar bounded blocker delegation.
- Initial `gh stack submit --auto` stopped in an actionlint/ShellCheck pipe hang on unchanged workflows; terminated only owned actionlint, push failed and remote heads were absent. No hooks bypassed. Read-only diagnosis plus isolated same-version Go-toolchain rebuild is delegated; no global tool/config mutation. GOMAXPROCS=1 and the Go1.25 rebuild alone did not fix the hang. No PRs created yet.
- Stack continues to own one cumulative file set; new paths are the pin/manifests/lock, current-toolchain docs, musl workflow/test, bootstrap tests, signal type helpers and a Changeset. Candidate full gate, native proof, independent review and draft submission remain pending.

- Actionlint recovery verified: upstream ShellCheck stdin-pipe transport deadlock (#704/#702), not Go version alone. Task-local v1.7.12 transport-only fix (`cmd.Stdin = strings.NewReader`) retains all lint rules and ShellCheck arguments; full nine-workflow checks passed 20/20, plus owner rerun. Use command-local PATH `/tmp/skillset-actionlint-go125.GDvfrk/binpipefix`; binary SHA-256 `7668b2969c33fe4645192c52d609709a059852fcd00effcec3d7158c28e8d254`. No global config/tool changes.
- Actual candidate Darwin arm64 native binary builds, passes codesign verification and reports CLI 0.30.0, but size verification rejects 90,398,208 bytes against 71,373,720 allowed. Matt explicitly directed continuing the upgrade and deferring Bun binary trimming. Preserve the failed size result and current budget; no claim of full native-size qualification. Separate native investigator owns `/Users/mg/Developer/outfitter/skillset-astra-native-baseline` at `a84158945` for baseline attribution only.

- Candidate `03a4278f8ae0b6558edfe2709e8ec7fd2207d995` passed independent Terra high round 1 (5/5). Attributable full-gate report `set-603-bun-144-candidate-2026-10-29T15-56-16-284Z-f799e108.json` records 3792 pass, 2 skip, 4 todo, 5 fail / 3803 tests / 334 files, 68499 assertions and one snapshot. Three failures are real native-size checks; two are stale expected pin text. Corrected those three message patterns to 1.4.4; focused two-test proof passes (11 assertions). No native tests skipped or budgets loosened. Aggregate gate remains failed for the owner-deferred size gap.
- Separately ran the gates after the test phase: Ultracite doctor, skillset check, docs check, check:pack and trunk-scoped CI report all pass. Packaged JavaScript bunx/isolated-global help+version smoke passes under explicit Bun 1.4.0, retaining the consumer floor.
- SET-775 now owns deferred trimming. Same source compiled under 1.4.0 is 65,295,600 bytes versus 90,398,208 under 1.4.4; +25,102,608 exactly matches Bun executable and minimal-program growth. Current source adds only 0.63% over recorded baseline under 1.4.0. No source/minification regression found. Installed 1.4.4 does not implement the newer documented `bun compile --trim` command; verify runtime capability in the follow-up.
- SET-772 brief now records Matt's deferral and the resulting non-green aggregate gate; runtime and independent backlog progress continues, while full native release qualification remains incomplete.
