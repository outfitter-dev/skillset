# Contributing to Skillset

Thanks for helping improve Skillset. Contributions should preserve its source-first model for self-hosted agent guidance: portable source lives in `.skillset/` and `skillset.yaml`, while provider-native agent files are generated projections. Code, documentation, schemas, tests, and fixtures remain authored in their ordinary repository locations.

## Before you start

Open an issue or discussion before investing in a large behavior, schema, or architecture change. Small fixes and focused documentation improvements can proceed directly when the intent is clear.

Skillset uses Bun 1.3.14. From a fresh checkout:

```bash
bun install --frozen-lockfile
bun run hooks:install
bun run check
```

## Make a focused change

- Follow `AGENTS.md` and the nearest project documentation.
- Follow the [documentation system](docs/development/documentation-system.md) when changing repository documentation or generated reference.
- Keep changes small, reversible, and tied to one purpose.
- Add focused tests for new behavior.
- Edit `.skillset/` or `skillset.yaml` when changing self-hosted source; run `bun run skillset:build` and inspect the generated diff.
- Do not hand-edit generated skills, plugins, or provider output as source truth.
- Add a Changeset for published-package behavior or payload changes. Repository-only documentation and tooling changes do not need one unless they alter the published package.

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

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE).
