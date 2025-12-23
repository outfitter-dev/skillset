# Skillset Harness

The headless harness validates aliases, sets, and hook behavior without requiring a full interactive agent session.

## Run

- Hook only (CI mode):
  - `bun run test:harness -- --tools hook --hook-mode ci --clean`
- Hook CLI mode (plugin + CLI path):
  - `bun run test:harness -- --tools hook --hook-mode cli --clean`
- Full run (hook + Claude + Codex):
  - `bun run test:harness -- --clean`

## Hook modes

The harness exercises two hook paths to mirror real deployments:

- **CI mode (`hook-ci`)**: Forces module execution (no CLI). Simulates CI or minimal installs.
- **CLI mode (`hook-cli`)**: Uses a temporary `skillset` shim that runs the CLI entrypoint.

Select modes with `--hook-mode ci|cli` (comma-separated for both).

## Reports

Reports are written to:

- `.skillset-harness/reports/<runId>/report.json`

Each step includes status, duration, and sentinel evidence. When a step fails, inspect its stdout/stderr paths.

## Claude plugin hook

The Claude plugin ships in `plugins/skillset/.claude-plugin` and references `hooks/hooks.json`.
When installed, Claude Code executes `plugins/skillset/scripts/skillset-hook.ts`, which:

- Uses the CLI by default when `skillset` is in PATH
- Falls back to the module runner when the CLI is not available
- Can be forced with `SKILLSET_HOOK_MODE=cli|module`
- `SKILLSET_PROJECT_ROOT` can override the project root when running the CLI

This means installed environments usually run the CLI path, while CI-like environments use the module path.
