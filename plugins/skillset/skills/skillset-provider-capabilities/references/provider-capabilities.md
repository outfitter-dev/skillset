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

### claude: plugin-manifests

- Canonical source: `.skillset/plugins/<plugin>/skillset.yaml` (contracts: none).
- Realization: Projects plugin metadata and component wiring into target-native plugin manifests.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:4d6b62adf26fd148e691bdf1491915922172ee110b15d83e6cba214493cebb08`.
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
- Authority pin: `sha256:8fd801d278d9620d53bf8faff79ac56dcdbfffa0ebfdf830ee7807288c7e5023`.
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
- Authority pin: `sha256:30404c36e84d718005023ee0d35737f4a5bf6dc10d3d5bca00d1ad3584e6242d`.
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
- Authority pin: `sha256:0ab0977b2bb6ae38dfa5dac57cb2a9da3161b20a2cc72ab07df13705eecf47d4`.
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
- Authority pin: `sha256:ef3450cf0acca893e57573737a2a604f49c402c740c695cae881830e020403a4`.
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
- Authority pin: `sha256:a6831e927ddf521f6c1ecf2da2866a38bc7586883180d6d14e74ccede3c05586`.
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

### claude: plugin-skills

- Canonical source: `.skillset/plugins/<plugin>/skills/<skill>/SKILL.md` (contracts: none).
- Realization: Preserves plugin-scoped skills inside each target plugin boundary.
- Destination support: native; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:6c38d5cb4af370e552c19e312d55dd033846124a7018fcbb92102bd0b6d7e118`.
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
- Authority pin: `sha256:012f3bfaa7d2f6453268d033a83370fa4ad82726e57392692fe25afa6b3779e3`.
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
- Authority pin: `sha256:c5c11d51d0927cef098b3e1627700ae376d6374e7c1a5df1c2f0a8063bbe431c`.
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
- Authority pin: `sha256:19713db35fc38ff601965fb3ad88fa98e74d9e9c3cc3bf744f48c14915046a33`.
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
- Authority pin: `sha256:4500e43d394277cbf810c2f23487f75e23c05c0d9140fc43b972e9ab41983730`.
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
- Authority pin: `sha256:52e4dcb0722acf4ccc4a6d2aa2f071cd05701320fa64688747b859737dd4ee96`.
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
- Semantic scope: Claude-native plugin hook declarations retain Claude event and handler semantics through validated pass-through.
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

- The declaration is provider-native; identically spelled events on other providers do not establish equivalence. Use adaptive hooks for explicitly supported adaptation.
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
- Authority pin: `sha256:f832da96e35b42b4720357ad0120621856b0a0630d8a680c3da6d282b6f8c41d`.
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
- Authority pin: `sha256:89cf22a19c3f2ce9990b2015738328565695b9d935b79004797448ff34b49542`.
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
      "longDescription",
      "privacyPolicyURL",
      "screenshots",
      "shortDescription",
      "termsOfServiceURL",
      "websiteURL"
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
- Authority pin: `sha256:644a981dfc902dadd6c3293d895d31483dd4f88faa9553f9ff0eab40e9d4481d`.
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
- Authority pin: `sha256:7ec5ccc338a008de2bf53b9f85178aecab730378f04561003f6c5d6d2330df9b`.
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
- Authority pin: `sha256:02eb42a7620040886d92dfffd64962a6a902b8f87119d65b73de15d22847d3bc`.
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
- Authority pin: `sha256:f17fc3f6cd47eef3a9604bf1584ecbd484596ebc99360ef72edaebe4298e9e50`.
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
- Authority pin: `sha256:57a03cbb0e8f4066f145493c31ed50c7d40ef057947ff193d4d9a742c5c99d14`.
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
- Authority pin: `sha256:a5700c5e9c647c3ba22970fd7bab4e7c15fcc293613cd1f4fd4a8ffaabc65217`.
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
- Authority pin: `sha256:296785739b9377d5142e2c09b9b0c01ef3b56e1edb82febccdb31ca28a32cd8f`.
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
- Authority pin: `sha256:88ac71776f81b9c3e033e9d6a28ec7b4660eecbbb7ce6ac839c21fe7da3433e0`.
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
- Authority pin: `sha256:e0334f3d7d50f07395dcf19d04261e1d9e62dc4eb7785eb1688d9327f9e1c241`.
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
- Authority pin: `sha256:6381e426d15b3a87912d851d94e56633b94724f34d699844dbc3e1c59c043da8`.
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
- Authority pin: `sha256:4fe43077ec8067cf6d2175bde8abfe0f1d45269c07ba5cc774209cabb647de21`.
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
- Authority pin: `sha256:1c7c37291996f44896222e680259fe9f9fcb196735d529d18d65fee97c42bba4`.
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

- This judgment excludes paths narrowing, which is degraded, and wildcard scopes, which are unsupported. Native root AGENTS.md is read in place and is outside this synthesis judgment. Native context limits and AGENTS.override.md shadowing still apply.
- Reviewed implementation evidence is tracked with this capability; contributor locations are not bundled.
- Fidelity is scoped to the pinned registry contract and reviewed implementation. The regression gate requires re-review when cited implementation files change; lookup does not inspect source files in an installed package.
- Destination support and build output do not prove runtime activation or effectiveness.

### cursor: project-instructions

- Canonical source: `.skillset/rules/**/*.md` (contracts: `rule-frontmatter`).
- Realization: Renders project instructions to Claude rules and directory-local Codex AGENTS.md files.
- Destination support: transformed; fidelity: **unknown**; evidence: **missing**.
- Semantic scope: No reviewed semantic scope is recorded.
- Authority pin: `sha256:bab163fb69f4e69511d88e69e85e513cb65dd52bc71d02e795197ba36ded1b96`.
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
- Authority pin: `sha256:8ef90765af35eee69eabc5d166e12f82afe0b6b72859a2e7d7cd2bb41b523bce`.
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
- Authority pin: `sha256:86162871ff9d4e0de5c9cddf498cdeb564cd5adb90018a8e60eb809a4f1bb4d7`.
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
- Authority pin: `sha256:61f618390d3ae32a2f3bed08a1baebadba32e289e374f21b799c7c545c5e013d`.
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
- Authority pin: `sha256:f36335eb72fce6e9b9b0e3830e3d292d03fcf57f36784b003c135d43424be2c5`.
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
- Authority pin: `sha256:3efa4d76dd574586e592720c347f62ca6b69f81f949bd9c93509e21c698585a4`.
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
- Authority pin: `sha256:e7f8c3faab8f3252f295a8679b49681d97f33b4b78d5d1cd9d442cb62f6e731f`.
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
- Authority pin: `sha256:998e75a20bc0b0cb49b42d8a392734b170e16a3d6b86b7c46285a861384e571b`.
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
- Authority pin: `sha256:77a68bdd1c12b638b8191b2be87ab9499740b6d1d77588c2a8ee65005f8fef61`.
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
- Authority pin: `sha256:ecd6b6c05ac90158682f8dba1b4f7781143a634ac93395046245cf5520299acc`.
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
