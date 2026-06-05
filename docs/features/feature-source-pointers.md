# Feature Source Pointers

Feature id: `feature-source-pointers`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Feature source pointers let a feature own external repo files without a generic component bucket or symlinks. The pointer lives on the feature key that understands the file, so target support and diagnostics remain feature-specific.

The implemented v1 feature-key adapters are `mcp` and `bin`. Other plugin companion surfaces can still be implemented target-native pass-through paths, but they do not accept `*.source` pointer syntax until a later adapter owns that feature.

## Authoring

Feature keys support boolean and object forms:

```yaml
mcp: true
mcp: false
mcp:
  source: repo:packages/docs-mcp/mcp.json

bin:
  source: repo:tools/docs-cli/bin
```

`true` means require the conventional local file or directory for that feature. `false` disables conventional discovery even when the conventional path exists. Object form configures an explicit source pointer. The `repo:` scheme points inside the content repository and must not traverse outside it.

## Support Table

| Feature key | Claude | Codex | Status | Notes |
| --- | --- | --- | --- | --- |
| `mcp` | `.mcp.json` / manifest field | `.mcp.json` / manifest field | `implemented` | Conventional `.skillset/plugins/<plugin>/.mcp.json` is auto-discovered. `mcp.source` can point at a repo-owned JSON file. |
| `bin` | plugin-root `bin/` | `unsupported` | `target_native` / `implemented` for Claude | Conventional `.skillset/plugins/<plugin>/bin/` is auto-discovered. `bin.source` can point at a repo-owned directory. Enabled Codex plugin output fails loudly. |
| `apps` | n/a | `.app.json` / manifest field | `target_native` / `implemented pass-through`, `planned` pointer adapter | `.app.json` is copied as a native companion path today. `apps.source` is not supported. |
| `hooks` | `hooks/hooks.json` | `hooks/hooks.json` | `target_native` / `implemented pass-through`, `planned` pointer adapter | Existing canonical path and Codex compatibility root hook behavior continue. `hooks.source` is not supported. |
| generic `components.*` | n/a | n/a | `unsupported` | Rejected v1 shape because ownership and target semantics become vague. |

## Target Lowering

Feature pointers are resolved by the feature adapter that knows the target schema and output path. A pointer does not bypass validation, provenance, or unsupported-target checks. Conventional discovery is warning-free when it finds expected files, and disabled or unsupported features are visible through missing output, lock provenance, or fail-loud diagnostics.

Pass-through companion paths such as Codex `.app.json` and plugin `hooks/hooks.json` are implemented through their native path renderers, not through feature-key pointer adapters. Authors should place those files in their conventional source paths until a future issue explicitly adds `apps.source` or `hooks.source`.

Claude plugin-root `bin/` is a documented target-native component added to the Bash tool `PATH` while the plugin is enabled. It is copied into Claude plugin output and recorded as a `plugin-feature` lock entry, but it does not add a manifest field. Plugin-root `settings.json` is target-native too, but live settings suggestion and mutation remain future-only.

## Diagnostics

- Reject `repo:` pointers that escape the repository root.
- Reject pointers whose feature key is unknown or unsupported for every enabled target.
- Reject `mcp` sources that are not files and `bin` sources that are not directories.
- Validate known structured files after preprocessing.
- Report conventional discovery in list/explain/lock provenance so auto-enabled files do not feel magical.
- Fail rather than silently skip when a feature cannot lower to an enabled target.

## Provenance

Locks record the feature key, source pointer when present, target support status, discovered convention or explicit pointer, generated path, source hash, output hash, and target state. `skillset list` and `skillset explain` show whether a generated plugin feature came from convention or an explicit source pointer.

## Tests and Fixtures

Fixtures cover `true`, `false`, and object forms, safe `repo:` path resolution, missing pointer diagnostics, conventional discovery, target-specific unsupported behavior, divergent output collisions, and lock/list/explain provenance.
