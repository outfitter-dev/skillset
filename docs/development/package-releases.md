---
description: The package-release contract defines Changeset ownership, automated policy, local preflight, trusted publishing, and recovery boundaries.
---

# Package Releases

This page covers the npm package release path for the public Skillset distribution packages. It is separate from Skillset [source-unit](../glossary.md#source-unit) releases under `.skillset/changes`, which describe authored plugin, skill, and [generated-output](../glossary.md#generated-output) provenance.

## Ownership

GitHub Actions is the package release operator. Local commands are diagnostics and dry-run aids; package publication should happen from the `Release` workflow on `main`.

Changesets owns npm package version and package changelog calculation. The Skillset change/release commands continue to own source-unit reasons, release state, generated entity changelogs, and [target](../glossary.md#target) output [drift](../glossary.md#drift). Do not collapse these two release systems unless a future explicit bridge is designed.

GitHub applies its bot-approval gate whenever the repository `GITHUB_TOKEN` creates or updates the generated `changeset-release/main` pull request. After every such update, a collaborator must approve the pull request workflow runs, then confirm that the PR-associated, exact-head `check`, `skillset check --ci` gate, and every other applicable workflow are green. Keep the release PR unmerged until that exact-head evidence is green. A manual `workflow_dispatch` run is diagnostic evidence only; it is not a substitute for required checks attached to the pull request head.

Unattended generated-PR CI requires a separately approved, least-privilege GitHub App or personal access token so the update is not attributed to the repository `GITHUB_TOKEN`. Provisioning or storing that credential is an explicit repository-administration action and is outside this workflow's contract. Do not use `pull_request_target` to execute generated release PR code: its privileged default-branch context is the wrong trust boundary for code checked out from a pull request.

The unscoped `skillset` package, `@skillset/cli`, and the five initial `@skillset/native-*` packages are public. `@skillset/cli` owns the complete Bun-targeted artifact. The unscoped package is a dependency-free Node launcher whose optional dependencies select exactly one matching native package by operating system, CPU, and Linux libc. Changesets keeps all seven packages in one fixed version group because `skillset` owns the product version. The remaining scoped workspace packages are private implementation packages: `@skillset/core` is the internal compiler/library boundary, `@skillset/registry` stores deterministic provider facts and registry contracts, and the other scoped packages support schema, lint, toolkit, transform, and workbench surfaces behind that boundary. Do not include those private packages in npm publish automation or treat their exports as semver-stable.

## Flow

Feature branches that change package-facing behavior should include a `.changeset/*.md` file on the branch that owns the behavior. In Graphite stacks, keep release intent branch-local: do not hide lower-branch package changes by adding one cleanup Changeset at the stack tip. If the lower branch owns the package-facing code, the lower branch owns the Changeset, and any missing release intent should be fixed on that branch before restacking upward.

Package-facing means a change that can affect a public CLI package payload or its runtime behavior. The guardrail intentionally does not treat docs, workflow files, release scripts, generated Skillset source-unit state, fixtures, or repo-only maintenance as package-facing by default. Current package-facing paths are:

| Path | Why it requires a package Changeset |
| --- | --- |
| `README.md` | Canonical README source copied into the published package. |
| `apps/skillset/src/**` except tests | CLI runtime source bundled into the package. |
| `apps/cli/package.json` | Public Bun package metadata, bin, dependency, runtime-floor, and version-bearing state. |
| `apps/skillset/package.json` | Published package metadata, bin entries, dependencies, and version-bearing state. |
| `apps/native-*/package.json` | Public platform package identity, compatibility selectors, payload, and version-bearing state. |
| `scripts/build-package.ts`, `scripts/native-packages.ts` | Public launcher, Bun CLI, and native package assembly behavior. |
| `packages/core/src/**` except tests | Internal compiler/library implementation bundled through the CLI. |
| `packages/lint/src/**` except tests | Lint implementation consumed by the CLI. |
| `packages/registry/src/**` except tests | Adopted provider [destination](../glossary.md#destination)-format snapshots, schema evidence, and migration registry consumed by the CLI and core conformance checks. |
| `packages/schema/src/**` except tests | Source contract schemas, validators, examples, and artifact generation consumed by the CLI, Workbench, and generated editor-schema references. |
| `packages/toolkit/src/**` except tests | Runtime helper surfaces intended for hook scripts and compiler-owned wrappers. |
| `packages/transforms/src/**` except tests | Transform implementation consumed by the CLI. |
| `packages/*/package.json` for `core`, `lint`, `registry`, `schema`, `toolkit`, and `transforms` | Runtime dependency and package metadata for the private workspace packages that feed the CLI. |
| `bun.lock` / `bun.lockb` | Dependency resolution that can alter the packaged CLI runtime. |

`bun run changeset:check` enforces this boundary. It fails when package-facing paths change without an active `.changeset/*.md`, when an active Changeset appears on a branch that only changes repo machinery, or when a pending Changeset mixes either public package with ignored private `@skillset/*` packages. Deleted Changesets are ignored so cleanup branches can remove mistaken package-release entries. Private-only Changesets remain valid internal evidence; a public Changeset should list only packages that Changesets can version.

Provider and schema changes usually have two evidence surfaces. The package Changeset explains the npm-facing behavior change, while the Skillset pending change entry explains any source-unit or generated-output provenance change in the local workspace. Generated schema artifacts under `docs/reference/schemas/` and `docs/reference/examples/` are reviewed with the contract change but do not replace the `.changeset/*.md` entry because they are derived from `packages/schema/src/**`.

Use these package changelog shapes for common provider/schema updates:

| Drift class | Changelog wording shape |
| --- | --- |
| Compatible provider refresh | `Refresh provider schema snapshot evidence for <surface>; generated output stays byte-compatible.` |
| Safe migration | `Add a safe <provider> <destination> destination-format update so skillset update --yes can rewrite generated outputs without source changes.` |
| Manual review | `Record <provider> <destination> destination-format drift as manual review so Skillset reports the affected outputs without rewriting source or generated files automatically.` |
| Schema contract change | `Update the <field/surface> schema contract and regenerate editor schema artifacts so CLI, Workbench, and docs share the same validation shape.` |

When a branch with unreleased Changesets merges to `main`, `.github/workflows/release.yml` runs `changesets/action` to create or update a `chore(release): version packages` pull request. Skillset then applies missing release intent labels to that generated version PR. It preserves any existing human-provided label family and only fills gaps. The labeler uses source PR evidence from the package release range: if every consumed Changeset source PR carries explicit `stack:boundary` evidence and the generated version is stable, it may add `publish:auto`; otherwise it adds `publish:manual` so the release stays behind the protected environment.

When the version PR merges to `main`, the same workflow checks the exact seven-package npm set and resolves the release intent labels from the merged version PR. A fresh low-risk generated release may publish through `npm-auto`; anything ambiguous routes to the protected manual `npm` environment. A recoverable partial release always routes through `npm`, even when its source policy was automatic. `publish:none` skips npm and GitHub release creation, while `publish:block` stops the workflow.

Before npm publication, the workflow resolves the protected macOS signing policy, builds one release artifact from the version commit, runs direct and global-install smoke on all five target hosts, and attests the exact five archives plus manifest and checksum file. The current implementation accepts only an explicit `SKILLSET_MACOS_SIGNING_POLICY=unsigned`; here `unsigned` means no Developer ID identity or notarization, while the native builder still applies the identity-free ad hoc signature required to execute Bun 1.4.0's Darwin output. A missing, unknown, or `required` value fails closed because protected signing and notarization are not yet implemented. Protected signing must replace the ad hoc signature before final archive assembly when that policy changes because signatures alter the executable and archive hashes.

The publisher uses npm 11.12.1 to stage all seven tarballs before the first registry mutation. It records each tarball's SHA-512 integrity, publishes the five native packages, then `@skillset/cli`, then `skillset`, and waits after every package for the exact version, dist-tag, integrity, and SLSA provenance to appear. It rechecks all six prerequisites immediately before the launcher. A partial prefix may resume through the manual environment while the launcher is absent. A non-prefix state, missing provenance, immutable tarball mismatch, dist-tag drift, or a launcher published before a prerequisite blocks and requires a new version instead of silent repair.

After the registry set is complete, the workflow verifies every GitHub attestation, resolves the commit where all seven manifests acquired the product version, and creates or verifies the matching `v<version>` tag. GitHub release recovery is byte-safe: matching assets are retained, missing assets are uploaded, and mismatched or unexpected assets block without clobbering. The final release must contain exactly the five native archives, `skillset-v<version>-manifest.json`, and `skillset-v<version>-SHA256SUMS`.

The publish wrapper derives the npm dist-tag from the version: stable versions publish to `latest`, and prerelease versions publish to their prerelease label such as `beta`.

## Homebrew Handoff

Homebrew is the native macOS path for Apple Silicon and Intel systems. After a stable `latest` release is reconciled, the Release workflow calls the reusable `Publish Homebrew` workflow with the published tag. Prereleases and older stable tags are rejected so they cannot replace the current formula.

The handoff downloads the exact seven GitHub release assets, verifies their GitHub attestations, checks the `SHA256SUMS` inventory and bytes, and validates the native manifest's exact five-target metadata. It then renders a macOS-only formula from the verified Darwin checksums and updates the tap README with install, upgrade, and uninstall commands. The workflow opens or updates `release/skillset` in `outfitter-dev/homebrew-tap`; it never merges the pull request or publishes the formula directly. The generic tap workflow repair in `outfitter-dev/homebrew-tap` PR #19 is a prerequisite. Tap-owned CI must pass strict audit plus install and test on Apple Silicon and Intel macOS before a maintainer merges that PR; the tap's tested-head publication remains a separate maintainer action.

Cross-repository mutation runs only in the protected GitHub `homebrew` environment. Configure `HOMEBREW_TAP_TOKEN` there as a fine-grained token limited to `outfitter-dev/homebrew-tap` with Contents and Pull requests read/write access. The environment's required reviewers own approval of token use; repository-wide or organization-wide token access is not required.

For recovery, manually dispatch `Publish Homebrew` with the current published stable tag. The workflow serializes every Skillset handoff through one concurrency group and reuses one tap branch, so a newer stable release updates the existing proposal instead of creating mergeable stale-version branches. A missing token, non-latest tag, asset mismatch, invalid manifest, failed attestation, unmanaged tap README section, or tap PR conflict stops without merging. Resolve the evidence or branch conflict, then rerun the protected workflow; do not hand-edit generated checksums or bypass tap CI.

## Native Artifact Build

The repository owns a focused native build path separate from the ordinary `bun run check` gate. The accepted release set is five targets: Apple arm64 and baseline x64, Linux glibc arm64 and baseline x64, and Windows baseline x64. Linux musl arm64 and baseline x64 remain buildable reserved targets; they are not part of the required manifest or public package set.

```bash
bun run build:native -- --target darwin-arm64
bun run native:check -- --allow-partial
bun run native:smoke -- --target darwin-arm64

bun run build:native -- --required --reproducible
bun run native:check
bun run build:native-packages -- --required --pack-dir <path>
bun run native:global-smoke -- --target darwin-arm64
```

The required build compiles the singular `apps/skillset/src/cli.ts` entrypoint with the pinned Bun runtime. `--reproducible` compiles every selected target twice using the same canonical executable filename and rejects byte drift. The build emits one raw executable per target, deterministic one-file archives, `skillset-v<version>-manifest.json`, and `skillset-v<version>-SHA256SUMS` under `.skillset/cache/native/` by default.

Verification enforces the exact five-target set, archive names and payloads, executable modes, package mappings, product/Bun versions, CLI-contract digest, sizes, archive and manifest checksums, sort order, and complete checksum coverage. The target-host smoke checks version, root help, a structured read-only lookup, invalid-command exit behavior, and a sentinel proving those normal paths did not invoke a system `bun`.

`scripts/native-size-baseline.json` records Bun 1.4.0 measurements for every required target and may retain informational measurements for buildable reserved targets. A target may grow by 10% or 2 MiB, whichever is larger, before verification fails. That budget catches an embedded-runtime or packaging regression without making ordinary compiler growth churn the baseline; a Bun pin change requires explicit remeasurement and review.

The `Native` workflow builds the five required targets reproducibly on macOS, applying a deterministic ad hoc signature to Darwin executables so Bun 1.4.0's compiled output is runnable, then runs each executable on its matching standard GitHub-hosted macOS, Linux, or Windows architecture. The ad hoc signature carries no developer identity and does not replace the protected signing and notarization policy. The expensive matrix does not run on every pull-request push: maintainers dispatch it manually for exact-head review evidence, GitHub runs it monthly on `main` to detect hosted-runner drift, and the protected Release workflow calls the same reusable job before publication. Release resolves the signing policy before the reusable workflow starts and consumes that exact smoke-tested artifact for attestation, npm packaging, and the GitHub release. The native workflow does not apply a protected identity, attest, publish, create a release, or change the Homebrew tap.

`bun run build:native-packages -- --required` projects the verified raw executables into the five public platform package directories. Each package contains exactly one executable plus its package manifest, generated package README, and MIT license. The platform packages declare `os`, `cpu`, and Linux `libc` compatibility; the unscoped launcher's optional dependencies use exact product versions and never download during `postinstall`. Global npm installation remains compatible with npm's lifecycle-script disabling mode because the launcher and platform packages contain their complete payloads and declare no lifecycle scripts.

The global native smoke command packs all five local platform packages, rewrites only the disposable launcher fixture to use those tarballs, and runs a real offline global npm installation with lifecycle scripts disabled. It asserts npm installed only the host-compatible optional package, runs `skillset --version` and root help with Bun replaced by a sentinel, then uninstalls and reinstalls the command. The hosted Native matrix runs this proof on every initial target after the direct executable smoke.

### Verify the published distribution matrix

After a stable npm/GitHub release and its Homebrew formula are published, run the manual **Distribution Conformance** workflow with the exact `v<version>` tag. This is deliberately a post-publication gate: pull requests and local builds cannot prove registry provenance, GitHub attestations, or a formula installed from the public tap.

The workflow checks out the release tag with read-only permissions, reconstructs the native package inputs from the verified archives, and rebuilds all seven npm tarballs with pinned npm. Registry verification requires the exact seven-package set, common dist-tag, matching tarball integrity, and provenance. It also verifies the exact seven GitHub assets and every attestation, then records native raw/archive sizes plus the `@skillset/cli` tarball size. Finally, it runs the same version, help, structured lookup, invalid-command, exit-code, and forbidden-runtime assertions across three channels on all five required hosts:

- the direct native archive with neither Bun nor Node available to the child command;
- `npm install --global skillset` with Node available and Bun replaced by a sentinel;
- `bunx @skillset/cli`, the Bun-global command, and a repository-local development dependency, plus an explicit no-Bun failure proof.

A separate Homebrew lane installs `outfitter-dev/tap/skillset`, runs the same native assertions, and executes strict audit and formula tests on Apple Silicon and Intel macOS. Musl remains a reserved negative-diagnostic target rather than Tier 1; it does not enter this required matrix until the native target contract promotes it.

`bun run test:distribution` is the local and immutable-tag diagnostic gate. It pins the five-target inventory, unsupported platform and libc diagnostics, and recoverable versus blocked partial-release states. The hosted workflow runs that gate before exercising the published bytes, then mutates only its disposable global installation to prove missing-package, version-mismatch, and corrupt-executable diagnostics from the published launcher. It also exhaustively checks every public route's help, structured-output declaration, and invalid-input exit behavior on each installed channel.

The workflow does not publish, tag, attest, sign, open or merge a pull request, or modify the tap. A failed partial-registry, missing-asset, checksum, provenance, attestation, version-parity, runtime, or formula check leaves the release incomplete and requires the owning recovery path. Preserve the uploaded `skillset-distribution-evidence-<version>` artifact and link its run in the release handoff.

## Release Intent Labels

Release labels express human intent, not trust. The policy script still verifies the branch, commit, generated Changesets PR shape, changed files, exact-SHA CI, changelog heading, version delta, and registry state before an automatic publish can run.

The release PR supports these mutually exclusive label families:

| Family | Labels | Behavior |
| --- | --- | --- |
| Publish | `publish:auto`, `publish:manual`, `publish:none`, `publish:block` | Chooses automatic publish, protected manual publish, intentional no-publish state, or hard block. Missing `publish:*` defaults to manual. |
| Channel | `channel:stable`, `channel:preview`, `channel:canary` | Declares the intended release channel. Automatic publishing currently requires `channel:stable`, which maps to npm `latest`. |
| Release | `release:patch`, `release:minor`, `release:major` | Declares release-size intent. When present, the policy compares it against the actual package version delta. |

Conflicting labels within a family, unknown labels under these prefixes, registry drift, or `publish:block` block the workflow with diagnostics. `publish:none` requires an audit reason in the release PR body or comments because it intentionally leaves package-version state unpublished. Any generated release PR that touches workflow files, release scripts, package publish metadata, lockfiles, source files, or other unexpected paths falls back to the manual environment rather than the automatic environment.

Source PRs may also use `stack:boundary`. That label is not a release-size intent and it does not replace a Changeset. It marks a source PR as complete enough to be considered for automatic package publication. The publish policy reads the source PRs between the previous package-version commit and the generated version commit; `publish:auto` requires every consumed Changeset source PR to carry `stack:boundary`. Missing boundary evidence falls back to manual approval. Unknown `stack:*` labels block the workflow because label drift should be corrected explicitly.

## Commands

```bash
bun run changeset
bun run changeset:check
bun run changeset:status
bun run build:native -- --target <suffix>
bun run build:native-packages -- --required --pack-dir <path>
bun run native:check -- --allow-partial
bun run native:global-smoke -- --target <suffix>
bun run native:smoke -- --target <suffix>
bun run publish:plan
bun run publish:label-release-pr
bun run publish:policy
bun run publish:check
bun run publish:registry-check
bun run publish:registry-check:published
bun run publish:release-check -- --native-out-dir <path> --stage-dir <path>
bun run release:assets -- stage --native-out-dir <path> --release-dir <path>
bun run release:signing-check
```

`bun run publish:label-release-pr` is a workflow helper that runs after `changesets/action` creates or updates the generated version PR. It labels missing intent families without overriding existing human intent.

`bun run changeset:check` is the branch-local package-release guard. Locally it diffs against the remote trunk; in PR CI it uses the pull request file list so stacked branches are checked against their own review diff.

`bun run publish:policy` is the release-workflow policy gate. It reads the current commit, the associated Changesets release PR, exact-SHA GitHub checks, source PR stack evidence, package/changelog state, and npm registry state, then emits GitHub Actions outputs for `auto`, `manual`, `none`, or `block`.

`bun run publish:check` is the local source preflight: it runs the full repo check, validates the exact seven-package manifest and Changesets fixed group, rebuilds the npm outputs, and verifies the ordinary package payloads without registry authentication. The release-only `publish:release-check` additionally consumes a verified native output, stages all seven tarballs with the pinned npm CLI, and compares any existing package versions against their immutable registry integrity and provenance.

Before marking a release PR ready, review provider and schema evidence when the range touches `packages/registry/src/**`, `packages/schema/src/**`, `docs/reference/schemas/**`, or `docs/reference/examples/**`:

1. Run `bun run schema:check` for schema contract or generated schema/example changes.
2. Run `bun run providers:check` and, when upstream drift is expected, `bun run providers:diff` for provider snapshot or migration changes. Apply an intentional refresh with `bun run providers:update`.
3. Inspect `packages/registry/src/{index.ts,schema-snapshots.ts,migrations.ts}` alongside the [provider evidence refresh procedure](features/feature-registry.md#provider-evidence-refresh), authored [provider reference](../reference/providers/README.md), and generated [support matrix](../reference/support-matrix.md) so the adopted snapshot, migration class, and user-facing diagnostics tell the same story.
4. Confirm each package-facing provider/schema change has a `.changeset/*.md` entry using the wording class above, and each local source-unit behavior change has a Skillset pending change entry where appropriate.
5. Keep generated `docs/reference/schemas/**` and `docs/reference/examples/**` diffs in the same branch as their `packages/schema/src/**` source change, then rerun `bun run changeset:check` and `bun run skillset:check:outputs`.

These commands mutate package state or contact the registry for publication, so they are workflow/recovery commands rather than normal local diagnostics:

```bash
bun run version:packages
bun run publish:packages
```

`bun run version:packages` consumes Changesets and rewrites package versions and changelogs. `bun run publish:packages -- --native-out-dir <path> --stage-dir <path>` publishes only the preflighted tarballs in canonical order. It is intended for GitHub Actions and refuses to publish from a local shell unless `SKILLSET_ALLOW_LOCAL_PUBLISH=1` is set for an explicit incident or recovery path.

## Trusted Publishing Setup

The workflow uses npm Trusted Publishing with `permissions.id-token: write`, SHA-pinned workflow actions, Node 24, pinned npm 11.12.1, explicit `npm publish --provenance`, and GitHub environments for publish paths. Bun remains the package build, test, and preflight runtime; npm owns the OIDC exchange. Configure the same publisher connection separately for each of these packages:

- `@skillset/native-darwin-arm64`
- `@skillset/native-darwin-x64`
- `@skillset/native-linux-arm64-glibc`
- `@skillset/native-linux-x64-glibc`
- `@skillset/native-win32-x64`
- `@skillset/cli`
- `skillset`

| Field                | Value                                         |
| -------------------- | --------------------------------------------- |
| Package              | One package from the seven-package list above |
| Publisher            | GitHub Actions                                |
| Organization or user | `outfitter-dev`                               |
| Repository           | `skillset`                                    |
| Workflow filename    | `release.yml`                                 |
| Environment          | Leave blank                                   |
| Allowed action       | `npm publish`                                 |

npm allows one trusted publisher connection per package, so do not create separate entries for `npm` and `npm-auto`. Leaving the npm Environment field blank binds each package to this repository and workflow without pinning one GitHub environment. The workflow still uses GitHub environments for routing: `npm` remains the protected manual and recovery path, while `npm-auto` should not require manual reviewers because the release policy and exact-set preflight are the gates that make that path reachable.

The repository intentionally does not commit an npm auth token in `.npmrc` and the release workflow does not pass `NPM_TOKEN`.

### One-time package identity bootstrap

npm requires a package to exist before its trusted publisher can be configured. Before the first native release, the five `@skillset/native-*` packages and `@skillset/cli` therefore need one tightly bounded interactive bootstrap at the current `0.22.2` source version. These are real, installable baseline artifacts; the bootstrap does not republish or replace the existing `skillset@0.22.1` registry package and never includes the unscoped launcher. The provenance-bearing global-native release remains the coordinated `0.23.0` set.

After the complete source stack is merged, use a clean `main` checkout synchronized exactly with `origin/main`. Install the pinned npm CLI, build and verify the five native targets, then stage the six bootstrap tarballs into a new empty directory:

```bash
npm install --location=global npm@11.12.1
bun install --frozen-lockfile
bun run build:native -- --required --reproducible
bun run native:check
bun run publish:bootstrap -- stage \
  --native-out-dir .skillset/cache/native \
  --stage-dir <new-empty-directory>
```

Inspect `npm-bootstrap-packages.json` and all six tarballs before authorizing the mutation. The stage excludes `skillset`, pins version `0.22.2`, records the exact clean source commit and SHA-512 integrity, and verifies every tarball's internal package identity and exact four-file payload. It refuses an occupied package identity unless it is an exact canonical-prefix recovery from the same staged bytes. Publication requires that recorded commit to remain the live `main` commit, so restage after any source change.

The mutating command is deliberately local and interactive. It discards ambient npm token/configuration variables, uses an isolated temporary npm configuration, forces a fresh npm web login against `registry.npmjs.org`, requires the authenticated account to report `auth-and-writes` 2FA, and removes the temporary login state afterward. npm owns the 2FA prompt for every publish. The command refuses a non-TTY session, a dirty worktree, any branch other than `main`, a head different from live `origin/main` or the staged commit, a changed tarball, a mismatched confirmation, a non-prefix registry state, or an already-registered identity with different bytes or tags:

```bash
bun run publish:bootstrap -- publish \
  --stage-dir <reviewed-directory> \
  --confirm-version 0.22.2
```

After all six exact packages are visible, configure `release.yml` as the trusted publisher for all seven packages using the table above. Do not merge the generated `0.23.0` version PR until every connection is saved, the protected GitHub release environments exist, and `SKILLSET_MACOS_SIGNING_POLICY=unsigned` is set explicitly. The ordinary coordinated publisher remains token-free; the bootstrap command is not a recovery path for later releases and stops working once the product manifests leave `0.22.2`.

## No Package Release

Package-facing changes should include a `.changeset/*.md` file. Internal-only changes should omit a Changeset when they do not affect the published package contract; call that out in the PR body when the distinction is subtle so the release workflow's version-PR behavior is easy to audit. Skillset source-unit changes under the workspace change directory are separate from npm package changes and do not satisfy package release intent by themselves.
