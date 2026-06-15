# Package Releases

This page covers the npm package release path for the unscoped `skillset` package. It is separate from Skillset source-unit releases under `.skillset/changes`, which describe authored plugin, skill, and generated-output provenance.

## Ownership

GitHub Actions is the package release operator. Local commands are diagnostics and dry-run aids; package publication should happen from the `Release` workflow on `main`.

Changesets owns npm package version and package changelog calculation. The Skillset change/release commands continue to own source-unit reasons, release state, generated entity changelogs, and target output drift. Do not collapse these two release systems unless a future explicit bridge is designed.

Only the unscoped `skillset` CLI package is public in the current package posture. The workspace packages `@skillset/core`, `@skillset/lint`, and `@skillset/transforms` remain private implementation packages: core is the internal library boundary that the CLI and tests consume, while lint and transforms are support packages behind that boundary. Do not include them in npm publish automation or treat their exports as semver-stable until a future package-posture issue explicitly promotes them.

## Flow

Feature branches that change package-facing behavior should include a `.changeset/*.md` file. When the branch merges to `main`, `.github/workflows/release.yml` runs `changesets/action` to create or update a `chore(release): version packages` pull request.

When the version PR merges to `main`, the same workflow checks the npm registry and resolves the release intent labels from the merged version PR. If the current `apps/skillset/package.json` version is already published and the intended dist-tag points to it, the workflow exits the publish step without entering a publish environment and ensures a missing GitHub release can still be created when the matching `v<version>` tag already points at the package-version commit. If the version is missing, the workflow runs the publish policy. Low-risk generated releases can publish through `npm-auto`; anything ambiguous routes to the protected manual `npm` environment; `publish:none` skips npm and GitHub release creation; `publish:block` stops the release workflow. Successful publishes wait for the version and dist-tag to appear on the registry, create and push the matching `v<version>` tag at the package-version commit, and create the GitHub release with `--verify-tag` if it does not already exist.

The publish wrapper derives the npm dist-tag from the version: stable versions publish to `latest`, and prerelease versions publish to their prerelease label such as `beta`.

## Release Intent Labels

Release labels express human intent, not trust. The policy script still verifies the branch, commit, generated Changesets PR shape, changed files, exact-SHA CI, changelog heading, version delta, and registry state before an automatic publish can run.

The release PR supports these mutually exclusive label families:

| Family | Labels | Behavior |
| --- | --- | --- |
| Publish | `publish:auto`, `publish:manual`, `publish:none`, `publish:block` | Chooses automatic publish, protected manual publish, intentional no-publish state, or hard block. Missing `publish:*` defaults to manual. |
| Channel | `channel:stable`, `channel:preview`, `channel:canary` | Declares the intended release channel. V1 only allows `publish:auto` with `channel:stable`, which maps to npm `latest`. |
| Release | `release:patch`, `release:minor`, `release:major` | Declares release-size intent. When present, the policy compares it against the actual package version delta. |

Conflicting labels within a family, unknown labels under these prefixes, registry drift, or `publish:block` block the workflow with diagnostics. `publish:none` requires an audit reason in the release PR body or comments because it intentionally leaves package-version state unpublished. Any generated release PR that touches workflow files, release scripts, package publish metadata, lockfiles, source files, or other unexpected paths falls back to the manual environment rather than the automatic environment.

## Commands

```bash
bun run changeset
bun run changeset:status
bun run publish:plan
bun run publish:policy
bun run publish:check
bun run publish:registry-check
bun run publish:registry-check:published
```

`bun run publish:policy` is the release-workflow policy gate. It reads the current commit, the associated Changesets release PR, exact-SHA GitHub checks, package/changelog state, and npm registry state, then emits GitHub Actions outputs for `auto`, `manual`, `none`, or `block`.

`bun run publish:check` is the local preflight: it runs the full repo check, rebuilds the npm package output, and performs `bun pm pack --dry-run` from `apps/skillset` so package contents are verified without registry authentication.

These commands mutate package state or contact the registry for publication, so they are workflow/recovery commands rather than normal local diagnostics:

```bash
bun run version:packages
bun run publish:packages
```

`bun run version:packages` consumes Changesets and rewrites package versions and changelogs. `bun run publish:packages` is intended for GitHub Actions and refuses to perform a first publish from a local shell unless `SKILLSET_ALLOW_LOCAL_PUBLISH=1` is set for an explicit incident or recovery path.

## Trusted Publishing Setup

The workflow is prepared for npm Trusted Publishing by using publish jobs with `permissions.id-token: write`, SHA-pinned workflow actions, Node 24, the npm CLI for the final publish, and GitHub environments for publish paths. Bun remains the package build, test, and preflight runtime; npm owns the OIDC exchange because Trusted Publishing is currently documented for `npm publish`. Configure the trusted publisher for the npm package with:

| Field | Value |
| --- | --- |
| Package | `skillset` |
| Publisher | GitHub Actions |
| Organization or user | `outfitter-dev` |
| Repository | `skillset` |
| Workflow filename | `release.yml` |
| Environment | Leave blank |
| Allowed action | `npm publish` |

npm allows one trusted publisher connection per package, so do not create separate npm trusted publisher entries for `npm` and `npm-auto`. Leaving the npm Environment field blank binds publishing to this repository and workflow without pinning one GitHub environment. The workflow still uses GitHub environments for routing: `npm` remains the protected manual approval path, while `npm-auto` should not require manual reviewers because the release policy is the gate that makes that path reachable.

The repository intentionally does not commit an npm auth token in `.npmrc` and the release workflow does not pass `NPM_TOKEN`.

## No Package Release

Package-facing changes should include a `.changeset/*.md` file. Internal-only changes may intentionally omit a Changeset when they do not affect the published package contract; call that out in the PR body so the release workflow's version-PR behavior is easy to audit. Skillset source-unit changes under `.skillset/changes` are separate from npm package changes and do not satisfy package release intent by themselves.
