---
description: Plugin MCP servers define discovery, source pointers, validation, provider paths, and lock provenance.
---

# MCP Servers

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-mcp` | `implemented` | `native` | `native` | `native` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Plugin MCP definitions are feature-key source pointers because the feature owns a known [target](../../glossary.md#target) path, manifest field, validation shape, and provenance.

## Authoring

Conventional `<source-root>/plugins/<plugin>/.mcp.json` is discovered automatically. `<source-root>` is `.skillset/`. `mcp: true` requires that conventional file. `mcp: false` disables conventional discovery. `mcp.source: repo:path/to/mcp.json` reads a repo-owned MCP file as the adaptive source.

```yaml
mcp:
  source: repo:services/reviewer/mcp.json
```

## Target Rendering

| Source | Claude output | Codex output | Cursor output | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Conventional `.mcp.json` | `.mcp.json` and manifest `mcpServers` | `.mcp.json` and manifest `mcpServers` | `mcp.json` and manifest `mcpServers` | `target_native` / `implemented` | Parsed once as portable MCP and rendered in the provider dialect. |
| `mcp.source` | `.mcp.json` and manifest `mcpServers` | `.mcp.json` and manifest `mcpServers` | `mcp.json` and manifest `mcpServers` | `target_native` / `implemented` | Source pointer must use `repo:` and stay outside generated roots; rendering uses the same typed model. |

Portable source uses `stdio`, `streamable-http`, and `sse`, with `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` placeholders. A command entry without `type` infers `stdio`; a URL entry must declare its transport. Provider spellings such as `type: http` or `${CLAUDE_PLUGIN_ROOT}` fail with a canonical fix-it. The Agent Plugins projection emits `mcp.json` with the fixed 1.0 schema identifier; authored source may omit `$schema`, but a conflicting value is rejected.

The typed model preserves provider credential, OAuth, and unknown-field entries whole for diagnostics, but omits them from rendered MCP files. This includes provider-managed header placeholders such as `${API_TOKEN}` because Agent Plugins 1.0 does not define a portable credential mechanism. It also records target-specific gaps such as a provider without SSE, stdio working-directory, or persistent plugin-data placeholder support. For example, a stdio entry with `cwd` remains available to the standards, Codex, and Cursor projections but is omitted from Claude's native MCP output because Claude's documented plugin substitution surface does not include `cwd`. The operation policy reports each omitted entry as a warning or error instead of emitting unsupported fields or inventing a substitution.

`skillset import --from <provider>` reverses provider transport, header, placeholder, and filename spellings into canonical `.mcp.json` before committing imported source.

## Diagnostics

- Reject non-`repo:` source pointer schemes.
- Reject pointers that escape the repo, point inside [generated-output](../../glossary.md#generated-output) roots, or reference missing paths.
- Reject MCP sources that are not files or valid JSON objects with a closed `mcpServers` root.
- Reject unknown root fields, invalid union shapes, reserved environment variables, invalid placeholders, unsafe commands or working directories, invalid remote URLs, and invalid or client-owned HTTP headers.
- Resolve plugin-relative commands and working directories through the filesystem and reject missing or symlink-escaping references.
- Validate generated MCP JSON after provider rendering.
- Reject divergent feature and provider-source outputs to the same generated path.

## Provenance

Locks record `kind: plugin-feature`, `feature: mcp`, origin (`conventional` or `explicit`), source pointer when present, source path, generated path, hashes, validation, and target state. `skillset list` and `skillset explain` show that feature ownership.

## Evidence

Contract tests cover conventional discovery, every accepted source form, path containment, JSON validation, typed provider rendering, standard package emission, import rewriting, manifest wiring, lock provenance, and list/explain output. The [Feature Source Pointers](feature-source-pointers.md) page owns the shared pointer rules.
