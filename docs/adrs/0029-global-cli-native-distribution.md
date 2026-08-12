---
id: 29
slug: global-cli-native-distribution
title: Global CLI and Native Distribution
status: accepted
created: 2026-08-11
updated: 2026-08-11
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 4, 14, 22, 23, 26, 27]
amends: [4]
---

# ADR-0029: Global CLI and Native Distribution

## Context

Skillset's shortest path currently begins with a repository dependency and a
package runner:

```bash
bun add --dev skillset
bunx skillset init
```

That path makes the compiler feel project-local even though commands such as
`init`, `create`, `new`, and future cross-repository workflows benefit from a
globally available `skillset` reflex. It also requires users to install Bun
before they can evaluate the product.

The package boundary has a second mismatch. The unscoped `skillset` package
contains the complete Bun-targeted JavaScript CLI, while the same package also
exposes an unused `skillset-toolkit` executable for one hook runtime-context
operation. The main CLI already owns that operation as `skillset hooks
context`. Keeping both executable names would either duplicate Bun's embedded
runtime in native builds or preserve a compatibility surface with no adopters.

Bun can compile the existing TypeScript CLI into standalone executables for
macOS, Linux, and Windows. A measured Apple arm64 build from Skillset 0.22.1
with Bun 1.3.14 and `--compile --minify` is 64,684,514 bytes raw and
24,287,547 bytes gzip-compressed. The current Bun-targeted JavaScript bundle is
2,269,393 bytes. The native cost is acceptable for the primary install because
it removes the system Bun dependency; the JavaScript bundle remains useful for
CI and users who already have Bun.

[ADR-0004](0004-core-library-boundary.md#package-and-publish-posture)
kept every scoped package private while the compiler boundary was being shaped.
The CLI now has a concrete external distribution consumer, so that narrow
publish posture needs an explicit amendment without making Core or the other
implementation packages public.

## Decision

**Skillset has one public command, `skillset`, delivered as a native global CLI
and as a complete Bun-targeted package.**

### Global installation is the front door

The primary npm journey is:

```bash
npm install --global skillset
skillset init
```

Homebrew is an equal native path on macOS:

```bash
brew install outfitter-dev/tap/skillset
skillset init
```

Documentation may show both native routes before choosing one canonical first
example. Installation of the compiler does not install, trust, activate, or
enable any rendered provider output. The build-versus-activation boundary in
the [tenets](../project/tenets.md#builds-do-not-imply-trust) remains intact.

### Each package has one role

The public packages are:

| Package | Role | Runtime |
| --- | --- | --- |
| `skillset` | npm global-install launcher and product version owner | npm's Node launcher selects a native executable; Bun is not required |
| `@skillset/cli` | Complete JavaScript CLI for `bunx`, global Bun installs, repository dependencies, and CI | Bun |
| `@skillset/native-*` | Platform artifacts selected by the unscoped launcher | Standalone executable with embedded Bun |

`@skillset/cli` is not a reduced CI edition. It exposes the same `skillset`
bin, commands, structured output, exit behavior, and interactive/non-interactive
contract as the native executable. The app implementation remains singular;
distribution packages do not fork command logic.

The initial public native package set is:

- `@skillset/native-darwin-arm64`
- `@skillset/native-darwin-x64`
- `@skillset/native-linux-x64-glibc`
- `@skillset/native-linux-arm64-glibc`
- `@skillset/native-win32-x64`

The names `@skillset/native-linux-x64-musl` and
`@skillset/native-linux-arm64-musl` are reserved for the musl targets. They are
not declared, published, or enforced in the initial release set. After
target-host smoke promotes either target, its package joins the same public
lockstep contract.

The unscoped package declares the current enforced native package set as
optional dependencies with matching `os`, `cpu`, and `libc` metadata. A small
npm-compatible launcher resolves the installed match and preserves argv,
stdio, signals, and exit status. It fails with an actionable platform, libc,
omitted-optional-dependency, or version mismatch diagnostic. It does not
download an executable during `postinstall`.

The `skillset` manifest owns the product version. `@skillset/cli`, every native
package in the enforced release set, the compiled `skillset --version` result,
archive names, release tag, and Homebrew formula must match it. Release
planning rejects version drift or a partial package set.

This amends only ADR-0004's scoped-package publish posture. `@skillset/core`,
`@skillset/lint`, `@skillset/registry`, `@skillset/schema`,
`@skillset/transforms`, `@skillset/toolkit`, and `@skillset/workbench` remain
private unless a later accepted decision names a concrete external contract.

### Native releases use an explicit target and artifact contract

The first required release matrix is:

| Artifact suffix | Bun target | npm package |
| --- | --- | --- |
| `darwin-arm64` | `bun-darwin-arm64` | `@skillset/native-darwin-arm64` |
| `darwin-x64` | `bun-darwin-x64-baseline` | `@skillset/native-darwin-x64` |
| `linux-x64-glibc` | `bun-linux-x64-baseline` | `@skillset/native-linux-x64-glibc` |
| `linux-arm64-glibc` | `bun-linux-arm64` | `@skillset/native-linux-arm64-glibc` |
| `windows-x64` | `bun-windows-x64-baseline` | `@skillset/native-win32-x64` |

Linux x64/arm64 musl joins the required matrix only after target-host smoke is
reliable. Windows arm64 and modern-only x64 variants remain deferred. Baseline
x64 targets prefer install compatibility over CPU-specific performance.

Unix archives use
`skillset-v{version}-{artifact-suffix}.tar.gz`; Windows uses
`skillset-v{version}-windows-x64.zip`. Each archive contains one executable and
the release owns the required machine-readable manifest and checksum inventory
defined below.

Native builds and `@skillset/cli` embed the same version and command contract.
Every distribution is built from `apps/skillset/src/cli.ts` without
target-specific command branches. The release gate runs the same
table-driven distribution-conformance vectors against `@skillset/cli` and
every required native target on its target operating system. Those vectors
must inventory every public route and verify its help/usage identity,
structured-output availability, exit behavior, and one representative
read-only end-to-end workflow. `skillset --version` and root `--help` remain
explicit smoke assertions. Normal native commands must not shell out to a
system `bun`.

Each GitHub release requires these metadata artifacts:

- `skillset-v{version}-manifest.json`, with `schemaVersion: 1`, `version`,
  `commit`, `bunVersion`, `cliContractSha256`, and an `artifacts` array sorted
  by artifact suffix. Each artifact records `suffix`, `target`, `npmPackage`,
  `archive`, lowercase `sha256`, `rawSize`, `archiveSize`, and `required`.
- `skillset-v{version}-SHA256SUMS`, with one lowercase SHA-256 digest and two
  spaces before each archive filename, sorted by filename. It covers every
  native archive plus the manifest.

The release verifier rejects a missing field, unknown schema version,
duplicate suffix, wrong sort order, checksum mismatch, package/version drift,
or absent required artifact. npm provenance is required for every public npm
package, and GitHub artifact attestations are required for the native archives,
manifest, and checksum file. If the configured release environment cannot
produce either proof, publication blocks until a maintainer explicitly amends
the release contract; absence is not downgraded to a warning.

### One command vocabulary includes runtime context

Remove the public `skillset-toolkit` bin without a compatibility alias.
Generated adaptive hooks use:

```bash
skillset hooks context --event Stop --format env \
  --context-fields provider,hook.event,session.id
```

The normalized runtime-context implementation may remain in a private owned
package. Its package name is not a user-facing installation or semver promise.

### Release channels remain protected workflows

Changesets and GitHub Actions version and release the public package set in
lockstep. Platform packages and `@skillset/cli` become visible before the
unscoped launcher. A GitHub release is created only after target smoke,
registry-set verification, archive checksums, and required provenance and
attestation verification pass.

The existing `outfitter-dev/homebrew-tap` formula consumes immutable macOS
release archives and their checksums. Formula updates derive from verified
release metadata and test `skillset --version`; they are not handwritten from
an expected future release.

Merge, npm publication, GitHub release creation, protected signing or
notarization inputs, and Homebrew publication remain separate authority gates.
Repository implementation can prepare and verify those paths without granting
itself release credentials or publication authority.

## Non-Goals

- A separate `skillset-ci`, `@skillset/ci`, or `@skillset/bun` product.
- A compatibility alias for `skillset-toolkit`.
- Publishing the private runtime-context package.
- Installing Bun from the native CLI when normal execution does not require it.
- A network-downloading npm install script.
- Automatic installation, activation, trust, or user-level provider mutation.
- A new Homebrew tap or a general self-update system.

## Consequences

### Positive

- The first command after one install is always `skillset`, and later
  system-wide workflows do not need package-runner syntax.
- Native users do not need Bun, while Bun/CI users keep a roughly 2 MB
  full-featured JavaScript distribution.
- npm, direct GitHub assets, and Homebrew share one compiled artifact contract.
- One executable vocabulary removes duplicated hook-runtime packaging and docs.
- Platform, checksum, version, and partial-release failures become explicit
  release evidence rather than installation surprises.

### Tradeoffs

- Native downloads embed Bun and are materially larger than the JavaScript
  bundle.
- The npm path uses a small Node launcher because npm itself implies Node; a
  direct archive or Homebrew install has no Node or Bun runtime dependency.
- Five initial platform packages and coordinated immutable publication make
  release automation more complex than the current single-package flow; each
  promoted musl target expands that enforced set by one.
- Cross-platform target smoke, Linux libc selection, Windows process forwarding,
  macOS signing, and partial registry recovery add real maintenance surfaces.
- The hard cut deliberately favors a smaller command contract over compatibility
  for an unused pre-1.0 executable.

### Risks

- A partially published npm version set cannot be overwritten. Release planning
  must order packages, detect registry state, and provide a deliberate recovery
  path before publishing the launcher.
- Bun target or executable behavior can change with the pinned runtime. Builds,
  artifact metadata, and target-host smoke therefore remain tied to the pinned
  Bun version.
- Direct macOS downloads may need signing or notarization policy beyond
  Homebrew's installation path. The release gate must fail clearly when required
  protected inputs are unavailable; it must not invent or rotate credentials.

### What This Does NOT Decide

- When either reserved Linux musl target graduates after the initial native
  release; target-host conformance evidence decides that promotion.
- Windows arm64 support or modern-only x64 performance variants.
- The exact signing provider, secret names, or notarization mechanism.
- A future native self-update command or non-npm shell installer.
- Public APIs for Core, toolkit runtime, schema, registry, lint, transforms, or
  Workbench.

## References

- [Tenets](../project/tenets.md) - happy path, explicit authority, and build-versus-activation doctrine.
- [ADR-0004: Core Library and CLI Boundary](0004-core-library-boundary.md) - amended scoped-package publish posture and singular CLI ownership.
- [ADR-0014: Source Change, Release, and Dependency Provenance](0014-source-change-release-provenance.md) - existing Changesets and release provenance context.
- [ADR-0022: Workflow-Oriented CLI](0022-workflow-oriented-cli.md) - one public command vocabulary and workflow-oriented routing.
- [ADR-0023: Versioned Structured Output For CLI Automation](0023-versioned-structured-output-for-cli-automation.md) - distribution parity includes the public machine protocol.
- [ADR-0026: YAML Formatting and Bun Native APIs](0026-yaml-formatting-and-bun-native-apis.md) - pinned Bun and Bun-native implementation preference.
- [ADR-0027: Runtime Activation Readiness Is Observational](0027-runtime-activation-readiness-is-observational.md) - compiler installation does not imply provider activation.
- [Bun standalone executables](https://bun.com/docs/bundler/executables) - compile behavior and supported cross-compile targets.
- [npm package.json](https://docs.npmjs.com/files/package.json/) - bin, optional dependency, operating system, CPU, and libc metadata.
- [Homebrew Formula Cookbook](https://docs.brew.sh/Formula-Cookbook) - formula install and test contract.
- [Global CLI and native distribution architecture](https://linear.app/outfitter/document/global-cli-and-native-distribution-architecture-1785333a3cb6) - project measurements, issue map, and protected release boundary.
