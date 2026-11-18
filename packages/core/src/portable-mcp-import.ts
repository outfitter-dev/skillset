import type { JsonRecord, JsonValue, TargetName } from "./types";
import { isJsonRecord } from "./yaml";

/** Reverse a provider MCP dialect into Skillset's canonical portable source. */
export function normalizeImportedMcpSource(
  value: JsonValue,
  target: TargetName | "agent-plugins"
): JsonRecord {
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

  return {
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
          return [name, normalizeImportedServer(raw, target, name)];
        })
    ),
  };
}

function normalizeImportedServer(
  raw: JsonRecord,
  target: TargetName | "agent-plugins",
  name: string
): JsonRecord {
  const normalized: Record<string, JsonValue> = Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, JsonValue] => entry[1] !== undefined
    )
  );
  // Only Claude's documented HTTP spelling has this exact native equivalent.
  // Other aliases remain visible to portable-source validation instead of guessing.
  if (target === "claude" && normalized.type === "http") {
    normalized.type = "streamable-http";
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
  }

  if (target === "codex" && normalized.http_headers !== undefined) {
    if (normalized.headers !== undefined) {
      throw new Error(
        `skillset: imported MCP server ${name} declares both headers and http_headers`
      );
    }
    normalized.headers = normalized.http_headers;
    delete normalized.http_headers;
  }

  if (target === "claude") {
    for (const field of ["command", "cwd"] as const) {
      if (typeof normalized[field] === "string") {
        normalized[field] = normalizeClaudePlaceholders(normalized[field]);
      }
    }
    if (Array.isArray(normalized.args)) {
      normalized.args = normalized.args.map((argument) =>
        typeof argument === "string"
          ? normalizeClaudePlaceholders(argument)
          : argument
      );
    }
    if (isJsonRecord(normalized.env)) {
      normalized.env = Object.fromEntries(
        Object.entries(normalized.env).map(([key, envValue]) => [
          key,
          typeof envValue === "string"
            ? normalizeClaudePlaceholders(envValue)
            : envValue,
        ])
      );
    }
  }
  return normalized;
}

function normalizeClaudePlaceholders(value: string): string {
  // Unbraced placeholders must end at an environment-variable identifier boundary.
  return value
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", "${PLUGIN_ROOT}")
    .replaceAll(/\$CLAUDE_PLUGIN_ROOT(?![A-Za-z0-9_])/gu, "${PLUGIN_ROOT}")
    .replaceAll("${CLAUDE_PLUGIN_DATA}", "${PLUGIN_DATA}")
    .replaceAll(/\$CLAUDE_PLUGIN_DATA(?![A-Za-z0-9_])/gu, "${PLUGIN_DATA}");
}
