# Astra backlog execution

## Mandate

One Astra thread owns sustained implementation of the eligible Skillset backlog in Linear. Produce as much good, high-quality work as possible, keep moving through eligible issues, and open small, coherent draft PRs. Use subagents and isolated review/repair worktrees when useful. Linear's six projects organize work; they do not require six execution lanes or six builders.

This packet records Matt's operating decisions from the conversation on October 29, 2026. It supersedes the multi-lane execution and coordination model in the earlier autonomous campaign playbook. It preserves Linear's issue scope, dependencies, acceptance criteria, deferred work, and settled product decisions. It does not introduce a new compiler or product contract.

Start here, then read [GOAL.md](GOAL.md), [REFS.md](REFS.md), and the latest [RETRO.md](RETRO.md). Current user instructions take precedence over this packet. Follow current repository guidance and specialist skills; surface substantive conflicts rather than silently changing accepted product behavior.

## Standing authority and completion horizon

When Matt starts the Astra thread with this packet, proceed continuously through eligible, non-deferred Skillset issues without asking for routine permission between issues or checkpoints. Within that inventory, Astra may:

- Inspect Linear, repository state, existing branches, worktrees, PRs, reviews, and CI.
- Create owned branches/worktrees; implement source, tests, docs, required generated output, and release records.
- Run appropriate checks, commit, push owned branches, and create/update draft PRs.
- Delegate bounded research, independent review, and repair work in isolated worktrees; exchange task and handoff messages with those participants.
- Integrate repair commits into the owning branch and restack branches this campaign owns, with affected writers idle.
- Proactively maintain existing Linear issues, descriptions, statuses, milestones, dependency relations, and implementation evidence; add necessary durable issue comments and concise project updates when milestones complete.

The target is a coherent draft stack followed by a settlement pass that makes it ready for owner review and merge. This grant does not authorize merges, package publication, deployments, release-channel or visibility changes, adding remotes, global runtime/configuration changes, destructive cleanup of user work, or messages to unrelated people/services. Existing PRs and stacks owned by others require an explicit ownership handoff before mutation or history rewrites. A historical implementation hold is not a reason to re-ask about work this packet now authorizes; an unresolved current owner or external release gate still matters.

Keep PRs draft throughout accumulation. Do not mark them ready merely because draft CI is green. At settlement, report readiness to Matt; changing readiness or merging is a separate owner decision.

## Bootstrap once, then execute

1. Read root and relevant nested guidance, CONTRIBUTING.md, and the specialist skills needed for the first change. Read tenets and governing ADRs before changing contracts. Use the commit's pinned Bun and repository commands.
2. Refresh the six Linear projects, first pulls, full selected issues, latest decision comments, actual blockers, and existing implementation evidence. Consult shared Linear agent context if that capability works; unavailable optional notes do not block ordinary reads.
3. Inspect checkout status, worktrees, branches, open PRs, stack topology, and known owners. Preserve unrelated and ignored work. Do not restart an In Progress/In Review issue from scratch or assume an old draft PR is current.
4. Establish one owned execution worktree and default stack. Record actual paths, refs, base/head SHAs, owners, and existing external work in RETRO.md. Use Linear's branch name for a one-issue branch and current gh-stack guidance for stacked work.
5. Record a short eligible queue and begin the first coherent change. Bootstrap is preparation for execution, not a separate approval ceremony. Do not build an orchestration framework, schedulers, or a six-role organization.

Initial queue anchors from the October 28 Linear plan, subject to live verification:

| Project | First pull | Execution guidance |
| --- | --- | --- |
| Correctness and invariants | SET-748 | Check summary must classify formatter-only drift correctly. Then address documented-path bugs and their downstream dependencies. |
| Authoring model | SET-554 | Already In Review at the catch-up snapshot. Reconcile existing implementation, PR, ownership, and current acceptance before extending it. |
| Release: beta to launch | SET-457, then SET-466 | Public skill identity/triggers and router behavior precede the generated-file edit hook. |
| Adoption and migration | SET-437 | Architecture accepted as written; record it in the ADRs, then follow the flag/state and migration implementation dependencies. |
| Guidance and docs | SET-708 | Already In Progress at the snapshot. Reuse existing work and distinguish independent recovery docs from collision behavior waiting on code. |
| Developer workflow and verification | SET-760 | Research-only. Reuse the October 24 audit and refresh evidence; it is not authority to rewrite tests or change CI policy. |

SET-748 is the recommended first fresh coding pickup if current evidence still supports it. These anchors are not one global serial order: pick eligible work by Linear priority, concrete dependencies, downstream value, and file/branch ownership. When one item is waiting, advance another. Do not treat milestone numbers as dependencies where Linear explicitly allows fan-out, especially Authoring model.

## Settled decisions and dependencies

Read the linked issues before implementation. Later explicit decisions supersede older proposals and stale status-update text.

- SET-726: onboarding or a first build finding an unmanaged root AGENTS.md auto-enables native mode, recorded in skillset.yaml. Root AGENTS.md is authored source and is never overwritten. Reject unscoped root rules in that mode; RULES.md plus native mode is an error. The October 28 rejection supersedes the October 20 managed-index proposal. SET-726 precedes SET-689 first-build wiring; these precede SET-691 adoption and SET-707 quickstart work.
- SET-686: provider-only plugin components are uncovered where unsupported and do not block valid provider outputs. Amend the owning ADR and add regression proof before SET-700 component docs and SET-459 flagship content rely on it.
- SET-437: promote the accepted reviewable-migration architecture. `adopt` is unmanaged-skill management; `migrate` owns repository migration from its first release. Preserve `init --adopt` until replacement, with legacy cutover in SET-440. SET-437/SET-438 constrain SET-563, not the entire migration project.
- SET-457/SET-466 precede SET-727, the public plugin's pre-edit hook. Component support from SET-686 must also be usable before that hook is claimed to work.
- SET-444 semantic external-fixture evidence precedes SET-478's finished-beta first-contact gate. Command completion alone is not migration readiness or semantic fidelity.
- Release mechanics remain a separate dependency. SET-763 was Done at catch-up; SET-730 retained older exact-main failure evidence. An October 29 project update reported release PR #735 head checks passed, without proving protected merge, publication, or Homebrew delivery. Refresh the evidence rather than repeating old release-blocker claims or bypassing publication gates.

Keep post-beta/post-1.0 work parked where Linear says it is parked. Do not pull in speculative specialists, scoring, Blueprints, MCP, ownership cleanup, or unrelated refactors merely to increase throughput. New work needs a direct connection to the approved backlog; record real discoveries and propose out-of-scope follow-ups rather than silently expanding the campaign.

## Stack ownership and the no-overlap rule

Use one delivery stack by default. Make each PR a coherent, reviewable outcome; order branches by actual implementation dependencies. PR boundaries need not duplicate issue boundaries when a small shared prerequisite deserves its own change, but preserve issue traceability.

Separate delivery stacks must never have overlapping files. Compare the full set of paths modified anywhere in each active stack against its recorded trunk base: source, tests, docs, generated files, lock files, manifests, release records, and tracked working records all count. There is no generated-file or mechanical-change exception. Different commits touching the same path still overlap, even if the eventual net diff cancels out. Include additions, deletions, and both sides of renames. Recheck before committing or pushing new scope and after topology changes.

Record stack IDs/bases and cumulative touched paths in the campaign's local working ledger. A shared checkpoint file can itself create overlap: keep the committed campaign packet owned by the primary stack, and keep other stacks' interim progress in untracked local records or their issue evidence. Prefer one stack when maintaining disjointness would add overhead.

If new work would overlap another delivery stack, put it in the owning stack or consolidate owned stacks before introducing overlap. If another owner prevents consolidation, defer only the conflicting work. Do not split into nominally independent stacks and plan to resolve overlap later.

Review/repair worktrees are temporary branches of their parent delivery stack, not separate delivery stacks. They may touch that stack's files. One writer owns each worktree; nobody edits another writer's worktree or rewrites their active branch.

## Continuous implementation loop

For each eligible change:

1. Read the complete issue and current code. State the outcome, proof, smallest useful change, owner, and branch. Resolve routine implementation choices autonomously.
2. Implement the scoped behavior with meaningful tests, docs, and release records. Edit canonical .skillset/ sources and regenerate owned outputs rather than editing generated guidance directly. Keep mechanical formatting separate from behavior changes.
3. Run focused checks while editing. Before pushing, satisfy current repository push requirements and the relevant local gates; do not suppress hooks or pretend draft CI replaces full acceptance. Schedule full verification at coherent commits and material integration points, avoiding duplicate runs without new changes or evidence.
4. Commit a reviewable checkpoint, launch a bounded local review, and continue with the next eligible change. Push and open/update a draft PR once the initial local review is addressed or has the documented two-round disposition below. A fix that is materially unsafe or lacks required verification stays local until corrected.
5. Record acceptance evidence, exact head/base, test results, pending local/external findings, dependencies, and next action. Keep Linear status truthful: implemented, in review, ready, merged, and released are different facts. Do not close delivery issues merely because a draft PR exists.

Use CI/review waits for independent implementation, focused research, or another eligible pickup. Do not repeatedly poll unchanged checks. Control simultaneous full test runs according to host capacity; more workers should not multiply expensive identical gates.

## Asynchronous local review: at most two routine rounds

Use GPT-6.1 Terra reviewer threads with high reasoning and fast mode where the runtime supports it. Select those settings explicitly. If fast mode or the requested model is unavailable, record the actual capability and setting; do not claim the requested configuration was used. Continue independent implementation instead of making optional reviewer provisioning a campaign-wide stop.

Review coherent committed checkpoints, not every intermediate edit. Give the reviewer the exact base/head SHA, issue acceptance, changed paths, governing source anchors, existing checks, and a bounded review question. Use a separate worktree so Astra can continue. The initial review is read-only and returns a score out of 5, concise P0-P3 findings with evidence, concrete fixes, and downstream impact. Avoid speculative or stylistic scope expansion.

Each checkpoint gets at most two routine review-and-repair rounds: first review and repair, then one focused re-review and repair/disposition. A commit or restack does not reset the counter for the same change. Do not create an endless review/rewrite loop or keep reopening settled style choices.

After round two, Astra chooses an explicit disposition: resolved with proof; deferred nonblocking with rationale and owner; or blocked for the affected PR/dependents. The round cap limits review churn, not the quality bar. Unresolved correctness, security, contract, or acceptance failures cannot be called clean or passed downstream as safe. Narrow or defer the affected change and keep independent eligible work moving. If a further bounded investigation/review is essential, explain why it is exceptional rather than silently starting routine round three.

Passing review applies only to the reviewed SHA. Commits, rebases, and worktree changes invalidate its current-head acceptance under repository policy. Preserve historical findings and fix evidence, and obtain current-head review when needed for settlement; do not repeatedly re-review every descendant merely to keep an accumulating draft stack temporarily stamped clean.

## Repair handoff and integration

When a finding needs code changes, Astra explicitly transitions the isolated reviewer worktree to repair ownership (or creates a separate repair worktree) and records allowed paths, base/head, finding IDs, and expected proof. The thread may then make focused fixes and tests, verify, and commit. It must not review its own repair as independent acceptance. Use the second review round for an independent check where available, or retain a pending independent disposition for settlement.

Return repair commits, exact SHAs, changed paths, checks, findings addressed, residual concerns, and an idle handoff. The repair thread does not rebase or force-push Astra's delivery branches.

Astra integrates each fix into the branch that owns the defect, not as a catch-all commit at the top. Before rewriting, identify affected refs, ensure all affected writers (including automation) are explicitly idle, and preserve recoverable heads. Use current gh-stack guidance only on stacks entirely owned by the campaign. Integrate the focused repair, resolve interactions with newer descendant edits, restack, verify ancestry and resulting behavior, update draft PRs/evidence, then release writers with the new heads. No generic stash mutation, destructive cleanup, or rewrite of someone else's branch.

Restacks require renewed verification receipts where the merge base changed. Do not merge trunk into a release-apply branch or sort change streams. Never run release apply as a generic feature-stack conflict repair.

## External reviews: triage now, settle later

Draft PRs are checkpoints, not occasions to stop the implementation campaign for every external bot or human comment. Triage feedback for downstream impact. Act promptly when it exposes a safety/correctness defect, invalidates acceptance, changes a shared contract, or would cause future implementation to build on a faulty premise. Pause only the affected chain when possible.

Record and defer feedback that does not affect subsequent implementation. Keep a finding-to-owner/PR/head list so deferred comments cannot disappear in compaction. This explicit user instruction changes the timing of review response; it does not make unresolved comments disappear or authorize ignoring them at readiness. Do not resolve threads without a fix, reasoned disposition, or verified evidence.

## Proactive Linear maintenance

Astra owns tracker hygiene throughout execution; do not leave it for Matt or wait to be asked. Keep issue status, scope, acceptance criteria, milestone placement, dependencies, and linked implementation evidence consistent with confirmed work. Preserve the existing project/status taxonomy and file new confirmed work into an existing project and milestone; do not create a duplicate campaign tracker or speculative backlog.

Comment on an issue only when the information is necessary for future reference: a decision or rationale, substantive scope divergence, a durable blocker/handoff, or acceptance evidence that the issue and linked PR do not otherwise preserve clearly. Avoid routine progress narration, duplicate CI logs, per-commit comments, and comments that merely repeat fields or the PR. Update the current issue brief when intent changes; a chronological comment alone is insufficient. Record tracker mutations in RETRO.md without copying the entire issue history.

When a milestone actually meets its current done criteria, post one simple update to its Linear project. State the milestone completed, the resulting capability/outcome, relevant issue/PR links, and the next milestone or material blocker. A few sentences suffice. Reuse an existing update for corrections and avoid duplicate completion announcements. Draft implementation or passing head checks do not prove merged/released delivery: if delivery is still pending, reflect that in issue state and any useful checkpoint update rather than declaring the milestone complete. If the milestone's criteria require merge/publication outside this grant, report that remaining owner step.

Suggested project update: "Completed [milestone]: [outcome]. Evidence: [issue/PR links]. Next: [next milestone]; [material blocker, if any]." Do not generate an update for every issue, review round, or commit.

## Verification and release records

Follow the current repository commands and hooks, not historical command spellings embedded in old issues. In this checkout the key surfaces include focused sandboxed tests, docs:check, schema:generate/schema:check when schemas change, skillset:build and generated-output checks when source changes, changeset:check, check:fast, check, skillset:check:ci, and exact-commit verify receipts. Read current package scripts and lefthook.yml before relying on that list.

Self-hosted source-unit changes need supported Skillset change entries; published-package behavior/payload changes need Changesets. Changes touching both need both. Never hand-edit pending event files. Preserve receipt identity, exact revisions, test outcomes, and observed-versus-inferred boundaries. Treat SET-760 and other research-only issues according to their own limits. External conformance is an explicitly selected slow lane, not a routine full-suite substitute.

## Settlement and stopping

Enter settlement when the eligible inventory is exhausted, Matt asks for a checkpoint, or stack growth/interactions make further accumulation counterproductive. This is a phase transition, not a request to approve every routine fix.

- Sweep every PR's local and external findings. Fix or explicitly disposition each; reply and resolve threads with evidence where appropriate.
- Integrate repairs at their owning layer, restack, and verify current heads, ancestry, generated output, required release records, current-head independent reviews, and applicable local/hosted checks. Distinguish draft fast CI from the full readiness gate. Report any full hosted checks that cannot run while draft; do not mark ready solely to trigger them without owner direction.
- Reconcile Linear with actual delivery evidence. Produce a PR/issue map with ready, partial, blocked, deferred, and external-owner items. Report remaining merge and publication steps separately.
- Preserve a usable handoff even when only part of the backlog is complete. Follow the packet archival policy when the campaign truly completes; archive before merge readiness when required.

Ask Matt only for substantive unresolved decisions, a genuine scope departure, ownership conflict, or actions outside the standing grant. Exhausted review rounds and ordinary CI waits are reasons to select another eligible task, not to stop all work. After three materially identical failures, change approach, narrow the repro, or record the exact blocker and needed input.

Update RETRO.md after meaningful implementation, tracker, review, or topology changes. Keep it compact: current queue, actual ownership/refs, evidence, deferred findings, blockers, and next action. Do not copy full logs or secrets into tracked notes. At compaction/resume, reconstruct from that ledger plus current Git/Linear/PR evidence before mutating anything.

## Copyable kickoff

```text
Use .agents/plans/2026-10-29-astra-backlog/PLAN.md as the operating contract
for this Skillset backlog run. Read its GOAL.md, REFS.md, RETRO.md, and current
repo guidance. You are the sole Astra implementation and integration owner.

Start execution after a concise live inventory/ownership check. Keep advancing
through eligible non-deferred Linear work without routine permission waits.
Implement, verify, commit, push owned branches, and open coherent draft PRs.
Default to one stack; separate delivery stacks must never overlap any files.

Use asynchronous GPT-6.1 Terra high/fast local review threads where supported,
with isolated worktrees and at most two routine review/repair rounds per
checkpoint. Let repair owners return focused verified commits, integrate fixes
into the owning branch, and restack affected owned descendants safely.
Keep implementing independent work while reviews and checks run.

Triage external reviews for downstream impact; defer other feedback to the
settlement pass. Preserve all quality and acceptance requirements. Keep Linear
current proactively; comment only for necessary future reference, and post a
simple project update when a milestone truly completes. Keep the handoff ledger
truthful. No merge, publication, deployment, global
configuration changes, or unrelated cleanup is authorized by this kickoff.
```
