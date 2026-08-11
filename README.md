# Skillset

Skillset is a source-first compiler for provider-native agent loadouts.

Write a skill, instruction, agent, hook, or plugin once in a repository-owned source tree. Skillset validates that source, then renders reviewable Claude, Codex, and Cursor files without installing or activating them.

## Install

Skillset requires Bun 1.3.14 or newer.

```bash
bun add --dev skillset
```

Initialize an existing repository, inspect the plan, and write the source scaffold:

```bash
bunx skillset init
bunx skillset init --yes
```

Add authored source under `.skillset/`, then preview and write provider-native output:

```bash
bunx skillset check
bunx skillset build
bunx skillset build --yes
bunx skillset check --only outputs
```

`init` and `build` preview by default. `--yes` confirms the exact plan. Start with the [first-author journey](docs/start/README.md) or run the checked-in [first-author example](examples/first-author/README.md).

## Why Skillset

Agent platforms overlap, but their file layouts and native capabilities do not. Maintaining parallel source trees makes shared intent drift and tempts authors to pretend unlike features are portable.

Skillset keeps one adaptive source where meanings genuinely match, preserves provider-native escape hatches where they do not, and makes unsupported destinations visible before output ships. Read [Why Skillset](docs/why-skillset.md) for the design tradeoffs.

## The model

```text
skillset.yaml + .skillset/ authored source
                    |
          validate, derive, render
                    |
       provider-native repository files
```

- [`skillset.yaml`](docs/configuration/project-configuration.md) selects targets and workspace behavior.
- [`.skillset/`](docs/reference/source/workspace-layout.md#authored-workspace) contains the source humans and agents edit.
- `skillset check` validates source and reports generated drift.
- `skillset build` previews a deterministic output plan.
- `skillset build --yes` writes repo-local provider output and lock provenance.

Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration. [Build and activation are separate workflows](docs/start/build-versus-activation.md).

## What it can author

Skillset currently handles standalone skills, project instructions and agents, plugins, resources, hooks, provider-native components, change records, and release projections. Support is intentionally explicit: see the generated [feature support matrix](docs/reference/support-matrix.md) for current target evidence and the [CLI reference](docs/reference/cli/README.md) for every public command.

Generated output stays native to each provider. A shared instruction may become Claude rules, a directory-local Codex `AGENTS.md`, and Cursor `.mdc` rules. A feature without a faithful destination is diagnosed or handled by the workspace's explicit unsupported-destination policy.

## Work safely

The everyday loop is small:

```bash
# Validate source and generated readiness.
bunx skillset check

# Inspect pending output without writing.
bunx skillset diff

# Explain one source or generated path.
bunx skillset explain .agents/skills/my-skill/SKILL.md

# Watch source and preview continuously.
bunx skillset dev
```

Use `skillset dev --write` only when you want clean source edits to update repo-local outputs continuously. Use `skillset reconcile` when a managed generated file was edited and a human must choose source or output authority. Confirmed replacement paths retain backup or rollback evidence.

## Adopt existing work

`skillset init` surveys an existing repository for local skills, plugins, and instruction files. `skillset import` copies one selected provider-native source into `.skillset/` without overwriting existing source:

```bash
bunx skillset import /path/to/SKILL.md
bunx skillset import /path/to/plugin
```

Import reports what it recognized, preserved, and could not adapt. It never scans or changes user-level provider configuration unless you explicitly choose a provider's local import root.

## Documentation

Choose the path that matches your question:

- **Start:** [first-author journey](docs/start/README.md), [why Skillset](docs/why-skillset.md), and [build versus activation](docs/start/build-versus-activation.md).
- **Look something up:** [generated reference](docs/reference/README.md), [CLI commands](docs/reference/cli/README.md), [support matrix](docs/reference/support-matrix.md), and [glossary](docs/glossary.md).
- **Understand the project:** use the [documentation map](docs/README.md), which keeps current project and decision material reachable while the corpus is reorganized.
- **Contribute:** [contributor guide](CONTRIBUTING.md), [security policy](SECURITY.md), and [documentation system](docs/development/documentation-system.md).

## Develop the compiler

Clone the repository, install the pinned toolchain, and run the aggregate check:

```bash
git clone https://github.com/outfitter-dev/skillset.git
cd skillset
./scripts/bootstrap.sh repo
bun run check
```

Useful focused commands:

```bash
bun run typecheck
bun run test:focused -- path/to/test.ts
bun run docs:generate
bun run docs:check
bun run skillset:check
bun run skillset:check:outputs
```

Package releases are GitHub Actions-owned. Package-facing changes use Changesets; local development must not publish or mutate user-level provider configuration.

## License and security

Skillset is available under the [MIT License](LICENSE). Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md), not a public issue.
