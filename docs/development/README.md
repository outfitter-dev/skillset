---
description: Routes Skillset maintainers to documentation, schema, package, feature-system, and evidence guidance.
---

# Skillset Development

These pages explain how to change and verify the compiler itself.

- [Documentation system](documentation-system.md) defines documentation ownership, generation, migration, and review.
- [Schema contracts](schema-contracts.md) defines the schema-first workflow for source and configuration fields.
- [Package ownership](package-ownership.md) defines package boundaries and the app-facade guard.
- [Public plugin closure](public-closure.md) defines guard ownership and bounded shell interpretation.
- [Package releases](package-releases.md) defines Changesets, package preflight, and GitHub Actions-owned publishing.
- [Feature-system internals](features/README.md) cover registries, render reports, adapters, test machinery, and maintainer guardrails.
- Evidence retains dated implementation receipts under `evidence/`, newest first:
  - [SET-673 HTML block boundaries](evidence/2026-10-31-set-673-html-boundaries.md) (2026-10-31; correctness and measured allocation tradeoff)
  - [SET-759 projection timing](evidence/2026-10-31-set-759-projection-timing.md) (2026-10-31; bounded unresolved timeout investigation)
  - [SET-492 loss-accounting investigation](evidence/2026-10-31-set-492-loss-accounting.md) (2026-10-31; current reproduction and non-ratifying options)
  - [SET-495 open-object audit](evidence/2026-10-31-set-495-open-object-audit.md) (2026-10-31; findings and recommendations)
  - [SET-433 transform inventory](evidence/2026-10-30-set-433-transform-inventory.md) (2026-10-30; open evidence review)
  - [SET-554 Agent Skills internal-marker receipt](evidence/2026-09-16-set-554-agent-skills-internal-marker.md) (2026-09-16)
  - [SET-550 Cursor parity fixture evidence](evidence/2026-09-16-cursor-parity-fixtures.md) (2026-09-16)
  - [SET-313 Cursor runtime smoke receipt](evidence/2026-07-20-set-313-cursor-runtime-smoke.md) (2026-07-20)
