# Executables

Feature id: `executables`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Claude plugin `bin/` is a target-native executable component. Skillset supports it through conventional discovery and `bin.source`; Codex plugin `bin` output is unsupported in v1.

## Authoring

Use plugin-local `<source-root>/plugins/<plugin>/bin/` for conventional discovery, where `<source-root>` is `.skillset/src/` in ordinary repos and `skillset/` in dedicated Skillset repos. `bin: true` requires that conventional directory, `bin: false` disables it, and `bin.source: repo:path/to/bin` points at a repo-owned directory.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| Conventional `bin/` | plugin root `bin/` | n/a | `target_native` / `implemented` | Copied as executable support files; no Claude manifest field. |
| `bin.source` | plugin root `bin/` | n/a | `target_native` / `implemented` | Source pointer must be a repo directory outside generated roots. |
| Codex-enabled `bin` | n/a | unsupported | `unsupported` / `implemented` | Fails loudly unless Codex plugin output is disabled. |

## Diagnostics

- Reject `bin` sources that are not directories.
- Reject `repo:` pointers that escape the repo, point into generated output roots, or reference missing paths.
- Reject enabled Codex plugin output with `bin` because Codex plugins do not support that component in v1.
- Reject divergent feature and provider-source outputs to the same generated path.

## Provenance

Locks record `kind: plugin-feature`, `feature: bin`, origin, optional source pointer, source path, generated path, output hashes, `targetState: target-native`, and opaque-copy validation.

## Tests and Fixtures

Fixtures cover conventional discovery, explicit source pointers, disabled discovery, Claude-only copying, Codex unsupported diagnostics, type mismatches, generated-root pointer rejection, list/explain provenance, and divergent output collisions.
