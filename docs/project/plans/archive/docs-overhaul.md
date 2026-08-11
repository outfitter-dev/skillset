---
description: Records the completed Skillset documentation overhaul, its delivered Graphite stack, verified outcomes, and material deviations.
---

# Skillset documentation overhaul

> **Disposition: completed and archived, 2026-08-10.** The overhaul shipped as an 11-PR Graphite stack. Every PR is ready for review with its exact-head Changeset, aggregate, and self-hosted Skillset checks green; no review threads remain open. The stack is intentionally unmerged and unqueued.

## Delivered stack

| PR | Delivered change |
| --- | --- |
| [#399](https://github.com/outfitter-dev/skillset/pull/399) | OSS and package metadata |
| [#400](https://github.com/outfitter-dev/skillset/pull/400) | Documentation validation foundations |
| [#401](https://github.com/outfitter-dev/skillset/pull/401) | Contract-owned generated reference |
| [#402](https://github.com/outfitter-dev/skillset/pull/402) | Skillset front door and golden path |
| [#403](https://github.com/outfitter-dev/skillset/pull/403) | Reader-intent information architecture |
| [#404](https://github.com/outfitter-dev/skillset/pull/404) | Start journey and working guides |
| [#405](https://github.com/outfitter-dev/skillset/pull/405) | Configuration and source reference |
| [#406](https://github.com/outfitter-dev/skillset/pull/406) | Provider reference and shipping guides |
| [#407](https://github.com/outfitter-dev/skillset/pull/407) | User-facing feature reference |
| [#408](https://github.com/outfitter-dev/skillset/pull/408) | Development feature reference |
| [#409](https://github.com/outfitter-dev/skillset/pull/409) | Tenets, project surface, navigation, and plan closeout |

**Outcome.** The repository now has a reader-facing journey, generated contract-owned reference, deterministic documentation checks with zero baselined debt, migration accounting, package/front-door verification, and a context-free first-author lifecycle exercised against the packed package.

**Material deviations.** There were no material scope deviations. Hosted execution exposed integration gaps that were repaired in their owning PRs: PR #400 now fetches full history for the aggregate documentation diff check and hardens Markdown marker parsing; PRs #402, #403, #405, and #409 carry the package Changesets required by their package-facing changes; PR #404 documents the supported post-initialization recovery for missed root instructions; PR #406 distinguishes Claude marketplace-update writes from Cursor build output; and PR #408 assigns render-result production to its actual owners. Implementation decisions made at planned decision points—including hybrid generated blocks and keeping diagnostics review-owned—are recorded in the documentation-system reference rather than treated as scope deviations.

**Status:** Executed, 2026-08-10. This document was the complete plan of record for the Skillset documentation overhaul. It applies the [Outfitter documentation doctrine](https://github.com/outfitter-dev/agent-workbench/blob/main/research/outfitter-docs-doctrine.md) as accepted project direction. The superseded 2026-07-26 gist is historical context only and has no governing force.

**Doctrine relationship:** the doctrine owns every shared rule (graph model, frontmatter contract, page contracts, writing standards, `docs:generate`/`docs:check`, the ratchet, review contract). This plan does not restate them — it records Skillset's project fit: the concrete layout, ownership table, journey, PR sequencing, and acceptance criteria.

---

## 1. Summary

Skillset has a deep contributor and specification corpus (~135 Markdown files, 29 accepted ADRs, ~40 feature pages) and no reader-facing product layer. This project adds that layer, makes contract-owned reference mechanically current, preserves the contributor corpus, and lands the whole tree in doctrine-conformant shape. Three layers:

1. **Authored reader layer** — README, the `start/` journey and `guides/`, configuration, troubleshooting, provider judgment, glossary.
2. **Contract-generated reference** — CLI, feature inventory, provider support matrix; drift-gated in CI.
3. **Preserved contributor and project layer** — `development/`, `project/` (tenets, plans), ADRs.

Markdown in the repository is the product; any future site is a projection.

**Goals:** newcomer comprehension in 60 README seconds; a tested ten-minute first-author path; one canonical owner per consequential fact category; generated contract-owned reference; an executable golden path; physical separation of reader, contributor, project, and decision material; consistent MIT metadata; and portable Markdown that remains complete on GitHub.

**Non-goals:** standing up a documentation site; rewriting ADR or evidence content beyond mechanical path and link repairs; changing user-facing compiler, CLI, or schema behavior; generating explanatory prose; generic snippet transclusion; or versioned documentation before 1.0. Repository tooling, fixtures, deterministic documentation generators, checks, and small non-user-facing exports needed to expose canonical contracts safely are in scope.

## 2. Project-fit decisions

These decisions apply the shared doctrine to Skillset's product and corpus:

| Area | Skillset decision |
| --- | --- |
| Journey | `start/` holds only the tutorial run; flat, outcome-named `guides/` hold later tasks; ordering lives only in `start/README.md` |
| Stages | Start → Adopt → Work → Ship, using the doctrine's stage semantics |
| Troubleshooting | Root `docs/troubleshooting.md`; graduates to a directory when it outgrows one file |
| Tenets | `project/tenets.md` because product doctrine is reader-relevant, not contributor internals |
| Plans | Active and upcoming work lives in `project/plans/`; completed, abandoned, and superseded work lives in `project/plans/archive/` |
| Glossary | `docs/glossary.md` plus first-use term links |
| `description` frontmatter | ≤240 characters hard / ~160 target, non-breaking plain text, with grammatical mood following node genre |
| Tags | Deferred until a real consumer exists |
| Concepts | Concept stops begin in `start/`; `concepts/` remains a graduation option |
| Writing standards | The doctrine owns shared standards; §6 below contains only Skillset-specific rules |

## 3. Target information architecture

```
README.md                      Rewritten front door (~150 lines); canonical for npm projection
LICENSE  CONTRIBUTING.md  SECURITY.md   New OSS policy and metadata files
AGENTS.md                      Mechanical path updates + documentation-system link only
docs/
  README.md                    Router: intent groups, each entry link + description-derived promise
  why-skillset.md              The problem, the bet, the deliberate non-goals
  glossary.md                  NEW — anchor-grain definition homes: canonical source, projection,
                               render, drift, destination, activation, cascade, …
  troubleshooting.md           NEW location — symptom-organized, single file
  migration-map.json           Structured path-migration accounting
  start/                       The guided path
    README.md                  The spine: Start → Adopt → Work → Ship, pointing into guides/
    quickstart.md              (Start) task-first rewrite
    first-author.md            (Start) walkthrough wrapping examples/first-author
    how-rendering-works.md     (Start) concept stop
    build-versus-activation.md (Start) concept stop; canonical home of the invariant
  guides/                      Flat, outcome-named
    importing.md               (Adopt)
    development-loop.md        (Work)
    continuous-integration.md  (Ship)
    publishing.md              (Ship)
    marketplaces.md            (Ship)
  configuration/
    README.md  project-configuration.md  frontmatter.md  target-overrides.md  tools-policy.md
  reference/
    README.md
    cli/                       Generated command pages + hand-written intro
    source/                    workspace-layout.md  instructions.md  preprocessing.md
    providers/                 README.md (vocabulary + matrix reading)  claude.md  codex.md  cursor.md
    features/                  User-facing feature index and pages
    support-matrix.md          GENERATED
    schemas/                   Public-rules if hand-written; exempt where generated
  project/
    README.md                  Index; claims tenets and plans
    tenets.md                  Moved from docs/tenets.md; volatile contract details removed
    plans/
      README.md                Index of upcoming, current, paused, and otherwise actionable plans
      docs-overhaul.md         This document while active
      archive/
        README.md              Index of completed, abandoned, and superseded plans
        0x-latest.md           Completed release plan (historical naming exempt)
  development/
    README.md                  Development reachability root
    documentation-system.md    Skillset's docs operating model; links up to the doctrine
    features/                  Feature-system internals
    schema-contracts.md  package-ownership.md  package-releases.md
    evidence/
  adrs/                        Decision content untouched; mechanical path/link repairs allowed
```

Every current file gets exactly one disposition (keep / move / rewrite / merge / archive); nothing is silently deleted. Merges name their surviving pages in the migration map. `layout.md` splits across `configuration/` and `reference/source/`; `target-surfaces.md` splits into the generated matrix basis and `reference/providers/README.md`; subdirectory indexes are `README.md`.

**Plan lifecycle.** `project/plans/` contains upcoming, current, paused, or otherwise actionable plans. `project/plans/archive/` contains completed, abandoned, or superseded plans. Archiving adds a disposition banner and a concise outcome/deviation summary, then freezes the substantive body. The move receives a migration-map entry, the active index stops claiming the plan, and the archive index claims it. This plan moves to `project/plans/archive/docs-overhaul.md` in the final PR.

**The journey.** Skillset is a lifecycle product and carries the full arc. The spine at `start/README.md`: **Start** (quickstart → first-author → how-rendering-works → build-versus-activation) → **Adopt** (importing) → **Work** (development-loop; troubleshooting linked in-flow) → **Ship** (continuous-integration → publishing → marketplaces). Ordering lives only in the spine; guides are independently findable and carry no ordering metadata.

**The glossary.** Seeded with the terms the front door needs (canonical source, projection, render, destination, drift, activation, cascade); grows as rewrites touch terms. First-use linking applies to every rewritten page: first use of a term of art links to its definition home — glossary anchor or owning concept/reference page. Entry first sentences follow the description language contract so hover-card projections work later.

## 4. Canonical truth ownership (Skillset's table)

The doctrine's three rules govern; this is the required per-project ownership table:

| Fact category | Canonical owner | Evidence / verification | Documentation projection |
| --- | --- | --- | --- |
| CLI commands, flags, defaults | Command registry | CLI help snapshots, command tests | Generated `reference/cli/` |
| Source/config/frontmatter fields | Schema artifacts | Schema tests, fixtures | `configuration/` + `reference/source/` |
| Feature × provider support | Feature registry | Provider evidence, render tests | Generated `support-matrix.md` |
| Output paths and shapes | Renderer destination definitions | Fixtures, snapshots | Fixture-verified reference tables |
| Product doctrine | Tenets | Accepted ADRs | `project/tenets.md`; linked summaries |
| Task workflows | Authored guide/journey page | Executable fixture | The page itself |
| Terms of art | Glossary entry or owning page | Review | First-use links everywhere else |
| Current release state | Package metadata | Release pipeline, registry | Badges, release pages |
| Release history | CHANGELOG (package roots) | Git history, release artifacts | Linked, never restated |

Runtime contracts own current observed behavior; tenets and accepted ADRs own intended doctrine and rationale. If they disagree, documentation work stops and records the mismatch as an implementation or decision issue rather than silently choosing a side. The layered invariant runs from tenet to `start/build-versus-activation.md` to any standardized summary and canonical link.

## 5. Generated reference, golden path, front door

The generated-reference layer uses `scripts/docs-reference.ts`, a typed normalized model, and deterministic output with stable ordering and no timestamps. It imports registries and contracts through clean, side-effect-free workspace exports; parsing `--help` is a fallback only. Full generated pages are never generator inputs. Hybrid pages use verified generated-block markers whose interiors alone may be rewritten. PR 3 decides and records feature-page ↔ registry linkage, the intro-docs support policy, and the diagnostics-catalog go/no-go.

The golden-path smoke runs the documented commands against the workspace binary in an isolated sandbox. It exercises the lifecycle twice: generate, edit canonical source, and regenerate. The root README is a roughly 150-line front door and the canonical source for the npm README projection; pack verification confirms README, LICENSE, and manifest metadata.

`SECURITY.md` states which releases receive fixes, directs reporters to GitHub private vulnerability reporting, requests useful reproduction and impact details, and warns against public disclosure before a fix. Enabling the repository setting is a separate maintainer action, not authorized merely by this plan; PR 1 verifies that the approved private channel is actually available before naming it.

Generated CLI pages and the support matrix get doctrine-conformant `description` frontmatter emitted by the generator (third-person indicative — the command is the actor).

## 6. Skillset-specific writing rules

Shared standards live in the doctrine (§5–§6 there) and are not restated. Skillset adds:

- **The invariant** uses the exact standardized wording and canonical link everywhere it appears (checker-verified): "Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration."
- **Terminology:** current derive/render/destination vocabulary only; retired terms enforced by the existing denylist check, scoped per the ratchet.
- **Tenets boundary:** preserve doctrine meaning; volatile contract details (command names, config keys, provider lists, output paths) move to reference or ADR links. Tenet meaning changes are out of scope.
- **The recurring worked example** is `examples/first-author`; prose commands correspond to the smoke-tested fixture.

## 7. Checks, enforcement, migration accounting

`docs:generate` writes every generated documentation projection. `docs:check` is the aggregate gate for generated drift, links and anchors, public reachability, structure, migration accounting, terminology, invariant wording, marker integrity, and the golden-path smoke. Existing violations enter a shrink-only baseline in PR 2; each rewrite leaves its pages compliant; PR 11 deletes the empty baseline. Mechanical moves land before rewrites touch moved files.

`docs/migration-map.json` records each moved, split, archived, or deleted documentation path with `status`, `primary`, and any `successors`. The checker resolves remote trunk with `scripts/git-trunk.sh`, compares trunk with the current worktree using Git rename detection, and requires every removed or renamed documentation source path to have an entry. It also verifies that old paths no longer exist, non-deleted entries have an existing primary destination, every successor exists, and paths are repository-relative and unique. Git's classification is not authoritative: a heavily rewritten move reported as a deletion still requires a migration entry.

Description checks enforce the doctrine contract mechanically where possible: presence on public evergreen pages, ≤240 characters, single line, no Markdown. Mood and genre fit are review concerns.

## 8. Delivery plan (Graphite stack)

Ordering principle unchanged: metadata first, rails second, canonical reference third, front door fourth, then restructure — content moves at most once, and new prose links to final paths from the start.

1. **`chore(meta): establish OSS and package metadata`** — LICENSE, workspace license fields, CONTRIBUTING.md, SECURITY.md with its approved reporting channel verified, npm projection + pack gate. (Still unlanded.)
2. **`feat(docs): establish documentation validation foundations`** — link/structure checkers, `docs:check` skeleton, Git-diff-backed migration-map plumbing, `development/documentation-system.md` (linking up to the doctrine), staged baseline, description-contract checks.
3. **`feat(docs): generate contract-owned reference`** — generator, typed model, drift gate, generated CLI pages + support matrix, feature↔registry linkage decision, intro-docs policy, diagnostics spike, generated `description` emission.
4. **`docs: create the Skillset front door`** — README rewrite (+ description-sync check), `why-skillset.md`, `glossary.md` seeded, `start/build-versus-activation.md`, golden-path smoke, minimal docs landing. All links use final target paths.
5. **`docs: reorganize documentation by reader intent`** — mechanical moves to the §3 tree (pure renames), including `tenets.md` → `project/tenets.md` and the completed release plan → `project/plans/archive/0x-latest.md`; create the active and archive plan indexes; update repo-wide and `.skillset/` links; complete the migration map; make global reachability blocking.
6. **`docs: rewrite the start path and working guides`** — quickstart, first-author, how-rendering-works, the spine, `guides/importing.md`, `guides/development-loop.md`, root `troubleshooting.md`; first-use term links throughout.
7. **`docs: consolidate configuration and source reference`** — layout.md + README-remnant split into `configuration/*` and `reference/source/*`; delete layout.md after link audit.
8. **`docs: document providers and the Ship guides`** — provider pages (marker protocol), providers README, `guides/continuous-integration.md`, `guides/publishing.md`, `guides/marketplaces.md`.
9. **`docs: standardize user-facing feature pages`** — question-contract pass.
10. **`docs: standardize development feature pages`** — maintainer-contract pass.
11. **`docs: align tenets, project surface, and navigation`** — tenets boundary pass in `project/`, `project/README.md`, residual sweeps, zero-baseline verification + baseline deletion, final router polish, acceptance audit; then mark this plan executed, record the delivered PR stack and material deviations, move it to `project/plans/archive/docs-overhaul.md`, and transfer its navigation ownership to the archive index.

Each rewrite PR leaves its own pages fully rule-compliant. PRs 4, 6, 7 exceed the ~250-LOC guideline (prose is line-heavy); each stays single-topic with move vs. rewrite counts separated in the body.

**Bootstrap note:** this file lands ahead of the stack (creating `docs/project/plans/`), and PR 5's reorganization builds the rest of `project/` around it. PR 11 records its active → archived move in the migration map.

## 9. Acceptance criteria

**Reader success**

- [ ] The install command and first executable example appear within the first 60 non-frontmatter lines of the README; the README stays near 150 lines.
- [ ] A manual ten-minute first-author test passes at least once for a reader or agent given no repository-internal context.
- [ ] The docs landing is organized by reader intent; `start/README.md` presents one Start → Adopt → Work → Ship story; every public page is transitively reachable through its owning index; development pages are reachable from the development index or explicitly exempt.
- [ ] `docs/glossary.md` exists; the front door's terms of art are defined; every PR-6+ rewritten page links first uses to definition homes.
- [ ] Every public evergreen page's `description` passes the mechanical contract; spot-review confirms mood/genre fit.
- [ ] The spine at `start/README.md` presents the four-stage journey; stage membership of guides is expressed only there.
- [ ] Root `troubleshooting.md` is symptom-organized and reachable from the router's "Something failed" intent group.
- [ ] `project/README.md` claims `tenets.md` and the plans index; `project/` top level contains only evergreen files.

**Correctness**

- [ ] `docs:check` is green in CI and covers golden-path smoke, deterministic regeneration, link and anchor integrity, reachability, migration-map completeness, feature/provider ID validation, marker integrity, invariant wording and canonical links, README command validation, and README/package-description sync.
- [ ] No retired terminology or release-era language remains in public evergreen docs; the shrink-only baseline is deleted.
- [ ] Each rewrite PR body names its truth sources.

**Maintainability and portability**

- [ ] No exhaustive CLI or support inventory is maintained by hand.
- [ ] H1 is the single title authority; no `title` frontmatter is introduced.
- [ ] Every workspace package declares MIT through dynamic discovery; pack verification confirms manifest metadata, README, and LICENSE; registry metadata is confirmed after the next release.
- [ ] `development/documentation-system.md` is linked from CONTRIBUTING, AGENTS, and generated headers and records the generator source choice, diagnostics decision, and feature ↔ registry linkage.
- [ ] All public content is complete and readable on GitHub using portable Markdown; the migration map is sufficient to derive future site redirects.
- [ ] `plans/README.md` claims actionable plans and `plans/archive/README.md` claims completed, abandoned, and superseded plans.
- [ ] On completion, this plan is marked executed, records the delivered PR stack and material deviations, moves to `project/plans/archive/docs-overhaul.md`, receives a migration-map entry, and transfers from the active plans index to the archive index.

## 10. Deferred (recorded so they are not re-litigated)

- **Tags** — doctrine contract exists; adopt when a consumer (site layer) lands.
- **`supersedes` frontmatter on ADRs** — align when ADR tooling next changes; not part of this overhaul.
- **`docs/releases/` narrative notes** — when a release earns story; CHANGELOG ledger suffices pre-1.0.
- **`project/roadmap.md`** — when there is durable direction worth stating in-repo.
- **Site (Blume or Fumadocs), llms.txt, agent evals, compiled writing-docs skills** — per the doctrine's leverage layer; the skills arrive via the agent-workbench pipeline, not this stack.
- **Terminal recordings and screenshots** — polish after correctness.
- **Generic snippet transclusion** — the golden-path smoke covers critical surfaces; reconsider only if drift appears elsewhere.
- **Versioned docs** — pre-1.0.
- **Tombstones and real redirects** — the migration map is sufficient before a site exists.
- **CODE_OF_CONDUCT.md and display-title metadata** — add only when an actual external-contribution or presentation need appears.
