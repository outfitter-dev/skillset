---
id: draft-yaml-formatting-and-bun-native-apis
slug: yaml-formatting-and-bun-native-apis
title: YAML Formatting and Bun Native APIs
status: draft
created: 2026-06-22
updated: 2026-06-22
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, deterministic-projection-and-adapter-conformance]
---

# YAML Formatting and Bun Native APIs

## Context

Skillset source is intentionally human-authored. Workspace manifests, plugin manifests, and skill frontmatter should be easy to read and should avoid pointless churn when Skillset scaffolds, imports, migrates, or otherwise rewrites source-owned files.

Two related forms of drift are visible or likely:

- The current shared YAML serializer sorts object keys alphabetically, while `skillset init` / `skillset create` hand-render manifests with `skillset` first.
- Future formatting rules could accidentally fight a repository's local linting or formatting preferences if Skillset becomes too opinionated about source key order.

There is also a dependency/tooling question. The repo is Bun-first and pins Bun. Bun 1.3.14 exposes `Bun.YAML.parse`, `Bun.YAML.stringify`, and `Bun.TOML.parse`. Core still uses the `yaml` package for YAML parse/stringify, while Workbench already uses Bun's parser APIs for syntax checks.

An exploratory check found that `Bun.YAML.stringify` currently emits compact flow-style YAML for ordinary objects and does not accept the formatting options Skillset currently relies on for readable block YAML. That makes it unsuitable as a blind drop-in replacement for source-facing `skillset.yaml` and Markdown frontmatter output.

## Decision

Use Bun-native APIs first for Skillset code and tooling when they meet the product contract. Prefer Bun APIs over third-party packages for new parsing, serialization, process, filesystem, and runtime needs, but do not swap an existing dependency into a user-visible output path without compatibility evidence.

For YAML formatting, defer broad formatter doctrine. The desired near-term policy is:

- Skillset-authored YAML source should put `skillset` first when a `skillset` key exists.
- This applies to scaffolded `skillset.yaml` files and Skillset-written Markdown frontmatter.
- Other keys should remain deterministic, but Skillset should not enforce an elaborate hand-tuned order yet.
- Skillset should not lint or rewrite user-authored manifests only to satisfy key-order preference.
- Formatting changes should happen only when Skillset is already writing a file for a source-management reason such as scaffold, import, migration, or explicit future format command.

This means `skillset` first is a source readability default, not a project-wide formatting mandate.

## Consequences

### Positive

- Keeps the source identity block where authors expect to see it.
- Avoids creating a broad formatting rule before the source contract and common project preferences settle.
- Preserves deterministic generated output and lock behavior as the stronger requirement.
- Gives future dependency cleanup a clear rule: use Bun first, but verify byte shape and diagnostics before replacing existing output-affecting libraries.

### Tradeoffs

- The current implementation may continue to show minor ordering differences between hand-rendered scaffolds and YAML rewritten through the shared serializer until a focused formatting slice lands.
- Keeping the `yaml` package for now means dependency cleanup is deferred even though Bun has YAML APIs.
- A minimal `skillset`-first policy does not solve every human-preferred nested ordering, such as whether root identity fields should appear as `name`, `title`, `summary`, `description`, `version`, `schema`, and `owner`.

### What This Does NOT Decide

- It does not require replacing the `yaml` package immediately.
- It does not adopt `Bun.YAML.stringify` for source-facing YAML output.
- It does not define a complete canonical key order for every manifest or frontmatter shape.
- It does not require a lint rule for YAML key order.
- It does not change provider-native escape key ordering such as `_allow`, `_deny`, `_claude`, or `_codex`.

## Future Implementation Shape

A small follow-up can implement this without a broad formatter:

1. Add a source-facing YAML serializer helper that preserves readable block YAML and orders `skillset` first when present.
2. Use that helper only in Skillset source-write paths: setup scaffolds, import-origin writes, migration-created manifests, and Markdown frontmatter writes.
3. Keep parse behavior order-agnostic.
4. Add focused tests that assert `skillset` appears first in Skillset-written manifests and frontmatter.
5. Separately evaluate Bun YAML parsing/stringifying against current fixtures before removing the `yaml` dependency.

## References

- [Tenets](../../tenets.md) - source-first loadouts and deterministic generated output.
- [ADR-0001: Root Compile Policy](../0001-root-compile-policy.md) - root manifest compile policy.
- [Deterministic Projection and Adapter Conformance](20260613-deterministic-projection-and-adapter-conformance.md) - ordering drift and generated-output stability.
