import type {
  ActivationCapability,
  ActivationRequirementStage,
  ActivationRequirementState,
} from "@skillset/core";
import type { ProviderActivationClaim } from "@skillset/core";

export interface ActivationParsedFact {
  readonly claim: ProviderActivationClaim;
  readonly stage: ActivationRequirementStage;
  readonly state: ActivationRequirementState;
  readonly subject: string;
}

export interface ActivationParserRequest {
  readonly capability: ActivationCapability;
  readonly inspectorId: string;
  readonly subjects: readonly string[];
  readonly stdout: string;
}

export interface ActivationParserResult {
  readonly facts: readonly ActivationParsedFact[];
  readonly outcome: "malformed" | "ran";
  readonly summary: string;
}

type JsonRecord = Record<string, unknown>;

export function parseActivationInspectorOutput(
  request: ActivationParserRequest
): ActivationParserResult {
  switch (request.inspectorId) {
    case "claude.plugin.list":
      return parsePluginInventory(request);
    case "codex.plugin.list":
      return parsePluginInventory(request);
    case "codex.mcp.list":
      return parseJsonMcpInventory(request);
    case "claude.mcp.list":
      return parseTextMcpStatus(request);
    case "cursor.mcp.list":
      return parseTextMcpStatus(request);
    case "cursor.status":
      return parseCursorStatus(request);
    default:
      return malformed("the registry inspector has no activation parser");
  }
}

function parsePluginInventory(
  request: ActivationParserRequest
): ActivationParserResult {
  const parsed = parseJson(request.stdout);
  if (parsed === undefined)
    return malformed("provider output was not valid JSON");
  const entries = pluginEntries(parsed);
  if (entries === undefined) {
    return malformed("provider plugin inventory used an unknown shape");
  }

  const facts = request.subjects.flatMap((subject) => {
    const entry = entries.find((candidate) =>
      pluginAliases(candidate).includes(subject)
    );
    if (entry === undefined) {
      return [fact(subject, "discoverable", "missing")];
    }
    const enabled = readBoolean(entry, "enabled");
    return [
      fact(subject, "discoverable", "satisfied"),
      ...(enabled === undefined
        ? []
        : [fact(subject, "enabled", enabled ? "satisfied" : "missing")]),
    ];
  });

  return ran(facts, `parsed ${entries.length} plugin inventory entries`);
}

function parseJsonMcpInventory(
  request: ActivationParserRequest
): ActivationParserResult {
  const parsed = parseJson(request.stdout);
  if (parsed === undefined)
    return malformed("provider output was not valid JSON");
  const names = mcpNames(parsed);
  if (names === undefined) {
    return malformed("provider MCP inventory used an unknown shape");
  }
  return ran(
    request.subjects.map((subject) =>
      names.has(subject)
        ? fact(subject, "discoverable", "satisfied")
        : fact(subject, "discoverable", "missing")
    ),
    `parsed ${names.size} configured MCP server names`
  );
}

function parseTextMcpStatus(
  request: ActivationParserRequest
): ActivationParserResult {
  const lines = request.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return malformed("provider MCP status output was empty");
  }
  if (lines.every((line) => isEmptyMcpInventory(line))) {
    return ran(
      request.subjects.map((subject) =>
        fact(subject, "discoverable", "missing")
      ),
      "parsed an empty MCP inventory"
    );
  }
  const entries = lines.map(parseTextMcpEntry);
  if (
    lines.some((line) => isEmptyMcpInventory(line)) ||
    entries.some((entry) => entry === undefined)
  ) {
    return malformed("provider MCP status output used an unknown shape");
  }

  const facts = request.subjects.flatMap((subject) => {
    const entry = entries.find((candidate) => candidate?.name === subject);
    if (entry === undefined) {
      return [fact(subject, "discoverable", "missing")];
    }
    const connected = connectionState(entry.status);
    return [
      fact(subject, "discoverable", "satisfied"),
      ...(connected === undefined
        ? []
        : [fact(subject, "connected", connected ? "satisfied" : "missing")]),
    ];
  });

  return ran(facts, `parsed ${lines.length} bounded MCP status lines`);
}

function parseCursorStatus(
  request: ActivationParserRequest
): ActivationParserResult {
  const parsed = parseJson(request.stdout);
  if (!isRecord(parsed)) {
    return malformed("Cursor status output used an unknown shape");
  }
  const authenticated =
    readBoolean(parsed, "authenticated") ??
    readBoolean(parsed, "isAuthenticated") ??
    (typeof parsed.status === "string"
      ? statusAuthentication(parsed.status)
      : undefined);
  if (authenticated === undefined) {
    return malformed("Cursor status did not expose an allowlisted auth field");
  }
  if (!authenticated) {
    return ran(
      request.subjects.map((subject) =>
        fact(subject, "authenticated", "missing")
      ),
      "Cursor reported an unauthenticated session"
    );
  }
  return ran(
    request.subjects.map((subject) =>
      fact(subject, "authenticated", "satisfied")
    ),
    "Cursor reported an authenticated session"
  );
}

function isEmptyMcpInventory(line: string): boolean {
  return /^No MCP servers configured(?:[.!](?:\s+.*)?|\s+\([^)]*\))?$/iu.test(
    line
  );
}

function pluginEntries(value: unknown): readonly JsonRecord[] | undefined {
  if (Array.isArray(value)) {
    return identifiedPluginEntries(value);
  }
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.installed))
    return identifiedPluginEntries(value.installed);
  if (Array.isArray(value.plugins))
    return identifiedPluginEntries(value.plugins);
  return undefined;
}

function identifiedPluginEntries(
  value: readonly unknown[]
): readonly JsonRecord[] | undefined {
  const entries = strictRecords(value);
  return entries?.every((entry) => pluginAliases(entry).length > 0)
    ? entries
    : undefined;
}

function pluginAliases(entry: JsonRecord): readonly string[] {
  const name = readString(entry, "name");
  const pluginId = readString(entry, "pluginId") ?? readString(entry, "id");
  const marketplace =
    readString(entry, "marketplaceName") ?? readString(entry, "marketplace");
  return [
    pluginId,
    name,
    name !== undefined && marketplace !== undefined
      ? `${marketplace}/${name}`
      : undefined,
    name !== undefined && marketplace !== undefined
      ? `${name}@${marketplace}`
      : undefined,
  ].filter((value): value is string => value !== undefined);
}

function mcpNames(value: unknown): ReadonlySet<string> | undefined {
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.servers)
      ? value.servers
      : isRecord(value) && Array.isArray(value.mcpServers)
        ? value.mcpServers
        : undefined;
  if (candidates !== undefined) {
    const entries = strictRecords(candidates);
    if (entries === undefined) return undefined;
    const names = entries
      .map((entry) => readString(entry, "name"))
      .filter((name): name is string => name !== undefined);
    return names.length === entries.length ? new Set(names) : undefined;
  }
  const record =
    isRecord(value) && isRecord(value.servers)
      ? value.servers
      : isRecord(value) && isRecord(value.mcpServers)
        ? value.mcpServers
        : undefined;
  return record === undefined ? undefined : new Set(Object.keys(record));
}

function parseTextMcpEntry(
  line: string
): { readonly name: string; readonly status: string } | undefined {
  const match =
    /^(?:[✓✔✗✘○●⏸]\s*)?([^\s:]+)(?::|\s+-\s+)(.*)$/u.exec(line);
  const name = match?.[1]?.trim();
  if (!name) return undefined;
  return { name, status: match?.[2]?.trim() ?? "" };
}

function connectionState(line: string): boolean | undefined {
  if (
    /\b(?:disconnected|failed|error|pending|rejected|disabled|not (?:configured|connected|ready|healthy|running)|unavailable)\b/iu.test(
      line
    )
  ) {
    return false;
  }
  if (/\b(?:connected|ready|healthy|running)\b/iu.test(line)) return true;
  return undefined;
}

function statusAuthentication(value: string): boolean | undefined {
  if (/^(?:authenticated|logged[_ -]?in)$/iu.test(value)) return true;
  if (
    /^(?:unauthenticated|logged[_ -]?out|authentication required)$/iu.test(
      value
    )
  ) {
    return false;
  }
  return undefined;
}

function fact(
  subject: string,
  stage: ActivationRequirementStage,
  state: ActivationRequirementState
): ActivationParsedFact {
  return {
    claim: stage as ProviderActivationClaim,
    stage,
    state,
    subject,
  };
}

function ran(
  facts: readonly ActivationParsedFact[],
  summary: string
): ActivationParserResult {
  return { facts, outcome: "ran", summary };
}

function malformed(summary: string): ActivationParserResult {
  return { facts: [], outcome: "malformed", summary };
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function strictRecords(
  value: readonly unknown[]
): readonly JsonRecord[] | undefined {
  return value.every(isRecord) ? value : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(value: JsonRecord, key: string): boolean | undefined {
  return typeof value[key] === "boolean" ? value[key] : undefined;
}

function readString(value: JsonRecord, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : undefined;
}
