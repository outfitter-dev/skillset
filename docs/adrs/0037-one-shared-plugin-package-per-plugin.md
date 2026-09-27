---
id: 37
slug: one-shared-plugin-package-per-plugin
title: One Shared Plugin Package per Plugin
status: accepted
created: 2026-09-25
updated: 2026-09-25
owners: ['[galligan](https://github.com/galligan)']
depends_on: [2, 23, 28, 30, 32, 33, 36]
amends: [2, 23, 28, 30, 32, 33]
---

# ADR-0037: One Shared Plugin Package per Plugin

## Context

Plugin output used to add a provider segment under each plugin:
`plugins/<plugin>/claude/`, `plugins/<plugin>/chatgpt/`,
`plugins/<plugin>/cursor/`, and the Agent Plugins standard bundle at
`plugins/<plugin>/agents/`. Every enabled provider received a complete copy of
the same skills, README, license, and assets, and each marketplace pointed at a
different subdirectory for what was one product.

The copies were not needed. The Agent Plugins 1.0 package root holds
`plugin.json` and an immediate-child `skills/` tree. Claude and Cursor read
their manifests from `.claude-plugin/` and `.cursor-plugin/` metadata
directories, and the ChatGPT product bundle already uses the Agent Plugins root
manifest with an `extensions.com.openai` object
([ADR-0030](0030-chatgpt-product-bundles-and-standards-only-builds.md#modern-bundles-have-one-portable-core-and-one-native-extension)).
One directory can serve every provider without the providers colliding.

SET-558 moved the compiler to that shape. `pluginTargetRoot()` now ignores the
target and the per-target output root and returns `plugins/<plugin>`.
[ADR-0036](0036-plugin-skills-belong-to-the-standard-package.md#consequences)
deferred output placement to this record. Until now AGENTS.md and several
accepted ADRs still described per-provider bundle roots, so a reviewer
reasonably read the change as a regression.

## Decision

Each source plugin renders to exactly one package at `plugins/<plugin>/`. Every
enabled target and the Agent Plugins standard share that package. No target
adds a provider path segment.

### Package shape

Providers add their manifest and supported components beside the portable
baseline. They do not create subpackages:

```text
plugins/review-tools/plugin.json                  # Agent Plugins root; ChatGPT extension
plugins/review-tools/.claude-plugin/plugin.json
plugins/review-tools/.cursor-plugin/plugin.json
plugins/review-tools/skills/<effective-name>/SKILL.md
plugins/review-tools/assets/**
plugins/skillset.lock                              # shared provenance for all packages
```

Marketplaces stay at their provider-native catalog paths
(`.claude-plugin/marketplace.json`, `.cursor-plugin/marketplace.json`,
`.agents/plugins/marketplace.json`). Every catalog entry points at the same
`plugins/<plugin>` package.

### One writer per path

A shared package means providers cannot fork a file. Before writing, Skillset
compares provider renderings of each shared path. Provider-only skill
frontmatter keys can coexist, while conflicting values or body bytes fail with a
provider-specific diagnostic. Any other two producers that need different bytes
or modes at one path fail with `plugin-package-path-conflict`. Two skill sources
that flatten to the same effective name also fail. Skillset never forks a path
into provider-specific copies to resolve a conflict.

The shared lock keeps one entry per rendered projection, with the `standard`,
`project-use`, or `bundle` role from
[ADR-0036](0036-plugin-skills-belong-to-the-standard-package.md#decision).

### Placement is fixed until configured placement lands

`plugins/[name]` is the only accepted package placement. Root
`plugins.output` is parsed into a deterministic path plan so that it fails
loudly instead of being ignored. These fail before any write, and each
diagnostic names its owning issue:

- a custom path or per-target `name` (SET-561);
- repository-root placement (SET-581);
- `combine` (SET-568);
- a nondefault `<target>.plugins.path`, or a `claude.bundle.path` that would
  split the package (SET-561).

The test: a provider or configuration value that would put one plugin's files
in two package roots is an error, not a layout option.

### Superseded statements

These statements remain in their original ADRs as history. This ADR replaces
them as current instruction:

- `docs/adrs/0002-cursor-is-a-first-class-provider.md`: “plugin bundles to
  `plugins/<plugin>/cursor/` with `.cursor-plugin/plugin.json`.” Cursor's
  manifest renders at `plugins/<plugin>/.cursor-plugin/plugin.json` inside the
  shared package.
- `docs/adrs/0023-versioned-structured-output-for-cli-automation.md`: the
  example diagnostic path “`plugins/example/codex/skillset.lock`”. Generated
  plugin provenance lives in the shared `plugins/skillset.lock`; the envelope
  contract the example illustrates is unchanged.
- `docs/adrs/0028-open-standards-are-the-portability-floor.md`: “Agent Plugins
  | each `.skillset/plugins/<plugin>/` | `plugins/<plugin>/agents/`”, the
  following paragraph that names `agents` as “a sibling of the existing
  `claude`, `codex`, and `cursor` provider bundles”, and “Plugin-bound skills
  are rendered through the same baseline renderer under
  `plugins/<plugin>/agents/skills/<skill>/`.” The Agent Plugins baseline is the
  root of `plugins/<plugin>/`, and its skills render at
  `plugins/<plugin>/skills/<skill>/`. The implementation-plan row expecting “an
  independent `plugins/<plugin>/agents` package” is superseded the same way.
- `docs/adrs/0030-chatgpt-product-bundles-and-standards-only-builds.md`: “the
  modern plugin bundle at `plugins/<plugin>/chatgpt/`” and “The pure Agent
  Plugins projection remains `plugins/<plugin>/agents/`. The ChatGPT product
  bundle renders at `plugins/<plugin>/chatgpt/`.” Both render as the single
  `plugins/<plugin>/plugin.json` root. The ChatGPT extension is a member of that
  manifest, not a separate bundle.
- `docs/adrs/0032-standards-compilation-is-inherent.md`: “Agent Plugins |
  portable plugin source | `plugins/<plugin>/agents/` package.” The standard
  package is `plugins/<plugin>/`.
- `docs/adrs/0033-workspace-authoring-model.md`: the retained ADR-0002 claim
  “plugin bundles to `plugins/<plugin>/cursor/`”. The SET-550 evidence gate
  still applies to Cursor destination claims inside the shared package.

## Consequences

### Positive

- Skill bytes, README, license, and assets render once per plugin, no matter how
  many providers are enabled.
- One directory installs from every provider marketplace, and catalog sources
  converge on `plugins/<plugin>`.
- Cross-provider disagreement shows up as a build-time conflict instead of as
  separate per-provider copies.

### Tradeoffs

- Earlier generated paths such as `plugins/<plugin>/claude/` are gone. Under
  the [ADR-0033](0033-workspace-authoring-model.md) internal hard cutover,
  plans show them as ordinary removals. There is no compatibility alias.
- A provider cannot carry different bytes at a shared path. Provider-specific
  content has to live in that provider's metadata directory or in a
  provider-only frontmatter key.
- Custom placement is unavailable until SET-561 and SET-581 land.

### Risks

A provider could start reading a root file or directory that another provider
already owns, with incompatible expectations. Provider conformance evidence and
the path-conflict check are the guard: the collision fails a build instead of
shipping.

## Non-Decisions

- The semantics of `plugins.output`, the `[name]` token, and custom
  destinations belong to SET-561. Repository-root package placement belongs to
  SET-581, and `combine` to SET-568. Each needs its own decision when
  implemented. This ADR fixes only the default and the one-package invariant
  they must preserve.
- Removing the unused `outputRoot`/`target` parameters from the placement
  helpers is implementation cleanup and changes no behavior.

## References

- [Tenets](../project/tenets.md) - target-native truth and early drift visibility.
- [ADR-0002: Cursor Is a First-Class Provider](0002-cursor-is-a-first-class-provider.md) - Cursor bundle path amended here.
- [ADR-0023: Versioned Structured Output For CLI Automation](0023-versioned-structured-output-for-cli-automation.md) - example lock path amended here.
- [ADR-0028: Open Standards Are the Default Portability Floor](0028-open-standards-are-the-portability-floor.md) - Agent Plugins bundle path amended here.
- [ADR-0030: ChatGPT Product Bundles and Standards-Only Builds](0030-chatgpt-product-bundles-and-standards-only-builds.md) - ChatGPT and Agent Plugins bundle paths amended here.
- [ADR-0032: Standards Compilation Is Inherent](0032-standards-compilation-is-inherent.md) - standard package path amended here.
- [ADR-0033: Workspace Authoring Model](0033-workspace-authoring-model.md) - hard-cutover policy; retained Cursor path amended here.
- [ADR-0036: Plugin Skills Belong to the Standard Package](0036-plugin-skills-belong-to-the-standard-package.md) - deferred this placement decision; projection roles reused here.
- [Plugins feature reference](../reference/features/plugins.md) - current package layout and manifest authority.
- [SET-558](https://linear.app/outfitter/issue/SET-558) - shared package implementation.
- [SET-561](https://linear.app/outfitter/issue/SET-561/root-destination-and-output-paths-pluginsoutput) - configured destination resolution.
- [SET-581](https://linear.app/outfitter/issue/SET-581/publish-one-output-package-at-the-repository-root) - repository-root package writer.
