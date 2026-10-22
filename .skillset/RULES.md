---
cursor: false
---

# Skillset repository guide

This repo contains the local `skillset` compiler.

The repo now self-hosts source in the canonical Skillset workspace layout:

- standalone internal skills for developing `skillset` itself;
- one generated `skillset` plugin for using the compiler in other source-first repos.

## Doctrine

Read [docs/project/tenets.md](docs/project/tenets.md) before changing the source contract, target rendering model, schema vocabulary, or generated-output promises. The tenets are the slow-moving design layer; implementation docs and generated agent guidance should align with them.

For source/config/frontmatter fields, follow [docs/development/schema-contracts.md](docs/development/schema-contracts.md). Shared structural shape belongs in `@skillset/schema`; compiler and Workbench consumers should route through that package instead of maintaining parallel field lists. Regenerate schema artifacts with `bun run schema:generate` and verify with `bun run schema:check`.

For repository documentation, follow [docs/development/documentation-system.md](docs/development/documentation-system.md). It defines local ownership, generation, validation, migration accounting, and review expectations under the shared documentation doctrine.

## Responsibilities

- Read adaptive source from a repo's `.skillset/` directory with workspace/source config in root `skillset.yaml`.
- Emit one shared plugin package per plugin at `plugins/<plugin>/`, with target-native manifests beside the portable baseline and shared generated provenance in `plugins/skillset.lock` ([ADR-0037](docs/adrs/0037-one-shared-plugin-package-per-plugin.md)).
- Emit standalone skills under configured target skill roots, defaulting to `.claude/skills` and `.agents/skills`, plus `.cursor/skills` for the Cursor target.
- Emit source rules from `<source-root>/rules/**/*.md` to Claude `.claude/rules/**/*.md`, Codex directory-local `AGENTS.md` files, and Cursor `.cursor/rules/*.mdc` files without overwriting unmanaged guidance.
- Preserve plugin boundaries across Claude, Codex, and Cursor outputs.
- Keep source-only `skillset` metadata out of generated artifacts except for lightweight generated `metadata.version` and `metadata["skillset.schema"]` fields.
- Write deterministic `skillset.lock` files near generated outputs.
- Provide local source import helpers for existing plugins and skills.

## Commands

```bash
bun run skillset:build
bun run skillset:check
bun run skillset:check:outputs
bun run skillset:check:ci
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
bun run measure:gate -- --label <label> [--repo <dir>] [--lead-in <s>] [--out <dir>] [--note <text>] [--output <path>]... -- <command>
bun run build:native -- --target <suffix>
bun run build:native-packages -- --required --pack-dir <path>
bun run native:check -- --allow-partial
bun run native:global-smoke -- --target <suffix>
bun run native:smoke -- --target <suffix>
bun run ultracite:doctor
bun run typecheck
bun run test
bun run test:focused -- <path>
bun run check
bun run check:workflows
bun run docs:check
bun run docs:generate
bun run package-ownership:guard
bun run terminology:guard
bun run cli-surface:guard
bun run path-containment:guard
bun run public-closure:guard
bun run target-topology:guard
bun run test-fixture-temp:guard
bun run change-stream:guard
bun run generated-merge-policy:guard
bun run git-env:guard
bun run process-gone:guard
./scripts/bootstrap.sh [repo|agent|codex|claude|cursor|doctor|teardown]
```

`./scripts/bootstrap.sh sweep` still works as a legacy alias for `teardown`.

`bun run test:focused -- <path>` runs the named test files under the test sandbox; use it while iterating, then run `bun run check` before pushing. `bun run docs:generate` rebuilds generated documentation blocks and reference pages, and `bun run docs:check` (part of `bun run check`) fails when they are stale or a doc breaks the documentation system's rules. `bun run check:workflows` lints `.github/workflows/*.yml` with `actionlint` when it is installed and skips otherwise.

`bun run package-ownership:guard` blocks app-level package facade files from returning under `apps/skillset/src/`. Prefer importing an owned package root API or a documented private workspace internal directly instead of adding `export * from "@skillset/<package>/internal/*"` shims in the CLI app.

`bun run terminology:guard` blocks retired compiler vocabulary (the render-result and `compile.unsupportedDestination` cutover, and the pre-ADR-0039 "instruction" spellings of rule source) from drifting back into active source, docs, generated guidance, CLI output, schema names, and tests. Agent Instructions and provider "instruction" words are not retired. It runs inside `bun run check`. When it fails, prefer fixing the source to use the derive/render/destination vocabulary; only extend the explicit allowlists in `scripts/terminology-guard.ts` for deliberate historical (ADR) or deferred-concept context.

`bun run cli-surface:guard` rejects retired CLI commands and flags in tracked docs, guidance, config, and source (tests excluded), and checks that the CLI contract, help text, runtime parser, and structured output agree. Update `scripts/cli-contract.ts` rather than reintroducing a retired spelling.

`bun run path-containment:guard` keeps OS-path containment on `isPathInside` / `resolveInside` / `assertRealPathInside` in `packages/core/src/path.ts`. It rejects new `isAbsolute(relative…)` copies, `relative(…).startsWith("..")` tests, `relative(…) === ".."` comparisons, and realpath or resolve slash-prefix comparisons in `apps/` and `packages/` outside that helper. A `relative()` result stays tracked through `replace`/`replaceAll` and any single-argument normalizer such as `normalizePath(relative(…))`.

`bun run public-closure:guard` scans only generated public artifacts under `plugins/skillset/**` and rejects routes or references into contributor-only `skillset-dev*` material, development docs, fixtures, package internals, and repository scripts. Contributor and self-hosted `.agents/`, `.claude/`, `.cursor/`, and `.skillset/` trees are deliberately outside this public-closure scan.

`bun run git-env:guard` checks direct production and test spawn calls whose executable is a `"git"` literal or a locally initialized argv alias, and fails when they omit the shared sanitized environment (`gitSafeEnv`, `gitReadOnlyEnv`, or `testGitEnv`). Command wrappers must sanitize at their spawn site because the syntax guard does not follow values across function parameters. Hook-exported `GIT_DIR` overrides `git -C` and cwd discovery; the helper lives in `@skillset/core` and is the only definition.

`bun run change-stream:guard` keeps the append-only `.skillset/changes/*.jsonl` streams safe to merge. `.gitattributes` declares the built-in `merge=union` strategy for them so restacking a branch onto trunk keeps both sides' appended records (trunk's, then the branch's) instead of conflicting; the guard checks what union cannot — trailing newline, valid JSONL objects, unique record ids, the declared `merge=union` attribute, and that trunk's stream is an in-order prefix of the working copy. Record order is load-bearing because release/pending state folds events in file order (ADR-0038). The guard reads each stream at `git merge-base HEAD $(scripts/git-trunk.sh)` and fails at the first line where the working copy stops matching it, so trunk's records may never be reordered, edited, or removed; new records only go after them. Event `createdAt`/`appliedAt`/`amendedAt` is event time, not sequence, so an appended block older than trunk's tail passes and there is no allowlist. Restack (rebase onto trunk) is the supported way to update a branch: merging trunk into a branch (`git merge main`, GitHub's "Update branch") puts trunk's new records after the branch's and fails the guard by design. Never sort a stream to fix a failure; restore trunk's records exactly and move the branch's records after them.

Source control: use plain git for a single branch and `gh stack` (the `github/gh-stack` extension) for stacked work. Restack onto trunk locally with `git rebase` for a single branch, or `gh stack rebase` for a stack. `gh stack rebase` cascade-rebases every branch in the stack and `gh stack sync` also force-pushes them all and updates their PRs, so run either only on a stack you own entirely, and `sync` only when you mean to push. Never rebase or force-push a branch someone else owns.

`bun run process-gone:guard` rejects one-shot `process.kill(pid, 0)` "process is gone" assertions in `apps/`, `packages/`, and `scripts/`. After a process group is killed, Linux can briefly report a descendant as still running; tests must `await expectProcessGone(pid)` from `scripts/test-helpers/process.ts`, which polls until ESRCH or a deadline and still fails a genuine survivor.

`bun run test-fixture-temp:guard` fails any test that calls the OS `tmpdir()`, because scanning the shared temp directory races with concurrent runs. Allocate fixtures with `createTestFixtureRoot` and observe cleanup with `tempEntriesLeftBy` (both in `scripts/test-helpers/fixture-root.ts`). The few tests that must observe the real temp directory are listed in the guard with an exact owner, count, and usage.

`bun run generated-merge-policy:guard` sorts every tracked file into generated snapshot (from the committed `skillset.lock` files), append-only ledger, or authored, and checks that `.gitattributes` gives each the `merge` attribute its category needs: `-merge` for generated output so `skillset resolve` rebuilds it, `union` for change streams, and the default for authored files.

`bun run target-topology:guard` uses the TypeScript AST and the canonical schema target registry to reject hand-enumerated target collections, same-subject target equality subsets, and implicit multi-target dispatch fallbacks. Deliberate schema declarations, historical migrations, and provider-native format boundaries require exact per-match allowlist evidence.

`bun run skillset:check:ci` runs `skillset check --ci`, the gate behind the `skillset-ci` job in `.github/workflows/ci.yml`: lint, change-entry coverage, and generated drift. Pass `--fix` to rebuild stale generated output mechanically; CI does that on boundary pull requests and stays read-only on PRs that have stacked children. The same workflow runs `bun run check` and Changesets coverage (`changeset:check`) as separate jobs, so a green `skillset:check:ci` alone is not a green CI. Content repos scaffold the equivalent workflow with `skillset init --include ci`.

`bun run conformance:fast` reruns the fast deterministic projection and adapter conformance suites without running the whole test corpus. `bun run check` already includes those suites through `bun run test`, so CI and pre-push use the same aggregate gate without duplicating them. `bun run conformance:external` is the opt-in slow lane for pinned external adoption fixtures; it may fetch/reset clones and writes reports under `.skillset/cache/fixtures/`, so keep it out of default gates.

Record every change before pushing. Skillset keeps two independent release records and CI checks both. A **change entry** under `.skillset/changes/` is required when you change a source unit under `.skillset/` (a skill, a plugin, or this `RULES.md`): `bun ./apps/skillset/src/cli.ts check --ci --root .` names each uncovered scope and prints the exact `skillset change add --scope <unit> --bump <bump> --reason "<reason>"` command, or `skillset change refresh @<id> --yes` when a pending entry for that scope already exists but its evidence is stale. A **Changeset** (`.changeset/*.md`) is required when you change published-package behavior or payload; `bun run changeset:check` says whether a branch needs one. A change that touches both needs both; one never stands in for the other. See [docs/reference/features/changes.md](docs/reference/features/changes.md).

Package releases are GitHub Actions-owned. Use Changesets for package-facing changes, and use `bun run publish:check` as a local dry-run preflight. Do not run `bun run publish:packages` locally unless the maintainer explicitly chooses a release recovery path.

`bun run measure:gate` records one gate invocation as attributable evidence rather than a bare number: the revision and tree SHA with any dirty entries, the pinned and ambient Bun sampled on both sides of the timed region, the lockfile hash, host capacity and load average, and resource usage where the host can report it. A sample whose ambient interpreter moved mid-run, or whose tree cannot back the revision it names, is written with `attributable: false` and its reasons. Resource usage carries its own confidence: nested `bun run` wrappers lose descendant accounting, so totals that cannot be true of the elapsed wall time are marked `suspect` and must not be quoted. The harness does not establish a cold or warm cache condition. `--repo` measures a different checkout, which is how a baseline is taken without the harness contaminating the tree it measures. `--output` (repeatable, relative to the measured checkout) records the sha256 of a file the command produced in the report's `outputs`; the sharded test runner accepts a baseline JUnit only when its report lists that file with a matching digest. Reports and raw logs land under `.skillset/cache/measure/`, which is ignored.

`lefthook.yml` is the single source of truth for the local gates. `bun run hooks:install` installs them as git hooks; `bun run hooks:pre-push` runs the full pre-push gate anywhere: a repo-sanity check that `core.bare` is still false, push-range whitespace, Changesets coverage (`bun run changeset:check`), workflow lint when `actionlint` is available, then `bun run check` and the self-hosted `skillset check --ci` report scoped to the remote trunk in parallel. Push-range gates resolve the trunk via `scripts/git-trunk.sh` (`origin/HEAD`, typically `origin/main`).

Ultracite is wired in setup-first mode. `bun run ultracite:doctor` must stay clean and is part of `bun run check`; `bun run ultracite:check` / `bun run ultracite:fix` expose the strict Oxlint/Oxfmt cleanup backlog but are not yet required gates.

The repo pins Bun in `.bun-version` and `packageManager`; update both together
when intentionally moving Skillset to a newer Bun runtime.

Read-only authoring aids (never write outputs or mutate config):

```bash
bun ./apps/skillset/src/cli.ts diff --root .
bun ./apps/skillset/src/cli.ts explain <path> --root .
bun ./apps/skillset/src/cli.ts status --root .
```

`bun run check` includes self-hosted source checks and generated-output verification. If `skillset:check:outputs` reports stale or hand-edited output, run `bun ./apps/skillset/src/cli.ts build --repair --root .` first (it previews; add `--yes` to write): it classifies each managed path against the lock and a fresh render, restores missing or stale output, and refuses to overwrite hand edits unless you pass `--discard-edits`. Then run `bun run skillset:build`, inspect the generated diff, and rerun `bun run check`.

## Constraints

- Do not publish this package or add a remote unless the maintainer explicitly asks.
- Do not mutate user-level Claude or Codex config.
- Do not install, trust, or symlink generated plugins or skills into global runtime locations.
- Do not hand-edit `.claude/skills`, `.claude/rules`, `.agents/skills`, `.cursor/skills`, `.cursor/rules`, `plugins/`, the root `AGENTS.md`, or `.claude/CLAUDE.md` as source truth; this file is generated from `.skillset/RULES.md`; in this repo, edit `.skillset/` for source or `skillset.yaml` for workspace config, then rebuild.
- Keep this package focused on compilation, validation, import, and checks.
