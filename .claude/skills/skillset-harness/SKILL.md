---
name: skillset-harness
description: Run and evaluate the Skillset headless test harness (aliases, sets, and skill invocation) and interpret its JSON reports. Use this when validating $skill/$set behavior or checking Claude Code/Codex headless runs.
---

# Skillset Harness Runner

## Run the harness

- Prefer the repo script so results are structured and gitignored.
- Quick smoke (hook-only):
  - `bun run test:harness -- --tools hook --clean`
- Full run (hook + Claude + Codex):
  - `bun run test:harness -- --clean`

## Options

- `--tools hook,claude,codex` to limit which tools run.
- `--clean` to reset the sandbox workspace and XDG dirs.
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

## Notes

- Outputs are stored under `.skillset-harness/` and are gitignored.
- If the `.codex/skills` symlink is missing, re-create it to mirror this skill.
