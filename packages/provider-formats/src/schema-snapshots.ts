import { createHash } from "node:crypto";

export const PROVIDER_SCHEMA_SNAPSHOT_SCHEMA = "skillset-provider-schema@1";

export const PROVIDER_SCHEMA_TARGETS = ["claude", "codex"] as const;

export type ProviderSchemaTarget = (typeof PROVIDER_SCHEMA_TARGETS)[number];

export type ProviderSchemaSnapshotId =
  | "claude-keybindings-schema"
  | "claude-marketplace-schema"
  | "claude-plugin-manifest-schema"
  | "claude-settings-schema"
  | "codex-config-schema"
  | "codex-hook-event-schemas"
  | "codex-hooks-schema"
  | "codex-skill-metadata-schema";

export type ProviderSchemaManualOverlayId =
  | "claude-skill-frontmatter-overlay"
  | "claude-subagent-frontmatter-overlay"
  | "codex-agents-md-overlay"
  | "codex-plugin-manifest-overlay"
  | "codex-subagent-toml-overlay";

export type ProviderSchemaJsonValue =
  | boolean
  | number
  | string
  | null
  | readonly ProviderSchemaJsonValue[]
  | { readonly [key: string]: ProviderSchemaJsonValue };

export interface ProviderSchemaSource {
  readonly contentHash: string;
  readonly note?: string;
  readonly url: string;
}

export interface ProviderSchemaProvenance {
  readonly contentHash: string;
  readonly fetchedAt: string;
  readonly rollingLatest: true;
  readonly sources: readonly ProviderSchemaSource[];
}

export interface ProviderJsonSchemaSummary {
  readonly definitions?: readonly string[];
  readonly id?: string;
  readonly properties?: readonly string[];
  readonly required?: readonly string[];
  readonly schemaUri: string;
  readonly title?: string;
  readonly topLevelType?: string;
}

export interface ProviderSchemaSetEntry {
  readonly contentHash: string;
  readonly name: string;
  readonly properties: readonly string[];
  readonly required: readonly string[];
  readonly title: string;
  readonly url: string;
}

export interface ProviderSchemaSetSummary {
  readonly entries: readonly ProviderSchemaSetEntry[];
  readonly repositoryPath: string;
  readonly schemaCount: number;
}

export interface ProviderSchemaManualOverlay {
  readonly formatSnapshotId:
    | "claude-skill"
    | "claude-subagent"
    | "codex-agents-md"
    | "codex-plugin"
    | "codex-subagent";
  readonly id: ProviderSchemaManualOverlayId;
  readonly note: string;
  readonly sources: readonly { readonly url: string }[];
  readonly target: ProviderSchemaTarget;
}

export interface ProviderSchemaSnapshot {
  readonly destination: string;
  readonly id: ProviderSchemaSnapshotId;
  readonly provenance: ProviderSchemaProvenance;
  readonly schema: typeof PROVIDER_SCHEMA_SNAPSHOT_SCHEMA;
  readonly summary: ProviderJsonSchemaSummary | ProviderSchemaSetSummary;
  readonly target: ProviderSchemaTarget;
  readonly title: string;
}

const FETCHED_AT = "2026-06-23T09:51:15-04:00";

const schemaSnapshots = [
  schemaSnapshot({
    destination: "settings",
    id: "claude-settings-schema",
    provenance: {
      contentHash: "sha256:1f885d9a1517f9a591c48ea7c260f90b303677524a194e230aaa1f55d6b82dc1",
      fetchedAt: FETCHED_AT,
      rollingLatest: true,
      sources: [
        {
          contentHash: "sha256:22ffdfc7013b40b9fefdfd9df4af889a096ed0c5bf23607484526f291439b8f8",
          url: "https://json.schemastore.org/claude-code-settings.json",
        },
      ],
    },
    summary: {
      definitions: ["hookCommand", "hookMatcher", "permissionRule"],
      id: "https://json.schemastore.org/claude-code-settings.json",
      properties: [
        "$schema",
        "agent",
        "allowManagedHooksOnly",
        "allowManagedMcpServersOnly",
        "allowManagedPermissionRulesOnly",
        "allowedChannelPlugins",
        "allowedHttpHookUrls",
        "allowedMcpServers",
        "alwaysThinkingEnabled",
        "apiKeyHelper",
        "attribution",
        "autoMemoryDirectory",
        "autoMemoryEnabled",
        "autoMode",
        "autoUpdatesChannel",
        "availableModels",
        "awsAuthRefresh",
        "awsCredentialExport",
        "blockedMarketplaces",
        "channelsEnabled",
        "claudeMdExcludes",
        "cleanupPeriodDays",
        "companyAnnouncements",
        "defaultShell",
        "deniedMcpServers",
        "disableAllHooks",
        "disableDeepLinkRegistration",
        "disableSkillShellExecution",
        "disabledMcpjsonServers",
        "effortLevel",
        "enableAllProjectMcpServers",
        "enabledMcpjsonServers",
        "enabledPlugins",
        "env",
        "extraKnownMarketplaces",
        "fastMode",
        "fastModePerSessionOptIn",
        "feedbackSurveyRate",
        "fileSuggestion",
        "forceLoginMethod",
        "forceLoginOrgUUID",
        "forceRemoteSettingsRefresh",
        "hooks",
        "httpHookAllowedEnvVars",
        "includeCoAuthoredBy",
        "includeGitInstructions",
        "language",
        "minimumVersion",
        "model",
        "modelOverrides",
        "otelHeadersHelper",
        "outputStyle",
        "parentSettingsBehavior",
        "permissions",
        "plansDirectory",
        "pluginConfigs",
        "pluginTrustMessage",
        "prUrlTemplate",
        "prefersReducedMotion",
        "respectGitignore",
        "sandbox",
        "showClearContextOnPlanAccept",
        "showThinkingSummaries",
        "showTurnDuration",
        "skillOverrides",
        "skipDangerousModePermissionPrompt",
        "skipWebFetchPreflight",
        "skippedMarketplaces",
        "skippedPlugins",
        "spinnerTipsEnabled",
        "spinnerTipsOverride",
        "spinnerVerbs",
        "statusLine",
        "strictKnownMarketplaces",
        "strictPluginOnlyCustomization",
        "subagentStatusLine",
        "teammateMode",
        "terminalProgressBarEnabled",
        "tui",
        "useAutoModeDuringPlan",
        "viewMode",
        "voiceEnabled",
        "worktree",
        "wslInheritsWindowsSettings",
      ],
      schemaUri: "http://json-schema.org/draft-07/schema#",
      title: "Claude Code Settings",
      topLevelType: "object",
    },
    target: "claude",
    title: "Claude Code Settings JSON Schema",
  }),
  schemaSnapshot({
    destination: "plugin-manifest",
    id: "claude-plugin-manifest-schema",
    provenance: {
      contentHash: "sha256:2a83eaad328540a7850c59cb422d82008e98391d47a1bba386f285c8c6679b14",
      fetchedAt: FETCHED_AT,
      rollingLatest: true,
      sources: [
        {
          contentHash: "sha256:3f69938d71a47a72fa60050b2050dd620054708911defc1c1dcd7188dcb169f5",
          url: "https://json.schemastore.org/claude-code-plugin-manifest.json",
        },
      ],
    },
    summary: {
      id: "https://json.schemastore.org/claude-code-plugin-manifest.json",
      properties: [
        "$schema",
        "agents",
        "author",
        "channels",
        "commands",
        "dependencies",
        "description",
        "homepage",
        "hooks",
        "keywords",
        "license",
        "lspServers",
        "mcpServers",
        "monitors",
        "name",
        "outputStyles",
        "repository",
        "settings",
        "skills",
        "themes",
        "userConfig",
        "version",
      ],
      required: ["name"],
      schemaUri: "http://json-schema.org/draft-07/schema#",
      title: "Claude Code Plugin Manifest",
      topLevelType: "object",
    },
    target: "claude",
    title: "Claude Code Plugin Manifest JSON Schema",
  }),
  schemaSnapshot({
    destination: "marketplace",
    id: "claude-marketplace-schema",
    provenance: {
      contentHash: "sha256:4fc9f71550f0c498cfa92d020a516b0165bdbcb2f5f54904654bf9e42346f805",
      fetchedAt: FETCHED_AT,
      rollingLatest: true,
      sources: [
        {
          contentHash: "sha256:42c3f80413638e93a420256d942f409104b651379b9ac2451cc636f581de2ffc",
          url: "https://json.schemastore.org/claude-code-marketplace.json",
        },
      ],
    },
    summary: {
      id: "https://json.schemastore.org/claude-code-marketplace.json",
      properties: [
        "$schema",
        "allowCrossMarketplaceDependenciesOn",
        "description",
        "forceRemoveDeletedPlugins",
        "metadata",
        "name",
        "owner",
        "plugins",
        "version",
      ],
      required: ["name", "owner", "plugins"],
      schemaUri: "http://json-schema.org/draft-07/schema#",
      title: "Claude Code Plugin Marketplace",
      topLevelType: "object",
    },
    target: "claude",
    title: "Claude Code Plugin Marketplace JSON Schema",
  }),
  schemaSnapshot({
    destination: "keybindings",
    id: "claude-keybindings-schema",
    provenance: {
      contentHash: "sha256:6d90e9e2531c3ed69181d65eae4f68c7228aa5023876eaeee7b6a28aa4da4768",
      fetchedAt: FETCHED_AT,
      rollingLatest: true,
      sources: [
        {
          contentHash: "sha256:93d4f2926fa9f116287dbb90904901e01aa243012c7a84ee0c95c874835d9e3a",
          url: "https://json.schemastore.org/claude-code-keybindings.json",
        },
      ],
    },
    summary: {
      definitions: [
        "bindingValue",
        "builtinAction",
        "commandBinding",
        "context",
        "keybindingBlock",
        "keystrokePattern",
      ],
      id: "https://json.schemastore.org/claude-code-keybindings.json",
      properties: ["$docs", "$schema", "bindings"],
      required: ["bindings"],
      schemaUri: "http://json-schema.org/draft-07/schema#",
      title: "Claude Code Keybindings",
      topLevelType: "object",
    },
    target: "claude",
    title: "Claude Code Keybindings JSON Schema",
  }),
  schemaSnapshot({
    destination: "config",
    id: "codex-config-schema",
    provenance: {
      contentHash: "sha256:9ae0e3d495832ec9d3f0a70b78ab9c40ecc92d15e37fc25aecc07bc2be3e517e",
      fetchedAt: FETCHED_AT,
      rollingLatest: true,
      sources: [
        {
          contentHash: "sha256:7ab046a490d84eab883b5c90c0320d884200a45f694ea20d7852c3282840e2ef",
          url: "https://developers.openai.com/codex/config-schema.json",
        },
      ],
    },
    summary: {
      definitions: [
        "AbsolutePathBuf",
        "AgentsToml",
        "ConfigProfile",
        "HookHandlerConfig",
        "HooksToml",
        "MarketplaceConfig",
        "PermissionsToml",
        "PluginConfig",
        "ProjectConfig",
        "SandboxMode",
        "SkillConfig",
        "ToolsToml",
        "TrustLevel",
      ],
      properties: [
        "agents",
        "approval_policy",
        "apps",
        "features",
        "hooks",
        "marketplaces",
        "mcp_servers",
        "model",
        "model_provider",
        "model_providers",
        "permissions",
        "plugins",
        "project_doc_fallback_filenames",
        "project_doc_max_bytes",
        "projects",
        "sandbox_mode",
        "skills",
        "tools",
      ],
      schemaUri: "http://json-schema.org/draft-07/schema#",
      title: "ConfigToml",
      topLevelType: "object",
    },
    target: "codex",
    title: "Codex Config TOML JSON Schema",
  }),
  schemaSnapshot({
    destination: "hooks",
    id: "codex-hooks-schema",
    provenance: {
      contentHash: "sha256:7822f2ce5f0d18972f24f844f4b38c45830f3bd3924fa85f23b5d7e2ae478de6",
      fetchedAt: FETCHED_AT,
      rollingLatest: true,
      sources: [
        {
          contentHash: "sha256:427fb2f56736f26045527a0c7418e7f2d23ae7cc7d3545cbb7d957644ee94d0e",
          url: "https://json.schemastore.org/codex-hooks.json",
        },
      ],
    },
    summary: {
      definitions: [
        "commandHandler",
        "hookHandler",
        "matcherGroup",
        "matcherGroups",
        "skippedHandler",
      ],
      id: "https://json.schemastore.org/codex-hooks.json",
      properties: ["hooks"],
      required: ["hooks"],
      schemaUri: "http://json-schema.org/draft-07/schema#",
      title: "Codex hooks configuration",
      topLevelType: "object",
    },
    target: "codex",
    title: "Codex Hooks JSON Schema",
  }),
  schemaSnapshot({
    destination: "hook-events",
    id: "codex-hook-event-schemas",
    provenance: {
      contentHash: "sha256:93d7f080f1d1e20aa4ba3acb1aae3b6bb2d46d741711e2b522fa4098e9af0045",
      fetchedAt: FETCHED_AT,
      rollingLatest: true,
      sources: [
        {
          contentHash: "sha256:c60f0fbc16dff2e0c0eb3967db4a653b1e839fd9a98a3815d84c71fc14dda245",
          note: "Directory listing for generated Codex hook event input/output schemas.",
          url: "https://api.github.com/repos/openai/codex/contents/codex-rs/hooks/schema/generated",
        },
      ],
    },
    summary: {
      entries: [
        eventSchema("permission-request.command.input.schema.json", "permission-request.command.input", "sha256:75c73d7a38cfc0e73ef06bd1fc506a44d25874522069ec4fb85e0bf1e7d6b8fb", ["cwd", "hook_event_name", "model", "permission_mode", "session_id", "tool_input", "tool_name", "transcript_path", "turn_id"], ["agent_id", "agent_type", "cwd", "hook_event_name", "model", "permission_mode", "session_id", "tool_input", "tool_name", "transcript_path", "turn_id"]),
        eventSchema("permission-request.command.output.schema.json", "permission-request.command.output", "sha256:749c73245b4b6d43537c3049f76720ab1c2bd48d7e4752b744b376925b9d57a1", [], ["continue", "hookSpecificOutput", "stopReason", "suppressOutput", "systemMessage"]),
        eventSchema("post-compact.command.input.schema.json", "post-compact.command.input", "sha256:4a4b3f3022c939a15ab12e95f5c5c17b18bb20f74fe962ae0a51b2a3e76e63f9", ["cwd", "hook_event_name", "model", "session_id", "transcript_path", "trigger", "turn_id"], ["agent_id", "agent_type", "cwd", "hook_event_name", "model", "session_id", "transcript_path", "trigger", "turn_id"]),
        eventSchema("post-compact.command.output.schema.json", "post-compact.command.output", "sha256:48355bfcb568259cf396beb6ade2ac32827f50bf6a3c20b395c337dce184cbed", [], ["continue", "stopReason", "suppressOutput", "systemMessage"]),
        eventSchema("post-tool-use.command.input.schema.json", "post-tool-use.command.input", "sha256:8ea1e4bccb262fad05b85c300d562d2653c5a64118d6a2c5704468fc4ea836a9", ["cwd", "hook_event_name", "model", "permission_mode", "session_id", "tool_input", "tool_name", "tool_response", "tool_use_id", "transcript_path", "turn_id"], ["agent_id", "agent_type", "cwd", "hook_event_name", "model", "permission_mode", "session_id", "tool_input", "tool_name", "tool_response", "tool_use_id", "transcript_path", "turn_id"]),
        eventSchema("post-tool-use.command.output.schema.json", "post-tool-use.command.output", "sha256:a823d0e2c941e98d7d3af825dfdb0b1dfa6a935696ff8b8529e8e83232a1b0c8", [], ["continue", "decision", "hookSpecificOutput", "reason", "stopReason", "suppressOutput", "systemMessage"]),
        eventSchema("pre-compact.command.input.schema.json", "pre-compact.command.input", "sha256:065f0ae3cd628ac9af8c0cf9bd1d5a673bcbd5ea1d7dcdc0c6437f34dd0189d9", ["cwd", "hook_event_name", "model", "session_id", "transcript_path", "trigger", "turn_id"], ["agent_id", "agent_type", "cwd", "hook_event_name", "model", "session_id", "transcript_path", "trigger", "turn_id"]),
        eventSchema("pre-compact.command.output.schema.json", "pre-compact.command.output", "sha256:c392f3054ae6750f427d4dec07380fd67e8c58a7939a35d5c69bfa070c7ca032", [], ["continue", "stopReason", "suppressOutput", "systemMessage"]),
        eventSchema("pre-tool-use.command.input.schema.json", "pre-tool-use.command.input", "sha256:fabed428f0fe75767c5700208b166da5faef4e031d601dfc8bff2f96d340c682", ["cwd", "hook_event_name", "model", "permission_mode", "session_id", "tool_input", "tool_name", "tool_use_id", "transcript_path", "turn_id"], ["agent_id", "agent_type", "cwd", "hook_event_name", "model", "permission_mode", "session_id", "tool_input", "tool_name", "tool_use_id", "transcript_path", "turn_id"]),
        eventSchema("pre-tool-use.command.output.schema.json", "pre-tool-use.command.output", "sha256:e684f81c63fbb5972892f6a848b49fec68c8ce137931651093d2dd1da56a1dd6", [], ["continue", "decision", "hookSpecificOutput", "reason", "stopReason", "suppressOutput", "systemMessage"]),
        eventSchema("session-start.command.input.schema.json", "session-start.command.input", "sha256:690c0eef7c9f3ddcd41e24207b81b362101a300b4abec076b990a1cd79a66e20", ["cwd", "hook_event_name", "model", "permission_mode", "session_id", "source", "transcript_path"], ["cwd", "hook_event_name", "model", "permission_mode", "session_id", "source", "transcript_path"]),
        eventSchema("session-start.command.output.schema.json", "session-start.command.output", "sha256:f375e6de1c59ecbabd8c1aff05a67976d0f3aa2ef061808838de4c7c20be1c71", [], ["continue", "hookSpecificOutput", "stopReason", "suppressOutput", "systemMessage"]),
        eventSchema("stop.command.input.schema.json", "stop.command.input", "sha256:7db4793c404b5c46b230c27b9507eb1a558fd958689d8715221c5dd81351a06a", ["cwd", "hook_event_name", "last_assistant_message", "model", "permission_mode", "session_id", "stop_hook_active", "transcript_path", "turn_id"], ["cwd", "hook_event_name", "last_assistant_message", "model", "permission_mode", "session_id", "stop_hook_active", "transcript_path", "turn_id"]),
        eventSchema("stop.command.output.schema.json", "stop.command.output", "sha256:dc2b30e84c97beca5825aa64ca46e1337e402781dc5a9142b67111d10523f15c", [], ["continue", "decision", "reason", "stopReason", "suppressOutput", "systemMessage"]),
        eventSchema("subagent-start.command.input.schema.json", "subagent-start.command.input", "sha256:ce7dc9b5ae8826d1e0c59ffcea793e558aebceb7917a2eb9bb2edd8a7ac37aa9", ["agent_id", "agent_type", "cwd", "hook_event_name", "model", "permission_mode", "session_id", "transcript_path", "turn_id"], ["agent_id", "agent_type", "cwd", "hook_event_name", "model", "permission_mode", "session_id", "transcript_path", "turn_id"]),
        eventSchema("subagent-start.command.output.schema.json", "subagent-start.command.output", "sha256:34e8ec95393d2aa930d7932a34c3fb29a5e5f90c264fdbcc581393c5838b4660", [], ["continue", "hookSpecificOutput", "stopReason", "suppressOutput", "systemMessage"]),
        eventSchema("subagent-stop.command.input.schema.json", "subagent-stop.command.input", "sha256:94dc8df29f4691195ac2338ae6de876230e5100a10b94ef48df4e732424b5df5", ["agent_id", "agent_transcript_path", "agent_type", "cwd", "hook_event_name", "last_assistant_message", "model", "permission_mode", "session_id", "stop_hook_active", "transcript_path", "turn_id"], ["agent_id", "agent_transcript_path", "agent_type", "cwd", "hook_event_name", "last_assistant_message", "model", "permission_mode", "session_id", "stop_hook_active", "transcript_path", "turn_id"]),
        eventSchema("subagent-stop.command.output.schema.json", "subagent-stop.command.output", "sha256:8ba2cd7899ae4544193764e67e988235edebe984abe5788634d123bbf13e3e3a", [], ["continue", "decision", "reason", "stopReason", "suppressOutput", "systemMessage"]),
        eventSchema("user-prompt-submit.command.input.schema.json", "user-prompt-submit.command.input", "sha256:e6b923bc519896197c44c4fc267a9d115cef24ac418dde9c27db699f4e3b65fd", ["cwd", "hook_event_name", "model", "permission_mode", "prompt", "session_id", "transcript_path", "turn_id"], ["agent_id", "agent_type", "cwd", "hook_event_name", "model", "permission_mode", "prompt", "session_id", "transcript_path", "turn_id"]),
        eventSchema("user-prompt-submit.command.output.schema.json", "user-prompt-submit.command.output", "sha256:5e290303db710f3ccc12f4a2744e8586e7749b3ca2b6bf9f57781ed75bf17b2b", [], ["continue", "decision", "hookSpecificOutput", "reason", "stopReason", "suppressOutput", "systemMessage"]),
      ],
      repositoryPath: "openai/codex/codex-rs/hooks/schema/generated",
      schemaCount: 20,
    },
    target: "codex",
    title: "Codex Hook Event JSON Schema Set",
  }),
  schemaSnapshot({
    destination: "skill-metadata",
    id: "codex-skill-metadata-schema",
    provenance: {
      contentHash: "sha256:eebe9ca02eec5263cd23ff3945b3d3301e0b57861af2d53c76bd620b83ae355b",
      fetchedAt: FETCHED_AT,
      rollingLatest: true,
      sources: [
        {
          contentHash: "sha256:512803fcf05ff56d00109a1e885088718a13f682bb8fb08ff3e45058040bf406",
          url: "https://json.schemastore.org/codex-skill-metadata.json",
        },
      ],
    },
    summary: {
      definitions: ["toolDependency"],
      id: "https://json.schemastore.org/codex-skill-metadata.json",
      properties: ["$schema", "dependencies", "interface", "policy"],
      schemaUri: "http://json-schema.org/draft-07/schema#",
      title: "Codex skill metadata",
      topLevelType: "object",
    },
    target: "codex",
    title: "Codex Skill Metadata JSON Schema",
  }),
] as const satisfies readonly ProviderSchemaSnapshot[];

export const providerSchemaSnapshots = defineProviderSchemaSnapshots(schemaSnapshots);

export const providerSchemaManualOverlays = [
  manualOverlay({
    formatSnapshotId: "claude-skill",
    id: "claude-skill-frontmatter-overlay",
    note: "Claude skill structure is currently documented in prose; no adopted JSON Schema source is available.",
    sources: [{ url: "https://code.claude.com/docs/en/skills" }],
    target: "claude",
  }),
  manualOverlay({
    formatSnapshotId: "claude-subagent",
    id: "claude-subagent-frontmatter-overlay",
    note: "Claude subagent Markdown/frontmatter structure is currently documented in prose; no adopted JSON Schema source is available.",
    sources: [{ url: "https://code.claude.com/docs/en/sub-agents" }],
    target: "claude",
  }),
  manualOverlay({
    formatSnapshotId: "codex-plugin",
    id: "codex-plugin-manifest-overlay",
    note: "Codex plugin manifest structure is currently documented in prose; no adopted JSON Schema source is available.",
    sources: [{ url: "https://developers.openai.com/codex/plugins/build" }],
    target: "codex",
  }),
  manualOverlay({
    formatSnapshotId: "codex-subagent",
    id: "codex-subagent-toml-overlay",
    note: "Codex custom agent TOML structure is currently documented in prose; no adopted JSON Schema source is available.",
    sources: [{ url: "https://developers.openai.com/codex/subagents" }],
    target: "codex",
  }),
  manualOverlay({
    formatSnapshotId: "codex-agents-md",
    id: "codex-agents-md-overlay",
    note: "Codex AGENTS.md discovery and merge behavior is currently documented in prose; no adopted JSON Schema source is available.",
    sources: [{ url: "https://developers.openai.com/codex/guides/agents-md" }],
    target: "codex",
  }),
] as const satisfies readonly ProviderSchemaManualOverlay[];

export function listProviderSchemaSnapshots(): readonly ProviderSchemaSnapshot[] {
  return providerSchemaSnapshots;
}

export function getProviderSchemaSnapshot(id: ProviderSchemaSnapshotId): ProviderSchemaSnapshot | undefined {
  return providerSchemaSnapshots.find((snapshot) => snapshot.id === id);
}

export function defineProviderSchemaSnapshots(
  entries: readonly ProviderSchemaSnapshot[]
): readonly ProviderSchemaSnapshot[] {
  assertProviderSchemaSnapshots(entries);
  return [...entries].sort((left, right) => left.id.localeCompare(right.id));
}

export function assertProviderSchemaSnapshots(entries: readonly ProviderSchemaSnapshot[]): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`skillset: duplicate provider schema snapshot ${entry.id}`);
    ids.add(entry.id);
    if (entry.schema !== PROVIDER_SCHEMA_SNAPSHOT_SCHEMA) {
      throw new Error(`skillset: unsupported provider schema snapshot schema ${entry.schema}`);
    }
    if (!PROVIDER_SCHEMA_TARGETS.includes(entry.target)) {
      throw new Error(`skillset: unsupported provider schema target ${entry.target}`);
    }
    if (entry.provenance.sources.length === 0) {
      throw new Error(`skillset: provider schema snapshot ${entry.id} requires at least one source`);
    }
    for (const source of entry.provenance.sources) {
      if (!/^sha256:[0-9a-f]{64}$/u.test(source.contentHash)) {
        throw new Error(`skillset: provider schema snapshot ${entry.id} source hash is invalid`);
      }
      if (!/^https:\/\//u.test(source.url)) {
        throw new Error(`skillset: provider schema snapshot ${entry.id} source must be an https URL`);
      }
    }
    const actualHash = hashProviderSchemaSnapshot(entry);
    if (entry.provenance.contentHash !== actualHash) {
      throw new Error(`skillset: provider schema snapshot ${entry.id} hash drifted; expected ${entry.provenance.contentHash}, got ${actualHash}`);
    }
  }
}

export function hashProviderSchemaSnapshot(snapshot: ProviderSchemaSnapshot): string {
  return `sha256:${createHash("sha256").update(normalizeProviderSchemaSnapshot(snapshot)).digest("hex")}`;
}

export function normalizeProviderSchemaSnapshot(snapshot: ProviderSchemaSnapshot): string {
  const { contentHash: _contentHash, ...provenance } = snapshot.provenance;
  return `${stableStringify({
    destination: snapshot.destination,
    id: snapshot.id,
    provenance,
    schema: snapshot.schema,
    summary: snapshot.summary,
    target: snapshot.target,
    title: snapshot.title,
  })}\n`;
}

function schemaSnapshot(input: Omit<ProviderSchemaSnapshot, "schema">): ProviderSchemaSnapshot {
  return {
    schema: PROVIDER_SCHEMA_SNAPSHOT_SCHEMA,
    ...input,
  };
}

function manualOverlay(input: ProviderSchemaManualOverlay): ProviderSchemaManualOverlay {
  return input;
}

function eventSchema(
  name: string,
  title: string,
  contentHash: string,
  required: readonly string[],
  properties: readonly string[]
): ProviderSchemaSetEntry {
  return {
    contentHash,
    name,
    properties,
    required,
    title,
    url: `https://raw.githubusercontent.com/openai/codex/main/codex-rs/hooks/schema/generated/${name}`,
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortJson(record[key] ?? null);
  }
  return sorted;
}
