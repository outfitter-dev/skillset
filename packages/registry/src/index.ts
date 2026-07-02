import { createHash } from "node:crypto";

export * from "./migrations";
export * from "./hook-evidence";
export * from "./schema-snapshots";

export const PROVIDER_DESTINATION_FORMAT_SNAPSHOT_SCHEMA = "skillset-provider-destination-format@1";

export const PROVIDER_DESTINATION_FORMAT_TARGETS = ["claude", "codex", "cursor"] as const;

export type ProviderDestinationFormatTarget = (typeof PROVIDER_DESTINATION_FORMAT_TARGETS)[number];

export type ProviderDestinationFormatSnapshotId =
  | "claude-hooks"
  | "claude-plugin"
  | "claude-skill"
  | "claude-subagent"
  | "codex-agents-md"
  | "codex-plugin"
  | "codex-skill"
  | "codex-subagent"
  | "cursor-agent"
  | "cursor-hooks"
  | "cursor-plugin"
  | "cursor-rules"
  | "cursor-skill";

export type ProviderDestinationFormatJsonValue =
  | boolean
  | number
  | string
  | null
  | readonly ProviderDestinationFormatJsonValue[]
  | { readonly [key: string]: ProviderDestinationFormatJsonValue };

export interface ProviderDestinationFormatSource {
  readonly note?: string;
  readonly url: string;
}

export interface ProviderDestinationFormatProvenance {
  readonly contentHash: string;
  readonly fetchedAt: string;
  readonly sources: readonly ProviderDestinationFormatSource[];
}

export interface ProviderDestinationFormatSnapshot {
  readonly destination: string;
  readonly format: ProviderDestinationFormatJsonValue;
  readonly id: ProviderDestinationFormatSnapshotId;
  readonly provenance: ProviderDestinationFormatProvenance;
  readonly schema: typeof PROVIDER_DESTINATION_FORMAT_SNAPSHOT_SCHEMA;
  readonly target: ProviderDestinationFormatTarget;
  readonly title: string;
}

const FETCHED_AT = "2026-06-23T09:31:27-04:00";
const validatedDestinationSnapshotHashes = new WeakMap<ProviderDestinationFormatSnapshot, string>();

const snapshots = [
  snapshot({
    destination: "plugin",
    format: {
      components: [
        { defaultPath: "skills/", kind: "skills", manifestField: "skills", status: "native" },
        { defaultPath: "commands/", kind: "commands", manifestField: "commands", status: "native" },
        { defaultPath: "agents/", kind: "agents", manifestField: "agents", status: "native" },
        { defaultPath: "hooks/hooks.json", kind: "hooks", manifestField: "hooks", status: "native" },
        { defaultPath: ".mcp.json", kind: "mcp", manifestField: "mcpServers", status: "native" },
        { defaultPath: ".lsp.json", kind: "lsp", manifestField: "lspServers", status: "native" },
        { defaultPath: "monitors/monitors.json", kind: "monitors", manifestField: "experimental.monitors", status: "native" },
        { defaultPath: "output-styles/", kind: "output-styles", manifestField: "outputStyles", status: "native" },
        { defaultPath: "themes/", kind: "themes", manifestField: "experimental.themes", status: "native" },
        { defaultPath: "bin/", kind: "bin", manifestField: null, status: "native" },
        { defaultPath: "settings.json", kind: "settings", manifestField: null, status: "native" },
      ],
      manifest: {
        path: ".claude-plugin/plugin.json",
        requiredFields: ["name", "description"],
        optionalFields: ["version", "author", "homepage", "repository", "license"],
        unknownFields: "warn",
      },
      pathRules: {
        componentDirectoriesAtPluginRoot: true,
        metadataDirectory: ".claude-plugin/",
      },
    },
    id: "claude-plugin",
    provenance: {
      contentHash: "sha256:c81a4328f9e1cba88b3496ae42181d03692186cefda4abd5d07428e15e835ae4",
      fetchedAt: FETCHED_AT,
      sources: [
        { url: "https://code.claude.com/docs/en/plugins" },
        { url: "https://code.claude.com/docs/en/plugins-reference" },
      ],
    },
    target: "claude",
    title: "Claude Plugin Destination Format",
  }),
  snapshot({
    destination: "skill",
    format: {
      directoryPattern: ".claude/skills/<skill-name>/",
      frontmatter: {
        optionalFields: [
          "allowed-tools",
          "arguments",
          "context",
          "description",
          "disable-model-invocation",
          "name",
          "user-invocable",
        ],
        recommendedFields: ["description"],
      },
      requiredFiles: ["SKILL.md"],
      serialization: "markdown-with-yaml-frontmatter",
      supportingDirectories: ["examples/", "references/", "scripts/"],
    },
    id: "claude-skill",
    provenance: {
      contentHash: "sha256:a67aece088a7d8b3baa57791ab66796f2479b207ddb1d01296fed73f99bae4bc",
      fetchedAt: FETCHED_AT,
      sources: [{ url: "https://code.claude.com/docs/en/skills" }],
    },
    target: "claude",
    title: "Claude Skill Destination Format",
  }),
  snapshot({
    destination: "agent",
    format: {
      filePattern: ".claude/agents/*.md",
      frontmatter: {
        optionalFields: [
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
          "tools",
        ],
        requiredFields: ["name", "description"],
      },
      serialization: "markdown-with-yaml-frontmatter",
    },
    id: "claude-subagent",
    provenance: {
      contentHash: "sha256:41303616b5d8d8f13b01380d224e4687846dbf68ae5c4c3ddd1fb80f4762f95a",
      fetchedAt: FETCHED_AT,
      sources: [{ url: "https://code.claude.com/docs/en/sub-agents" }],
    },
    target: "claude",
    title: "Claude Subagent Destination Format",
  }),
  snapshot({
    destination: "hooks",
    format: {
      filePattern: "hooks/hooks.json",
      handlerFields: ["type", "command", "prompt", "agent", "timeout", "async", "args"],
      rootFields: ["description", "hooks"],
      shape: "event-map",
      supportedHandlerTypes: ["agent", "command", "http", "mcp_tool", "prompt"],
    },
    id: "claude-hooks",
    provenance: {
      contentHash: "sha256:5ff4ac7c547bba9e9423524cf5befed46007e191a70ad62c94427aacd69d17bc",
      fetchedAt: FETCHED_AT,
      sources: [{ url: "https://code.claude.com/docs/en/hooks" }],
    },
    target: "claude",
    title: "Claude Hook Destination Format",
  }),
  snapshot({
    destination: "plugin",
    format: {
      components: [
        { defaultPath: "skills/", kind: "skills", manifestField: "skills", status: "native" },
        { defaultPath: ".app.json", kind: "apps", manifestField: "apps", status: "native" },
        { defaultPath: ".mcp.json", kind: "mcp", manifestField: "mcpServers", status: "native" },
        { defaultPath: "hooks/hooks.json", kind: "hooks", manifestField: "hooks", status: "native" },
        { defaultPath: "assets/", kind: "assets", manifestField: null, status: "native" },
        { defaultPath: "agents/", kind: "agents", manifestField: null, status: "unsupported" },
        { defaultPath: "bin/", kind: "bin", manifestField: null, status: "unsupported" },
      ],
      manifest: {
        interfaceFields: [
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
          "websiteURL",
        ],
        path: ".codex-plugin/plugin.json",
        requiredFields: ["name"],
        optionalFields: [
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
          "version",
        ],
      },
      pathRules: {
        componentDirectoriesAtPluginRoot: true,
        manifestPathsStartWith: "./",
        metadataDirectory: ".codex-plugin/",
      },
    },
    id: "codex-plugin",
    provenance: {
      contentHash: "sha256:ea1a87e3450a9c3959adfb9e1165fede2d9eca9fa9663d8e97f15d2a48ca3ae0",
      fetchedAt: FETCHED_AT,
      sources: [{ url: "https://developers.openai.com/codex/plugins/build" }],
    },
    target: "codex",
    title: "Codex Plugin Destination Format",
  }),
  snapshot({
    destination: "skill",
    format: {
      directoryPattern: ".agents/skills/<skill-name>/",
      frontmatter: {
        requiredFields: ["name", "description"],
      },
      requiredFiles: ["SKILL.md"],
      serialization: "markdown-with-yaml-frontmatter",
      supportingDirectories: ["agents/", "assets/", "references/", "scripts/"],
    },
    id: "codex-skill",
    provenance: {
      contentHash: "sha256:7e36cc613d0443fcae2963e276a7994d2b321b04471ae2a8941e290ed2654050",
      fetchedAt: FETCHED_AT,
      sources: [{ url: "https://developers.openai.com/codex/skills" }],
    },
    target: "codex",
    title: "Codex Skill Destination Format",
  }),
  snapshot({
    destination: "agent",
    format: {
      filePattern: ".codex/agents/*.toml",
      requiredFields: ["name", "description", "developer_instructions"],
      optionalFields: [
        "mcp_servers",
        "model",
        "model_reasoning_effort",
        "nickname_candidates",
        "sandbox_mode",
        "skills.config",
      ],
      serialization: "toml",
    },
    id: "codex-subagent",
    provenance: {
      contentHash: "sha256:45166b628859b5cecc6d2ecd78561d4ad73e58c4ab7c4cfddda53a3365867cb6",
      fetchedAt: FETCHED_AT,
      sources: [{ url: "https://developers.openai.com/codex/subagents" }],
    },
    target: "codex",
    title: "Codex Custom Agent Destination Format",
  }),
  snapshot({
    destination: "instructions",
    format: {
      discoveryOrder: ["AGENTS.override.md", "AGENTS.md", "project_doc_fallback_filenames"],
      filePattern: "AGENTS.md",
      mergeOrder: "root-to-current-working-directory",
      projectDocMaxBytesDefault: 32_768,
      serialization: "markdown",
    },
    id: "codex-agents-md",
    provenance: {
      contentHash: "sha256:3f6a53f45530261b0b2fafa705b1b01b8cc2b7c817eae3263226f2fd89fbae17",
      fetchedAt: FETCHED_AT,
      sources: [{ url: "https://developers.openai.com/codex/guides/agents-md" }],
    },
    target: "codex",
    title: "Codex Project Instructions Destination Format",
  }),
  snapshot({
    destination: "plugin",
    format: {
      components: [
        { defaultPath: "skills/", kind: "skills", manifestField: "skills", status: "native" },
        { defaultPath: "rules/", kind: "rules", manifestField: "rules", status: "native" },
        { defaultPath: "agents/", kind: "agents", manifestField: "agents", status: "native" },
        { defaultPath: "commands/", kind: "commands", manifestField: "commands", status: "native" },
        { defaultPath: "hooks/hooks.json", kind: "hooks", manifestField: "hooks", status: "native" },
        { defaultPath: "mcp.json", kind: "mcp", manifestField: "mcpServers", status: "native" },
        { defaultPath: "assets/", kind: "assets", manifestField: null, status: "native" },
        { defaultPath: "scripts/", kind: "scripts", manifestField: null, status: "native" },
        { defaultPath: "bin/", kind: "bin", manifestField: null, status: "unsupported" },
      ],
      manifest: {
        path: ".cursor-plugin/plugin.json",
        requiredFields: ["name", "description"],
        optionalFields: [
          "agents",
          "category",
          "commands",
          "displayName",
          "hooks",
          "logo",
          "mcpServers",
          "rules",
          "skills",
          "tags",
          "version",
        ],
      },
      pathRules: {
        componentDirectoriesAtPluginRoot: true,
        metadataDirectory: ".cursor-plugin/",
      },
    },
    id: "cursor-plugin",
    provenance: {
      contentHash: "sha256:1d87b97a074afb49078bda9fa1e399a653229001c134b8fe0a5a2937ccbde5f9",
      fetchedAt: FETCHED_AT,
      sources: [
        { url: "https://cursor.com/docs/plugins" },
        { url: "https://github.com/cursor/plugins" },
      ],
    },
    target: "cursor",
    title: "Cursor Plugin Destination Format",
  }),
  snapshot({
    destination: "skill",
    format: {
      directoryPattern: ".cursor/skills/<skill-name>/",
      frontmatter: {
        requiredFields: ["name", "description"],
      },
      requiredFiles: ["SKILL.md"],
      serialization: "markdown-with-yaml-frontmatter",
      supportingDirectories: ["assets/", "references/", "scripts/"],
    },
    id: "cursor-skill",
    provenance: {
      contentHash: "sha256:70eb2f6bac761f362c4895d71da72e9e5c047b9525f40214844e79122f569201",
      fetchedAt: FETCHED_AT,
      sources: [
        { url: "https://cursor.com/docs/plugins" },
        { url: "https://github.com/cursor/plugins" },
      ],
    },
    target: "cursor",
    title: "Cursor Skill Destination Format",
  }),
  snapshot({
    destination: "agent",
    format: {
      filePattern: ".cursor/agents/*.md",
      frontmatter: {
        optionalFields: ["is_background", "model", "readonly", "skills"],
        requiredFields: ["name", "description"],
      },
      serialization: "markdown-with-yaml-frontmatter",
    },
    id: "cursor-agent",
    provenance: {
      contentHash: "sha256:eb6d9afc41c0bb38724157466cab2a9a81809d5df477b85231df4ee7e190a5c0",
      fetchedAt: FETCHED_AT,
      sources: [
        { url: "https://cursor.com/docs/plugins" },
        { url: "https://github.com/cursor/plugins" },
      ],
    },
    target: "cursor",
    title: "Cursor Agent Destination Format",
  }),
  snapshot({
    destination: "instructions",
    format: {
      filePattern: ".cursor/rules/*.mdc",
      frontmatter: {
        optionalFields: ["alwaysApply", "globs"],
        requiredFields: ["description"],
      },
      serialization: "markdown-with-yaml-frontmatter",
    },
    id: "cursor-rules",
    provenance: {
      contentHash: "sha256:b02aeab7b95d881cd961dfb8c34a5f1e32d2368f234c27d6d2eb65d74e995bd3",
      fetchedAt: FETCHED_AT,
      sources: [{ url: "https://cursor.com/docs/rules" }],
    },
    target: "cursor",
    title: "Cursor Rules Destination Format",
  }),
  snapshot({
    destination: "hooks",
    format: {
      canonicalEventNames: "skillset-pascal-case",
      nativeEventNames: "cursor-lower-camel",
      filePattern: "hooks/hooks.json",
      handlerFields: ["type", "command", "timeout"],
      rootFields: ["hooks"],
      shape: "event-map",
      supportedHandlerTypes: ["command"],
    },
    id: "cursor-hooks",
    provenance: {
      contentHash: "sha256:9bc3b608cc0ebc7ce09e52754c69ac1148290d8165d778e488abb138654cda19",
      fetchedAt: FETCHED_AT,
      sources: [{ url: "https://cursor.com/docs/hooks" }],
    },
    target: "cursor",
    title: "Cursor Hook Destination Format",
  }),
] as const satisfies readonly ProviderDestinationFormatSnapshot[];

export const providerDestinationFormatSnapshots = defineProviderDestinationFormatSnapshots(snapshots);

export function defineProviderDestinationFormatSnapshots(
  entries: readonly ProviderDestinationFormatSnapshot[]
): readonly ProviderDestinationFormatSnapshot[] {
  assertProviderDestinationFormatSnapshots(entries);
  return [...entries].sort((left, right) => left.id.localeCompare(right.id)).map((entry) => {
    const hash = hashProviderDestinationFormatSnapshot(entry);
    const frozen = deepFreeze(entry);
    validatedDestinationSnapshotHashes.set(frozen, hash);
    return frozen;
  });
}

export function listProviderDestinationFormatSnapshots(): readonly ProviderDestinationFormatSnapshot[] {
  return providerDestinationFormatSnapshots;
}

export function getProviderDestinationFormatSnapshot(
  id: ProviderDestinationFormatSnapshotId
): ProviderDestinationFormatSnapshot | undefined {
  return providerDestinationFormatSnapshots.find((snapshot) => snapshot.id === id);
}

export function assertProviderDestinationFormatSnapshots(
  entries: readonly ProviderDestinationFormatSnapshot[]
): void {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`skillset: duplicate provider destination format snapshot ${entry.id}`);
    ids.add(entry.id);
    if (entry.schema !== PROVIDER_DESTINATION_FORMAT_SNAPSHOT_SCHEMA) {
      throw new Error(`skillset: unsupported provider destination format snapshot schema ${entry.schema}`);
    }
    if (!PROVIDER_DESTINATION_FORMAT_TARGETS.includes(entry.target)) {
      throw new Error(`skillset: unsupported provider destination format target ${entry.target}`);
    }
    if (entry.provenance.sources.length === 0) {
      throw new Error(`skillset: provider destination format snapshot ${entry.id} requires at least one source`);
    }
    for (const source of entry.provenance.sources) {
      if (!/^https:\/\//u.test(source.url)) {
        throw new Error(`skillset: provider destination format snapshot ${entry.id} source must be an https URL`);
      }
    }
    const actualHash = hashProviderDestinationFormatSnapshot(entry);
    if (entry.provenance.contentHash !== actualHash) {
      throw new Error(
        `skillset: provider destination format snapshot ${entry.id} hash drifted; expected ${entry.provenance.contentHash}, got ${actualHash}`
      );
    }
  }
}

export function hashProviderDestinationFormatSnapshot(
  snapshot: ProviderDestinationFormatSnapshot
): string {
  const validatedHash = validatedDestinationSnapshotHashes.get(snapshot);
  if (validatedHash !== undefined) return validatedHash;
  return `sha256:${createHash("sha256").update(normalizeProviderDestinationFormatSnapshot(snapshot)).digest("hex")}`;
}

export function normalizeProviderDestinationFormatSnapshot(
  snapshot: ProviderDestinationFormatSnapshot
): string {
  const { contentHash: _contentHash, ...provenance } = snapshot.provenance;
  return `${stableStringify({
    destination: snapshot.destination,
    format: snapshot.format,
    id: snapshot.id,
    provenance,
    schema: snapshot.schema,
    target: snapshot.target,
    title: snapshot.title,
  })}\n`;
}

function snapshot(
  input: Omit<ProviderDestinationFormatSnapshot, "schema">
): ProviderDestinationFormatSnapshot {
  return {
    schema: PROVIDER_DESTINATION_FORMAT_SNAPSHOT_SCHEMA,
    ...input,
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

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}
