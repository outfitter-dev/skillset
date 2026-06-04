# Feature Source Pointers

Feature id: `feature-source-pointers`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Feature source pointers let a feature own external repo files without a generic component bucket or symlinks. The pointer lives on the feature key that understands the file, so target support and diagnostics remain feature-specific.

## Authoring

SET-26 defines the planned feature-key shape:

```yaml
mcp: true
mcp: false
mcp:
  source: repo:packages/docs-mcp/mcp.json

bin:
  source: repo:tools/docs-cli/bin
```

`true` means discover conventional local files for that feature. `false` disables conventional discovery. Object form configures an explicit source pointer. The `repo:` scheme points inside the content repository and must not traverse outside it.

## Support Table

| Feature key | Claude | Codex | Status | Notes |
| --- | --- | --- | --- | --- |
| `mcp` | `.mcp.json` / manifest field | `.mcp.json` / manifest field | `planned` | Exact source path and validation are feature-owned. |
| `apps` | n/a | `.app.json` / manifest field | `target_native` / `planned` | Codex-only plugin surface. |
| `hooks` | `hooks/hooks.json` | `hooks/hooks.json` | `implemented` / `planned` | Existing canonical path and Codex compatibility root hook behavior continue; SET-26 expands feature-key discovery. |
| `bin` | plugin-root `bin/` | `future` / `unsupported` | `target_native` / `planned` for Claude | Claude docs document `bin/`; Codex support needs explicit target evidence before enabling. |
| generic `components.*` | n/a | n/a | `unsupported` | Rejected v1 shape because ownership and target semantics become vague. |

## Target Lowering

Feature pointers should be resolved by the feature adapter that knows the target schema and output path. A pointer should not bypass validation, provenance, or unsupported-target checks. Conventional discovery must be warning-free when it finds expected files, and visible when a feature is disabled or unsupported for an enabled target.

Claude plugin-root `bin/` is a documented target-native component. It can be represented through a `bin` feature key once the adapter support registry records target support and output ownership. Plugin-root `settings.json` is target-native too, but live settings suggestion and mutation remain future-only.

## Diagnostics

- Reject `repo:` pointers that escape the repository root.
- Reject pointers whose feature key is unknown or unsupported for every enabled target.
- Validate known structured files after preprocessing.
- Report conventional discovery in list/explain/lock provenance so auto-enabled files do not feel magical.
- Fail rather than silently skip when a feature cannot lower to an enabled target.

## Provenance

Locks should record the feature key, source pointer, target support status, discovered convention or explicit pointer, generated path, source hash, output hash, and any skipped/unsupported target state. `skillset list` and `skillset explain` should eventually show whether a feature came from convention, explicit source, or target-native island.

## Tests and Fixtures

SET-26 should add fixtures for `true`, `false`, and object forms, safe `repo:` path resolution, conventional discovery, target-specific unsupported behavior, and lock/list/explain provenance.
