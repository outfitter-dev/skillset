# Skillset Harness Reference

This reference is for deeper context beyond the quick steps in SKILL.md.

## What the harness does

- Creates a sandbox workspace under `.skillset-harness/workspace/`.
- Writes fixture skills into `.claude/skills` and `.codex/skills` inside the sandbox.
- Writes `.skillset/config.json` and `.skillset/cache.json` for deterministic resolution.
- Runs these steps in order:
  1. `index` (builds cache from sandbox skills)
  2. `set-load` (loads the configured set and checks sentinel evidence)
  3. `hook-ci` (runs the plugin hook via module path)
  4. `hook-cli` (runs the plugin hook via CLI shim)
  5. `claude` (optional, headless CLI)
  6. `codex` (optional, headless CLI)

## Report format

Reports are written to:

- `.skillset-harness/reports/<runId>/report.json`

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
- `hook` should show `alpha-skill` sentinel as `seen: true` and may not show `beta-skill`.
  - This is expected: set tokens are not expanded into injected skill content.

## Hook modes

The harness exercises two hook paths to mirror real environments:

- **CI mode (`hook-ci`)**: Forces module execution (no CLI). Simulates CI or minimal installs.
- **CLI mode (`hook-cli`)**: Uses a temporary `skillset` shim that runs the CLI entrypoint.

Control modes with:

- `--hook-mode ci` (only module path)
- `--hook-mode cli` (only CLI path)
- `--hook-mode ci,cli` (default)

## Common failures and fixes

- `index` fails with module/import errors:
  - Ensure you are in repo root and using `bun run test:harness`.
- `set-load` shows sentinels missing:
  - Confirm `.skillset-harness/workspace/.claude/skills` exists and has SKILL.md files.
  - Re-run with `--clean`.
- `hook` shows no evidence:
  - Confirm `set-load` evidence is correct first.
  - Then inspect `.skillset-harness/reports/<runId>/skillset-hook.json`.
- `claude` or `codex` step `skipped`:
  - CLI not installed or not in PATH.
  - Install the CLI and authenticate, then re-run.
- `claude` or `codex` step `failed`:
  - Inspect `stderrPath` for auth or network errors.

## Environment overrides

- `SKILLSET_HARNESS_CLAUDE_CMD` (default: `claude`)
- `SKILLSET_HARNESS_CLAUDE_ARGS` (extra args)
- `SKILLSET_HARNESS_CODEX_CMD` (default: `codex`)
- `SKILLSET_HARNESS_CODEX_ARGS` (extra args)
- `SKILLSET_PROJECT_ROOT` (override project root for CLI mode)

## Where to change fixtures

- Edit `scripts/skillset-harness.ts` to adjust skills, prompts, or sentinel values.
