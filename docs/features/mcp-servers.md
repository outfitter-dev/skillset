# MCP Servers

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-mcp` | `implemented` | `native` | `native` | `native` |
<!-- skillset:feature-support:end -->

Feature id: `mcp-servers`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Plugin MCP definitions are feature-key source pointers because the feature owns a known target path, manifest field, validation shape, and provenance.

## Authoring

Conventional `<source-root>/plugins/<plugin>/.mcp.json` is discovered automatically. `<source-root>` is `.skillset/`. `mcp: true` requires that conventional file. `mcp: false` disables conventional discovery. `mcp.source: repo:path/to/mcp.json` copies a repo-owned MCP file into the generated plugin bundle.

## Target Rendering

| Source | Claude output | Codex output | Cursor output | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Conventional `.mcp.json` | `.mcp.json` and manifest `mcpServers` | `.mcp.json` and manifest `mcpServers` | `mcp.json` and manifest `mcpServers` | `target_native` / `implemented` | Structured JSON validation. |
| `mcp.source` | `.mcp.json` and manifest `mcpServers` | `.mcp.json` and manifest `mcpServers` | `mcp.json` and manifest `mcpServers` | `target_native` / `implemented` | Source pointer must use `repo:` and stay outside generated roots. |

## Diagnostics

- Reject non-`repo:` source pointer schemes.
- Reject pointers that escape the repo, point inside generated output roots, or reference missing paths.
- Reject MCP sources that are not files.
- Validate MCP JSON after rendering.
- Reject divergent feature and provider-source outputs to the same generated path.

## Provenance

Locks record `kind: plugin-feature`, `feature: mcp`, origin (`conventional` or `explicit`), source pointer when present, source path, generated path, hashes, validation, and target state. `skillset list` and `skillset explain` show that feature ownership.

## Tests and Fixtures

Fixtures cover conventional discovery, explicit `repo:` source pointers, `true` / `false` forms, invalid paths, type mismatches, JSON validation, manifest wiring, lock provenance, and list/explain output.
