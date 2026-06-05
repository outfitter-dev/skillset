# Build Scopes

Feature id: `build-scopes`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Build scopes describe where Skillset writes or inspects generated output. They should stay separate from typed entity selectors such as plugin names, skill names, or future component ids.

## Authoring

Build mode is configured in root source:

```yaml
compile:
  build: updated
```

`updated` is the default mode. `all` rebuilds every configured output. CLI flags `--updated` and `--all` override config for the current command.

`skillset build` is plan-first. It prints pending generated changes and writes only with explicit confirmation:

```bash
skillset build --yes
```

`--dry-run` is accepted for every build scope and always prevents writes, even when `--yes` is also present. Explicit `--scope` selectors filter generated destinations for build, diff, check, list, and explain. Repo scripts that intentionally refresh all generated output should omit `--scope` and pass `--yes`.

## Support Table

| Behavior | Build | Check | Diff/list/explain | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `compile.build: updated` | writes missing/changed outputs and removes stale scoped outputs | detect drift | explain target state | `implemented` | No usable lock falls back to the rendered configured outputs and writes a fresh baseline only when build runs with `--yes`; unchanged files are left untouched. |
| `compile.build: all` | rewrites selected output roots | detect drift | explain full plan | `implemented` | CLI `--all` overrides config and records the resolved mode in lock metadata. |
| `--scope repo/plugins/project/user/all` | destination filtering | destination filtering | destination filtering | `implemented` | Scope is about destinations, not arbitrary feature sets. `repo` covers standalone generated skill roots, `plugins` covers generated plugin repos, `project` covers project guidance/agents/native islands, and `user` is reserved with no build outputs today. |
| `skillset diff` | no writes | n/a | added/changed/missing/removed diff | `implemented` | Missing locked outputs are shown separately from new generated outputs. |
| `skillset explain <path>` | n/a | n/a | source/generated provenance | `implemented` | Explain resolves lock provenance for current generated outputs. |
| `skillset list` | n/a | n/a | lock-backed inventory | `implemented` | Lists current generated lock entries today, including target-native islands and project agents. |

## Target Lowering

Build scopes do not change source meaning. They choose destination classes and entity subsets for planning or writing. Target adapters still decide whether a source feature can lower faithfully to a provider, and unsupported lowering remains fail-loud unless visible unsupported-policy provenance exists.

User/global destinations require the most conservative posture. `skillset build` must not mutate user-level Claude or Codex runtime config as a side effect. Future setup flows may propose or stage changes, but write confirmation and provenance need to be explicit.

## Diagnostics

- Missing or corrupt locks should not silently disable guards. The workspace lock still fails loudly when corrupt because it guards unmanaged project files; absent locks are treated as a first baseline build.
- Dry-run commands must never write generated files, locks, target config, or user-level settings.
- Missing managed outputs are reported with `!` in `diff`/build plans and as `missing managed generated file` in `check`.
- Scope/entity selectors should fail on unknown scopes or ambiguous entity selectors rather than guessing.
- Diff/list/explain should make skipped, future, unsupported, and target-native states visible.

## Provenance

`.skillset.lock` should remain the heavy provenance surface: source hashes, generated hashes, target state, skipped source, adapter version, preprocessing dependencies, and warnings belong there rather than in generated skill frontmatter. Build-scope commands should explain their decisions from lock state rather than hidden global state.

## Tests and Fixtures

Fixtures cover plan-first build behavior, `--yes`, `--dry-run` precedence, build-mode flag conflicts, scope validation/filtering, updated-mode no-churn behavior, all-mode rewrites, and missing managed output classification. Existing SET-9 and SET-24 fixtures cover diff/list/explain lock visibility for generated skills, target-native islands, and project agents.
