import { PROVIDER_SCHEMA_TARGETS } from "./schema-snapshots";
import type { ProviderSchemaTarget } from "./schema-snapshots";

export type ProviderMcpEvidenceTarget = ProviderSchemaTarget;

export interface ProviderMcpEvidenceSource {
  readonly note: string;
  readonly url: string;
}

/** Provider-native MCP spellings consumed directly by the core renderer seam. */
export interface ProviderMcpEvidence {
  readonly dataPlaceholder: string | null;
  readonly observedAt: string;
  readonly providerName: string;
  readonly providerVersion: string;
  readonly remoteHeadersField: "headers" | "http_headers";
  readonly rootPlaceholder: string;
  readonly sources: readonly ProviderMcpEvidenceSource[];
  readonly sseType: "sse" | null;
  readonly stdioCwd: boolean;
  readonly stdioType: "stdio" | null;
  readonly streamableHttpType: "http" | null;
  readonly target: ProviderMcpEvidenceTarget;
}

const entries = [
  {
    dataPlaceholder: "CLAUDE_PLUGIN_DATA",
    observedAt: "2026-09-12",
    providerName: "Claude Code",
    providerVersion: "2.1.269",
    remoteHeadersField: "headers",
    rootPlaceholder: "CLAUDE_PLUGIN_ROOT",
    sources: [
      {
        note:
          "Official MCP transport and plugin variable documentation; the documented stdio substitution fields exclude cwd.",
        url: "https://code.claude.com/docs/en/mcp",
      },
    ],
    sseType: "sse",
    stdioCwd: false,
    stdioType: null,
    streamableHttpType: "http",
    target: "claude",
  },
  {
    dataPlaceholder: "PLUGIN_DATA",
    observedAt: "2026-09-12",
    providerName: "Codex",
    providerVersion: "0.154.0",
    remoteHeadersField: "http_headers",
    rootPlaceholder: "PLUGIN_ROOT",
    sources: [
      {
        note: "Immutable released adapter source for Agent Plugins MCP conversion and SSE rejection.",
        url: "https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/codex-mcp/src/agent_plugin_config.rs",
      },
    ],
    sseType: null,
    stdioCwd: true,
    stdioType: null,
    streamableHttpType: null,
    target: "codex",
  },
  {
    dataPlaceholder: null,
    observedAt: "2026-09-12",
    providerName: "Cursor",
    providerVersion: "plugins docs observed 2026-09-12",
    remoteHeadersField: "headers",
    rootPlaceholder: "PLUGIN_ROOT",
    sources: [
      {
        note: "Official plugin MCP discovery and variable documentation.",
        url: "https://cursor.com/docs/reference/plugins",
      },
      {
        note: "Immutable official Cursor plugin authoring schema.",
        url: "https://raw.githubusercontent.com/cursor/plugins/2a8044425c7bddf429c3bdedf3ab61e791d34d65/schemas/plugin.schema.json",
      },
    ],
    sseType: "sse",
    stdioCwd: true,
    stdioType: "stdio",
    streamableHttpType: null,
    target: "cursor",
  },
] as const satisfies readonly ProviderMcpEvidence[];

export const providerMcpEvidence = defineProviderMcpEvidence(entries);

export function defineProviderMcpEvidence(
  evidence: readonly ProviderMcpEvidence[]
): readonly ProviderMcpEvidence[] {
  const targets = new Set<ProviderMcpEvidenceTarget>();
  for (const entry of evidence) {
    if (targets.has(entry.target)) {
      throw new Error(
        `skillset: duplicate provider MCP evidence ${entry.target}`
      );
    }
    targets.add(entry.target);
    if (
      entry.sources.length === 0 ||
      entry.sources.some((source) => !source.url.startsWith("https://"))
    ) {
      throw new Error(
        `skillset: provider MCP evidence ${entry.target} requires HTTPS sources`
      );
    }
  }
  for (const target of PROVIDER_SCHEMA_TARGETS) {
    if (!targets.has(target)) {
      throw new Error(`skillset: missing provider MCP evidence ${target}`);
    }
  }
  return evidence;
}

export function listProviderMcpEvidence(): readonly ProviderMcpEvidence[] {
  return providerMcpEvidence;
}

export function getProviderMcpEvidence(
  target: ProviderMcpEvidenceTarget
): ProviderMcpEvidence {
  const evidence = providerMcpEvidence.find((entry) => entry.target === target);
  if (evidence === undefined) {
    throw new Error(`skillset: missing provider MCP evidence ${target}`);
  }
  return evidence;
}
