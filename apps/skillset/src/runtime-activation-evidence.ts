import type { ActivationProofClaim } from "@skillset/schema";

export const RUNTIME_ACTIVATION_EVIDENCE_CAPABILITIES = [
  "mcp-server",
] as const satisfies readonly ActivationProofClaim["capability"][];

export function supportsRuntimeActivationEvidence(
  claim: ActivationProofClaim
): boolean {
  return RUNTIME_ACTIVATION_EVIDENCE_CAPABILITIES.some(
    (capability) => capability === claim.capability
  );
}

/**
 * Extracts only provider-structured invocation evidence. Final response text
 * and authored assertions are intentionally excluded: they cannot prove that
 * the named runtime subject was exercised.
 */
export function runtimeActivationEvidence(
  target: "claude" | "codex" | "cursor",
  stdout: string
): readonly ActivationProofClaim[] {
  const evidence = new Map<string, ActivationProofClaim>();
  const records = jsonRecords(stdout);
  for (const value of records) {
    if (target === "codex") {
      collectCodexEvidence(value, evidence);
    }
  }
  if (target !== "codex") collectToolUseEvidence(records, evidence);
  return [...evidence.values()].toSorted(compareEvidence);
}

function collectCodexEvidence(
  value: Record<string, unknown>,
  evidence: Map<string, ActivationProofClaim>
): void {
  if (value.type !== "item.completed" || !isRecord(value.item)) return;
  const item = value.item;
  if (
    item.type !== "mcp_tool_call" ||
    (item.error !== undefined && item.error !== null)
  ) {
    return;
  }
  const server = readNonEmptyString(item.server);
  if (server !== undefined) addMcpEvidence(server, evidence);
}

function collectToolUseEvidence(
  values: readonly Record<string, unknown>[],
  evidence: Map<string, ActivationProofClaim>
): void {
  const requestedServers = new Map<string, string>();
  const successfulResults = new Set<string>();

  for (const value of values) {
    if (!isRecord(value.message)) continue;
    const content = value.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (value.type === "assistant" && block.type === "tool_use") {
        const id = readNonEmptyString(block.id);
        const name = readNonEmptyString(block.name);
        const server = name === undefined ? undefined : mcpServerFromToolName(name);
        if (id !== undefined && server !== undefined) {
          requestedServers.set(id, server);
        }
      }
      if (
        value.type === "user" &&
        block.type === "tool_result" &&
        (block.is_error === undefined || block.is_error === false)
      ) {
        const id = readNonEmptyString(block.tool_use_id);
        if (id !== undefined) successfulResults.add(id);
      }
    }
  }

  for (const id of successfulResults) {
    const server = requestedServers.get(id);
    if (server !== undefined) addMcpEvidence(server, evidence);
  }
}

function addMcpEvidence(
  subject: string,
  evidence: Map<string, ActivationProofClaim>
): void {
  const claim = { capability: "mcp-server", subject } as const;
  evidence.set(`${claim.capability}\0${claim.subject}`, claim);
}

function mcpServerFromToolName(name: string): string | undefined {
  const match =
    /^mcp__(?<server>[^_][A-Za-z0-9._-]*)__[^_].*$/u.exec(name);
  return match?.groups?.server;
}

function jsonRecords(stdout: string): readonly Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const candidate of [stdout.trim(), ...stdout.split(/\r?\n/u)]) {
    if (candidate.trim().length === 0) continue;
    try {
      const value = JSON.parse(candidate) as unknown;
      if (isRecord(value)) records.push(value);
    } catch {
      // Provider output may mix diagnostics and JSONL.
    }
  }
  return records;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function compareEvidence(
  left: ActivationProofClaim,
  right: ActivationProofClaim
): number {
  return (
    left.capability.localeCompare(right.capability) ||
    left.subject.localeCompare(right.subject)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
