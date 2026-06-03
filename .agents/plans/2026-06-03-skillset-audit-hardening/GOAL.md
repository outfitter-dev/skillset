# Goal Prompt

Paste this into Claude from `/Users/mg/Developer/galligan/skillset`.

````text
/goal From repo `/Users/mg/Developer/galligan/skillset`, execute packet `.agents/plans/2026-06-03-skillset-audit-hardening/` end to end. Objective: implement the first Skillset audit hardening slice after Claude run `2b6f6349`: add a durable kitchen-sink fixture proving unexercised source surfaces, then fix P1/P2 guardrails around hook target compatibility, custom `resources.to` link behavior, fail-open generated-state handling, stable lock/hash ordering, and doc tracker drift.

Read first: `AGENTS.md`, `README.md`, `docs/layout.md`, packet `PLAN.md`/`REFS.md`, and the audit transcript path in `REFS.md`. Use `RETRO.md` as the durable ledger; update it after meaningful design, code, tracker, verification, review, or generated-output changes.

Default fixture approach: keep fixture source inside the `skillset` repo, e.g. `fixtures/kitchen-sink/` or an equivalent test fixture, so it proves hooks/rules/shared resources/`.mcp.json`/target companion files without polluting Matt's real `agents` content. If that is not meaningful, stop and ask before changing `agents`.

Implementation requirements: add tests for the kitchen-sink fixture; add target-aware hook lint so Codex-enabled hooks fail on unsupported Codex events or handler types; fix or clearly reject ambiguous bare links when a declared resource uses custom `to`; fail loudly on corrupt `.skillset.lock` and real FS errors instead of silently disabling guards; replace locale-dependent `localeCompare` ordering for lock/hash inputs with stable ordering; update docs so PAT-52 owns changelog/version workflow, PAT-47 owns global/XDG installs, PAT-43 semver/version drift is done where applicable, and matrix rows separate implemented vs aspirational surfaces.

Hard rules: do not publish, install, trust, symlink, mutate user-level Claude/Codex config, add a remote, push, open PRs, merge, import legacy/Obsidian/global skills, migrate `agents` content, design a separate `agents` target, or hand-edit generated outputs as source truth. If generated outputs are stale, rebuild from source and inspect the diff.

Work checkpoint-by-checkpoint. After each turn report checkpoint, changed files/artifacts, exact checks, result, remaining work, blockers, and next checkpoint. Before final, request local review for file safety, target fidelity, schema/resolver/render correctness, and generated-output freshness; capture score, P0-P3 findings, and prompt-to-fix text in `RETRO.md`; fix all P0/P1/P2 or record evidence-based rejection.

Validation ladder: use narrow tests after slices. Before final run `bun run skillset:build`, `bun run skillset:check`, `bun run skillset:lint`, `bun run typecheck`, `bun test`, `bun run check`, and `git diff --check`. Record skips with reasons. Done only when implementation/docs satisfy `PLAN.md`, checks pass or skips are justified, review is recorded, forbidden-action audit is clean, and `RETRO.md` final state is complete.

Stop/ask if official Claude/Codex docs contradict planned target behavior; meaningful fixture coverage requires touching `/Users/mg/Developer/galligan/agents`; user-level config/publish/install/symlink is required; unrelated verification stays broken after one focused retry; or three attempts do not shrink the failing surface.
````

## Handoff Notes

- Keep the prompt above under the `/goal` wrapper when pasting to Claude.
- The packet carries the detailed plan and references; the prompt carries the
  execution contract and stop rules.
