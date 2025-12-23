# Skillset Smoke Test Reference

This reference is for deeper context beyond the quick steps in SKILL.md.

## What the smoke test does

- Creates a sandbox workspace under `.skillset-smoke/workspace/`.
- Writes fixture skills into `.claude/skills` and `.codex/skills` inside the sandbox.
- Writes `.skillset/config.json` and `.skillset/cache.json` for deterministic resolution.
- Runs these steps in order:
  1. `build-core` (when hook CLI mode is enabled)
  2. `index` (builds cache from sandbox skills)
  3. `set-load` (loads the configured set and checks sentinel evidence)
  4. `hook-ci` (runs the plugin hook via module path)
  5. `hook-cli` (runs the plugin hook via CLI shim)
  6. `claude` (optional, headless CLI)
  7. `codex` (optional, headless CLI)

## Report format

Reports are written to:

- `.skillset-smoke/reports/<runId>/report.json`

Key fields:

- `runId`: ISO timestamp string.
- `workspace`: sandbox workspace path.
- `steps`: array with one entry per step:
  - `status`: `ok | failed | skipped`
  - `duration_ms`: wall time for the step
  - `exitCode`: numeric exit code or `null`
  - `stdoutPath` / `stderrPath`: optional paths for command output
  - `details.evidence`: array of `{ id, seen }` sentinel checks

## Expected behavior

- `index` should show `skillCount: 2` for the two fixture skills.
- `set-load` should show both sentinels as `seen: true`.
- `hook` should show both `alpha-skill` and `beta-skill` sentinels when a set is used.

## Hook modes

The smoke test exercises two hook paths to mirror real environments:

- **CI mode (`hook-ci`)**: Forces module execution (no CLI). Simulates CI or minimal installs.
- **CLI mode (`hook-cli`)**: Uses a temporary `skillset` shim that runs the CLI entrypoint.

Control modes with:

- `--hook-mode ci` (only module path)
- `--hook-mode cli` (only CLI path)
- `--hook-mode ci,cli` (default)

The smoke test cleans the sandbox by default. Use `--no-clean` to keep the workspace and XDG state.

## Common failures and fixes

- `index` fails with module/import errors:
  - Ensure you are in repo root and using `bun run test:smoke`.
- `set-load` shows sentinels missing:
  - Confirm `.skillset-smoke/workspace/.claude/skills` exists and has SKILL.md files.
  - Re-run (default clean) or force `--no-clean` if you need to inspect state.
- `hook` shows no evidence:
  - Confirm `set-load` evidence is correct first.
  - Then inspect `.skillset-smoke/reports/<runId>/skillset-hook.json`.
- `claude` or `codex` step `skipped`:
  - CLI not installed or not in PATH.
  - Install the CLI and authenticate, then re-run.
- `claude` or `codex` step `failed`:
  - Inspect `stderrPath` for auth or network errors.

## Environment overrides

- `SKILLSET_SMOKE_CLAUDE_CMD` (default: `claude`)
- `SKILLSET_SMOKE_CLAUDE_ARGS` (extra args)
- `SKILLSET_SMOKE_CODEX_CMD` (default: `codex`)
- `SKILLSET_SMOKE_CODEX_ARGS` (extra args)
- `SKILLSET_PROJECT_ROOT` (override project root for CLI mode)

## Where to change fixtures

- Edit `scripts/skillset-smoke.ts` to adjust skills, prompts, or sentinel values.
