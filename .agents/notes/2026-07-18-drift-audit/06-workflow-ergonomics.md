# 06 — Asymmetric verbs and buried recovery paths

Workflows where the create-side is first-class but the
inspect/undo/recover-side is missing or hidden. Directly continues the
2026-07-18 conversation about the pre-push change-coverage failure and
adoption-time collision safety.

### 06.1 — Change-coverage failure prints no recovery command at the terminal (confirmed, HIGH ergonomics — [SET-328](https://linear.app/outfitter/issue/SET-328/print-structured-recovery-guidance-for-skillset-check-ci-failures))
- `printCiReport` (`apps/skillset/src/check-cli.ts:155-272`) prints raw issue
  lines only; the recovery guidance ("Add or fix pending changes with
  `skillset change add …` or `skillset change migrate --yes`") exists solely in
  the Markdown report (`apps/skillset/src/ci.ts:393-397`). An agent at the
  pre-push gate never sees it.
- **Fix:** print the existing hint string in `printCiReport` when change errors
  are present.

### 06.2 — No `skillset change refresh` for stale stacked evidence (confirmed, HIGH ergonomics, decided-needed on shape)
- `change-evidence-stale` means an existing reason covers the scope at an old
  hash. Recovery today is hand-authoring `change.covered` ledger events (the
  retro's 23 `evt-set309-refresh-*` events were manual; `ledgerEventId` can't
  even produce those mnemonics — `change-workflow.ts:553-561`).
- Mechanically safe to automate: `expectedHashForScope` gives the target,
  `appendLedgerEvents` writes; purely additive, invents no authored intent.
  Natural home: `skillset change refresh` or lifting the stale case out of the
  `--fix` exclusion (`ci.ts:214-224` — keep `change-uncovered` excluded; that
  one requires authored reason+bump).
- Middle path for `change-uncovered`: `--fix` scaffolds a draft entry with
  correct scope/hash and a placeholder reason that still fails
  `change-reason-placeholder` — fill-in-the-blank instead of cryptic error.
- The "established stacked-branch evidence procedure" is documented nowhere;
  the command would replace tribal knowledge.

### 06.3 — No `change discard` verb; CI text references a discard action that doesn't exist (confirmed, MEDIUM)
- `change` verbs: add/amend/check/history/list/migrate/reason/show/status
  (`apps/skillset/src/cli-commands.ts`); `ci.ts:348` tells users to
  "intentionally discard them" — only possible by deleting the file by hand
  (and the ledger keeps the orphaned events).
- **Fix:** `change discard <@ref>` (or point the guidance at the manual step).

### 06.4 — `restore` requires a backup id the user cannot enumerate (confirmed, MEDIUM)
- Backups created implicitly (`packages/core/src/build.ts:137,147`), ids
  surfaced only transiently in stdout (`dev-watch.ts:279-281`,
  `release.ts:177`); `restore` throws without an id
  (`recovery-cli.ts:17-42`). No listing verb — contrast `test list`.
- Manifests are on disk (`.skillset/snapshots/<runId>/manifest.json`) with
  action/reason/hashes/source-path — a `restore --list` (or `skillset status`
  section) is pure presentation.
- Bigger arc (from the adoption discussion): the adoption ADR deferred a guided
  cutover/eject command ("can earn its place later",
  `docs/adrs/drafts/20260610-one-action-repo-adoption.md:76-77`). If adoption
  volume grows, `restore --list` is step one toward a browsable "here's what
  Skillset replaced" surface.

### 06.5 — Hook attachments: added by `new hook`, removed by hand (observed, LOW-MEDIUM, verify)
- SET-310 built comment-preserving `hooks.auto` attachment *appends*
  (`appendAdaptiveHookAttachment`, `adaptive-hook-authoring.ts:78-109`). No
  detach/remove counterpart verb surfaced in the audit. Removal is a hand-edit
  of source YAML/frontmatter — fine for now, but note the asymmetry alongside
  06.3/06.4 if an `edit`/`remove` family ever lands.

### 06.6 — `--fix` scope is opaque at failure time (observed, LOW)
- `check --ci --fix` deliberately fixes only generated-output drift
  (`ci.ts:210-237`); change/lint errors are report-only. Nothing at failure
  time says which errors `--fix` would/wouldn't touch, so agents try it and
  learn by re-failing. Cheap fix: annotate the failure summary with
  "fixable with --fix" / "requires change add".

## Batch shape
06.1 is a chip already. 06.2 + 06.3 form one "change-workflow verbs" PR;
06.4 is a standalone small PR; 06.5/06.6 are riders. All are independent of
the other notes' batches — good parallel track.
