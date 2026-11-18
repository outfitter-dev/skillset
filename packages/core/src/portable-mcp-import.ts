import type { ImportNormalizationCode } from "@skillset/schema";
import type { JsonRecord, JsonValue, TargetName } from "./types";
import { isJsonRecord } from "./yaml";

export interface McpNormalizationChange {
  readonly code: ImportNormalizationCode;
  readonly sourcePointer: string;
  readonly destinationPointer: string;
  readonly occurrences: number;
}

/** Reverse a provider MCP dialect into Skillset's canonical portable source. */
export function normalizeImportedMcpSource(
  value: JsonValue,
  target: TargetName | "agent-plugins"
): { readonly source: JsonRecord; readonly changes: readonly McpNormalizationChange[] } {
  const changes: McpNormalizationChange[] = [];
  if (!isJsonRecord(value)) {
    throw new Error("skillset: imported MCP source must contain a JSON object");
  }
  const { mcpServers } = value;
  if (!isJsonRecord(mcpServers)) {
    throw new Error(
      "skillset: imported MCP source mcpServers must contain a JSON object"
    );
  }
  const rootFields = Object.keys(value).filter(
    (field) => field !== "$schema" && field !== "mcpServers"
  );
  if (rootFields.length > 0) {
    throw new Error(
      `skillset: imported MCP source has unmappable root fields: ${rootFields.toSorted().join(", ")}`
    );
  }

  const source = {
    ...(value.$schema === undefined ? {} : { $schema: value.$schema }),
    mcpServers: Object.fromEntries(
      Object.keys(mcpServers)
        .toSorted()
        .map((name) => {
          const raw = mcpServers[name];
          if (!isJsonRecord(raw)) {
            throw new Error(
              `skillset: imported MCP server ${name} must contain a JSON object`
            );
          }
          return [name, normalizeImportedServer(raw, target, name, changes)];
        })
    ),
  };
  return { source, changes };
}

function normalizeImportedServer(
  raw: JsonRecord,
  target: TargetName | "agent-plugins",
  name: string,
  changes: McpNormalizationChange[]
): JsonRecord {
  const pointer = `/mcpServers/${escapePointer(name)}`;
  const record = (code: ImportNormalizationCode, sourcePointer: string, destinationPointer = sourcePointer, occurrences = 1) => changes.push({ code, sourcePointer, destinationPointer, occurrences });
  const normalized: Record<string, JsonValue> = Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, JsonValue] => entry[1] !== undefined
    )
  );
  // Only Claude's documented HTTP spelling has this exact native equivalent.
  // Other aliases remain visible to portable-source validation instead of guessing.
  if (target === "claude" && normalized.type === "http") {
    normalized.type = "streamable-http";
    record("mcp.claude-http-transport", `${pointer}/type`);
  }
  // Codex defines URL-only servers as Streamable HTTP. Cursor's same shape can
  // mean HTTP or SSE; Claude requires an explicit remote type. A command also
  // makes the source contradictory, so leave it for the existing validator.
  if (
    target === "codex" &&
    normalized.type === undefined &&
    normalized.command === undefined &&
    normalized.url !== undefined
  ) {
    normalized.type = "streamable-http";
    record("mcp.codex-url-transport", `${pointer}/url`, `${pointer}/type`);
  }

  if (target === "codex" && normalized.http_headers !== undefined) {
    if (normalized.headers !== undefined) {
      throw new Error(
        `skillset: imported MCP server ${name} declares both headers and http_headers`
      );
    }
    normalized.headers = normalized.http_headers;
    delete normalized.http_headers;
    record("mcp.codex-header-field", `${pointer}/http_headers`, `${pointer}/headers`);
  }

  if (target === "claude") {
    // Claude's stdio schema has no cwd field. Importing it as portable source
    // would introduce behavior that the source provider did not express.
    if (normalized.cwd !== undefined) {
      throw new Error(`skillset: imported Claude MCP server ${name} has unmappable field cwd`);
    }
    if (typeof normalized.command === "string") {
      normalized.command = normalizeClaudePlaceholders(normalized.command, `${pointer}/command`, record);
    }
    if (Array.isArray(normalized.args)) {
      normalized.args = normalized.args.map((argument, index) =>
        typeof argument === "string"
          ? normalizeClaudePlaceholders(argument, `${pointer}/args/${index}`, record)
          : argument
      );
    }
    if (isJsonRecord(normalized.env)) {
      normalized.env = Object.fromEntries(
        Object.entries(normalized.env).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, envValue]) => [
          key,
          typeof envValue === "string"
            ? normalizeClaudePlaceholders(envValue, `${pointer}/env/${escapePointer(key)}`, record)
            : envValue,
        ])
      );
    }
  }
  return normalized;
}

function normalizeClaudePlaceholders(
  value: string, pointer: string,
  record: (code: ImportNormalizationCode, sourcePointer: string, destinationPointer?: string, occurrences?: number) => unknown
): string {
  // Claude expands braced placeholders in MCP config. Bare variables may be
  // shell syntax or literal arguments; importing them must not infer expansion.
  const bare = /\$(CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA)(?![A-Za-z0-9_])/u.exec(value);
  if (bare !== null) {
    throw new Error(
      `skillset: imported Claude MCP value contains ${bare[0]}; its literal or shell meaning cannot be mapped automatically; review the source before importing`
    );
  }
  for (const [token, code] of [["${CLAUDE_PLUGIN_ROOT}", "mcp.claude-root-token"], ["${CLAUDE_PLUGIN_DATA}", "mcp.claude-data-token"]] as const) {
    const occurrences = value.split(token).length - 1;
    if (occurrences > 0) record(code, pointer, pointer, occurrences);
  }
  return value
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", "${PLUGIN_ROOT}")
    .replaceAll("${CLAUDE_PLUGIN_DATA}", "${PLUGIN_DATA}");
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
