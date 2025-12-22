# Skillset Rename Plan Review

Scope: Full review of `.agents/plans/skillset-rename/*` for risks, gaps, and validation readiness ahead of the refactor.

## Findings (ordered by severity)

### Blockers

1) XDG override bug in `packages/shared/src/paths.ts` (Phase 0 spec)
- The proposed `getConfigDir()` returns `process.env.XDG_CONFIG_HOME` **without** appending `/skillset`, while `getDataDir()` and `getCacheDir()` do append `/skillset`.
- This contradicts the Phase 3 doc and example (`XDG_CONFIG_HOME=~/.myconfig` should resolve to `~/.myconfig/skillset`).
- Impact: user-level config will be looked up in the wrong directory when XDG vars are set; this breaks config loading and migration tests.
- Fix: `return process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, "skillset") : ...` to match data/cache behavior.

### High

2) `$<ref>` ambiguity between skill and set needs explicit resolution rules
- You’ve intentionally made `$<ref>` interchangeable for skills/sets. That requires a deterministic resolution policy in non-interactive contexts.
- Impact: hooks/inject (non-TTY) can’t prompt; silent guesses are dangerous.
- Recommendation: define and implement a clear order (alias map → single match → error). For CLI, add `--kind` and interactive selection in TTY. For prompt tokens, allow `$set:<ref>` / `$skill:<ref>` to force kind resolution.

3) Tokenization must strictly enforce kebab-case and reject uppercase/snake_case
- Requirement: no `$ALLCAPS`, no underscores, no camelCase.
- Impact: current token regex and tests must be updated so invalid tokens never resolve.
- Recommendation: add negative tests and enforce strict regex in tokenizer + resolver.

4) Migration safety nets still under-specified
- Phase 3/4/6 imply path and schema changes, but migration behavior is not defined.
- Required: `kits → sets`, `.claude/wskill` → `.skillset`, user XDG paths, and any config alias migration.
- Recommendation: implement idempotent migration with explicit prompts and a report of actions (never overwrite).

5) CLI output policy needs precedence rules
- `--json` / `--raw` / `--quiet` / `--verbose` can conflict, especially for `load`.
- Recommendation: centralize output policy, disable spinners/logs for machine outputs, and test combinations.

### Medium

6) Regex note for `$` should be corrected everywhere
- In JS regex literals, `$` must be escaped to match a literal dollar sign.
- Recommendation: update the phase doc and add a unit test for literal `$` matching.

7) Codex skill paths should be integrated into sync/migration guidance
- Codex loads skills from `.codex/skills` in repo scopes and `$CODEX_HOME/skills` (default `~/.codex/skills`) plus `/etc/codex/skills`.
- Recommendation: incorporate these paths into sync defaults and documentation.

8) Shell usage guidance should avoid `$` in CLI args
- User expectation: `$` tokens are for prompt text, not CLI arguments.
- Recommendation: ensure docs/tests use plain refs in CLI (`skillset show foo`) and only use `$` inside prompt content (quoted when needed).

### Low

9) Phase order mentions docs after Phase 8; but Phase 6 includes CLI redesign examples
- Align doc updates strictly after CLI redesign is implemented to prevent drift.

10) Some validation steps rely on `.claude/skills`
- If skill directories move to `.skillset/skills` later, update validation steps.

## Phase-by-phase notes

### Phase 0: Monorepo Conversion

- Good breakdown and dependency graph.
- Clarify build toolchain per package (tsc vs bun build), and ensure `exports` and `types` are consistent across packages.
- Fix the `getConfigDir()` behavior (see blocker #1).

### Phase 1: Core Naming

- Clear checklist.
- Ensure `bin` entry changes align with `apps/cli/package.json` and not root.
- Confirm any `wskill` strings in CLI help are also updated in tests.

### Phase 2: Invocation Syntax

- Tokenizer must enforce kebab-case and reject uppercase/snake_case.
- `$<ref>` is prompt-only; CLI args should be plain refs.

### Phase 3: Directory Structure

- Good XDG rationale and migration outline.
- Ensure `skillset init` migration does not overwrite existing `.skillset` if present.
- Add explicit precedence: project config overrides user config; user overrides defaults.
- Add Codex path handling for sync targets.

### Phase 4: Kit → Set

- Syntax is now shared (`$<ref>`). This increases ambiguity; ensure collision handling is implemented and tested.
- Ensure config schema migration for `kits` → `sets` is defined.

### Phase 5: Plugin Update

- Good checklist. Confirm that `.claude-plugin/plugin.json` path is correct after monorepo conversion (if plugin is moved).
- `import("skillset/hook")` depends on `exports` mapping in `apps/cli/package.json`.

### Phase 6: Documentation

- Make sure examples use `$<ref>` only in prompt text, not CLI args.
- Update any guidance on collisions to mention `--kind` and interactive prompts.

### Phase 7: Validation

- Add negative token tests (`$ALLCAPS`, `$snake_case`).
- Add ambiguity tests for set vs skill name collisions.

### Phase 8: CLI Redesign

- Good UX direction; ensure interactive behavior uses both `process.stdin.isTTY` and `process.stdout.isTTY`.
- Define how `--json` and `--raw` interact with spinners/logging.
- For `skillset sync`, incorporate Codex path defaults.

## Suggested additions

- **Collision policy**: a short section describing alias precedence, interactive prompts, and non-TTY errors for ambiguous `$<ref>`.
- **Migration spec**: explicit, idempotent migration behavior with a report of actions taken.
- **Output policy**: a short decision table for `--json`/`--raw`/`--quiet`/`--verbose`.

## Summary

The plan is comprehensive and mostly sound, but you must explicitly define the `$<ref>` collision policy, enforce strict kebab-case tokenization, and fix the XDG override logic. Once those are addressed and Codex paths are included, the refactor should be straightforward to execute.
