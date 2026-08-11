---
description: Claude plugin LSP servers define configuration discovery, manifest wiring, JSON validation, and provider limits.
---

# LSP Servers

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-lsp-servers` | `implemented` | `pass_through` | `not_applicable` | `planned` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Claude plugins can include an `.lsp.json` file that declares language server configuration. Skillset treats the file as [provider-native](../../glossary.md#provider-native) Claude plugin pass-through and wires the documented manifest field when the file is present.

## Authoring

Place `.skillset/plugins/<plugin>/.lsp.json` in the plugin source root. Discovery is automatic, and the file is copied only when the Claude plugin [target](../../glossary.md#target) is active.

```text
.skillset/plugins/reviewer/.lsp.json
```

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `<source-root>/plugins/<plugin>/.lsp.json` | `.lsp.json` plus manifest `lspServers: "./.lsp.json"` | n/a | `target_native` / `implemented` | JSON utility output is parsed after generation; deeper LSP schema validation is not a portable v1 contract. |

## Diagnostics

- Refuse malformed generated JSON.
- Back up unmanaged [generated-output](../../glossary.md#generated-output) collisions before replacing them in confirmed builds.
- Reject divergent provider source that tries to emit the same `.lsp.json` path.
- Do not copy Claude LSP configuration into Codex plugin output.

## Provenance

The generated file participates in plugin output hashes and lock provenance as a target-native companion file. It is not a `plugin-feature` entry because v1 does not provide `lsp.source`.

## Evidence

Plugin manifest fixtures verify field declaration, pass-through copying, post-generation JSON parsing, and the absence of a Codex [projection](../../glossary.md#projection). Skillset validates JSON syntax but does not claim a portable deep LSP schema.
