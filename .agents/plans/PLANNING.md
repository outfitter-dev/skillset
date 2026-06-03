# Goal Planning Preferences

This file is tracked project guidance for goal planning and execution in the
`skillset` compiler repo. Repo guidance in `AGENTS.md` and current user
instructions take precedence.

## Planning Directory

Default packet location:
`.agents/plans/{YYYY-MM-DD-slug}/`

Archive location:
`.agents/plans/archive/`

## Tracker

Primary tracker:
Linear PAT project, when Matt assigns or requests tracker work.

Issue hygiene:
- Do not invent tracker state. If no Linear issue is assigned, record that in
  `RETRO.md` and keep the packet executable from local files.
- If the executor creates or updates tracker records, record issue IDs, status,
  comments, and any scope divergence in `RETRO.md`.

Follow-up issue policy:
- File or propose follow-up issues for real discoveries outside the active goal.
- Do not mutate Linear for speculative or stylistic follow-ups without a clear
  connection to the goal.

## Source Control

Branching model:
Vanilla git is acceptable. Graphite may be present but this repo may have
untracked local branches.

Branch/PR conventions:
- Prefer a non-main branch for implementation.
- Do not push, open PRs, or merge unless Matt explicitly asks.

Plan packet commit policy:
- Commit the packet on the execution branch only when the execution flow calls
  for commits. Planning alone does not require a commit.

Archive before merge:
- Move completed packets to `.agents/plans/archive/` before merge readiness when
  a merge flow exists.

Retro policy:
- `RETRO.md` is the durable ledger and must be updated after meaningful design,
  code, tracker, verification, review, or cross-repo changes.
- `RETRO.md` must be finalized before handoff or completion.

## Planning Packet

Required files:
- `PLAN.md`
- `GOAL.md`
- `RETRO.md`
- `REFS.md`

Additional allowed files:
- Add extra Markdown files only when distinct design, migration, issue, or
  review detail would clutter the core files.

## Execution Preferences

Local review:
- Ask for a local review before final handoff on implementation goals.
- Expected review output: score out of 5, short summary, P0-P3 findings, and
  prompt-to-fix text for actionable findings.

Remote review:
- Not required unless Matt asks for PR or source-control host work.
- If remote review happens, record latest bot and human review state in
  `RETRO.md`.

Progress reporting:
- Report checkpoint, changed files/artifacts, exact checks, result, remaining
  work, blockers, and next checkpoint.

Retro reporting:
- Record verification commands, skipped checks, unresolved risks, forbidden
  action audit, and final archive readiness.

## Validation

Required gates:
- `bun run check`

Common narrow gates:
- `bun test`
- `bun run typecheck`
- `bun run skillset:lint`
- `bun run skillset:check`
- `git diff --check`

## Stop Rules

Stop or ask before continuing if:
- The work would require publishing, installing, trusting, symlinking, or
  mutating user-level Claude/Codex configuration.
- The work would require adding a remote, pushing, opening a PR, or merging
  without Matt's approval.
- Target official docs or local snapshots contradict the packet's target-fidelity
  assumptions.
- Verification remains broken after a focused retry and the failing surface is
  not shrinking.
