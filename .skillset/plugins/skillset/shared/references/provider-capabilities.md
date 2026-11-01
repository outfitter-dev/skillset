<!-- Generated capability reference; do not edit. -->

# Provider Capability Reference

This bundled snapshot is generated from the same semantic catalog as `skillset lookup capability`. Read the section matching the requested concept or exact native alias; an alias can identify more than one concept.

Evidence status is relative to the bundled authority pins, not a live upstream freshness check. Destination support is separate from semantic fidelity. Neither establishes installation, activation, or runtime effectiveness. Missing or stale judgments remain unknown. Use a qualified installed CLI for its own current catalog; do not silently combine snapshots.

## adaptive-hooks: Reusable hook behavior

Family: hooks. Exact aliases: `hooks`, `hook.json`.

### claude: adaptive-hooks

- Canonical source: `hooks/<name>.json or hooks/<name>/hook.json adaptive hook units` (contracts: `adaptive-hook`).
- Realization: Defines reusable adaptive hook units and renders supported plugin and Claude frontmatter hook destinations with explicit unsupported-destination results.
- Destination support: transformed; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:0067b6add96fd93e00d631473986d455b9b5d27e10c17f257ca4000c5a780384`.
- Standards: none recorded.
- Provider-native destination: `claude-hooks`.

```json
{
  "filePattern": "hooks/hooks.json",
  "handlerFields": [
    "type",
    "command",
    "prompt",
    "agent",
    "timeout",
    "async",
    "args"
  ],
  "rootFields": [
    "description",
    "hooks"
  ],
  "shape": "event-map",
  "supportedHandlerTypes": [
    "agent",
    "command",
    "http",
    "mcp_tool",
    "prompt"
  ]
}
```

- Provider source: https://code.claude.com/docs/en/hooks

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: adaptive-hooks

- Canonical source: `hooks/<name>.json or hooks/<name>/hook.json adaptive hook units` (contracts: `adaptive-hook`).
- Realization: Defines reusable adaptive hook units and renders supported plugin and Claude frontmatter hook destinations with explicit unsupported-destination results.
- Destination support: degraded; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:ee6a24597708fd4aea0fb324827302228718edc80f203af9ef922bea570e458f`.
- Standards: none recorded.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Codex supports plugin-level command hooks, but has no faithful skill-local or project-agent hook destination and narrower event/matcher support.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: adaptive-hooks

- Canonical source: `hooks/<name>.json or hooks/<name>/hook.json adaptive hook units` (contracts: `adaptive-hook`).
- Realization: Defines reusable adaptive hook units and renders supported plugin and Claude frontmatter hook destinations with explicit unsupported-destination results.
- Destination support: degraded; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:330a68ea2be2d2c6a5ff67de99d1fb08893747cbd6e5b2f8f75d932727532981`.
- Standards: none recorded.
- Provider-native destination: `cursor-hooks`.

```json
{
  "canonicalEventNames": "skillset-pascal-case",
  "nativeEventNames": "cursor-lower-camel",
  "filePattern": "hooks/hooks.json",
  "handlerFields": [
    "type",
    "command",
    "prompt",
    "timeout",
    "loop_limit",
    "failClosed",
    "matcher",
    "model"
  ],
  "rootFields": [
    "version",
    "hooks"
  ],
  "shape": "versioned-flat-event-map",
  "supportedHandlerTypes": [
    "command",
    "prompt"
  ]
}
```

- Provider source: https://cursor.com/docs/hooks
- Provider source: https://cursor.com/docs/reference/third-party-hooks
- Provider source: https://github.com/cursor/plugins/blob/e87eaecc7bd3a06160035b5bc1a76d8cd695273a/ralph-loop/hooks/hooks.json

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Cursor supports plugin-level command hooks, but has no faithful skill-local or project-agent hook destination and uses provider-native lower-camel event names.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

## agent-instructions-standard: Agent Instructions portable baseline

Family: standards. Exact aliases: `agent-instructions`, `AGENTS.md`.

### claude: project-instructions

- Canonical source: `.skillset/rules/**/*.md` (contracts: none).
- Realization: Renders project instructions to Claude rules and directory-local Codex AGENTS.md files.
- Destination support: transformed; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:60010cc879097e7ce0e0280c1eea87d887e4a26c30724f8ef258616bb0d546dd`.
- Standards: agent-instructions.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: project-instructions

- Canonical source: `.skillset/rules/**/*.md` (contracts: none).
- Realization: Renders project instructions to Claude rules and directory-local Codex AGENTS.md files.
- Destination support: transformed; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:e07fe27a66cc3a081751d7c4d83a80314de380eb9e30ebcb113cff8b0b8f2877`.
- Standards: agent-instructions.
- Provider-native destination: `codex-agents-md`.

```json
{
  "discoveryOrder": [
    "AGENTS.override.md",
    "AGENTS.md",
    "project_doc_fallback_filenames"
  ],
  "filePattern": "AGENTS.md",
  "mergeOrder": "root-to-current-working-directory",
  "projectDocMaxBytesDefault": 32768,
  "serialization": "markdown"
}
```

- Provider source: https://developers.openai.com/codex/guides/agents-md

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: project-instructions

- Canonical source: `.skillset/rules/**/*.md` (contracts: none).
- Realization: Renders project instructions to Claude rules and directory-local Codex AGENTS.md files.
- Destination support: transformed; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:a88b2fb22c6ff554ee2a089f117a5e5842c8e62269593112b75f811d6ee93c36`.
- Standards: agent-instructions.
- Provider-native destination: `cursor-rules`.

```json
{
  "filePattern": ".cursor/rules/*.mdc",
  "frontmatter": {
    "optionalFields": [
      "alwaysApply",
      "globs"
    ],
    "requiredFields": [
      "description"
    ]
  },
  "serialization": "markdown-with-yaml-frontmatter"
}
```

- Provider source: https://cursor.com/docs/rules

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

## agent-plugins-standard: Agent Plugins portable baseline

Family: standards. Exact aliases: `agent-plugins`, `agent-plugins-1.0`.

### claude: plugin-assets

- Canonical source: `plugin assets/` (contracts: none).
- Realization: 2026-09-21: The Claude plugin snapshot has no assets component; package-root assets are portable presentation, not Claude pass-through.
- Destination support: not_applicable; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:08692859631a1ba1d1931cfbed1fbe65c4d2d5e58598b355fa4ae30e0cbef915`.
- Standards: agent-plugins-1.0.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: plugin-assets

- Canonical source: `plugin assets/` (contracts: none).
- Realization: Copies plugin asset companions into generated provider plugin outputs.
- Destination support: pass_through; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:07db323c244bd3515597202add48c0e7133cd6fc43f347754ced34076b9e7b0c`.
- Standards: agent-plugins-1.0.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: plugin-assets

- Canonical source: `plugin assets/` (contracts: none).
- Realization: Copies plugin asset companions into generated provider plugin outputs.
- Destination support: planned; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:e4494e6ad279ea9dbdb2687be250700d7d6605cf9894c95702173ad1eb5b7a72`.
- Standards: agent-plugins-1.0.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- cursor provider support is not registered for this feature yet.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### claude: plugin-manifests

- Canonical source: `.skillset/plugins/<plugin>/skillset.yaml` (contracts: none).
- Realization: Projects plugin metadata and component wiring into target-native plugin manifests.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:5f819284edb6341d252ce12c14ff90aded20065187f5c1a07001884e012a52e6`.
- Standards: agent-plugins-1.0.
- Provider-native destination: `claude-plugin`.

```json
{
  "components": [
    {
      "defaultPath": "skills/",
      "kind": "skills",
      "manifestField": "skills",
      "status": "native"
    },
    {
      "defaultPath": "commands/",
      "kind": "commands",
      "manifestField": "commands",
      "status": "native"
    },
    {
      "defaultPath": "agents/",
      "kind": "agents",
      "manifestField": "agents",
      "status": "native"
    },
    {
      "defaultPath": "hooks/hooks.json",
      "kind": "hooks",
      "manifestField": "hooks",
      "status": "native"
    },
    {
      "defaultPath": ".mcp.json",
      "kind": "mcp",
      "manifestField": "mcpServers",
      "status": "native"
    },
    {
      "defaultPath": ".lsp.json",
      "kind": "lsp",
      "manifestField": "lspServers",
      "status": "native"
    },
    {
      "defaultPath": "monitors/monitors.json",
      "kind": "monitors",
      "manifestField": "experimental.monitors",
      "status": "native"
    },
    {
      "defaultPath": "output-styles/",
      "kind": "output-styles",
      "manifestField": "outputStyles",
      "status": "native"
    },
    {
      "defaultPath": "themes/",
      "kind": "themes",
      "manifestField": "experimental.themes",
      "status": "native"
    },
    {
      "defaultPath": "bin/",
      "kind": "bin",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "settings.json",
      "kind": "settings",
      "manifestField": null,
      "status": "native"
    }
  ],
  "manifest": {
    "path": ".claude-plugin/plugin.json",
    "requiredFields": [
      "name",
      "description"
    ],
    "optionalFields": [
      "version",
      "author",
      "displayName",
      "homepage",
      "repository",
      "license"
    ],
    "unknownFields": "warn"
  },
  "pathRules": {
    "componentDirectoriesAtPluginRoot": true,
    "metadataDirectory": ".claude-plugin/"
  }
}
```

- Provider source: https://code.claude.com/docs/en/plugins
- Provider source: https://code.claude.com/docs/en/plugins-reference#metadata-fields
- Provider source: https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-arm64/-/claude-code-darwin-arm64-2.1.142.tgz
- Provider source: https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-arm64/-/claude-code-darwin-arm64-2.1.143.tgz

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: plugin-manifests

- Canonical source: `.skillset/plugins/<plugin>/skillset.yaml` (contracts: none).
- Realization: Projects plugin metadata and component wiring into target-native plugin manifests.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:a5fdf66e084fe2fc9d0e38a520a0925e24bb2b6e2c0f37b2666f452f443c7a89`.
- Standards: agent-plugins-1.0.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: plugin-manifests

- Canonical source: `.skillset/plugins/<plugin>/skillset.yaml` (contracts: none).
- Realization: Projects plugin metadata and component wiring into target-native plugin manifests.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:2b0308a27a242f8ca803d1d045cf0ef9e2124c9acfd434b6e18b2871bbbc2618`.
- Standards: agent-plugins-1.0.
- Provider-native destination: `cursor-plugin`.

```json
{
  "components": [
    {
      "defaultPath": "skills/",
      "kind": "skills",
      "manifestField": "skills",
      "status": "native"
    },
    {
      "defaultPath": "rules/",
      "kind": "rules",
      "manifestField": "rules",
      "status": "native"
    },
    {
      "defaultPath": "agents/",
      "kind": "agents",
      "manifestField": "agents",
      "status": "native"
    },
    {
      "defaultPath": "commands/",
      "kind": "commands",
      "manifestField": "commands",
      "status": "native"
    },
    {
      "defaultPath": "hooks/hooks.json",
      "kind": "hooks",
      "manifestField": "hooks",
      "status": "native"
    },
    {
      "defaultPath": "mcp.json",
      "kind": "mcp",
      "manifestField": "mcpServers",
      "status": "native"
    },
    {
      "defaultPath": "assets/",
      "kind": "assets",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "scripts/",
      "kind": "scripts",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "bin/",
      "kind": "bin",
      "manifestField": null,
      "status": "unsupported"
    }
  ],
  "manifest": {
    "authorFields": [
      "name",
      "email"
    ],
    "path": ".cursor-plugin/plugin.json",
    "requiredFields": [
      "name"
    ],
    "optionalFields": [
      "agents",
      "author",
      "category",
      "commands",
      "description",
      "displayName",
      "hooks",
      "homepage",
      "keywords",
      "license",
      "logo",
      "mcpServers",
      "minClientVersions",
      "publisher",
      "repository",
      "rules",
      "skills",
      "tags",
      "variables",
      "version"
    ]
  },
  "pathRules": {
    "componentDirectoriesAtPluginRoot": true,
    "metadataDirectory": ".cursor-plugin/"
  }
}
```

- Provider source: https://github.com/cursor/plugins/blob/2a8044425c7bddf429c3bdedf3ab61e791d34d65/schemas/plugin.schema.json

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### claude: plugin-mcp

- Canonical source: `plugin mcp/source pointer or conventional .mcp.json` (contracts: none).
- Realization: Normalizes portable plugin MCP server definitions and renders them into generated provider plugin outputs.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:6be9c0518b098c6bfc001f42da3f34246aa0989e8e6be9c0f2487213e9c19350`.
- Standards: agent-plugins-1.0.
- Provider-native destination: `claude-plugin`.

```json
{
  "components": [
    {
      "defaultPath": "skills/",
      "kind": "skills",
      "manifestField": "skills",
      "status": "native"
    },
    {
      "defaultPath": "commands/",
      "kind": "commands",
      "manifestField": "commands",
      "status": "native"
    },
    {
      "defaultPath": "agents/",
      "kind": "agents",
      "manifestField": "agents",
      "status": "native"
    },
    {
      "defaultPath": "hooks/hooks.json",
      "kind": "hooks",
      "manifestField": "hooks",
      "status": "native"
    },
    {
      "defaultPath": ".mcp.json",
      "kind": "mcp",
      "manifestField": "mcpServers",
      "status": "native"
    },
    {
      "defaultPath": ".lsp.json",
      "kind": "lsp",
      "manifestField": "lspServers",
      "status": "native"
    },
    {
      "defaultPath": "monitors/monitors.json",
      "kind": "monitors",
      "manifestField": "experimental.monitors",
      "status": "native"
    },
    {
      "defaultPath": "output-styles/",
      "kind": "output-styles",
      "manifestField": "outputStyles",
      "status": "native"
    },
    {
      "defaultPath": "themes/",
      "kind": "themes",
      "manifestField": "experimental.themes",
      "status": "native"
    },
    {
      "defaultPath": "bin/",
      "kind": "bin",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "settings.json",
      "kind": "settings",
      "manifestField": null,
      "status": "native"
    }
  ],
  "manifest": {
    "path": ".claude-plugin/plugin.json",
    "requiredFields": [
      "name",
      "description"
    ],
    "optionalFields": [
      "version",
      "author",
      "displayName",
      "homepage",
      "repository",
      "license"
    ],
    "unknownFields": "warn"
  },
  "pathRules": {
    "componentDirectoriesAtPluginRoot": true,
    "metadataDirectory": ".claude-plugin/"
  }
}
```

- Provider source: https://code.claude.com/docs/en/plugins
- Provider source: https://code.claude.com/docs/en/plugins-reference#metadata-fields
- Provider source: https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-arm64/-/claude-code-darwin-arm64-2.1.142.tgz
- Provider source: https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-arm64/-/claude-code-darwin-arm64-2.1.143.tgz

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: plugin-mcp

- Canonical source: `plugin mcp/source pointer or conventional .mcp.json` (contracts: none).
- Realization: Normalizes portable plugin MCP server definitions and renders them into generated provider plugin outputs.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:5ee8bd4d441acbe95d077c4a24ea38794312ac953c42ff601aea1a8a1d656d76`.
- Standards: agent-plugins-1.0.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: plugin-mcp

- Canonical source: `plugin mcp/source pointer or conventional .mcp.json` (contracts: none).
- Realization: Normalizes portable plugin MCP server definitions and renders them into generated provider plugin outputs.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:0add073cc514199d41b1b0cb216bf7c4e3fee4634e5132c4bc0a43cc995e55e9`.
- Standards: agent-plugins-1.0.
- Provider-native destination: `cursor-plugin`.

```json
{
  "components": [
    {
      "defaultPath": "skills/",
      "kind": "skills",
      "manifestField": "skills",
      "status": "native"
    },
    {
      "defaultPath": "rules/",
      "kind": "rules",
      "manifestField": "rules",
      "status": "native"
    },
    {
      "defaultPath": "agents/",
      "kind": "agents",
      "manifestField": "agents",
      "status": "native"
    },
    {
      "defaultPath": "commands/",
      "kind": "commands",
      "manifestField": "commands",
      "status": "native"
    },
    {
      "defaultPath": "hooks/hooks.json",
      "kind": "hooks",
      "manifestField": "hooks",
      "status": "native"
    },
    {
      "defaultPath": "mcp.json",
      "kind": "mcp",
      "manifestField": "mcpServers",
      "status": "native"
    },
    {
      "defaultPath": "assets/",
      "kind": "assets",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "scripts/",
      "kind": "scripts",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "bin/",
      "kind": "bin",
      "manifestField": null,
      "status": "unsupported"
    }
  ],
  "manifest": {
    "authorFields": [
      "name",
      "email"
    ],
    "path": ".cursor-plugin/plugin.json",
    "requiredFields": [
      "name"
    ],
    "optionalFields": [
      "agents",
      "author",
      "category",
      "commands",
      "description",
      "displayName",
      "hooks",
      "homepage",
      "keywords",
      "license",
      "logo",
      "mcpServers",
      "minClientVersions",
      "publisher",
      "repository",
      "rules",
      "skills",
      "tags",
      "variables",
      "version"
    ]
  },
  "pathRules": {
    "componentDirectoriesAtPluginRoot": true,
    "metadataDirectory": ".cursor-plugin/"
  }
}
```

- Provider source: https://github.com/cursor/plugins/blob/2a8044425c7bddf429c3bdedf3ab61e791d34d65/schemas/plugin.schema.json

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### claude: plugin-readme

- Canonical source: `plugin README.md` (contracts: none).
- Realization: Copies plugin README companions into generated provider plugin outputs.
- Destination support: pass_through; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:6a91a445b87464f9a59393c29bb0addd2adb72b288cf5494ff895ec8245270d9`.
- Standards: agent-plugins-1.0.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: plugin-readme

- Canonical source: `plugin README.md` (contracts: none).
- Realization: Copies plugin README companions into generated provider plugin outputs.
- Destination support: pass_through; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:7e4349efb82b6ee5924706b3642fe75c3aaa70f9108e1308f9b7cac72c19bd19`.
- Standards: agent-plugins-1.0.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: plugin-readme

- Canonical source: `plugin README.md` (contracts: none).
- Realization: Copies plugin README companions into generated provider plugin outputs.
- Destination support: pass_through; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:88bc46cc77fe9ce59423fd5143abd442449af9d1812f450634df74673bd1785c`.
- Standards: agent-plugins-1.0.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### claude: plugin-scripts

- Canonical source: `plugin scripts/` (contracts: none).
- Realization: Copies plugin script companions into generated provider plugin outputs.
- Destination support: pass_through; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:2747884505521f8cc76cb4443c139e1ef68b45aa831ebb3c0a147620f1299462`.
- Standards: agent-plugins-1.0.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: plugin-scripts

- Canonical source: `plugin scripts/` (contracts: none).
- Realization: Copies plugin script companions into generated provider plugin outputs.
- Destination support: pass_through; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:686807d90fe40a608af6c433551410d8a0917da46343df8ec0b42a6a818b3b07`.
- Standards: agent-plugins-1.0.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: plugin-scripts

- Canonical source: `plugin scripts/` (contracts: none).
- Realization: Copies plugin script companions into generated provider plugin outputs.
- Destination support: pass_through; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:83fca2bbfdc953f34cf406a4075235975435a7659441519cfffbf859a6cffd7a`.
- Standards: agent-plugins-1.0.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### claude: plugin-skills

- Canonical source: `.skillset/plugins/<plugin>/skills/<skill>/SKILL.md` (contracts: none).
- Realization: Preserves plugin-scoped skills inside each target plugin boundary.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:e342b47d830e5682c3b7ceea3e8fa2e2e154f00a3d9b246d6b432bd727096265`.
- Standards: agent-plugins-1.0.
- Provider-native destination: `claude-skill`.

```json
{
  "directoryPattern": ".claude/skills/<skill-name>/",
  "frontmatter": {
    "optionalFields": [
      "allowed-tools",
      "arguments",
      "context",
      "description",
      "disable-model-invocation",
      "name",
      "user-invocable"
    ],
    "recommendedFields": [
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "examples/",
    "references/",
    "scripts/"
  ]
}
```

- Provider source: https://code.claude.com/docs/en/skills

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: plugin-skills

- Canonical source: `.skillset/plugins/<plugin>/skills/<skill>/SKILL.md` (contracts: none).
- Realization: Preserves plugin-scoped skills inside each target plugin boundary.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:356f7d3efb9eceaeed7ae2d443ee5e05d9dc4476431051c8bf5f85436ac8acfb`.
- Standards: agent-plugins-1.0.
- Provider-native destination: `codex-skill`.

```json
{
  "directoryPattern": ".agents/skills/<skill-name>/",
  "frontmatter": {
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "agents/",
    "assets/",
    "references/",
    "scripts/"
  ]
}
```

- Provider source: https://developers.openai.com/codex/skills

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: plugin-skills

- Canonical source: `.skillset/plugins/<plugin>/skills/<skill>/SKILL.md` (contracts: none).
- Realization: Preserves plugin-scoped skills inside each target plugin boundary.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:eee39f849747d30d3800c58b812b957b38721b2604f98aa0c16825afeac6eb1d`.
- Standards: agent-plugins-1.0.
- Provider-native destination: `cursor-skill`.

```json
{
  "directoryPattern": ".cursor/skills/<skill-name>/",
  "frontmatter": {
    "optionalFields": [
      "disable-model-invocation"
    ],
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "assets/",
    "references/",
    "scripts/"
  ]
}
```

- Provider source: https://cursor.com/docs/skills#frontmatter-fields
- Provider source: https://cursor.com/docs/plugins
- Provider source: https://github.com/cursor/plugins

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### claude: plugin-src

- Canonical source: `plugin src/` (contracts: none).
- Realization: Copies plugin source companions into generated provider plugin outputs.
- Destination support: pass_through; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:47281d3031a3fc14bd986d6b9d0cca5400794752934ef9d8d8dc0266e2539e70`.
- Standards: agent-plugins-1.0.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: plugin-src

- Canonical source: `plugin src/` (contracts: none).
- Realization: Copies plugin source companions into generated provider plugin outputs.
- Destination support: pass_through; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:315677ff66b8f65e89bb72194663378580eed930e1c688c6e41fb2f125033217`.
- Standards: agent-plugins-1.0.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: plugin-src

- Canonical source: `plugin src/` (contracts: none).
- Realization: Copies plugin source companions into generated provider plugin outputs.
- Destination support: pass_through; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:d9f76307183676a17db83a1d8f4b2c3c389eba33da3c2ed5402e55c4653c6da9`.
- Standards: agent-plugins-1.0.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

## agent-skills-standard: Agent Skills portable baseline

Family: standards. Exact aliases: `agent-skills`, `SKILL.md`.

### claude: standalone-skills

- Canonical source: `.skillset/skills/<skill>/SKILL.md` (contracts: none).
- Realization: Projects standalone repo skills into configured target skill roots.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:1d416a18441fc1255608974f38c65c2b9a60ab096c98acc94017b47f42eafbdf`.
- Standards: agent-skills.
- Provider-native destination: `claude-skill`.

```json
{
  "directoryPattern": ".claude/skills/<skill-name>/",
  "frontmatter": {
    "optionalFields": [
      "allowed-tools",
      "arguments",
      "context",
      "description",
      "disable-model-invocation",
      "name",
      "user-invocable"
    ],
    "recommendedFields": [
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "examples/",
    "references/",
    "scripts/"
  ]
}
```

- Provider source: https://code.claude.com/docs/en/skills

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: standalone-skills

- Canonical source: `.skillset/skills/<skill>/SKILL.md` (contracts: none).
- Realization: Projects standalone repo skills into configured target skill roots.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:871bf46e45b4293eb8196695d6800ba0d1417e4b0d14c5887d5ecbdf56454984`.
- Standards: agent-skills.
- Provider-native destination: `codex-skill`.

```json
{
  "directoryPattern": ".agents/skills/<skill-name>/",
  "frontmatter": {
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "agents/",
    "assets/",
    "references/",
    "scripts/"
  ]
}
```

- Provider source: https://developers.openai.com/codex/skills

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: standalone-skills

- Canonical source: `.skillset/skills/<skill>/SKILL.md` (contracts: none).
- Realization: Projects standalone repo skills into configured target skill roots.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:45681072c603b4e9ef5f0185dda3fb8bcc504b2ed9e16a4b82dfa7e1ead02b79`.
- Standards: agent-skills.
- Provider-native destination: `cursor-skill`.

```json
{
  "directoryPattern": ".cursor/skills/<skill-name>/",
  "frontmatter": {
    "optionalFields": [
      "disable-model-invocation"
    ],
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "assets/",
    "references/",
    "scripts/"
  ]
}
```

- Provider source: https://cursor.com/docs/skills#frontmatter-fields
- Provider source: https://cursor.com/docs/plugins
- Provider source: https://github.com/cursor/plugins

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

## claude-manifest-identity: Direct Claude manifest identity round trip

Family: plugins. Exact aliases: none.

### claude: plugin-manifests

- Canonical source: `.skillset/plugins/<plugin>/skillset.yaml` (contracts: `plugin-config`, `source-metadata`).
- Realization: Projects plugin metadata and component wiring into target-native plugin manifests.
- Destination support: native; fidelity: **exact**; evidence: **current**.
- Semantic scope: Selected direct Claude manifest name and description strings retain their identity and descriptive metadata meaning through canonical configuration and the actual same-provider manifest, only when all three values are equal and no overriding route participates.
- Authority pin: `sha256:b6223384a7684bc8281c86e58744bddca318455d88de35d8c68d503e8ddc7cc4`.
- Standards: none recorded.
- Provider-native destination: `claude-plugin`.

```json
{
  "components": [
    {
      "defaultPath": "skills/",
      "kind": "skills",
      "manifestField": "skills",
      "status": "native"
    },
    {
      "defaultPath": "commands/",
      "kind": "commands",
      "manifestField": "commands",
      "status": "native"
    },
    {
      "defaultPath": "agents/",
      "kind": "agents",
      "manifestField": "agents",
      "status": "native"
    },
    {
      "defaultPath": "hooks/hooks.json",
      "kind": "hooks",
      "manifestField": "hooks",
      "status": "native"
    },
    {
      "defaultPath": ".mcp.json",
      "kind": "mcp",
      "manifestField": "mcpServers",
      "status": "native"
    },
    {
      "defaultPath": ".lsp.json",
      "kind": "lsp",
      "manifestField": "lspServers",
      "status": "native"
    },
    {
      "defaultPath": "monitors/monitors.json",
      "kind": "monitors",
      "manifestField": "experimental.monitors",
      "status": "native"
    },
    {
      "defaultPath": "output-styles/",
      "kind": "output-styles",
      "manifestField": "outputStyles",
      "status": "native"
    },
    {
      "defaultPath": "themes/",
      "kind": "themes",
      "manifestField": "experimental.themes",
      "status": "native"
    },
    {
      "defaultPath": "bin/",
      "kind": "bin",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "settings.json",
      "kind": "settings",
      "manifestField": null,
      "status": "native"
    }
  ],
  "manifest": {
    "path": ".claude-plugin/plugin.json",
    "requiredFields": [
      "name",
      "description"
    ],
    "optionalFields": [
      "version",
      "author",
      "displayName",
      "homepage",
      "repository",
      "license"
    ],
    "unknownFields": "warn"
  },
  "pathRules": {
    "componentDirectoriesAtPluginRoot": true,
    "metadataDirectory": ".claude-plugin/"
  }
}
```

- Provider source: https://code.claude.com/docs/en/plugins
- Provider source: https://code.claude.com/docs/en/plugins-reference#metadata-fields
- Provider source: https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-arm64/-/claude-code-darwin-arm64-2.1.142.tgz
- Provider source: https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-arm64/-/claude-code-darwin-arm64-2.1.143.tgz

Limitations:

- Excludes name remaps, defaults, whitespace changes, listing or native overrides, absent or unselected output, all other fields and providers, and runtime activation or behavior.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: plugin-manifests

- Canonical source: `.skillset/plugins/<plugin>/skillset.yaml` (contracts: `plugin-config`, `source-metadata`).
- Realization: Projects plugin metadata and component wiring into target-native plugin manifests.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:295f4253636ca56fcc79f9fd0b857ca880989fe21a3eea3d3bb8363b8927872b`.
- Standards: none recorded.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: plugin-manifests

- Canonical source: `.skillset/plugins/<plugin>/skillset.yaml` (contracts: `plugin-config`, `source-metadata`).
- Realization: Projects plugin metadata and component wiring into target-native plugin manifests.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:c04d8a4cab76921a4bc3835fd27c360c11e9f7c455dbaec6ab57b8e19eb45a3a`.
- Standards: none recorded.
- Provider-native destination: `cursor-plugin`.

```json
{
  "components": [
    {
      "defaultPath": "skills/",
      "kind": "skills",
      "manifestField": "skills",
      "status": "native"
    },
    {
      "defaultPath": "rules/",
      "kind": "rules",
      "manifestField": "rules",
      "status": "native"
    },
    {
      "defaultPath": "agents/",
      "kind": "agents",
      "manifestField": "agents",
      "status": "native"
    },
    {
      "defaultPath": "commands/",
      "kind": "commands",
      "manifestField": "commands",
      "status": "native"
    },
    {
      "defaultPath": "hooks/hooks.json",
      "kind": "hooks",
      "manifestField": "hooks",
      "status": "native"
    },
    {
      "defaultPath": "mcp.json",
      "kind": "mcp",
      "manifestField": "mcpServers",
      "status": "native"
    },
    {
      "defaultPath": "assets/",
      "kind": "assets",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "scripts/",
      "kind": "scripts",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "bin/",
      "kind": "bin",
      "manifestField": null,
      "status": "unsupported"
    }
  ],
  "manifest": {
    "authorFields": [
      "name",
      "email"
    ],
    "path": ".cursor-plugin/plugin.json",
    "requiredFields": [
      "name"
    ],
    "optionalFields": [
      "agents",
      "author",
      "category",
      "commands",
      "description",
      "displayName",
      "hooks",
      "homepage",
      "keywords",
      "license",
      "logo",
      "mcpServers",
      "minClientVersions",
      "publisher",
      "repository",
      "rules",
      "skills",
      "tags",
      "variables",
      "version"
    ]
  },
  "pathRules": {
    "componentDirectoriesAtPluginRoot": true,
    "metadataDirectory": ".cursor-plugin/"
  }
}
```

- Provider source: https://github.com/cursor/plugins/blob/2a8044425c7bddf429c3bdedf3ab61e791d34d65/schemas/plugin.schema.json

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

## native-hooks: Provider-native hook declarations

Family: hooks. Exact aliases: `hooks/hooks.json`.

### claude: plugin-hooks

- Canonical source: `plugin hooks/hooks.json` (contracts: `hook`).
- Realization: Copies plugin hook declarations with registry-backed provider event and handler validation.
- Destination support: pass_through; fidelity: **provider-only**; evidence: **current**.
- Semantic scope: Claude-native plugin hook declarations without explicit marked resource arguments retain Claude event and handler semantics through validated pass-through.
- Authority pin: `sha256:69cdb29880ac838f610030b9a714229efeb9fa034c35cd909426e1a0f5ac65fd`.
- Standards: none recorded.
- Provider-native destination: `claude-hooks`.

```json
{
  "filePattern": "hooks/hooks.json",
  "handlerFields": [
    "type",
    "command",
    "prompt",
    "agent",
    "timeout",
    "async",
    "args"
  ],
  "rootFields": [
    "description",
    "hooks"
  ],
  "shape": "event-map",
  "supportedHandlerTypes": [
    "agent",
    "command",
    "http",
    "mcp_tool",
    "prompt"
  ]
}
```

- Provider source: https://code.claude.com/docs/en/hooks

Limitations:

- The declaration is provider-native; identically spelled events on other providers do not establish equivalence. Use adaptive hooks for explicitly supported adaptation. Explicit marked command arguments use the separately validated resource-lifting path and are outside this pass-through judgment.
- Reviewed implementation evidence is tracked with this capability; contributor locations are not bundled.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: plugin-hooks

- Canonical source: `plugin hooks/hooks.json` (contracts: `hook`).
- Realization: Copies plugin hook declarations with registry-backed provider event and handler validation.
- Destination support: pass_through; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:89559f3e2cdef078bda68ae98badca16a299afbd65e9075de0e3933355bc9df5`.
- Standards: none recorded.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: plugin-hooks

- Canonical source: `plugin hooks/hooks.json` (contracts: `hook`).
- Realization: Copies plugin hook declarations with registry-backed provider event and handler validation.
- Destination support: pass_through; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:b73a3a31afffb0678cad622edc3658d07e537a174d57a88a5645e842b43f8490`.
- Standards: none recorded.
- Provider-native destination: `cursor-hooks`.

```json
{
  "canonicalEventNames": "skillset-pascal-case",
  "nativeEventNames": "cursor-lower-camel",
  "filePattern": "hooks/hooks.json",
  "handlerFields": [
    "type",
    "command",
    "prompt",
    "timeout",
    "loop_limit",
    "failClosed",
    "matcher",
    "model"
  ],
  "rootFields": [
    "version",
    "hooks"
  ],
  "shape": "versioned-flat-event-map",
  "supportedHandlerTypes": [
    "command",
    "prompt"
  ]
}
```

- Provider source: https://cursor.com/docs/hooks
- Provider source: https://cursor.com/docs/reference/third-party-hooks
- Provider source: https://github.com/cursor/plugins/blob/e87eaecc7bd3a06160035b5bc1a76d8cd695273a/ralph-loop/hooks/hooks.json

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

## plugin-agents: Plugin-packaged agents

Family: plugins. Exact aliases: `agents/`.

### claude: plugin-agents

- Canonical source: `plugin target-native agents/` (contracts: `plugin-config`).
- Realization: Allows Claude plugin agents as target-native companion files and rejects Codex plugin agents.
- Destination support: pass_through; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:346e436c1bca5be615c141ddb857b19f9024268eb804cc6211781c50f90cc2c7`.
- Standards: none recorded.
- Provider-native destination: `claude-subagent`.

```json
{
  "filePattern": ".claude/agents/*.md",
  "frontmatter": {
    "optionalFields": [
      "background",
      "color",
      "disallowedTools",
      "effort",
      "hooks",
      "initialPrompt",
      "isolation",
      "maxTurns",
      "mcpServers",
      "memory",
      "model",
      "permissionMode",
      "tools"
    ],
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "serialization": "markdown-with-yaml-frontmatter"
}
```

- Provider source: https://code.claude.com/docs/en/sub-agents

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: plugin-agents

- Canonical source: `plugin target-native agents/` (contracts: `plugin-config`).
- Realization: Allows Claude plugin agents as target-native companion files and rejects Codex plugin agents.
- Destination support: unsupported; fidelity: **unavailable**; evidence: **current**.
- Semantic scope: The pinned Codex plugin contract has no plugin agents component; Skillset cannot faithfully emit plugin-packaged agents there.
- Authority pin: `sha256:3f6aa2b11c6a28273a0d996c9ca99d22ccfd10b6038c87b15075f4c27fad5928`.
- Standards: none recorded.
- Provider-native destination: `codex-plugin`.

```json
{
  "components": [
    {
      "defaultPath": "skills/",
      "kind": "skills",
      "manifestField": "skills",
      "status": "native"
    },
    {
      "defaultPath": ".app.json",
      "kind": "apps",
      "manifestField": "apps",
      "status": "native"
    },
    {
      "defaultPath": ".mcp.json",
      "kind": "mcp",
      "manifestField": "mcpServers",
      "status": "native"
    },
    {
      "defaultPath": "hooks/hooks.json",
      "kind": "hooks",
      "manifestField": "hooks",
      "status": "native"
    },
    {
      "defaultPath": "assets/",
      "kind": "assets",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "agents/",
      "kind": "agents",
      "manifestField": null,
      "status": "unsupported"
    },
    {
      "defaultPath": "bin/",
      "kind": "bin",
      "manifestField": null,
      "status": "unsupported"
    }
  ],
  "manifest": {
    "interfaceFields": [
      "brandColor",
      "capabilities",
      "category",
      "composerIcon",
      "defaultPrompt",
      "developerName",
      "displayName",
      "logo",
      "logoDark",
      "longDescription",
      "privacyPolicyURL",
      "privacyPolicyUrl",
      "screenshots",
      "shortDescription",
      "termsOfServiceURL",
      "termsOfServiceUrl",
      "websiteURL",
      "websiteUrl"
    ],
    "authorFields": [
      "name",
      "email",
      "url"
    ],
    "path": ".codex-plugin/plugin.json",
    "requiredFields": [
      "name"
    ],
    "optionalFields": [
      "apps",
      "author",
      "description",
      "homepage",
      "hooks",
      "interface",
      "keywords",
      "license",
      "mcpServers",
      "repository",
      "skills",
      "version"
    ]
  },
  "pathRules": {
    "componentDirectoriesAtPluginRoot": true,
    "manifestPathsStartWith": "./",
    "metadataDirectory": ".codex-plugin/"
  }
}
```

- Provider source: https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/core-plugins/src/manifest.rs
- Provider source: https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/core-plugins/src/loader.rs
- Provider source: https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/core-plugins/src/loader_tests.rs
- Provider source: https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/skills/src/assets/samples/plugin-creator/scripts/validate_plugin.py
- Provider source: https://github.com/openai/codex/blob/be6e8eac029b183056b7e4402879f15d2c85f61b/codex-rs/skills/src/assets/samples/plugin-creator/references/plugin-json-spec.md

Limitations:

- This is a plugin-packaging limitation. It does not mean Codex project agents are unavailable.
- Reviewed implementation evidence is tracked with this capability; contributor locations are not bundled.
- Codex plugin documentation does not include a plugin agents component.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: plugin-agents

- Canonical source: `plugin target-native agents/` (contracts: `plugin-config`).
- Realization: Allows Claude plugin agents as target-native companion files and rejects Codex plugin agents.
- Destination support: pass_through; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:14c53e9127734f2292e0026c4019e0a3103382874303ae33a4f83a5d33c038ef`.
- Standards: none recorded.
- Provider-native destination: `cursor-agent`.

```json
{
  "filePattern": ".cursor/agents/*.md",
  "frontmatter": {
    "optionalFields": [
      "is_background",
      "model",
      "readonly",
      "skills"
    ],
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "serialization": "markdown-with-yaml-frontmatter"
}
```

- Provider source: https://cursor.com/docs/subagents
- Provider source: https://cursor.com/docs/reference/plugins
- Provider source: https://github.com/cursor/plugins

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

## plugin-manifests: Plugin identity and components

Family: plugins. Exact aliases: `plugins`, `plugin.json`.

### claude: plugin-manifests

- Canonical source: `.skillset/plugins/<plugin>/skillset.yaml` (contracts: `plugin-config`, `source-metadata`).
- Realization: Projects plugin metadata and component wiring into target-native plugin manifests.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:afb1541f84ed4711b832be01469d6315764600c956d8a5bb1eb78a980c957cb6`.
- Standards: agent-plugins-1.0.
- Provider-native destination: `claude-plugin`.

```json
{
  "components": [
    {
      "defaultPath": "skills/",
      "kind": "skills",
      "manifestField": "skills",
      "status": "native"
    },
    {
      "defaultPath": "commands/",
      "kind": "commands",
      "manifestField": "commands",
      "status": "native"
    },
    {
      "defaultPath": "agents/",
      "kind": "agents",
      "manifestField": "agents",
      "status": "native"
    },
    {
      "defaultPath": "hooks/hooks.json",
      "kind": "hooks",
      "manifestField": "hooks",
      "status": "native"
    },
    {
      "defaultPath": ".mcp.json",
      "kind": "mcp",
      "manifestField": "mcpServers",
      "status": "native"
    },
    {
      "defaultPath": ".lsp.json",
      "kind": "lsp",
      "manifestField": "lspServers",
      "status": "native"
    },
    {
      "defaultPath": "monitors/monitors.json",
      "kind": "monitors",
      "manifestField": "experimental.monitors",
      "status": "native"
    },
    {
      "defaultPath": "output-styles/",
      "kind": "output-styles",
      "manifestField": "outputStyles",
      "status": "native"
    },
    {
      "defaultPath": "themes/",
      "kind": "themes",
      "manifestField": "experimental.themes",
      "status": "native"
    },
    {
      "defaultPath": "bin/",
      "kind": "bin",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "settings.json",
      "kind": "settings",
      "manifestField": null,
      "status": "native"
    }
  ],
  "manifest": {
    "path": ".claude-plugin/plugin.json",
    "requiredFields": [
      "name",
      "description"
    ],
    "optionalFields": [
      "version",
      "author",
      "displayName",
      "homepage",
      "repository",
      "license"
    ],
    "unknownFields": "warn"
  },
  "pathRules": {
    "componentDirectoriesAtPluginRoot": true,
    "metadataDirectory": ".claude-plugin/"
  }
}
```

- Provider source: https://code.claude.com/docs/en/plugins
- Provider source: https://code.claude.com/docs/en/plugins-reference#metadata-fields
- Provider source: https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-arm64/-/claude-code-darwin-arm64-2.1.142.tgz
- Provider source: https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-arm64/-/claude-code-darwin-arm64-2.1.143.tgz

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: plugin-manifests

- Canonical source: `.skillset/plugins/<plugin>/skillset.yaml` (contracts: `plugin-config`, `source-metadata`).
- Realization: Projects plugin metadata and component wiring into target-native plugin manifests.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:6b45e3ad3ccd9d404240a55e3ededd73f1e79953de21119be69975708f858edb`.
- Standards: agent-plugins-1.0.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: plugin-manifests

- Canonical source: `.skillset/plugins/<plugin>/skillset.yaml` (contracts: `plugin-config`, `source-metadata`).
- Realization: Projects plugin metadata and component wiring into target-native plugin manifests.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:60de69f8369ffd9ae4f10121a682fd27c0168858476b790b617b7c8cdc862ba4`.
- Standards: agent-plugins-1.0.
- Provider-native destination: `cursor-plugin`.

```json
{
  "components": [
    {
      "defaultPath": "skills/",
      "kind": "skills",
      "manifestField": "skills",
      "status": "native"
    },
    {
      "defaultPath": "rules/",
      "kind": "rules",
      "manifestField": "rules",
      "status": "native"
    },
    {
      "defaultPath": "agents/",
      "kind": "agents",
      "manifestField": "agents",
      "status": "native"
    },
    {
      "defaultPath": "commands/",
      "kind": "commands",
      "manifestField": "commands",
      "status": "native"
    },
    {
      "defaultPath": "hooks/hooks.json",
      "kind": "hooks",
      "manifestField": "hooks",
      "status": "native"
    },
    {
      "defaultPath": "mcp.json",
      "kind": "mcp",
      "manifestField": "mcpServers",
      "status": "native"
    },
    {
      "defaultPath": "assets/",
      "kind": "assets",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "scripts/",
      "kind": "scripts",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "bin/",
      "kind": "bin",
      "manifestField": null,
      "status": "unsupported"
    }
  ],
  "manifest": {
    "authorFields": [
      "name",
      "email"
    ],
    "path": ".cursor-plugin/plugin.json",
    "requiredFields": [
      "name"
    ],
    "optionalFields": [
      "agents",
      "author",
      "category",
      "commands",
      "description",
      "displayName",
      "hooks",
      "homepage",
      "keywords",
      "license",
      "logo",
      "mcpServers",
      "minClientVersions",
      "publisher",
      "repository",
      "rules",
      "skills",
      "tags",
      "variables",
      "version"
    ]
  },
  "pathRules": {
    "componentDirectoriesAtPluginRoot": true,
    "metadataDirectory": ".cursor-plugin/"
  }
}
```

- Provider source: https://github.com/cursor/plugins/blob/2a8044425c7bddf429c3bdedf3ab61e791d34d65/schemas/plugin.schema.json

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

## plugin-mcp: Plugin MCP servers

Family: mcp. Exact aliases: `mcp`, `mcpServers`, `.mcp.json`, `http_headers`.

### claude: plugin-mcp

- Canonical source: `plugin mcp/source pointer or conventional .mcp.json` (contracts: `plugin-config`).
- Realization: Normalizes portable plugin MCP server definitions and renders them into generated provider plugin outputs.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:59b6322f2c6c258e6f8cf6ad20c93a7001abfa2b4a26755b8c64765c5d3b412b`.
- Standards: agent-plugins-1.0.
- Provider-native destination: `claude-plugin`.

```json
{
  "components": [
    {
      "defaultPath": "skills/",
      "kind": "skills",
      "manifestField": "skills",
      "status": "native"
    },
    {
      "defaultPath": "commands/",
      "kind": "commands",
      "manifestField": "commands",
      "status": "native"
    },
    {
      "defaultPath": "agents/",
      "kind": "agents",
      "manifestField": "agents",
      "status": "native"
    },
    {
      "defaultPath": "hooks/hooks.json",
      "kind": "hooks",
      "manifestField": "hooks",
      "status": "native"
    },
    {
      "defaultPath": ".mcp.json",
      "kind": "mcp",
      "manifestField": "mcpServers",
      "status": "native"
    },
    {
      "defaultPath": ".lsp.json",
      "kind": "lsp",
      "manifestField": "lspServers",
      "status": "native"
    },
    {
      "defaultPath": "monitors/monitors.json",
      "kind": "monitors",
      "manifestField": "experimental.monitors",
      "status": "native"
    },
    {
      "defaultPath": "output-styles/",
      "kind": "output-styles",
      "manifestField": "outputStyles",
      "status": "native"
    },
    {
      "defaultPath": "themes/",
      "kind": "themes",
      "manifestField": "experimental.themes",
      "status": "native"
    },
    {
      "defaultPath": "bin/",
      "kind": "bin",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "settings.json",
      "kind": "settings",
      "manifestField": null,
      "status": "native"
    }
  ],
  "manifest": {
    "path": ".claude-plugin/plugin.json",
    "requiredFields": [
      "name",
      "description"
    ],
    "optionalFields": [
      "version",
      "author",
      "displayName",
      "homepage",
      "repository",
      "license"
    ],
    "unknownFields": "warn"
  },
  "pathRules": {
    "componentDirectoriesAtPluginRoot": true,
    "metadataDirectory": ".claude-plugin/"
  }
}
```

- Provider source: https://code.claude.com/docs/en/plugins
- Provider source: https://code.claude.com/docs/en/plugins-reference#metadata-fields
- Provider source: https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-arm64/-/claude-code-darwin-arm64-2.1.142.tgz
- Provider source: https://registry.npmjs.org/@anthropic-ai/claude-code-darwin-arm64/-/claude-code-darwin-arm64-2.1.143.tgz

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: plugin-mcp

- Canonical source: `plugin mcp/source pointer or conventional .mcp.json` (contracts: `plugin-config`).
- Realization: Normalizes portable plugin MCP server definitions and renders them into generated provider plugin outputs.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:07ded587c642e2ac14a165f7927cb3627c83b19fd2dcd0d250d11e0ef695ba89`.
- Standards: agent-plugins-1.0.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: plugin-mcp

- Canonical source: `plugin mcp/source pointer or conventional .mcp.json` (contracts: `plugin-config`).
- Realization: Normalizes portable plugin MCP server definitions and renders them into generated provider plugin outputs.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:464ae03700c10e55a4cfef778b9b866c5e1e1feb64d0596b7774915eb984513e`.
- Standards: agent-plugins-1.0.
- Provider-native destination: `cursor-plugin`.

```json
{
  "components": [
    {
      "defaultPath": "skills/",
      "kind": "skills",
      "manifestField": "skills",
      "status": "native"
    },
    {
      "defaultPath": "rules/",
      "kind": "rules",
      "manifestField": "rules",
      "status": "native"
    },
    {
      "defaultPath": "agents/",
      "kind": "agents",
      "manifestField": "agents",
      "status": "native"
    },
    {
      "defaultPath": "commands/",
      "kind": "commands",
      "manifestField": "commands",
      "status": "native"
    },
    {
      "defaultPath": "hooks/hooks.json",
      "kind": "hooks",
      "manifestField": "hooks",
      "status": "native"
    },
    {
      "defaultPath": "mcp.json",
      "kind": "mcp",
      "manifestField": "mcpServers",
      "status": "native"
    },
    {
      "defaultPath": "assets/",
      "kind": "assets",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "scripts/",
      "kind": "scripts",
      "manifestField": null,
      "status": "native"
    },
    {
      "defaultPath": "bin/",
      "kind": "bin",
      "manifestField": null,
      "status": "unsupported"
    }
  ],
  "manifest": {
    "authorFields": [
      "name",
      "email"
    ],
    "path": ".cursor-plugin/plugin.json",
    "requiredFields": [
      "name"
    ],
    "optionalFields": [
      "agents",
      "author",
      "category",
      "commands",
      "description",
      "displayName",
      "hooks",
      "homepage",
      "keywords",
      "license",
      "logo",
      "mcpServers",
      "minClientVersions",
      "publisher",
      "repository",
      "rules",
      "skills",
      "tags",
      "variables",
      "version"
    ]
  },
  "pathRules": {
    "componentDirectoriesAtPluginRoot": true,
    "metadataDirectory": ".cursor-plugin/"
  }
}
```

- Provider source: https://github.com/cursor/plugins/blob/2a8044425c7bddf429c3bdedf3ab61e791d34d65/schemas/plugin.schema.json

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

## project-agents: Project agent instructions

Family: agents. Exact aliases: `subagents`, `developer_instructions`.

### claude: project-agents

- Canonical source: `.skillset/subagents/*.md` (contracts: `agent-frontmatter`).
- Realization: Renders portable project agents to Claude Markdown agents and Codex TOML agents.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:644a5f15375f229a844121e03366cf06277c5f719748c4d597d51baca3fb19b1`.
- Standards: none recorded.
- Provider-native destination: `claude-subagent`.

```json
{
  "filePattern": ".claude/agents/*.md",
  "frontmatter": {
    "optionalFields": [
      "background",
      "color",
      "disallowedTools",
      "effort",
      "hooks",
      "initialPrompt",
      "isolation",
      "maxTurns",
      "mcpServers",
      "memory",
      "model",
      "permissionMode",
      "tools"
    ],
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "serialization": "markdown-with-yaml-frontmatter"
}
```

- Provider source: https://code.claude.com/docs/en/sub-agents

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: project-agents

- Canonical source: `.skillset/subagents/*.md` (contracts: `agent-frontmatter`).
- Realization: Renders portable project agents to Claude Markdown agents and Codex TOML agents.
- Destination support: transformed; fidelity: **partial**; evidence: **current**.
- Semantic scope: Project-agent name, description and instructions receive native TOML fields; shared skill-loading intent is only an instruction preface.
- Authority pin: `sha256:e9a92d29967c45ac38282fbc0a79562c17a5a053016846278f6b32f3a57fc922`.
- Standards: none recorded.
- Provider-native destination: `codex-subagent`.

```json
{
  "filePattern": ".codex/agents/*.toml",
  "requiredFields": [
    "name",
    "description",
    "developer_instructions"
  ],
  "optionalFields": [
    "mcp_servers",
    "model",
    "model_reasoning_effort",
    "nickname_candidates",
    "sandbox_mode",
    "skills.config"
  ],
  "serialization": "toml"
}
```

- Provider source: https://developers.openai.com/codex/subagents

Limitations:

- The skills preface is advisory, not target-enforced skill metadata. Provider-only fields require explicit provider configuration.
- Reviewed implementation evidence is tracked with this capability; contributor locations are not bundled.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: project-agents

- Canonical source: `.skillset/subagents/*.md` (contracts: `agent-frontmatter`).
- Realization: Renders portable project agents to Claude Markdown agents and Codex TOML agents.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:32b457ca3edad5cc479822197015c1cba0c77e457017f277fca3765e3f6275e2`.
- Standards: none recorded.
- Provider-native destination: `cursor-agent`.

```json
{
  "filePattern": ".cursor/agents/*.md",
  "frontmatter": {
    "optionalFields": [
      "is_background",
      "model",
      "readonly",
      "skills"
    ],
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "serialization": "markdown-with-yaml-frontmatter"
}
```

- Provider source: https://cursor.com/docs/subagents
- Provider source: https://cursor.com/docs/reference/plugins
- Provider source: https://github.com/cursor/plugins

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

## project-rules: Scoped project instructions

Family: rules. Exact aliases: `rules`, `AGENTS.md`, `CLAUDE.md`, `alwaysApply`.

### claude: project-instructions

- Canonical source: `.skillset/rules/**/*.md` (contracts: `rule-frontmatter`).
- Realization: Renders project instructions to Claude rules and directory-local Codex AGENTS.md files.
- Destination support: transformed; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:b051907e5a13ab08c644896964f08c61181a5c0fcf033aac179a05f3d3513a19`.
- Standards: agent-instructions.
- Provider-native destination: none recorded.

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: project-instructions

- Canonical source: `.skillset/rules/**/*.md` (contracts: `rule-frontmatter`).
- Realization: Renders project instructions to Claude rules and directory-local Codex AGENTS.md files.
- Destination support: transformed; fidelity: **synthesized**; evidence: **current**.
- Semantic scope: Generated rules with literal directory scope and no paths narrowing are combined in deterministic source-path order into the directory AGENTS.md.
- Authority pin: `sha256:27b88d98ccdde2a51e3053e801f45afb90403bd60f0ccdc3173e9aa4997b4d08`.
- Standards: agent-instructions.
- Provider-native destination: `codex-agents-md`.

```json
{
  "discoveryOrder": [
    "AGENTS.override.md",
    "AGENTS.md",
    "project_doc_fallback_filenames"
  ],
  "filePattern": "AGENTS.md",
  "mergeOrder": "root-to-current-working-directory",
  "projectDocMaxBytesDefault": 32768,
  "serialization": "markdown"
}
```

- Provider source: https://developers.openai.com/codex/guides/agents-md

Limitations:

- This judgment excludes paths narrowing, which is degraded, and wildcard scopes, whose tree expansion and provider glob differences have separate render results. Native root AGENTS.md is read in place and is outside this synthesis judgment. Native context limits and AGENTS.override.md shadowing still apply.
- Reviewed implementation evidence is tracked with this capability; contributor locations are not bundled.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: project-instructions

- Canonical source: `.skillset/rules/**/*.md` (contracts: `rule-frontmatter`).
- Realization: Renders project instructions to Claude rules and directory-local Codex AGENTS.md files.
- Destination support: transformed; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:e6c2dc881e8a23c350bfe6bbe607892bd4491c1c3e759f3280a581ed9dc0b0e6`.
- Standards: agent-instructions.
- Provider-native destination: `cursor-rules`.

```json
{
  "filePattern": ".cursor/rules/*.mdc",
  "frontmatter": {
    "optionalFields": [
      "alwaysApply",
      "globs"
    ],
    "requiredFields": [
      "description"
    ]
  },
  "serialization": "markdown-with-yaml-frontmatter"
}
```

- Provider source: https://cursor.com/docs/rules

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

## skill-invocation: Implicit skill invocation

Family: skills. Exact aliases: `implicit_invocation`, `disable-model-invocation`, `allow_implicit_invocation`.

### claude: skill-invocation-policy

- Canonical source: `skill implicit_invocation frontmatter` (contracts: `skill-frontmatter`).
- Realization: Lowers canonical skill invocation eligibility into provider-native policy.
- Destination support: transformed; fidelity: **equivalent**; evidence: **current**.
- Semantic scope: The resolved implicit_invocation boolean is inverted into disable-model-invocation; false eligibility becomes true disablement and vice versa.
- Authority pin: `sha256:c384e48621d0185092326e37612ccc66426d143722ef9b00dc1a5233421704fc`.
- Standards: none recorded.
- Provider-native destination: `claude-skill`.

```json
{
  "directoryPattern": ".claude/skills/<skill-name>/",
  "frontmatter": {
    "optionalFields": [
      "allowed-tools",
      "arguments",
      "context",
      "description",
      "disable-model-invocation",
      "name",
      "user-invocable"
    ],
    "recommendedFields": [
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "examples/",
    "references/",
    "scripts/"
  ]
}
```

- Provider source: https://code.claude.com/docs/en/skills

Limitations:

- Scope is invocation eligibility only; this does not disable explicit user invocation or prove runtime enforcement. Explicit provider overrides are outside this judgment.
- Reviewed implementation evidence is tracked with this capability; contributor locations are not bundled.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: skill-invocation-policy

- Canonical source: `skill implicit_invocation frontmatter` (contracts: `skill-frontmatter`).
- Realization: Lowers canonical skill invocation eligibility into provider-native policy.
- Destination support: transformed; fidelity: **exact**; evidence: **current**.
- Semantic scope: The resolved implicit_invocation boolean is represented directly as policy.allow_implicit_invocation in agents/openai.yaml.
- Authority pin: `sha256:e33c782023491b69d1c0afa3d881b1f68f2f9cb1a64627250a8c41f3c0b48a9c`.
- Standards: none recorded.
- Provider-native destination: `codex-skill`.

```json
{
  "directoryPattern": ".agents/skills/<skill-name>/",
  "frontmatter": {
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "agents/",
    "assets/",
    "references/",
    "scripts/"
  ]
}
```

- Provider source: https://developers.openai.com/codex/skills

Limitations:

- Scope is invocation eligibility only, not model compliance or user invocation. Explicit provider overrides are outside this judgment.
- Reviewed implementation evidence is tracked with this capability; contributor locations are not bundled.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: skill-invocation-policy

- Canonical source: `skill implicit_invocation frontmatter` (contracts: `skill-frontmatter`).
- Realization: Lowers canonical skill invocation eligibility into provider-native policy.
- Destination support: transformed; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:50d66fa19d408e8acca39c4f9f4a6bdfec307cd7d5127f083da8a6ccb6da87b4`.
- Standards: none recorded.
- Provider-native destination: `cursor-skill`.

```json
{
  "directoryPattern": ".cursor/skills/<skill-name>/",
  "frontmatter": {
    "optionalFields": [
      "disable-model-invocation"
    ],
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "assets/",
    "references/",
    "scripts/"
  ]
}
```

- Provider source: https://cursor.com/docs/skills#frontmatter-fields
- Provider source: https://cursor.com/docs/plugins
- Provider source: https://github.com/cursor/plugins

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

## skills: Reusable skill content

Family: skills. Exact aliases: `skill`, `SKILL.md`.

### claude: plugin-skills

- Canonical source: `.skillset/plugins/<plugin>/skills/<skill>/SKILL.md` (contracts: `skill-frontmatter`).
- Realization: Preserves plugin-scoped skills inside each target plugin boundary.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:dedab445c5bbf38b0792d49d012b40286de014c5106ed1b32bce6c5b9666354a`.
- Standards: agent-skills.
- Provider-native destination: `claude-skill`.

```json
{
  "directoryPattern": ".claude/skills/<skill-name>/",
  "frontmatter": {
    "optionalFields": [
      "allowed-tools",
      "arguments",
      "context",
      "description",
      "disable-model-invocation",
      "name",
      "user-invocable"
    ],
    "recommendedFields": [
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "examples/",
    "references/",
    "scripts/"
  ]
}
```

- Provider source: https://code.claude.com/docs/en/skills

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: plugin-skills

- Canonical source: `.skillset/plugins/<plugin>/skills/<skill>/SKILL.md` (contracts: `skill-frontmatter`).
- Realization: Preserves plugin-scoped skills inside each target plugin boundary.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:3e114327eb00fbe95779924563acb8a3222fa7d8e697ceef6293f3e5e265a73c`.
- Standards: agent-skills.
- Provider-native destination: `codex-skill`.

```json
{
  "directoryPattern": ".agents/skills/<skill-name>/",
  "frontmatter": {
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "agents/",
    "assets/",
    "references/",
    "scripts/"
  ]
}
```

- Provider source: https://developers.openai.com/codex/skills

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: plugin-skills

- Canonical source: `.skillset/plugins/<plugin>/skills/<skill>/SKILL.md` (contracts: `skill-frontmatter`).
- Realization: Preserves plugin-scoped skills inside each target plugin boundary.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:a47c4d3c93c4bffc686384f29b5f6842b314d9560d696e01ebd5260245fe83fe`.
- Standards: agent-skills.
- Provider-native destination: `cursor-skill`.

```json
{
  "directoryPattern": ".cursor/skills/<skill-name>/",
  "frontmatter": {
    "optionalFields": [
      "disable-model-invocation"
    ],
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "assets/",
    "references/",
    "scripts/"
  ]
}
```

- Provider source: https://cursor.com/docs/skills#frontmatter-fields
- Provider source: https://cursor.com/docs/plugins
- Provider source: https://github.com/cursor/plugins

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### claude: standalone-skills

- Canonical source: `.skillset/skills/<skill>/SKILL.md` (contracts: `skill-frontmatter`).
- Realization: Projects standalone repo skills into configured target skill roots.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:9a5ad69eb3cedd42c4d50a73c5f486936b0ec0edac0be9ca041b07ef663f66c6`.
- Standards: agent-skills.
- Provider-native destination: `claude-skill`.

```json
{
  "directoryPattern": ".claude/skills/<skill-name>/",
  "frontmatter": {
    "optionalFields": [
      "allowed-tools",
      "arguments",
      "context",
      "description",
      "disable-model-invocation",
      "name",
      "user-invocable"
    ],
    "recommendedFields": [
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "examples/",
    "references/",
    "scripts/"
  ]
}
```

- Provider source: https://code.claude.com/docs/en/skills

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### codex: standalone-skills

- Canonical source: `.skillset/skills/<skill>/SKILL.md` (contracts: `skill-frontmatter`).
- Realization: Projects standalone repo skills into configured target skill roots.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:c720f4b75b4e4c53586aeb93967435501c084872f8ec77e5f1b26678d0e2e0e3`.
- Standards: agent-skills.
- Provider-native destination: `codex-skill`.

```json
{
  "directoryPattern": ".agents/skills/<skill-name>/",
  "frontmatter": {
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "agents/",
    "assets/",
    "references/",
    "scripts/"
  ]
}
```

- Provider source: https://developers.openai.com/codex/skills

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: standalone-skills

- Canonical source: `.skillset/skills/<skill>/SKILL.md` (contracts: `skill-frontmatter`).
- Realization: Projects standalone repo skills into configured target skill roots.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:9c896cc04c5597669def85d4940d2b292f9c1ff759b534dfb03cc4c799255d38`.
- Standards: agent-skills.
- Provider-native destination: `cursor-skill`.

```json
{
  "directoryPattern": ".cursor/skills/<skill-name>/",
  "frontmatter": {
    "optionalFields": [
      "disable-model-invocation"
    ],
    "requiredFields": [
      "name",
      "description"
    ]
  },
  "requiredFiles": [
    "SKILL.md"
  ],
  "serialization": "markdown-with-yaml-frontmatter",
  "supportingDirectories": [
    "assets/",
    "references/",
    "scripts/"
  ]
}
```

- Provider source: https://cursor.com/docs/skills#frontmatter-fields
- Provider source: https://cursor.com/docs/plugins
- Provider source: https://github.com/cursor/plugins

Limitations:

- No semantic evidence is recorded.
- No semantic fidelity judgment is recorded.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.
