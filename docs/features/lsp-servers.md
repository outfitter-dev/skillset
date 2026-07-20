# LSP Servers

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-lsp-servers` | `implemented` | `pass_through` | `not_applicable` | `planned` |
<!-- skillset:feature-support:end -->

Feature id: `lsp-servers`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Claude plugins can include an `.lsp.json` file that declares language server configuration. Skillset treats the file as target-native Claude plugin pass-through and wires the documented manifest field when the file is present.

## Authoring

Place `<source-root>/plugins/<plugin>/.lsp.json` in the plugin source root. `<source-root>` is `.skillset/`. The file is copied only when Claude plugin output for that plugin is active.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `<source-root>/plugins/<plugin>/.lsp.json` | `.lsp.json` plus manifest `lspServers: "./.lsp.json"` | n/a | `target_native` / `implemented` | JSON utility output is parsed after generation; deeper LSP schema validation is not a portable v1 contract. |

## Diagnostics

- Refuse malformed generated JSON.
- Back up unmanaged generated-output collisions before replacing them in confirmed builds.
- Reject divergent provider source that tries to emit the same `.lsp.json` path.
- Do not copy Claude LSP configuration into Codex plugin output.

## Provenance

The generated file participates in plugin output hashes and lock provenance as a target-native companion file. It is not a `plugin-feature` entry because v1 does not provide `lsp.source`.

## Tests and Fixtures

Fixtures cover Claude manifest field declaration, target-native file copying, post-generation JSON parsing, and no Codex rendering.
