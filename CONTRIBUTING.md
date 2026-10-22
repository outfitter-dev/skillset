# Contributing to Skillset

Thanks for helping improve Skillset. Contributions should preserve its source-first model for self-hosted agent guidance: portable source lives in `.skillset/` and `skillset.yaml`, while provider-native agent files are generated projections. Code, documentation, schemas, tests, and fixtures remain authored in their ordinary repository locations.

## Before you start

Open an issue or discussion before investing in a large behavior, schema, or architecture change. Small fixes and focused documentation improvements can proceed directly when the intent is clear.

Skillset uses Bun 1.4.0. From a fresh checkout:

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
- Add focused tests for new behavior.
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

Use plain git for a single branch. For stacked work, use [`gh stack`](https://github.com/github/gh-stack) (`gh extension install github/gh-stack`). Update a branch by restacking it onto trunk: `git rebase` for a single branch, or `gh stack rebase` for a stack. `gh stack rebase` rewrites every branch in the stack and `gh stack sync` also force-pushes them all and updates their PRs, so run either only on a stack you own entirely, and `sync` only when you mean to push. Do not merge trunk into a branch: `bun run change-stream:guard` rejects the result.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE).
