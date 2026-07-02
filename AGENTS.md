# AGENTS.md

This repo contains the local `skillset` compiler.

The repo now self-hosts source in the canonical Skillset workspace layout:

- standalone internal skills for developing `skillset` itself;
- one generated `skillset` plugin for using the compiler in other source-first repos.

## Doctrine

Read [docs/tenets.md](docs/tenets.md) before changing the source contract, target rendering model, schema vocabulary, or generated-output promises. The tenets are the slow-moving design layer; implementation docs and generated agent guidance should align with them.

For source/config/frontmatter fields, follow [docs/schema-contracts.md](docs/schema-contracts.md). Shared structural shape belongs in `@skillset/schema`; compiler and Workbench consumers should route through that package instead of maintaining parallel field lists. Regenerate schema artifacts with `bun run schema:generate` and verify with `bun run schema:check`.

## Responsibilities

- Read adaptive source from a repo's `.skillset/` directory with workspace/source config in root `skillset.yaml`.
- Emit target-native plugin bundles under `plugins/<plugin>/<provider>/` by default, with shared generated provenance in `plugins/skillset.lock`.
- Emit standalone skills under configured target skill roots, defaulting to `.claude/skills` and `.agents/skills`.
- Emit source instructions from `<source-root>/rules/**/*.md` to Claude `.claude/rules/**/*.md` and Codex directory-local `AGENTS.md` files without overwriting unmanaged guidance.
- Preserve plugin boundaries across Claude and Codex outputs.
- Keep source-only `skillset` metadata out of generated artifacts except for lightweight generated `metadata.version` and `metadata.generated` fields.
- Write deterministic `skillset.lock` files near generated outputs.
- Provide local source import helpers for existing plugins and skills.

## Commands

```bash
bun run skillset:build
bun run skillset:lint
bun run skillset:check
bun run skillset:verify
bun run skillset:ci
bun run conformance:fast
bun run conformance:determinism
bun run conformance:adapters
bun run conformance:external
bun run changeset:check
bun run changeset:status
bun run publish:check
bun run publish:label-release-pr
bun run publish:policy
bun run schema:check
bun run schema:generate
bun run hooks:install
bun run hooks:pre-push
bun run ultracite:doctor
bun run typecheck
bun test
bun run check
bun run terminology:guard
./scripts/bootstrap.sh [repo|agent|codex|claude|doctor|teardown]
```

`bun run terminology:guard` blocks retired compiler vocabulary (the render-result and `compile.unsupportedDestination` cutover) from drifting back into active source, docs, generated guidance, CLI output, schema names, and tests. It runs inside `bun run check`. When it fails, prefer fixing the source to use the derive/render/destination vocabulary; only extend the explicit allowlists in `scripts/terminology-guard.ts` for deliberate historical (ADR) or deferred-concept context.

`bun run skillset:ci` is the same aggregate check GitHub Actions runs (`.github/workflows/ci.yml`): lint, change-entry coverage, and generated drift. Pass `--fix` to rebuild stale generated output mechanically. Content repos scaffold the equivalent workflow with `skillset init --include ci`.

`bun run conformance:fast` reruns the fast deterministic projection and adapter conformance suites without running the whole test corpus. `bun run check` already includes those suites through `bun run test`, so CI and pre-push use the same aggregate gate without duplicating them. `bun run conformance:external` is the opt-in slow lane for pinned external adoption fixtures; it may fetch/reset clones and writes reports under `.skillset/cache/fixtures/`, so keep it out of default gates.

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

`bun run check` includes self-hosted source checks and generated-output verification. If `skillset:verify` reports stale output, run `bun run skillset:build`, inspect the generated diff, then rerun `bun run check`.

## Constraints

- Do not publish this package or add a remote unless the maintainer explicitly asks.
- Do not mutate user-level Claude or Codex config.
- Do not install, trust, or symlink generated plugins or skills into global runtime locations.
- Do not hand-edit `.claude/skills`, `.agents/skills`, or `plugins/` as source truth; in this repo, edit `.skillset/` for source or `skillset.yaml` for workspace config, then rebuild.
- Keep this package focused on compilation, validation, import, and checks.
