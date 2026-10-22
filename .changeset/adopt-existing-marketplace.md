---
"@skillset/core": patch
---

Keep an adopted repo's existing Claude marketplace identity. `init --adopt` now declares `.claude-plugin/marketplace.json` under `marketplaces:` with its name, owner and description, reports entries it could not carry over, and lists the original file for cutover, so the next build no longer renames the catalog after the workspace.
