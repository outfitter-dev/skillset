---
description: Routes Skillset maintainers to documentation, schema, package, feature-system, and evidence guidance.
---

# Skillset Development

These pages explain how to change and verify the compiler itself.

- [Documentation system](documentation-system.md) defines documentation ownership, generation, migration, and review.
- [Schema contracts](schema-contracts.md) defines the schema-first workflow for source and configuration fields.
- [Package ownership](package-ownership.md) defines package boundaries and the app-facade guard.
- [Package releases](package-releases.md) defines Changesets, package preflight, and GitHub Actions-owned publishing.
- [Feature-system internals](features/README.md) cover registries, render reports, adapters, test machinery, and maintainer guardrails.
- Evidence retains dated implementation receipts under `evidence/`, newest first:
  - [SET-433 transform inventory](evidence/2026-10-30-set-433-transform-inventory.md) (2026-10-30; open evidence review)
  - [SET-554 Agent Skills internal-marker receipt](evidence/2026-09-16-set-554-agent-skills-internal-marker.md) (2026-09-16)
  - [SET-550 Cursor parity fixture evidence](evidence/2026-09-16-cursor-parity-fixtures.md) (2026-09-16)
  - [SET-313 Cursor runtime smoke receipt](evidence/2026-07-20-set-313-cursor-runtime-smoke.md) (2026-07-20)
