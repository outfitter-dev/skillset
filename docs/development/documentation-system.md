---
description: Explains how Skillset documentation is owned, generated, validated, migrated, and reviewed.
---

# Documentation System

Skillset treats repository Markdown as a product surface. The shared rules for that surface live in the [Outfitter documentation doctrine](https://github.com/outfitter-dev/agent-workbench/blob/main/research/outfitter-docs-doctrine.md); this page records how this repository applies them.

## Ownership

Authored pages own explanations, task workflows, and project judgment. Runtime contracts own observed behavior. Typed registries and schemas own exhaustive reference facts that code can determine. Generated reference is a projection of those contracts and must never become an input to its own generator.

The generated layer under [`docs/reference/`](../reference/README.md) projects schema artifacts, the public CLI presentation and flag contracts, and the feature registry's provider-support facts. Run `bun run docs:generate` after changing any owning contract. The CLI presentation catalog owns public routes, usage, examples, and route-to-flag assignments; `CLI_FLAGS` and `CLI_ENVIRONMENT` own the exhaustive shared vocabularies. The feature registry owns feature status, canonical targets, support levels, and feature-to-page links.

Feature narratives remain authored pages. Their registry-owned support tables use the generic `feature-support` generated block, which `docs:generate` rewrites from the Core registry while preserving surrounding prose. The registry's `docs` references are the canonical linkage between a feature and one or more authored pages. Introductory pages under `start/`, `guides/`, and the repository front door link to those facts but do not acquire registry entries simply to satisfy navigation.

Skillset does not generate a diagnostics catalog yet. Diagnostic identifiers, ownership, severity, and user guidance are distributed across several runtime surfaces rather than one typed exhaustive registry. Until such a registry exists, diagnostics stay documented on their owning feature and workflow pages; scraping messages would create a second, brittle contract.

## Validation

Run the aggregate documentation gate before proposing a documentation change:

```bash
bun run docs:check
```

The gate checks Markdown syntax and structure, frontmatter descriptions, local links and anchors, public-page reachability, generated-block markers, and path migrations. It also checks generated documentation for drift.

Existing corpus violations are recorded in `docs/docs-check-baseline.json`. That baseline is shrink-only: a new violation fails, and fixing a recorded violation also fails until its exact entry is removed. Normal checks never rewrite the baseline. Use `bun scripts/docs.ts baseline` only when intentionally refreshing it during the overhaul, inspect every change, and do not add new violations to make a check pass.

## Generated blocks

Fully generated pages carry a visible generated header. A page that mixes authored and generated material uses paired markers:

```markdown
<!-- skillset:generated:start block-id -->
<!-- skillset:generated:end block-id -->
```

Block IDs are unique kebab-case names within the file. Markers may not nest or cross. The generator may replace only the bytes inside a valid pair; authored text outside the pair remains untouched.

## Moving documentation

Record every moved, split, archived, or deleted Markdown path in [`docs/migration-map.json`](../migration-map.json). Each entry names the old repository-relative path, its disposition, and the surviving destination or destinations. The checker compares the worktree with the repository trunk and rejects an unaccounted deletion or rename.

Active, upcoming, paused, and otherwise actionable plans live in `docs/project/plans/`. Completed, abandoned, and superseded plans move to `docs/project/plans/archive/` with a disposition banner and outcome summary; the migration map and both plan indexes move their ownership at the same time.

## Review contract

Documentation changes identify their truth sources, keep generated and authored ownership distinct, and run the narrowest relevant checks while editing. Before a pull request leaves draft, run `bun run docs:check` and the repository aggregate `bun run check`, inspect generated diffs, and resolve every review finding. A mismatch between runtime behavior and an accepted tenet or ADR is an implementation or decision issue, not something prose should silently reconcile.
