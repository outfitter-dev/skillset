# AGENTS.md

This repo contains the local `skillset` compiler.

The repo now self-hosts source under `.skillset/`:

- standalone internal skills for developing `skillset` itself;
- one generated `skillset` plugin for using the compiler in other source-first repos.

## Doctrine

Read [docs/tenets.md](docs/tenets.md) before changing the source contract, target lowering model, schema vocabulary, or generated-output promises. The tenets are the slow-moving design layer; implementation docs and generated agent guidance should align with them.

## Responsibilities

- Read portable source from a content repo's `.skillset/` directory.
- Emit target-native plugin repositories under configured output roots, defaulting to `plugins-claude/` and `plugins-codex/`.
- Emit standalone skills under configured target skill roots, defaulting to `.claude/skills` and `.agents/skills`.
- Emit source instructions from `.skillset/instructions/**/*.md` to Claude `.claude/rules/**/*.md` and Codex directory-local `AGENTS.md` files without overwriting unmanaged guidance.
- Preserve plugin boundaries across Claude and Codex outputs.
- Keep source-only `skillset` metadata out of generated artifacts except for lightweight generated `metadata.version` and `metadata.generated` fields.
- Write deterministic `.skillset.lock` files near generated outputs.
- Provide local source import helpers for existing plugins and skills.

## Commands

```bash
bun run skillset:build
bun run skillset:lint
bun run skillset:check
bun run skillset:ci
bun run conformance:fast
bun run conformance:determinism
bun run conformance:adapters
bun run changeset:status
bun run publish:check
bun run hooks:install
bun run hooks:pre-push
bun run ultracite:doctor
bun run typecheck
bun test
bun run check
./scripts/bootstrap.sh [repo|agent|codex|claude|doctor|teardown]
```

`bun run skillset:ci` is the same aggregate check GitHub Actions runs (`.github/workflows/ci.yml`): lint, change-entry coverage, and generated drift. Pass `--fix` to rebuild stale generated output mechanically. Content repos scaffold the equivalent workflow with `skillset init --include ci`.

`bun run conformance:fast` reruns the fast deterministic projection and adapter conformance suites without running the whole test corpus. `bun run check` already includes those suites through `bun run test`, so CI and pre-push use the same aggregate gate without duplicating them.

Package releases are GitHub Actions-owned. Use Changesets for package-facing changes, and use `bun run publish:check` as a local dry-run preflight. Do not run `bun run publish:packages` locally unless the maintainer explicitly chooses a release recovery path.

`lefthook.yml` is the single source of truth for the local gates. `bun run hooks:install` installs them as git hooks; `bun run hooks:pre-push` runs the full pre-push gate anywhere (push-range whitespace, workflow lint when `actionlint` is available, `bun run check`, and the self-hosted `skillset ci` report scoped to the remote trunk). Push-range gates resolve the trunk via `scripts/git-trunk.sh` (`origin/HEAD`, typically `origin/main`).

Ultracite is wired in setup-first mode. `bun run ultracite:doctor` must stay clean and is part of `bun run check`; `bun run ultracite:check` / `bun run ultracite:fix` expose the strict Oxlint/Oxfmt cleanup backlog but are not yet required gates.

The repo pins Bun in `.bun-version` and `packageManager`; update both together
when intentionally moving Skillset to a newer Bun runtime.

Read-only authoring aids (never write outputs or mutate config):

```bash
bun ./apps/skillset/src/cli.ts diff --root .
bun ./apps/skillset/src/cli.ts explain <path> --root .
bun ./apps/skillset/src/cli.ts doctor --root .
```

`bun run check` includes the self-hosted generated-output check. If `skillset:check` reports stale output, run `bun run skillset:build`, inspect the generated diff, then rerun `bun run check`.

## Constraints

- Do not publish this package or add a remote unless the maintainer explicitly asks.
- Do not mutate user-level Claude or Codex config.
- Do not install, trust, or symlink generated plugins or skills into global runtime locations.
- Do not hand-edit `.claude/skills`, `.agents/skills`, `plugins-claude`, or `plugins-codex` as source truth; edit `.skillset/` and rebuild.
- Keep this package focused on compilation, validation, import, and checks.
