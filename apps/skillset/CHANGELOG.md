# skillset

## 0.13.4

### Patch Changes

- 26b2c3a: Report stacked pending change evidence in `skillset change check` while preserving strict stale-evidence failures.

## 0.13.3

### Patch Changes

- 76504a1: Document the private scoped-package publish posture for the core, lint, and transforms workspaces.
- d90bfef: Move authoring inspection and lint orchestration into the core package while keeping CLI compatibility shims.
- 9d4b379: Return structured check drift results from the core API while preserving CLI and helper failure behavior.

## 0.13.2

### Patch Changes

- fad23b6: Update GitHub workflow actions to Node 24-compatible major versions.

## 0.13.1

### Patch Changes

- 80bf65d: Harden package release automation with immutable workflow action pins and tag-authoritative GitHub release creation.
- b819ba0: Add GitHub-owned package release automation with Changesets version PRs, Bun publishing, and registry verification.
