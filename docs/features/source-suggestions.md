# Source Suggestions

Feature id: `source-suggestions`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Reconciliation are the recovery workflow for managed generated-output edits. They help a contributor who changed a file recorded in `skillset.lock` understand which source unit owns that file, whether the edit can be safely moved back to source, and what command or manual action should happen next. The v1 local command is diagnostics-first and only writes clean generated skill Markdown body edits when explicitly confirmed.

## Source Shape

There is no author-facing source key in v1. The source of truth remains the existing adaptive source file, pending change entry, applied change history, release state, and generated-output lock that already own the generated path.

The intended local command shape is:

```bash
skillset reconcile <generated-path>
skillset reconcile <generated-path> --use output --yes
```

Preview mode is read-only. Write mode is allowed only for clean, single-source cases where the generated Markdown body can be mapped back to one source path without losing meaning, and it requires `--use output --yes`. The command reuses `skillset.lock` ownership and `skillset explain` provenance so "which source owns this generated file?" has one answer across the CLI.

## Target Support

| Case | Behavior | Status |
| --- | --- | --- |
| Managed generated skill body edit | Preview source `SKILL.md` body replacement, optionally write with `--use output --yes` when clean | `implemented` |
| Pending changelog wording before release | Do not reverse-patch from generated output; point to `skillset change reason <@ref>` because pending entries are not rendered into committed changelogs | `implemented` |
| Generated changelog edit after release | Refuse reconciliation and point to `skillset change amend` for applied-history wording or `skillset release amend` for release-event metadata | `implemented` |
| Generated metadata, lock files, manifests, or version fields | Refuse; output resolution compares the exact generated frontmatter block with the current expected render and accepts body edits only | `implemented` |
| Output from partials, shared resources, or multiple source files | Refuse with diagnostics until a richer mapping exists | `implemented` |
| Provider-native output with no adaptive round trip | Refuse and explain the provider-specific source or manual path | `implemented` |
| Unmanaged files | Refuse; Skillset cannot claim source ownership without lock provenance | `implemented` |

## Diagnostics

The first implementation should make diagnostics useful before attempting writes:

- show the generated path, owning source unit, source path, and lock that established ownership;
- state whether the generated edit is cleanly suggestible, manual-only, or refused;
- show the source path and explicit write mode for clean cases;
- explain the generated files that would need to be rebuilt after accepting the source edit;
- keep refusal messages specific: metadata, multi-source rendering, provider-native no-round-trip, post-release changelog, unmanaged path, or stale/corrupt lock.

Output resolution renders the exact managed path from current source and compares
its frontmatter block with the actual generated frontmatter after normalizing line
endings. It does not compare generated frontmatter with adaptive source
frontmatter, because provider rendering intentionally strips, derives, and
transforms fields. Any generated-side frontmatter difference—including comments
or formatting—is refused before a source write; body-only edits remain eligible.

`skillset check --ci --fix` remains mechanical generated-output repair. It may restore generated files from source, but it must not treat a managed generated edit as source truth. For generated changelogs, current diagnostics already point contributors toward `skillset change reason <@ref>` for pending wording before release, `skillset change amend <@ref>` for applied-history wording after release, and `skillset release amend <@ref>` for release-event metadata. Because committed changelog projections render applied history, not pending entries, a generated `CHANGELOG.md` edit is usually a released-history correction and refuses local reverse-patching.

## Provenance

Reconciliation should not create a second source of truth. Accepted reconciliation changes the real source file or pending reason, then normal build/release machinery updates generated outputs and locks and `skillset check --only outputs` checks the result.

When CI suggestions arrive later, they should record enough evidence to avoid noisy repeat comments: suggestion id, generated path, owning source path, lock hash or source hash reviewed, suggested action, accepted/rejected/skipped status, and whether a writeback commit was attempted. That evidence belongs to suggestion workflow state, not generated target files.

## Relationship To Settings Suggestions

Reconciliation and reviewed settings suggestions solve different problems:

- Reconciliation recover edits made to files Skillset already owns as generated output.
- Settings suggestions propose changes to live runtime configuration that Skillset intentionally does not own or mutate during build.

Both need reviewable previews, stable ids, conflict checks, and refusal paths, but they must stay separate. A reconciliation should never mutate `~/.claude`, `~/.codex`, trust settings, marketplace activation, or project runtime settings. A settings suggestion should never pretend a generated output edit can be recovered into adaptive source.

## CI Path

[SET-152](https://linear.app/outfitter/issue/SET-152/design-ci-source-suggestion-writeback-for-managed-generated-edits) adds CI-side reconciliation diagnostics and keeps automated writeback as a future permissioned step. The intended path is:

1. `skillset check --ci` detects a PR edit to a managed generated path.
2. CI resolves the owning source unit from `skillset.lock`.
3. CI runs the same safety classification as `skillset reconcile` for added and changed generated paths.
4. For unsafe or ambiguous cases, CI reports the source path, reason for refusal, and manual command in the job summary or PR comment.
5. For clean cases, CI reports the owning source path and local `skillset reconcile <path> --use output --yes` recovery command; it does not choose a direction automatically.
6. Future safe same-repo writeback may commit a source update plus regenerated output back to the PR branch only after permission, branch freshness, and conflict checks pass.
7. Meaningful source edits still require normal change coverage.

Fork PRs, protected branches, stale branches, corrupt locks, concurrent pushes, and multi-source renderings should all fall back to comment-only diagnostics.

## Tests and Fixtures

[SET-151](https://linear.app/outfitter/issue/SET-151/implement-suggest-source-command-for-clean-generated-to-source) added tests for clean skill-body suggestions, generated changelog refusal, read-only previews, explicit write confirmation, and `explain`/suggestion provenance consistency. [SET-322](https://linear.app/outfitter/issue/SET-322/reconcile-detect-and-refuse-generated-side-frontmatter-divergence) adds expected-render frontmatter comparison, structured recovery, provider-transformed body-only coverage, and implemented provider-native refusal coverage.

[SET-152](https://linear.app/outfitter/issue/SET-152/design-ci-source-suggestion-writeback-for-managed-generated-edits) should add tests for comment-only CI output, safe same-repo writeback, fork/protected-branch refusal, stale lock refusal, conflicts, and preservation of change-entry requirements.

## Evidence

See [Output Safety](output-safety.md), [Changes](changes.md), [Releases And Changelogs](releases.md), [CI](ci.md), [SET-147](https://linear.app/outfitter/issue/SET-147/design-managed-output-source-suggestions-for-contributor-edits), [SET-151](https://linear.app/outfitter/issue/SET-151/implement-suggest-source-command-for-clean-generated-to-source), and [SET-152](https://linear.app/outfitter/issue/SET-152/design-ci-source-suggestion-writeback-for-managed-generated-edits).
