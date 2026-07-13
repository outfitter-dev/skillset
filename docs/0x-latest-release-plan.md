# Skillset 0.x `latest` Release Plan

This plan defines the release bar for promoting the public `skillset` npm package
to the stable `latest` dist-tag while keeping the milestone explicitly in the
0.x line. It is not a package-version cut, and it does not declare a 1.0
contract.

## Release Posture

Skillset can ship a confident 0.x release on npm `latest` when the launch gates
below are green. The release remains intentionally pre-1.0:

- source/config/frontmatter contracts are stable enough for early adopters, with
  explicit exceptions documented below;
- generated output and provider conformance are evidence-backed, not promised as
  final provider abstraction;
- hooks and runtime context are shipped only where the current helper-backed path
  is proven or explicitly deferred;
- package publication stays GitHub Actions-owned through the Changesets release
  flow in [Package Releases](package-releases.md);
- no local agent should run `bun run version:packages`,
  `bun run publish:packages`, or mutate npm/GitHub release state unless the
  maintainer chooses an explicit recovery path.

Stable 0.x package versions publish with npm dist-tag `latest`. Prerelease
builds remain on explicit prerelease tags such as `beta`.

## Go/No-Go Gates

| Gate | Current release bar | Required evidence |
| --- | --- | --- |
| Source/config/frontmatter contract | Mostly stable for 0.x. Known exceptions must stay documented rather than silently drifting. | `docs/schema-contracts.md`, generated schema artifacts, `bun run schema:check`, and Workbench schema diagnostics. |
| First-author path | Needs a real authoring pass before final release approval. SET-211 adds source-positioned diagnostic guidance, but onboarding still needs human feedback. | `docs/quickstart.md`, `examples/first-author/`, SET-198, SET-211, `skillset init`, `skillset check`, and `skillset check --only outputs` runs. |
| Hooks/runtime context | Must be either done through the helper-backed toolkit lane or explicitly deferred from release notes. Do not imply universal adaptive hook parity. | SET-16, SET-228, `docs/features/hooks.md`, `packages/toolkit/src/__tests__/`, runtime hook tests, and provider capability docs. |
| Package release automation | Must remain GitHub Actions-owned, with clear release-intent labels and exact-SHA CI before publish. | `docs/package-releases.md`, `.github/workflows/release.yml`, `scripts/release-policy.ts`, `bun run publish:check`, and release-policy tests. |
| Provider/schema evidence | Provider snapshots and schema references must be checked in and fresh for any changed contract or target surface. | `bun run schema:check`, provider format tests, `docs/target-surfaces.md`, generated schema/example diffs when applicable. |
| Change/release provenance | Source-unit changes and npm package changes must stay separate, with pending Skillset entries and Changesets used for their separate jobs. | `skillset change status`, `skillset change check`, `bun run changeset:check`, and `docs/features/changes.md`. |
| Local gates | Local full gate must pass before a release PR leaves draft. CI must pass before the generated version PR is approved or published. | `bun run check`, `bun run skillset:check:ci`, pre-push hook output, GitHub CI on the exact release commit. |

## Explicit Contract Exceptions

These are acceptable for a 0.x `latest` release only if release notes name them
plainly:

- Change state is implemented and usable, but the reason-only ledger redesign is
  still a planned cutover. Current docs should point to the draft ADR rather than
  pretending the derived-state model has landed.
- Marketplace and distribution flows are still plan/check/update surfaces, not a
  publish/sync command that mutates external repositories or runtime config.
- Workbench diagnostics are stable enough for internal package and CLI evolution,
  but `@skillset/workbench` is still a private workspace package rather than a
  public diagnostic API contract.
- Adaptive hooks support native aggregate hooks, adaptive hook units, and toolkit
  runtime context where tests prove them. Cross-provider parity remains bounded by
  provider capability records.
- Scoped workspace packages remain private implementation packages. The public
  npm contract is the unscoped `skillset` package and its shipped bins.

## First-Author Feedback Loop

Before approving the release cut, run a fresh authoring pass from an empty or
near-empty repo and record the result in SET-198 or its successor:

1. Run `skillset init [destination]` in preview mode, then with `--yes`.
2. Add one simple skill and one rule through the documented source layout.
3. Intentionally make one common frontmatter/config mistake and confirm
   Workbench diagnostics point to the source line with a suggested fix.
4. Run `skillset check`, `skillset build --yes`, `skillset check --only outputs`, and
   `skillset diff`.
5. Confirm the quickstart and first-author example match what the commands now
   do.

Blocking feedback should become Linear issues before the release PR is approved.
Non-blocking wording fixes can land in the release notes or docs branch.

## Hooks And Runtime Context Decision

The release can proceed only after one of these is true:

- SET-16 and the helper-backed toolkit lane are closed with local review and CI
  evidence; or
- release notes explicitly defer the remaining adaptive hook/runtime-context
  scope and describe exactly which hook surfaces are supported in this 0.x cut.

Do not market hooks as universally adaptive across Claude and Codex unless the
provider capability matrix and tests prove that exact claim. Prefer wording like
"Skillset can render supported hook definitions with explicit provider caveats"
over "write once, works everywhere."

## Release Notes Draft

Use these themes for the generated GitHub release body or maintainer-authored
release notes:

- Skillset is a source-first compiler for Claude and Codex loadouts.
- The 0.x `latest` release stabilizes the current workspace layout:
  `skillset.yaml` plus `.skillset/`.
- Authors can build deterministic generated output, verify drift, inspect
  provider support, and keep source-change provenance separate from package
  release state.
- The package ships the `skillset` and `skillset-toolkit`
  bins.
- Workbench diagnostics now teach common first-author mistakes with source
  positions and suggested fixes.
- Hooks, marketplaces, and distribution support are bounded by the documented
  target support matrix and may still carry explicit caveats.

Avoid:

- "1.0", "stable API", or "final contract";
- claims that generated output is installed, trusted, or enabled automatically;
- claims that all Claude and Codex provider features have portable parity;
- implying `@skillset/core`, `@skillset/schema`, `@skillset/workbench`, or
  `@skillset/toolkit` are public semver contracts.

## Migration Notes Draft

Use these notes when preparing the package changelog or release announcement:

- Source now defaults to the canonical workspace layout: root `skillset.yaml`
  plus `.skillset/` source.
- Operational cache output is reported as logical `.skillset/cache/...` paths
  but stored in the repo's XDG cache bucket.
- `workspace.cacheKey` is usually unnecessary because Skillset derives a local
  deterministic cache key from host and checkout path.
- Provider selection belongs in `compile.targets`; top-level `targets` and
  file-level `targets` are rejected with diagnostics.
- `skillset.id` is retired. Use directory-derived identity, or `skillset.name`
  only where an explicit root/plugin identity is needed.
- Package-facing compiler changes need `.changeset/*.md`; source-unit/loadout
  changes use `.skillset/changes/`.
- Generated target output remains rebuildable. Do not hand-edit generated files
  as source truth.

## Cut Procedure

1. Merge all intended source PRs for the cut, with local review reports and green
   CI.
2. Confirm any package-facing source PR has a branch-local Changeset.
3. Run `bun run check`, `bun run skillset:check:ci`, `bun run changeset:status`, and
   `bun run publish:check` locally before asking for the version PR to leave
   draft.
4. Let the release workflow create or update
   `chore(release): version packages`.
5. Label the generated version PR with the intended release family:
   `channel:stable`, `release:<patch|minor|major>`, and either `publish:auto`
   or `publish:manual`.
6. Keep the generated version PR in draft until exact-SHA CI is green.
7. Merge the version PR only when the maintainer approves the package cut.
8. Let GitHub Actions publish or route to the protected manual environment.
9. Verify npm and GitHub release state with `bun run publish:registry-check` or
   `bun run publish:registry-check:published`, depending on whether the package
   should already be visible.

Do not cut the package version directly on a feature branch. Do not publish from
a local shell as part of ordinary release prep.
