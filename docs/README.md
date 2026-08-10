---
description: Routes Skillset readers to the right start, task, reference, project, or contributor documentation.
---

# Skillset Documentation

Choose the question you are trying to answer. Each linked page states what it owns; exhaustive command and support facts come from generated reference rather than duplicated prose.

## I am new to Skillset

- [Why Skillset](why-skillset.md) explains the problem, the source-first model, and when the compiler is a good fit.
- [Start with Skillset](start/README.md) routes from a first build into adoption, daily work, and deliberate shipping workflows.
- [Build versus activation](start/build-versus-activation.md) explains what Skillset writes and what remains a separate user or provider decision.

## I need to look something up

- [Generated reference](reference/README.md) routes to contract-owned CLI commands, feature support, schemas, and examples.
- [CLI reference](reference/cli/README.md) lists every public command and its generated route pages.
- [Feature support matrix](reference/support-matrix.md) shows registry-owned support across canonical provider targets.
- [Glossary](glossary.md) defines the source, build, destination, provider, and activation vocabulary.

## Something failed

- [Troubleshooting](troubleshooting.md) starts from source, drift, import, recovery, watch, CI, and activation symptoms.

## I am contributing

- [Contributing](../CONTRIBUTING.md) covers setup, checks, source ownership, Changesets, and review expectations.
- [Development documentation](development/README.md) routes maintainers to documentation, schema, package, feature-system, and evidence guidance.
- [Project documentation](project/README.md) routes to the design tenets and active or archived plans.
- [Documentation system](development/documentation-system.md) defines authored and generated ownership, validation, migrations, and review.
- [Current documentation-overhaul plan](project/plans/docs-overhaul.md) records the staged transition and acceptance criteria.
- [Security policy](../SECURITY.md) gives the private vulnerability-reporting path.

## Detailed guides

These pages cover common author and maintainer workflows:

- [Build Your First Skill](start/quickstart.md) walks through the current first-author scaffold and build.
- [Import Existing Work](guides/importing.md) separates whole-repository adoption from one explicit source import.
- [Development Loop](guides/development-loop.md) covers preview, write, watch, reconciliation, and recovery.
- [Layout](layout.md) records the current source and generated destination structure.
- [Interactive CLI](reference/features/interactive-cli.md) defines prompt eligibility and controlled-terminal behavior.
- [Package ownership](development/package-ownership.md) explains the compiler package boundaries used by maintainers.

Generated output does not grant runtime authority. Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration. See [Build Versus Activation](start/build-versus-activation.md).
