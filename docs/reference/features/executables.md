---
description: Plugin executables define discovery, source pointers, file modes, provider support, and validation errors.
---

# Executables

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-bin` | `implemented` | `pass_through` | `unsupported` | `unsupported` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Claude plugin `bin/` is a [provider-native](../../glossary.md#provider-native) executable component. Skillset supports it through conventional discovery and `bin.source`; Codex and Cursor plugin `bin` output is unsupported.

## Authoring

Use plugin-local `<source-root>/plugins/<plugin>/bin/` for conventional discovery, where `<source-root>` is `.skillset/`. `bin: true` requires that conventional directory, `bin: false` disables it, and `bin.source: repo:path/to/bin` points at a repo-owned directory.

```yaml
bin:
  source: repo:tools/reviewer/bin
```

Mark executable source files with `chmod +x`. Skillset derives portable executable intent from any source executable bit, renders those files as `0755`, and renders non-executable generated files as `0644` on Unix. Windows skips physical Unix-mode application and checking; a checkout that does not expose Git's executable bit records `0644`, and Skillset does not infer execution from filenames or shebangs.

## Target Rendering

| Source | Claude output | Codex output | Cursor output | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Conventional `bin/` | plugin root `bin/` | n/a | n/a | `target_native` / `implemented` | Copied as executable support files; no Claude manifest field. |
| `bin.source` | plugin root `bin/` | n/a | n/a | `target_native` / `implemented` | Source pointer must be a repo directory outside generated roots. |
| Codex- or Cursor-enabled `bin` | n/a | unsupported | unsupported | `unsupported` / `implemented` | Fails loudly unless each unsupported plugin output is disabled. |

## Diagnostics

- Reject `bin` sources that are not directories.
- Reject `repo:` pointers that escape the repo, point into [generated-output](../../glossary.md#generated-output) roots, or reference missing paths.
- Reject enabled Codex or Cursor plugin output with `bin` because those plugins do not support that component.
- Reject divergent feature and provider-source outputs to the same generated path.

## Provenance

Locks record `kind: plugin-feature`, `feature: bin`, origin, optional source pointer, source path, generated path, normalized `fileModes`, mode-aware output hashes, `targetState: target-native`, and opaque-copy validation.

## Evidence

Contract tests cover conventional and explicit discovery, file modes, unsupported targets, pointer containment, list/explain provenance, and output collisions. See [Feature Source Pointers](feature-source-pointers.md) for the shared pointer contract.
