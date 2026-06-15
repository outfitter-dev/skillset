# Package Releases

This page covers the npm package release path for the unscoped `skillset` package. It is separate from Skillset source-unit releases under `.skillset/changes`, which describe authored plugin, skill, and generated-output provenance.

## Ownership

GitHub Actions is the package release operator. Local commands are diagnostics and dry-run aids; package publication should happen from the `Release` workflow on `main`.

Changesets owns npm package version and package changelog calculation. The Skillset change/release commands continue to own source-unit reasons, release state, generated entity changelogs, and target output drift. Do not collapse these two release systems unless a future explicit bridge is designed.

Only the unscoped `skillset` CLI package is public in the current package posture. The workspace packages `@skillset/core`, `@skillset/lint`, and `@skillset/transforms` remain private implementation packages: core is the internal library boundary that the CLI and tests consume, while lint and transforms are support packages behind that boundary. Do not include them in npm publish automation or treat their exports as semver-stable until a future package-posture issue explicitly promotes them.

## Flow

Feature branches that change package-facing behavior should include a `.changeset/*.md` file. When the branch merges to `main`, `.github/workflows/release.yml` runs `changesets/action` to create or update a `chore(release): version packages` pull request.

When the version PR merges to `main`, the same workflow checks the npm registry. If the current `apps/skillset/package.json` version is already published and the intended dist-tag points to it, the workflow exits the publish step without entering the protected publish environment and ensures a missing GitHub release can still be created when the matching `v<version>` tag already points at the package-version commit. If the version is missing, the workflow enters the `npm` environment, runs the full package preflight, publishes with `npm publish`, waits for the version and dist-tag to appear on the registry, creates and pushes the matching `v<version>` tag at the package-version commit, and creates the GitHub release with `--verify-tag` if it does not already exist.

The publish wrapper derives the npm dist-tag from the version: stable versions publish to `latest`, and prerelease versions publish to their prerelease label such as `beta`.

## Commands

```bash
bun run changeset
bun run changeset:status
bun run publish:plan
bun run publish:check
bun run publish:registry-check
bun run publish:registry-check:published
```

`bun run publish:check` is the local preflight: it runs the full repo check, rebuilds the npm package output, and performs `bun pm pack --dry-run` from `apps/skillset` so package contents are verified without registry authentication.

These commands mutate package state or contact the registry for publication, so they are workflow/recovery commands rather than normal local diagnostics:

```bash
bun run version:packages
bun run publish:packages
```

`bun run version:packages` consumes Changesets and rewrites package versions and changelogs. `bun run publish:packages` is intended for GitHub Actions and refuses to perform a first publish from a local shell unless `SKILLSET_ALLOW_LOCAL_PUBLISH=1` is set for an explicit incident or recovery path.

## Trusted Publishing Setup

The workflow is prepared for npm Trusted Publishing by using a publish job with `permissions.id-token: write`, SHA-pinned workflow actions, Node 24, the npm CLI for the final publish, and the protected GitHub environment `npm`. Bun remains the package build, test, and preflight runtime; npm owns the OIDC exchange because Trusted Publishing is currently documented for `npm publish`. Configure the trusted publisher for the npm package with:

| Field | Value |
| --- | --- |
| Package | `skillset` |
| Publisher | GitHub Actions |
| Organization or user | `outfitter-dev` |
| Repository | `skillset` |
| Workflow filename | `release.yml` |
| Environment | `npm` |
| Allowed action | `npm publish` |

The repository intentionally does not commit an npm auth token in `.npmrc` and the release workflow does not pass `NPM_TOKEN`.

## No Package Release

Package-facing changes should include a `.changeset/*.md` file. Internal-only changes may intentionally omit a Changeset when they do not affect the published package contract; call that out in the PR body so the release workflow's version-PR behavior is easy to audit. Skillset source-unit changes under `.skillset/changes` are separate from npm package changes and do not satisfy package release intent by themselves.
