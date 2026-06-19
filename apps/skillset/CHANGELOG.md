# skillset

## 0.14.0

### Minor Changes

- 205c0c2: Flatten Skillset pending change entries from `changes/pending/*.md` to `changes/*.md`, keeping applied history, release records, and release state as JSON/JSONL ledger files in the same committed change directory while leaving generated-output provenance in `.skillset.lock`.
- 97d723d: Cut setup and import flows to the 1.0 workspace layout: `init` now scaffolds ordinary `.skillset/skillset.yaml` workspaces, `create` defaults to dedicated `skillset.yaml`/`skillset/` repos, and imports resolve the active source root.

### Patch Changes

- 78fd845: Add `skillset change amend <@ref>` so applied change-history wording can be corrected through an append-only amendment ledger and regenerated changelogs without rewriting original history.
- 6c155a9: Show source-suggestion diagnostics in Skillset CI reports.
- 1c58a8a: Explain generated `CHANGELOG.md` drift as a managed projection issue, pointing contributors to `skillset change reason <@ref>` before release and the planned amend flow for released history.
- 3e816ae: Add `skillset release amend` for append-only release metadata corrections.
- 8d38a39: Track skill partial dependencies in generated lock provenance and source hashes.
- a2d6f8e: Add `skillset suggest-source` for clean generated skill body recovery.
- a01bfd4: Refresh workspace-layout diagnostics and adoption reporting so current ordinary and dedicated Skillset workspaces are described with the 1.0 workspace marker language instead of legacy config paths.
- fe3bad1: Support Skillset 1.0 workspace detection for ordinary `.skillset/skillset.yaml` workspaces and dedicated root `skillset.yaml` workspaces.

## 0.13.5

### Patch Changes

- 9ebda21: Rename the internal render-result model vocabulary (lowering outcomes → render results). The `.skillset.lock` files now use the `renderResults` field, the `skillset-render-result@1` schema stamp, and the `rendered` status value; `skillset explain`/`doctor` and adopt report output use render-result labels.
- e876b7a: Cut the unsupported-render compile policy key from `compile.unsupported` to `compile.unsupportedDestination` with no legacy alias. Policy diagnostics now read "unsupported destination policy blocked …" and reference the new key.
- fefdf04: Add a `destination` dimension to render-result data so `target` always means the provider/runtime adapter (`claude`/`codex`) and `destination` names the concrete output artifact/scope under it (e.g. `skill`, `plugin-manifest`, `instruction`, `agent`, `target-native-island`, `skill-frontmatter`, plugin feature artifacts). The field flows through `.skillset.lock`, `skillset explain`/`doctor` JSON, and the explain/doctor text lines (`featureId -> destination`).
- 23b6ade: Refresh adopter-facing docs and self-hosted Skillset guidance for the derive/render/destination vocabulary, and rename the feature-registry `loweringOwner` field to `renderOwner` and the `lowering-outcomes` feature id to `render-results` (feature doc renamed to `docs/features/render-results.md`). Historical ADRs and the deterministic-projection concept are deliberately preserved.
- 27785ce: Add a terminology guard (`bun run terminology:guard`, wired into `bun run check`) that blocks retired derive/render/destination cutover vocabulary from active source, docs, generated guidance, CLI output, schema names, and tests, with explicit allowlists for historical ADRs and deferred concepts. Also reword the adapter-conformance status-mismatch message from "support lowered with" to "support rendered with".
- 1b896c1: Load repo source from the unified `.skillset/src` layout, migrate self-hosted guidance and fixtures to that layout, and normalize old-layout Git baselines during CI comparisons.
- 1683ec4: Split workspace build configuration from root source metadata. Root `.skillset/config.yaml` now accepts workspace/build keys only, root source identity and support metadata live in `.skillset/src/skillset.yaml`, setup commands scaffold both files, source hashes include both roots, and a limited local migration script can move early Skillset repos to the unified `.skillset/src/` layout.
- ec951f0: Update `skillset init` and `skillset create` scaffolds for the unified `.skillset/src` layout. Setup now creates placeholders for the main source families (`agents`, `hooks`, `plugins`, `rules`, `shared`, `skills`, `_claude`, and `_codex`) by default, and `--include` is reserved for the optional CI workflow.

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
