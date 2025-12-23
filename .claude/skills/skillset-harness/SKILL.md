---
name: skillset-harness
description: Run and evaluate the Skillset headless test harness (aliases, sets, and skill invocation) and interpret its JSON reports. Use this when validating $skill/$set behavior or checking Claude Code/Codex headless runs.
---

# Skillset Harness Runner

Keep this skill self-contained. If you need more detail, read `REFERENCE.md`.

## Prereqs

- Ensure `bun` is available.
- For full runs, ensure `claude` and `codex` CLIs are installed and authenticated.
- Run from the repo root so the harness can find `scripts/skillset-harness.ts`.

## Run the harness

- Prefer the repo script so results are structured and gitignored.
- Quick smoke (hook-only):
  - `bun run test:harness:ci`
- Hook-only (CLI mode):
  - `bun run test:harness:cli`
- Full run (hook + Claude + Codex):
  - `bun run test:harness`

## Options

- `--tools hook,claude,codex` to limit which tools run.
- `--hook-mode ci|cli` to choose the hook path (repeatable or comma-separated).
- `--no-clean` to preserve the sandbox workspace and XDG dirs.
- `--clean-all` to wipe all harness artifacts (workspace + reports).
- `--strict` to exit non-zero if any step fails.

## Environment overrides

- `SKILLSET_HARNESS_CLAUDE_CMD` (default: `claude`)
- `SKILLSET_HARNESS_CLAUDE_ARGS` (extra args)
- `SKILLSET_HARNESS_CODEX_CMD` (default: `codex`)
- `SKILLSET_HARNESS_CODEX_ARGS` (extra args)

## Interpret results

- Reports live under `.skillset-harness/reports/<runId>/report.json`.
- Check `steps[*].status` and `steps[*].details.evidence` for sentinel hits.
- When a step fails, inspect its `stdoutPath`/`stderrPath` for errors.
  - Hook steps are labeled `hook-ci` and `hook-cli`.
  - The harness cleans by default; re-run with `--no-clean` to keep state for debugging.

## Triage checklist

Use this checklist in order when a run fails or evidence is missing:

1. Open the report JSON and find the first `steps[*].status !== "ok"`.
2. If `stdoutPath`/`stderrPath` exist, read them for the error message.
3. Confirm the workspace and XDG paths in the report (they must be under `.skillset-harness/`).
4. If a tool step is `skipped`, verify the CLI is installed and auth is valid.
5. If `hook` evidence is missing for a set, rely on the `set-load` evidence instead (set tokens are not injected into hook output).
6. If sentinels are missing for skills, confirm the harness created fixtures in `.skillset-harness/workspace/.claude/skills`.
7. Re-run with `--tools hook --clean` to isolate local resolution issues before retrying full runs.

## Notes

- Outputs are stored under `.skillset-harness/` and are gitignored.
- If the `.codex/skills` symlink is missing, re-create it to mirror this skill.
