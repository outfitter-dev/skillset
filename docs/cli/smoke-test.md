# Skillset Smoke Test

The headless smoke test validates aliases, sets, and hook behavior without requiring a full interactive agent session.

## Run

- Hook only (CI mode):
  - `bun run test:smoke:ci`
- Hook CLI mode (plugin + CLI path):
  - `bun run test:smoke:cli`
- Full run (hook + Claude + Codex):
  - `bun run test:smoke`

The smoke test cleans the sandbox by default. Use `--no-clean` to keep previous state.

## Hook modes

The smoke test exercises two hook paths to mirror real deployments:

- **CI mode (`hook-ci`)**: Forces module execution (no CLI). Simulates CI or minimal installs.
- **CLI mode (`hook-cli`)**: Uses a temporary `skillset` shim that runs the CLI entrypoint.

Select modes with `--hook-mode ci|cli` (comma-separated for both).

## Reports

Reports are written to:

- `.skillset-smoke/reports/<runId>/report.json`

Each step includes status, duration, and sentinel evidence. When a step fails, inspect its stdout/stderr paths.

Note: `.skillset-smoke/` is fully generated at runtime (workspace + reports) and is gitignored. You do not need to check it in for the smoke test to work.

## Claude plugin hook

The Claude plugin ships in `plugins/skillset/.claude-plugin` and references `hooks/hooks.json`.
When installed, Claude Code executes `plugins/skillset/scripts/skillset-hook.ts`, which:

- Uses the CLI by default when `skillset` is in PATH
- Falls back to the module runner when the CLI is not available
- Can be forced with `SKILLSET_HOOK_MODE=cli|module`
- `SKILLSET_PROJECT_ROOT` can override the project root when running the CLI

This means installed environments usually run the CLI path, while CI-like environments use the module path.
