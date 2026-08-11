---
description: Guides authors from a first Skillset build through adoption, daily work, and deliberate shipping workflows.
---

# Start with Skillset

Skillset's author journey is **Start → Adopt → Work → Ship**. Follow it in order for a first repository, or jump to the stage that matches the outcome you need.

## Start

[Build](../glossary.md#build) one small, reviewable [projection](../glossary.md#projection) from [canonical source](../glossary.md#canonical-source).

1. [Quickstart](quickstart.md) — initialize a repository, author one skill, and verify [generated output](../glossary.md#generated-output).
2. [First-author walkthrough](first-author.md) — inspect and modify the executable `examples/first-author` fixture.
3. [How rendering works](how-rendering-works.md) — understand source, [targets](../glossary.md#target), [destinations](../glossary.md#destination), locks, and [drift](../glossary.md#drift).
4. [Build versus activation](build-versus-activation.md) — keep repository generation separate from runtime authority.

## Adopt

Bring existing [provider-native](../glossary.md#provider-native) work into Skillset source without overwriting it silently.

- [Importing existing work](../guides/importing.md) covers repository surveys, selected imports, previews, and review boundaries.

## Work

Keep source and generated output current while you edit.

- [Development loop](../guides/development-loop.md) covers check, preview, write, watch, inspect, and commit.
- [Troubleshooting](../troubleshooting.md) starts from observable symptoms when that loop fails.

## Ship

Shipping is a set of explicit workflows, not a side effect of build. The Ship guides cover:

1. [Continuous integration](../guides/continuous-integration.md) — make source, generated output, and release intent reviewable in hosted checks.
2. [Publishing](../guides/publishing.md) — release source units and choose the correct external publication boundary.
3. [Marketplaces](../guides/marketplaces.md) — verify curated plugin entries and write supported provider catalog indexes.

Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration. See [Build Versus Activation](build-versus-activation.md).
