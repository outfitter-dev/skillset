---
id: 26
slug: yaml-formatting-and-bun-native-apis
title: YAML Formatting and Bun Native APIs
status: accepted
created: 2026-06-22
updated: 2026-07-21
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, 19]
---

# ADR-0026: YAML Formatting and Bun Native APIs

## Context

Skillset source is intentionally human-authored. Workspace manifests, plugin manifests, and skill frontmatter should be easy to read and should avoid pointless churn when Skillset scaffolds, imports, migrates, or otherwise rewrites source-owned files.

Two related forms of drift are visible or likely:

- The current shared YAML serializer sorts object keys alphabetically, while `skillset init` / `skillset create` hand-render manifests with `skillset` first.
- Future formatting rules could accidentally fight a repository's local linting or formatting preferences if Skillset becomes too opinionated about source key order.

There is also a dependency/tooling question. The repo is Bun-first and pins Bun. Bun 1.3.14 exposes `Bun.YAML.parse`, `Bun.YAML.stringify`, and `Bun.TOML.parse`. Core still uses the `yaml` package for YAML parse/stringify, while Workbench already uses Bun's parser APIs for syntax checks.

An exploratory check found that `Bun.YAML.stringify` currently emits compact flow-style YAML for ordinary objects and does not accept the formatting options Skillset currently relies on for readable block YAML. That makes it unsuitable as a blind drop-in replacement for source-facing `skillset.yaml` and Markdown frontmatter output.

## Decision

Use Bun-native APIs first for Skillset code and tooling when they meet the product contract. Prefer Bun APIs over third-party packages for new parsing, serialization, process, filesystem, and runtime needs, but do not swap an existing dependency into a user-visible output path without compatibility evidence.

For YAML formatting, keep generated canonicalization separate from authored
source mutation:

- Explicit Skillset source mutations put root `skillset` first when that key
  exists.
- A dedicated `yaml` Document writer preserves the relative order, unknown
  keys, and attached comments of other untouched root and nested nodes. This is
  an AST-local guarantee, not a byte-for-byte formatting promise.
- This applies to scaffolded and imported `skillset.yaml` files,
  Skillset-written Markdown frontmatter, adaptive hook attachments, body-only
  source reconciliation, and authored-source migrations.
- Skillset should not lint or rewrite user-authored manifests only to satisfy key-order preference.
- Formatting changes should happen only when Skillset is already writing a file for a source-management reason such as scaffold, import, migration, or explicit future format command.
- Body-only Markdown mutations preserve the existing frontmatter block rather
  than parsing and reserializing it.
- The existing recursive alphabetical serializer remains the owner for
  generated and deliberately normalized output.

This means `skillset` first is a source readability default, not a project-wide formatting mandate.

Core retains the `yaml` package for source Document parsing and writing. Bun
YAML remains a Workbench parse-only boundary because its serializer does not
provide the comment/AST controls required by authored source mutation.

## Consequences

### Positive

- Keeps the source identity block where authors expect to see it.
- Avoids creating a broad formatting rule before the source contract and common project preferences settle.
- Preserves deterministic generated output and lock behavior through the
  existing canonical serializer.
- Gives future dependency cleanup a clear rule: use Bun first, but verify byte shape and diagnostics before replacing existing output-affecting libraries.

### Tradeoffs

- A changed source document may receive presentation normalization from the
  `yaml` serializer even when untouched nodes retain their semantic value,
  relative order, and comments.
- Keeping the `yaml` package means dependency cleanup remains unavailable for
  source writes even though Bun has YAML APIs.
- A minimal `skillset`-first policy does not solve every human-preferred nested ordering, such as whether root identity fields should appear as `name`, `title`, `summary`, `description`, `version`, `schema`, and `owner`.

### What This Does NOT Decide

- It does not require replacing the `yaml` package immediately.
- It does not adopt `Bun.YAML.stringify` for source-facing YAML output.
- It does not define a complete canonical key order for every manifest or frontmatter shape.
- It does not require a lint rule for YAML key order.
- It does not change provider-native escape key ordering such as `_allow`, `_deny`, `_claude`, or `_codex`.

## Implementation Boundary

The implementation keeps the boundary narrow:

1. `packages/core/src/source-document.ts` owns authored YAML/Markdown
   mutations and new source-document serialization.
2. `packages/core/src/yaml.ts` retains recursive alphabetical serialization
   for generated or normalized artifacts.
3. Import, adoption, change-reason, source reconciliation, adaptive-hook, and
   authored-source migration paths route through the source-document owner.
4. Parse behavior remains order-agnostic, and no-op operations return the
   original source without formatting.
5. Comment-rich and body-only regressions prove the supported preservation
   boundary.

## References

- [Tenets](../tenets.md) - source-first loadouts and deterministic generated output.
- [ADR-0001: Root Compile Policy](0001-root-compile-policy.md) - root manifest compile policy.
- [Deterministic Projection and Adapter Conformance](0019-deterministic-projection-and-adapter-conformance.md) - ordering drift and generated-output stability.
