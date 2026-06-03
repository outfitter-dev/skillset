# Retro: Skillset Audit Hardening

Status: executed — implementation complete, checks green, final local review
clean (awaiting Matt's staging/commit)

Packet:
`.agents/plans/2026-06-03-skillset-audit-hardening/`

## SET Backlog Execution (2026-06-03, follow-on goal)

A follow-on `/goal` works through the SET Linear backlog (SET-2..SET-15) on the
same branch, guided by `docs/tenets.md`, committing per issue with conventional
commits and `SET-<id>` references, with subagent reviews at intervals.

Foundation: the prior audit-hardening working tree was committed as
`chore: ignore project-local Claude settings`, `feat: harden hook, resource, and
lock authoring diagnostics`, and `docs: add design tenets and align doc drift`.

Contract batch (P2 issues), each committed and moved to Linear "In Review":

- SET-3 (`feat: add skillset.schema source-contract marker`): integer source
  schema marker, defaults to current, semver/non-positive rejected, source-only.
- SET-4 (`feat: simplify source identity and naming defaults`): identity derives
  from directory names; `skillset.name`/`skillset.id` explicit-override aliases;
  decision recorded to keep `skillset.name` (no parallel top-level plugin
  `name`) because plugin/root metadata lives under `skillset`. Loud conflicts.
- SET-5 (`feat: rename source rules to instructions with rules compatibility`):
  canonical `.skillset/instructions/`, `.skillset/rules/` warned compat alias,
  both-with-content fails; added non-fatal `graph.warnings` channel.
- SET-6 (`feat: rename portable tools policy to tool_intent`): `tool_intent`
  canonical, `tools` alias, conflict if both; docs clarify Claude `allowed-tools`
  is preapproval not a sandbox; Codex stays metadata-only.
- SET-2 (`feat: align Codex plugin hooks with documented hooks/hooks.json
  default`): live-doc verified Codex plugin hook default = `hooks/hooks.json`
  with top-level `hooks` object + manifest override + `CLAUDE_PLUGIN_ROOT` alias
  (developers.openai.com/codex/plugins/build, 2026-06-03). Canonical output now
  `hooks/hooks.json`; legacy root `hooks.json` is a warned Codex compat source
  (legacy-first precedence preserves target-specific hooks during migration);
  flat event maps normalized into the canonical `hooks` object.

Batch review: `feature-dev:code-reviewer` over `956bb70..HEAD` scored 4/5.
Fixes applied (`fix: address contract-batch review findings (P1/P2)`): clarified
the Codex hook coexistence framing (kept warn-not-error with evidence; erroring
would break legacy plugins and remove the only way to express target-specific
hooks); rejected non-positive `skillset.schema` with a clearer message; made the
instructions/rules ambiguity check symmetric (markdown content, not dir
existence); added bare `schema` to `SOURCE_ONLY_KEYS`. Follow-up filed: SET-16
(design first-class target-specific plugin hook source model).

Quality/impl batch (each committed, moved to Linear "In Review"):

- SET-15: lint diagnostics for undeclared resource links (with suggested
  entries), plugin-root script dependencies, and non-executable script resources.
- SET-7: deterministic `<!-- source: ... -->` AGENTS.md boundaries + a build/check
  warning when generated AGENTS.md exceeds Codex's 32 KiB `project_doc_max_bytes`
  (live-doc verified).
- SET-8: live-doc-verified Claude pass-through for `.lsp.json`, `output-styles/`,
  `themes/`, `monitors/monitors.json` with documented manifest fields; deferred
  `settings.json` (user config) and `bin/` (not a component).
- SET-14: `docs/target-surfaces.md` evidence matrix + golden manifest tests
  (Codex interface camelCase, Claude paths).
- SET-10: `ImportReport` (copied files, inferred/target-native/unsupported
  fields, warnings, next checks); verbatim preservation; no-overwrite.
- SET-9: read-only `explain`, `diff`, `doctor` commands (new `src/authoring.ts`,
  `diffSkillset`, non-throwing `inspectSkillset`).

Quality-batch review (SET-15/7/8/14) scored 4/5 → 3/5; no P0/P1; P2s were scope
decisions, documented + locked with a regression test (commit 455f9d8).
Command-batch review (SET-10/9) scored 4/5; P2 (doctor summary message) and P3
(diff warnings) fixed in commit 96ed590.

Design-only proposals (no implementation), under `docs/proposals/` (SET-13,
SET-11, SET-12): agent source model (defer portable agents in v1, Codex has no
plugin-agent component per live docs), changelog/versioning (changesets-style
`skillset changes` plan), and global/XDG installs (XDG state, install/sync
separate from build so build never implies trust).

Follow-up filed: SET-16 (first-class target-specific plugin hook source model).

## SET Execution — Final State

- All 14 SET child issues (SET-2..SET-15) complete on branch
  `pat-58-support-shared-resources-in-skillset-source-plugins`, each committed
  with conventional messages + `Closes SET-<id>` and moved to Linear "In Review"
  (committed locally, not merged; no PR per hard rules).
- Three subagent reviews at intervals (contract / quality / command batches);
  all P2+ findings fixed or recorded as evidence-based scope decisions.
- Final validation (2026-06-03): `skillset build` (15 files), `skillset check`
  (15, no drift), `skillset lint` (3 skills), `typecheck` clean, `bun test`
  (91 pass / 0 fail), `bun run check` green, `git diff --check` clean, working
  tree clean.
- Live-doc verifications dated 2026-06-03: Codex plugin hooks
  (`developers.openai.com/codex/plugins/build`), Codex AGENTS.md size limit
  (`developers.openai.com/codex/guides/agents-md`, `openai/codex#7138`), Claude
  plugin components (`code.claude.com/docs/en/plugins-reference`), Codex plugin
  components (`developers.openai.com/codex/plugins`).
- Forbidden actions: none. No publish, install, trust, symlink, user-config
  mutation, remote, push, PR, or merge. The adjacent `agents` repo was not
  touched in this goal.

## Execution Summary

Planned hardening slice based on Claude audit run `2b6f6349`.

Scope:
- kitchen-sink fixture;
- hook compatibility lint;
- resource `to:` behavior;
- fail-open generated-state handling;
- stable ordering;
- doc tracker drift.

Current execution state:
- Complete. All four slices implemented and verified; all P0/P1/P2 review
  findings fixed; final local review found no blockers.
- No commits, pushes, PRs, or tracker changes (per hard rules).

## Branch / PR / Issue Ledger

- Assigned tracker: none yet.
- Related backlog/issues from docs:
  - PAT-47: global/XDG managed installs, explicitly out of this slice.
  - PAT-52: changelog/version workflow, explicitly out of this slice except doc
    pointer cleanup.
  - PAT-43: semver/version drift work, treated as completed where docs say so.
- Planner observed branch:
  `pat-58-support-shared-resources-in-skillset-source-plugins`
- Preexisting dirty state:
  project-local `.claude/settings.local.json` was machine-local/untracked and is
  now covered by `.gitignore`; it remains outside the patch and outside source
  truth.
- Execution branch:
  `pat-58-support-shared-resources-in-skillset-source-plugins` (worked in place;
  no new branch created, no commits made — left for Matt to stage/commit/stack).
  The `agents` repo is on the same branch name and received docs plus generated
  lock edits (uncommitted) for tracker-pointer / surface-matrix drift and
  generated-output freshness.
- PR:
  none.
- Issue:
  none assigned.

## Tracker Mutations

- Planner performed no tracker mutations.
- Executor performed no tracker mutations: no Linear create/update/comment/
  status/dependency changes. PAT-43/47/52 ownership was corrected only in repo
  docs (`agents` repo), not in Linear.
- 2026-06-03 — Skillset team backlog bootstrapped in Linear after Matt created
  the new team. Created roadmap parent `SET-1` and child issues:
  - `SET-2`: Align Codex hook source and output with documented plugin defaults.
  - `SET-3`: Add `skillset.schema` and separate source schema from content
    versions.
  - `SET-4`: Simplify source identity and naming defaults for plugins and
    skills.
  - `SET-5`: Rename source project rules to instructions with rules
    compatibility.
  - `SET-6`: Rename portable tools policy to `tool_intent` and clarify
    enforcement semantics.
  - `SET-7`: Improve generated `AGENTS.md` boundaries and instruction size
    diagnostics.
  - `SET-8`: Expand target-native plugin pass-through surfaces with fixture
    coverage.
  - `SET-9`: Add `skillset explain`, `diff`, and `doctor` authoring commands.
  - `SET-10`: Add import reports and preserve target-native fields during
    import.
  - `SET-11`: Design changelog and version bump workflow for skills and plugins.
  - `SET-12`: Design global/XDG managed installs and sync outside build
    semantics.
  - `SET-13`: Research agent and subagent source model with target-native
    lowering boundaries.
  - `SET-14`: Create target-surface evidence matrix and golden manifest tests.
  - `SET-15`: Harden shared resource and script authoring diagnostics.
  Parent `SET-1` was updated with an issue map grouping immediate contract work,
  authoring/generated-output quality, tooling/import flow, and deferred design.
  No Linear projects, status changes, assignments, estimates, dates, PRs, pushes,
  or repo remotes were created.

## Planning Log

### 2026-06-03

- Created packet from Claude audit run `2b6f6349`.
- Scope set to first hardening slice:
  kitchen-sink fixture, hook compatibility lint, resource `to:` behavior,
  fail-open generated-state handling, stable ordering, and doc tracker drift.
- Default fixture approach: keep fixture inside the `skillset` repo rather than
  adding test content to `/Users/mg/Developer/galligan/agents`.
- No tracker, source-control, generated-output, registry, install, symlink, or
  user-config mutation performed by planner.

## Design Decisions

Record executor decisions here:

- Fixture location and why: `fixtures/kitchen-sink/` committed in the `skillset`
  repo as a real on-disk `.skillset/` source tree. Tests copy it into a temp dir
  and build, so it exercises hooks/rules/shared resources/`.mcp.json`/companion
  files without polluting `agents` or the repo's own `.skillset/`. The repo
  self-build uses `--root .` (sourceDir `.skillset`), so `fixtures/` is never
  picked up by `skillset:build`/`check`; there are no self-hosted rules, so no
  rule glob scans `fixtures/`.
- Hook compatibility source of truth: live Codex hooks docs checked on
  2026-06-03 (`https://developers.openai.com/codex/hooks`), plus local snapshot
  history in `/Users/mg/patch/research/library/codex/config-reference.md` and
  `config-advanced.md`. Codex events:
  PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact,
  SessionStart, SubagentStart, SubagentStop, UserPromptSubmit, Stop. Codex
  handlers: only synchronous `command` handlers execute; prompt handlers, agent
  handlers, and `async: true` command handlers are parsed but skipped, so those
  fail Codex lint/build. Codex plugins default to `hooks/hooks.json`, but the
  live docs allow plugin manifests to override the hook path, so the current
  root `hooks.json` source/output shape remains valid through the generated
  Codex plugin manifest. Claude events checked against
  `https://code.claude.com/docs/en/hooks`; Claude validation stays broad
  (object shape) because Claude's hook surface is wider and evolving.
- Resource `to:` behavior: rewrite vs reject: **reject** ambiguous bare links.
  When a declared resource uses a custom `to` so its source-relative path
  differs from its emitted target path, a schemeless markdown link to that
  source-relative path is broken (nothing is emitted there). Rather than silently
  mis-rewrite a link that could legitimately point at a skill-local file, the
  build fails with a diagnostic naming the resource URL and the emitted target
  path. This mirrors the existing "undeclared shared resource link fails the
  build" guardrail and keeps rewrites unambiguous. Declared directory resource
  URLs now rewrite child links through the generated target path, so
  `plugin:templates/report.md` can lower to `docs/report.md` when
  `plugin:templates` is emitted to `docs`.
- Stable sort strategy: shared `compareStrings` helper in `src/path.ts` using
  `<`/`>` (UTF-16 code-unit order, locale-independent). Replaces every
  `localeCompare` in the render/resolver/build/resources pipeline so lock and
  hash inputs — and all generated ordering — are independent of host locale
  collation.
- Doc drift updates: README + docs/layout matrix split implemented vs
  aspirational; PAT-52 owns changelog/version workflow, PAT-47 owns global/XDG
  installs, PAT-43 semver/version drift noted done where applicable.
- Local settings: project-local `.claude/settings.local.json` is machine-local
  and ignored. No user-level Claude or Codex config was changed, and no local
  settings file is part of the patch.
- Tenets home: canonical Skillset doctrine now lives at `docs/tenets.md` in the
  compiler repo. `docs/README.md`, root `README.md`, and `AGENTS.md` point to
  it so agents see the slow-moving design layer before changing source schema,
  target lowering, or generated-output promises. This was kept docs-only; no
  `.skillset/` source or generated output was changed for the tenets slice.

## Execution Log

Record meaningful implementation checkpoints here:

- 2026-06-03 — Slice 3 core guardrails (`src/path.ts`, `src/build.ts`,
  `src/render.ts`, `src/resources.ts`): added `compareStrings`, replaced every
  `localeCompare` in render/resolver/build/resources/import, made
  `readWorkspaceManagedPaths` throw on corrupt/malformed `.skillset.lock`,
  narrowed `pluginHasPath` so real FS errors surface, and made
  `rewriteResourceLinks` reject ambiguous bare links to a custom-`to` resource's
  source path.
- 2026-06-03 — Slice 2 hook lint (`src/hooks.ts` new, `src/render.ts`,
  `src/lint.ts`): shared `validateHookDefinition` with Claude/Codex event sets
  and Codex synchronous-command-only handler rule; wired into both the build
  copy path and `skillset lint`. Corrected an existing test fixture that used
  the non-event `session_start` to the real `SessionStart`.
- 2026-06-03 — Closeout live-doc pass: checked live Codex and Claude hook docs,
  added Codex `async: true` command-hook rejection because current Codex parses
  but skips async command hooks, updated docs/skill source, and removed the
  pre-existing unused `graph` parameter from `hashPluginSource`.
- 2026-06-03 — Slice 1 fixture (`fixtures/kitchen-sink/`, README, and
  `src/__tests__/audit-hardening.test.ts`): durable `.skillset/` tree exercising
  shared resources + custom `to`, link rewrite, Claude+Codex hooks, `.mcp.json`,
  Claude `commands/` + Codex `.app.json`, and rules → Claude rules + Codex
  `AGENTS.md` with build-time variables. Tests copy it into a temp repo and
  build/check/lint; negatives cover ambiguous remapped links, Codex hook event
  and handler incompatibility, Claude broad acceptance, corrupt lock, and
  `compareStrings` ordering.
- 2026-06-03 — Review closeout fixes: added `.claude/settings.local.json` to
  `.gitignore`; tightened Codex hook validation to reject missing/non-string
  handler types; made hook lint mirror plugin-output selection; and fixed
  remapped directory resources so bare child links fail while declared
  `shared:`/`plugin:` child URLs rewrite to the generated child path.
- 2026-06-03 — Tenets doctrine slice: added `docs/tenets.md` with
  Trails-style documentation tiers, principles, promises, patterns, current
  doctrine implications, and posture for source-first Claude/Codex loadout
  compilation; added `docs/README.md` as the docs map; linked the tenets from
  root `README.md` and `AGENTS.md`.

## Verification Log

Record command, scope, result, and reason for any skipped check:

- 2026-06-03 (skillset repo, all run): `bun run skillset:build` → wrote 15
  generated files; `bun run skillset:check` → checked 15 (no drift);
  `bun run skillset:lint` → linted 3 source skills; `bun run typecheck` → clean;
  `bun test` → 54 pass / 0 fail / 254 expects; `bun run check` (composite:
  typecheck+test+lint+check+`git diff --check`) → green; `git diff --check` →
  no whitespace errors. No checks skipped.
- 2026-06-03 (skillset repo, focused after final P2 fix):
  `bun test src/__tests__/audit-hardening.test.ts` → 12 pass / 0 fail / 42
  expects; then `bun run check` → green (54 pass / 0 fail / 254 expects,
  linted 3 source skills, checked 15 generated files).
- 2026-06-03 (manual fixture build into temp dir): kitchen-sink builds 31 files;
  inspected Codex SKILL.md link rewrite (`docs/report.md`), rule variable
  rendering, and Codex `AGENTS.md` destinations.
- 2026-06-03 (agents repo): `bun run check` initially failed on stale generated
  locks after the compiler/provenance changes; `bun run skillset:build` rebuilt
  19 generated files; final `bun run check` passed (linted 1 source skill,
  checked 19 generated files, whitespace clean). Changed files are docs plus
  generated lock files. No code, tracker mutation, publish, install, symlink,
  or user config mutation in `agents`.
- 2026-06-03 (skillset repo, tenets docs slice): `git diff --check` → no
  whitespace errors; `bun run check` → green (`tsc --noEmit`, 54 tests pass / 0
  fail / 254 expects, `skillset:lint` linted 3 source skills,
  `skillset:check` checked 15 generated files, final `git diff --check`
  clean). `bun run skillset:build` skipped because no `.skillset/` source files
  changed and generated output remained source-derived/fresh.

## Local Review Log

Record local review score, summary, P0-P3 findings, and prompt-to-fix text:

- 2026-06-03 — `feature-dev:code-reviewer` over the change set (file safety,
  target fidelity, schema/resolver/render correctness, generated-output
  freshness).

  Overall score: 4/5

  Summary: Changeset correctly implements all stated goals. `CODEX_HOOK_EVENTS`
  matched the doc snapshot; command-only handler rule correctly reads "parsed
  but skipped" as a hard failure; `compareStrings` swap correct and tested; lock
  fail-loud is safe (throws before any write); bare-link rejection has no false
  positives/negatives in tested scenarios; hook walker handles flat and
  `{"hooks":{}}` shapes.

  Findings:
  - P2 - `src/render.ts` `hasRenderableContent` (~1262) - `existsSync` swallows
    EACCES, contradicting the new "surface real FS errors" intent; EACCES on the
    companion path itself is still read as absent.
    Prompt To Fix With AI: Replace `existsSync` + `statSync` with a single
    `statSync` in try/catch that returns false only on ENOENT and rethrows other
    errno codes, so EACCES/ELOOP surface.
    STATUS: FIXED — `hasRenderableContent` now stats once and rethrows non-ENOENT.
  - P3 - `src/render.ts` `validateHookJson` (~976) vs `src/lint.ts`
    `lintHookFile` (~102) - build passed an absolute hook path to
    `validateHookDefinition`, lint passed a repo-relative path, so the same bad
    hook produced different message paths.
    Prompt To Fix With AI: Thread `graph.rootPath` into `copyPluginCompanionFiles`
    and pass a repo-relative hook path to `validateHookJson`.
    STATUS: FIXED — companion copy now threads `rootPath`; hook messages are
    repo-relative in both build and lint.

  No-findings statement: Reviewer verified path-safety gate (`resolveInside`),
  resource target validation, Codex event/handler fidelity against the snapshot,
  bare-link normalization, lock fail-loud, and lint wiring; residual risk limited
  to the EACCES-on-companion-path edge (now fixed). Generated output confirmed
  fresh at 15 files.

- 2026-06-03 — Coordinator closeout pass after Matt asked what blocks 5/5.

  Live-doc update: current Codex hooks docs confirm the same event set and add
  that `async: true` command hooks are parsed but skipped. Added a validator
  rejection and test for async Codex command hooks. Current Claude hook docs show
  a much wider event/handler surface than Codex, so Claude validation remains
  intentionally broad.

- 2026-06-03 — `codex review --uncommitted` closeout series.

  Overall score after fixes: 5/5

  Summary: Review inspected staged, unstaged, and untracked changes. It found no
  remaining correctness, security, or maintainability blockers after fixes.
  Reviewer-ran checks: `bun test` (54 pass / 0 fail), `bun run typecheck`
  (clean), and `bun run skillset:check` (checked 15 generated files).

  Findings:
  - P2 - `.claude/settings.local.json` - machine-local project settings were
    showing as untracked and could be accidentally committed.
    Prompt To Fix With AI: Ignore project-local Claude settings in `.gitignore`
    instead of committing or deleting the local file.
    STATUS: FIXED — `.claude/settings.local.json` added to `.gitignore`; file
    remains machine-local and outside source truth.
  - P2 - `src/lint.ts` hook lint - lint originally validated plugin hook files
    even when that plugin was excluded from the target plugin output selection,
    creating a lint/build mismatch.
    Prompt To Fix With AI: Gate hook lint by both the resolved plugin target and
    `isOutputSelected` for the target plugin output.
    STATUS: FIXED — `lintPluginHooks` mirrors render selection; regression test
    added.
  - P2 - `src/resources.ts` remapped directory resources - bare links under a
    directory resource remapped by custom `to` could stay broken without a
    diagnostic.
    Prompt To Fix With AI: Track directory resources and detect bare child
    links under remapped source paths; also rewrite declared `shared:`/`plugin:`
    child URLs through the generated child path.
    STATUS: FIXED — source resource kind recorded; bare child links fail with a
    target/resource-URL diagnostic; declared directory resource URLs rewrite.
  - P3 - `src/hooks.ts` Codex hook handler validation - missing/non-string hook
    handler `type` was not a final review finding, but the review scratch pass
    exposed it as a live edge.
    Prompt To Fix With AI: Treat any non-`command` value, including a missing or
    non-string `type`, as skipped-by-Codex and fail the Codex target.
    STATUS: FIXED — missing/non-string handler type now fails build and lint;
    regression test added.

  No-findings statement: Final review found no discrete issue after these fixes.
  Remaining risk is future provider-surface drift, tracked below.

- 2026-06-03 — ChatGPT Pro external conceptual review recorded.

  Source: Matt-provided pasted response at
  `/Users/mg/.codex/attachments/48a26abb-343d-4415-b342-5c87fd0b158d/pasted-text.txt`.

  Durable digest:
  `.agents/plans/2026-06-03-skillset-audit-hardening/2026-06-03-chatgpt-pro-review-digest.md`

  Summary: Reviewer endorsed the core source-first compiler boundary and
  recommended narrowing v1 around target-native truth. Highest-severity topics
  to discuss: Codex hooks should likely use `hooks/hooks.json` plus a top-level
  `hooks` object; source `rules` may need to become `instructions` to avoid
  Codex `.rules` confusion; portable `tools` may overpromise enforcement and
  should perhaps become `tool_intent`/`access_intent`; `skillset.version`
  should be separated from source schema/compiler provenance.

- 2026-06-03 — Matt review triage decisions recorded.

  Digest section:
  `.agents/plans/2026-06-03-skillset-audit-hardening/2026-06-03-chatgpt-pro-review-digest.md#Matt-Decision-Notes`

  Decisions: accept canonical Codex hook direction; rename source `rules` toward
  `instructions`; rename portable `tools` to `tool_intent`; add
  `skillset.schema`; keep generated artifact version metadata simple rather
  than over-nesting under `skillset`; reconsider why source needs
  `skillset.name` distinct from the real `name`; keep `targets:` out and use
  top-level `claude` / `codex` inheritance with default-both output posture.

## Remote Review / CI Log

Record remote review, CI, source-control host, and bot review state if a PR or
remote review flow is introduced:

- Not applicable yet.

## Generated Output State

Record whether generated outputs changed and why:

- Self-hosted generated outputs changed only because the source
  `.skillset/plugins/skillset/skills/use-skillset/SKILL.md` gained the current
  Codex hook-validation note. `skillset:build` regenerated the matching
  Claude/Codex generated `use-skillset` skills plus both target lock hashes.
- New fixture output under `fixtures/kitchen-sink/` is source only (committed
  `.skillset/` tree); tests build it into temp dirs, so no fixture-generated
  output is committed.
- The adjacent `agents` repo regenerated lock files after compiler/provenance
  drift; its generated output check is current after `bun run skillset:build`.

## Forbidden Actions Audit

Executor confirms:

- No publish: confirmed. No `npm publish`, no package publish, no remote added.
- No global install/trust/symlink: confirmed. No installs, no symlinks, no trust
  changes; generated artifacts stayed repo-local.
- No user-level Claude/Codex config mutation: confirmed. Project-local
  `.claude/settings.local.json` is machine-local and ignored; `~/.claude` and
  `~/.codex` were untouched.
- No remote add, push, PR, or merge without approval: confirmed. No git remote
  operations; no commits made in either repo.
- No legacy GitButler, Obsidian, global-skill, or `agents` migration: confirmed.
  The `agents` repo received docs-only corrections (tracker pointers + surface
  matrix implemented-vs-aspirational) — not content migration, no new target.
- No generated-output hand-editing as source truth: confirmed. Self-hosted
  output was rebuilt from `.skillset/` source (`skillset build`); the
  kitchen-sink fixture commits only `.skillset/` source, never generated output.

## Remaining Risks

Record unresolved P3s or evidence-based rejections:

- Codex hook event list was rechecked against live docs on 2026-06-03. If Codex
  later documents additional events or starts executing async/prompt/agent hook
  handlers, `CODEX_HOOK_EVENTS` / handler validation should be widened.
- Codex plugin docs default to `hooks/hooks.json`, while current source/output
  uses root `hooks.json`; this is valid because generated Codex manifests point
  to `./hooks.json` and live docs allow manifest hook path overrides.
- Codex hook shape supports `{"hooks": {...}}`; the validator also accepts
  top-level event maps for compatibility with earlier local examples.
- `agents` repo docs/lock edits are uncommitted in its working tree for Matt to
  review.

## Final State

Complete before handoff:

- Objective complete: yes. Kitchen-sink fixture proves the unexercised surfaces;
  P1 Codex hook target-compatibility lint added (build + lint); P2 custom-`to`
  bare-link rejection including remapped directory children, fail-loud
  corrupt-lock handling, FS-error surfacing, and stable `compareStrings`
  ordering implemented; doc drift corrected.
- Checks: `bun run skillset:build`, `skillset:check` (15 files), `skillset:lint`
  (3 skills), `bun run typecheck`, `bun test` (54 pass), `bun run check`, and
  `git diff --check` all green. Focused audit-hardening tests: 12 pass. No
  skips.
- Review: initial local review 4/5 with P2/P3 fixed; closeout
  `codex review --uncommitted` final score 5/5/no blockers after P2 fixes.
- Tracker: no Linear mutations.
- Branch: in place on
  `pat-58-support-shared-resources-in-skillset-source-plugins`; no commits.
- Remaining risks: see above (all P3/low).
- Archive readiness: ready once Matt reviews and stages the `skillset` +
  `agents` working-tree changes; no push/PR performed per hard rules.

## Post-Review Polish - 2026-06-03

Matt asked to clean up the remaining import polish while the branch was still
open. Coordinator review had found one small file-safety wart: `skillset import`
created the final `.skillset/skills/<name>` or `.skillset/plugins/<name>`
directory before proving the copy/classification could complete, so a failed
import could leave an empty source-shaped directory behind.

Implemented a transactional import staging flow in `src/import.ts`:

- import now copies into a hidden sibling staging directory under the selected
  source parent;
- the staging directory is removed on every failure path;
- the final target directory is created only by renaming the completed staging
  directory into place;
- the no-overwrite guard is checked before staging and again immediately before
  the rename.

Added a regression in `src/__tests__/contract.test.ts` proving that importing a
non-`SKILL.md` file as a skill fails without leaving
`.skillset/skills/<name>` or hidden staging entries.

Verification after polish:

- `bun test src/__tests__/contract.test.ts` - 38 pass / 0 fail.
- `bun run typecheck` - clean.
- `bun run check` - typecheck, 92 tests / 0 fail, lint, generated-output check,
  and whitespace check all green.
- `bun ./src/cli.ts doctor --root .` - no problems.
- `bun ./src/cli.ts diff --root .` - no generated changes.
- `git diff --check` - clean.

Forbidden-action audit unchanged: no publish/install/trust/symlink/user-config
mutation/remote/push/PR/merge.

## Import Inference Polish - 2026-06-03

Matt asked to implement the import behavior discussed after the global
`.agents/skills`, `.claude/skills`, and `.codex/skills` review.

Implemented:

- `skillset import <path>` now infers `skill`, `skills`, `plugin`, or `plugins`
  from the filesystem.
- `--kind skill|skills|plugin|plugins` is supported, with `--kind skills` as
  the plural root for directories whose children are skill directories.
- Compatibility forms `skillset import skill <path>` and
  `skillset import plugin <path>` still work.
- Provider shortcuts `skillset import claude`, `skillset import codex`, and
  `skillset import agents` map to `~/.claude/skills`, `~/.codex/skills`, and
  `~/.agents/skills` respectively. `--from` is accepted as an explicit provider
  hint.
- Passing a `SKILL.md` path imports the full containing skill directory rather
  than only `SKILL.md`, preserving sibling `references/`, `scripts/`, `assets/`,
  `.codex/`, and other sidecars.
- Skills-root imports follow symlinked skill directories and de-dupe by
  realpath; unresolved/broken entries are skipped during discovery.
- Plugin-root imports can read native generated plugin directories with
  `.claude-plugin/plugin.json` or `.codex-plugin/plugin.json`. When no source
  config exists, import synthesizes a minimal source `skillset.yaml` from the
  native manifest while preserving the native manifest as imported context.
- README, layout docs, and the self-hosted `use-skillset` source skill were
  updated; generated Claude/Codex plugin outputs and `.skillset.lock` files were
  rebuilt from source.

Tests added:

- full skill-directory copy when importing a `SKILL.md` path;
- inferred `skills` root import plus symlink de-dupe;
- inferred plugin repository import plus synthesized source config for native
  plugin manifests;
- CLI smoke for `skillset import <path> --kind skills`.

Verification before final handoff:

- `bun run skillset:build` - wrote 15 generated files.
- `bun run typecheck` - clean.
- `bun test src/__tests__/contract.test.ts src/__tests__/skillset.test.ts` - 84
  pass / 0 fail.
- `bun run check` - typecheck, 96 tests / 0 fail, `skillset:lint`,
  `skillset:check` (15 generated files), and `git diff --check` green.

Forbidden-action audit unchanged: no publish, install, trust, symlink,
user-level Claude/Codex config mutation, registry mutation, remote add, push,
PR, merge, legacy import, Obsidian import, or global migration. The adjacent
`agents` repo was not modified in this slice.
