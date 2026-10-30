# Contributing to Skillset

Thanks for helping improve Skillset. Contributions should preserve its source-first model for self-hosted agent guidance: portable source lives in `.skillset/` and `skillset.yaml`, while provider-native agent files are generated projections. Code, documentation, schemas, tests, and fixtures remain authored in their ordinary repository locations.

## Before you start

Open an issue or discussion before investing in a large behavior, schema, or architecture change. Small fixes and focused documentation improvements can proceed directly when the intent is clear.

Skillset uses Bun 1.4.4. From a fresh checkout:

```bash
./scripts/bootstrap.sh repo
bun run hooks:install
bun run check
```

Bootstrap installs the pinned dependencies and normalizes tracked checkout file
modes, so verification behaves the same even when Git cloned the repository
under a restrictive shell umask.

## Make a focused change

- Follow `AGENTS.md` and the nearest project documentation.
- Follow the [documentation system](docs/development/documentation-system.md) when changing repository documentation or generated reference.
- Keep changes small, reversible, and tied to one purpose.
- Add focused tests for new behavior, including [counterexamples for absolute acceptance claims](fixtures/README.md#absolute-acceptance-claims).
- Edit `.skillset/` or `skillset.yaml` when changing self-hosted source; run `bun run skillset:build` and inspect the generated diff.
- Do not hand-edit generated skills, plugins, or provider output as source truth.
- Record the change (below) before you push.

### Record the change

Skillset keeps two independent release records, and CI checks both:

- **Change entry** (`.skillset/changes/`, [Changes reference](docs/reference/features/changes.md)): needed when you change a source unit under `.skillset/`, such as a skill, a plugin, or `.skillset/RULES.md`. Run `bun ./apps/skillset/src/cli.ts check --ci --root .` to see which scopes are uncovered, then record each one:

  ```bash
  bun ./apps/skillset/src/cli.ts change add --scope skill:skillset-dev --bump none --reason "Describe the reader-visible change." --root .
  ```

  If a pending entry for that scope already exists, refresh its evidence instead of adding another: `bun ./apps/skillset/src/cli.ts change refresh @<id> --yes --root .`. The `check` output prints the exact `change add` or `change refresh` command to run.
- **Changeset** (`.changeset/*.md`, `bun run changeset`): needed when you change published-package behavior or payload. `bun run changeset:check` says whether a branch needs one. Repository-only documentation and tooling changes do not.

A change that touches both a `.skillset/` source unit and a published package needs both records; one never stands in for the other.

Run the narrowest relevant checks while working, then run the aggregate gate before opening a pull request:

```bash
bun run test:focused -- <test-files...>
bun run skillset:check
bun run skillset:check:outputs
bun run check
```

If a check cannot run in your environment, say which check was skipped and what you verified instead.

## Report security issues privately

Do not open a public issue for a suspected vulnerability. Follow the private reporting instructions in [SECURITY.md](SECURITY.md) instead.

## Pull requests

Use a Conventional Commit-style title. Explain the context, what changed, how you verified it, and any risks or rollout notes. Keep the pull request in draft until CI is green, and resolve every review thread before marking it ready.

Use plain git for a single branch. For stacked work, use [`gh stack`](https://github.com/github/gh-stack) (`gh extension install github/gh-stack`). Update a branch by restacking it onto trunk: `git rebase` for a single branch, or `gh stack rebase` for a stack. `gh stack rebase` rewrites every branch in the stack and `gh stack sync` also force-pushes them all and updates their PRs, so run either only on a stack you own entirely, and `sync` only when you mean to push. Do not merge trunk into a branch: on a branch that ran `skillset release apply`, `bun run change-stream:guard` rejects the result.

### Review acceptance evidence

Apply the [absolute-claim checklist](fixtures/README.md#absolute-acceptance-claims) to new or changed promises of exactness, completeness, required inputs, blocked states, corruption handling, idempotence, or Bun-free execution. Identify the nearby wrong state and the test that would fail if it slipped through. Check that executable examples use the real public API. This convention applies when the affected behavior or tests are next touched; it does not require a retrospective rewrite of existing tests.

### Review transform recognition and output together

Apply [Recognize meaning before rewriting syntax](docs/project/tenets.md#recognize-meaning-before-rewriting-syntax) when adding or widening a transform, detector, automatic dialect declaration, or provider adapter. Review the entire accepted shape, including regex captures and surrounding context, against current primary evidence for both the source meaning and each destination's representation. Evidence that merely mentions both providers is insufficient.

For example, `@alice`, CSS `@media`, decorators and `@scope/package` do not establish a file-reference or invocation intent. A `.claude/` prefix does not establish a corresponding `.codex/` tree: rewriting `.claude/plugins/marketplaces` to `.codex/plugins/marketplaces` invents a destination even if reversing the replacement restores every byte. Fences, inline examples and prose comparing `CLAUDE.md` with `AGENTS.md` also need collision coverage.

A positive control must define both meanings. A test-only `source-intent:demo` → `target-intent:demo` protocol can prove dispatch when its contract explicitly defines that equivalence; it cannot prove a real provider capability. Production transformation needs the actual provider contract and tests of the preserved behavior. Match supported examples with nearby negative cases and inspect the resulting bytes. One recognized span must not silently opt unrelated document content into translation.

PR evidence must identify the recognized meaning, destination contract, semantic tests, negative corpus, and explicit disposition for ambiguity or loss. Unknown meaning stays preserved or provider-native; loss and unsupported destinations use the owning result contract. An exception names its owner, rationale, exact scope, evidence date, limitations and regression cases. Review recognizers, renderers and exception validators together so a scoped exception cannot become a general bypass.

Automated checks can enforce entry structure and deliberate test coverage. They cannot establish that a cited provider document supports an arbitrary recognizer, that evidence remains current, or that every semantic collision is covered. Reviewers own those judgments. Follow the [fixture evidence contract](fixtures/README.md#transform-and-conformance-evidence) and rebuild any changed `.skillset/` guidance before checking generated output.

### Review agent work against an exact commit

When several agents work in parallel, keep one writer per worktree. A reviewing agent edits nothing. It reads the exact commit under review (`git show <sha>`, `git diff <base-sha>..<sha>`, or a detached checkout of `<sha>` in its own worktree) and reports findings against that SHA. If the reviewer should fix something, hand the finding back to the worktree's owner, or give the reviewer its own worktree on a separate branch.

A review describes one commit. Any new commit, rebase, or force-push changes the SHA and invalidates the result, so re-review the new head before relying on it. Write review reports and PR comments with the full or short SHA they reviewed (for example, "reviewed at `1a2b3c4`"), not only the branch name, which moves.

Keep mechanical formatting (Oxfmt, regenerated output, renames) in its own commits so a reviewer can tell behavior changes apart from churn.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE).
