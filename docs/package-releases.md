# Package Releases

This page covers the npm package release path for the unscoped `skillset` package. It is separate from Skillset source-unit releases under the workspace change directory (`.skillset/changes`), which describe authored plugin, skill, and generated-output provenance.

For the current 0.x milestone decision record, see the
[0.x `latest` Release Plan](0x-latest-release-plan.md). That plan defines the
readiness gates for promoting a 0.x package to npm `latest` without making 1.0
contract promises.

## Ownership

GitHub Actions is the package release operator. Local commands are diagnostics and dry-run aids; package publication should happen from the `Release` workflow on `main`.

Changesets owns npm package version and package changelog calculation. The Skillset change/release commands continue to own source-unit reasons, release state, generated entity changelogs, and target output drift. Do not collapse these two release systems unless a future explicit bridge is designed.

Only the unscoped `skillset` CLI package is public in the current package posture. The scoped workspace packages remain private implementation packages: `@skillset/core` is the internal compiler/library boundary, `@skillset/registry` stores deterministic provider facts and registry contracts, and the remaining scoped packages support schema, lint, toolkit, transform, and workbench surfaces behind that boundary. Do not include them in npm publish automation or treat their exports as semver-stable until a future package-posture issue explicitly promotes them.

## Flow

Feature branches that change package-facing behavior should include a `.changeset/*.md` file on the branch that owns the behavior. In Graphite stacks, keep release intent branch-local: do not hide lower-branch package changes by adding one cleanup Changeset at the stack tip. If the lower branch owns the package-facing code, the lower branch owns the Changeset, and any missing release intent should be fixed on that branch before restacking upward.

Package-facing means a change that can affect the published `skillset` CLI package payload or its runtime behavior. The guardrail intentionally does not treat docs, workflow files, release scripts, generated Skillset source-unit state, fixtures, or repo-only maintenance as package-facing by default. Current package-facing paths are:

| Path | Why it requires a package Changeset |
| --- | --- |
| `apps/skillset/src/**` except tests | CLI runtime source bundled into the package. |
| `apps/skillset/package.json` | Published package metadata, bin entries, dependencies, and version-bearing state. |
| `packages/core/src/**` except tests | Internal compiler/library implementation bundled through the CLI. |
| `packages/lint/src/**` except tests | Lint implementation consumed by the CLI. |
| `packages/registry/src/**` except tests | Adopted provider destination-format snapshots, schema evidence, and migration registry consumed by the CLI and core conformance checks. |
| `packages/schema/src/**` except tests | Source contract schemas, validators, examples, and artifact generation consumed by the CLI, Workbench, and generated editor-schema references. |
| `packages/toolkit/src/**` except tests | Runtime helper surfaces intended for hook scripts and compiler-owned wrappers. |
| `packages/transforms/src/**` except tests | Transform implementation consumed by the CLI. |
| `packages/*/package.json` for `core`, `lint`, `registry`, `schema`, and `transforms` | Runtime dependency and package metadata for the private workspace packages that feed the CLI. |
| `bun.lock` / `bun.lockb` | Dependency resolution that can alter the packaged CLI runtime. |

`bun run changeset:check` enforces this boundary. It fails when package-facing paths change without an active `.changeset/*.md`, when an active Changeset appears on a branch that only changes repo machinery, or when a pending Changeset mixes the published `skillset` package with ignored private `@skillset/*` packages. Deleted Changesets are ignored so cleanup branches can remove mistaken package-release entries. Private-only Changesets remain valid internal evidence; a public Changeset should list only packages that Changesets can version.

Provider and schema changes usually have two evidence surfaces. The package Changeset explains the npm-facing behavior change, while the Skillset pending change entry explains any source-unit or generated-output provenance change in the local workspace. Generated schema artifacts under `docs/reference/schemas/` and `docs/reference/examples/` are reviewed with the contract change but do not replace the `.changeset/*.md` entry because they are derived from `packages/schema/src/**`.

Use these package changelog shapes for common provider/schema updates:

| Drift class | Changelog wording shape |
| --- | --- |
| Compatible provider refresh | `Refresh provider schema snapshot evidence for <surface>; generated output stays byte-compatible.` |
| Safe migration | `Add a safe <provider> <destination> destination-format update so skillset update --yes can rewrite generated outputs without source changes.` |
| Manual review | `Record <provider> <destination> destination-format drift as manual review so Skillset reports the affected outputs without rewriting source or generated files automatically.` |
| Schema contract change | `Update the <field/surface> schema contract and regenerate editor schema artifacts so CLI, Workbench, and docs share the same validation shape.` |

When a branch with unreleased Changesets merges to `main`, `.github/workflows/release.yml` runs `changesets/action` to create or update a `chore(release): version packages` pull request. Skillset then applies missing release intent labels to that generated version PR. It preserves any existing human-provided label family and only fills gaps. The labeler uses source PR evidence from the package release range: if every consumed Changeset source PR carries explicit `stack:boundary` evidence and the generated version is stable, it may add `publish:auto`; otherwise it adds `publish:manual` so the release stays behind the protected environment.

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

Source PRs may also use `stack:boundary`. That label is not a release-size intent and it does not replace a Changeset. It marks a source PR as complete enough to be considered for automatic package publication. The publish policy reads the source PRs between the previous package-version commit and the generated version commit; `publish:auto` requires every consumed Changeset source PR to carry `stack:boundary`. Missing boundary evidence falls back to manual approval. Unknown `stack:*` labels block the workflow because label drift should be corrected explicitly.

## Commands

```bash
bun run changeset
bun run changeset:check
bun run changeset:status
bun run publish:plan
bun run publish:label-release-pr
bun run publish:policy
bun run publish:check
bun run publish:registry-check
bun run publish:registry-check:published
```

`bun run publish:label-release-pr` is a workflow helper that runs after `changesets/action` creates or updates the generated version PR. It labels missing intent families without overriding existing human intent.

`bun run changeset:check` is the branch-local package-release guard. Locally it diffs against the remote trunk; in PR CI it uses the pull request file list so stacked branches are checked against their own review diff.

`bun run publish:policy` is the release-workflow policy gate. It reads the current commit, the associated Changesets release PR, exact-SHA GitHub checks, source PR stack evidence, package/changelog state, and npm registry state, then emits GitHub Actions outputs for `auto`, `manual`, `none`, or `block`.

`bun run publish:check` is the local preflight: it runs the full repo check, rebuilds the npm package output, and performs `bun pm pack --dry-run` from `apps/skillset` so package contents are verified without registry authentication.

Before marking a release PR ready, review provider and schema evidence when the range touches `packages/registry/src/**`, `packages/schema/src/**`, `docs/reference/schemas/**`, or `docs/reference/examples/**`:

1. Run `bun run schema:check` for schema contract or generated schema/example changes.
2. Run `bun ./apps/skillset/src/cli.ts providers check --root .` and, when upstream drift is expected, `bun ./apps/skillset/src/cli.ts providers diff --root .` for provider snapshot or migration changes.
3. Inspect `packages/registry/src/{index.ts,schema-snapshots.ts,migrations.ts}` alongside `docs/target-surfaces.md` so the adopted snapshot, migration class, and user-facing diagnostics tell the same story.
4. Confirm each package-facing provider/schema change has a `.changeset/*.md` entry using the wording class above, and each local source-unit behavior change has a Skillset pending change entry where appropriate.
5. Keep generated `docs/reference/schemas/**` and `docs/reference/examples/**` diffs in the same branch as their `packages/schema/src/**` source change, then rerun `bun run changeset:check` and `bun run skillset:verify`.

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

Package-facing changes should include a `.changeset/*.md` file. Internal-only changes should omit a Changeset when they do not affect the published package contract; call that out in the PR body when the distinction is subtle so the release workflow's version-PR behavior is easy to audit. Skillset source-unit changes under the workspace change directory are separate from npm package changes and do not satisfy package release intent by themselves.
