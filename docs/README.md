---
description: Routes Skillset readers to the right start, task, reference, project, or contributor documentation.
---

# Skillset Documentation

Choose the question you are trying to answer. Each linked page states what it owns; exhaustive command and support facts come from generated reference rather than duplicated prose.

## I am new to Skillset

- [Why Skillset](why-skillset.md) explains the problem, the source-first model, and when the compiler is a good fit.
- [Start with Skillset](start/README.md) introduces the Start → Adopt → Work → Ship journey through the executable first-author example.
- [Build versus activation](start/build-versus-activation.md) explains what Skillset writes and what remains a separate user or provider decision.

## I need to look something up

- [Generated reference](reference/README.md) routes to contract-owned CLI commands, feature support, schemas, and examples.
- [CLI reference](reference/cli/README.md) lists every public command and its generated route pages.
- [Feature support matrix](reference/support-matrix.md) shows registry-owned support across canonical provider targets.
- [Glossary](glossary.md) defines the source, build, destination, provider, and activation vocabulary.

## I am contributing

- [Contributing](../CONTRIBUTING.md) covers setup, checks, source ownership, Changesets, and review expectations.
- [Documentation system](development/documentation-system.md) defines authored and generated ownership, validation, migrations, and review.
- [Current documentation-overhaul plan](project/plans/docs-overhaul.md) records the staged transition and acceptance criteria.
- [Security policy](../SECURITY.md) gives the private vulnerability-reporting path.

## Current detailed guides

These existing pages remain reachable while the next stack layer moves the corpus into its final reader-intent structure:

- [Five-Minute Quickstart](quickstart.md) walks through the current first-author scaffold and build.
- [Layout](layout.md) records the current source and generated destination structure.
- [Interactive CLI](features/interactive-cli.md) defines prompt eligibility and controlled-terminal behavior.
- [Package ownership](package-ownership.md) explains the compiler package boundaries used by maintainers.

Generated output does not grant runtime authority. Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration. See [Build Versus Activation](start/build-versus-activation.md).
