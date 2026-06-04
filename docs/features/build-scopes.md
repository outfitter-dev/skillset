# Build Scopes

Feature id: `build-scopes`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Build scopes describe where Skillset writes or inspects generated output. They should stay separate from typed entity selectors such as plugin names, skill names, or future component ids.

## Authoring

SET-21 added build-mode parsing and lock provenance:

```yaml
compile:
  build: updated
```

`updated` is the default planned mode. `all` rebuilds every configured output. CLI flags such as `--updated` and `--all` should override config for the current command.

The parser currently normalizes `compile.build` and records it as `buildMode` in `.skillset.lock`. SET-25 owns the next step: making `updated` lock-aware for write planning and adding the CLI overrides.

## Support Table

| Behavior | Build | Check | Diff/list/explain | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `compile.build: updated` | normalized, write planning planned | detect drift | explain target state | `implemented` / `planned` | Parsed and locked today; SET-25 makes write planning lock-aware. No usable lock should fall back to all configured outputs and write a fresh lock. |
| `compile.build: all` | normalized, rebuild planning planned | detect drift | explain full plan | `implemented` / `planned` | Parsed and locked today; SET-25 makes the write planner rebuild every configured output. |
| `--scope repo/plugins/project/user/all` | destination class selection | destination class selection | destination class selection | `planned` | Scope is about destinations, not arbitrary feature sets. |
| `skillset diff` | no writes | n/a | planned diff | `implemented` / `planned` | Existing diff is read-only; SET-25 expands scope/list behavior. |
| `skillset explain <path>` | n/a | n/a | source/generated provenance | `implemented` / `planned` | Existing explain resolves lock provenance for current generated outputs. |
| `skillset list` | n/a | n/a | planned inventory | `planned` | Should expose conventional discovery and skipped/future state. |

## Target Lowering

Build scopes do not change source meaning. They choose destination classes and entity subsets for planning or writing. Target adapters still decide whether a source feature can lower faithfully to a provider, and unsupported lowering remains fail-loud unless visible unsupported-policy provenance exists.

User/global destinations require the most conservative posture. `skillset build` must not mutate user-level Claude or Codex runtime config as a side effect. Future setup flows may propose or stage changes, but write confirmation and provenance need to be explicit.

## Diagnostics

- Missing or corrupt locks should not silently disable guards; updated mode should fall back to all configured outputs and report why.
- Dry-run commands must never write generated files, locks, target config, or user-level settings.
- Scope/entity selectors should fail on unknown scopes or ambiguous entity selectors rather than guessing.
- Diff/list/explain should make skipped, future, unsupported, and target-native states visible.

## Provenance

`.skillset.lock` should remain the heavy provenance surface: source hashes, generated hashes, target state, skipped source, adapter version, preprocessing dependencies, and warnings belong there rather than in generated skill frontmatter. Build-scope commands should explain their decisions from lock state rather than hidden global state.

## Tests and Fixtures

SET-25 should add lock-aware fixtures for updated/all behavior, corrupt or missing locks, dry-run no-write checks, scope validation, and explain/list output for generated and skipped targets.
