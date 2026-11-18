import { expect, test } from "bun:test";

import { normalizeImportedMcpSource } from "../portable-mcp-import";

test.each([
  ["$CLAUDE_PLUGIN_ROOT/bin", "${PLUGIN_ROOT}/bin"],
  ["${CLAUDE_PLUGIN_ROOT}/bin", "${PLUGIN_ROOT}/bin"],
  ["$CLAUDE_PLUGIN_DATA/cache", "${PLUGIN_DATA}/cache"],
  ["${CLAUDE_PLUGIN_DATA}/cache", "${PLUGIN_DATA}/cache"],
  ["$CLAUDE_PLUGIN_ROOTED/bin", "$CLAUDE_PLUGIN_ROOTED/bin"],
  ["$CLAUDE_PLUGIN_DATASET", "$CLAUDE_PLUGIN_DATASET"],
  ["$CLAUDE_PLUGIN_ROOT_OLD", "$CLAUDE_PLUGIN_ROOT_OLD"],
  ["$CLAUDE_PLUGIN_DATA2", "$CLAUDE_PLUGIN_DATA2"],
  ["${CLAUDE_PLUGIN_ROOTED}/bin", "${CLAUDE_PLUGIN_ROOTED}/bin"],
])("Claude MCP placeholder normalization preserves identifier boundaries: %s", (input, expected) => {
  const server = { command: input, cwd: input, args: [input], env: { VALUE: input } };
  const source = { mcpServers: { demo: server } };
  const original = structuredClone(source);
  expect(normalizeImportedMcpSource(source, "claude")).toEqual({
    mcpServers: {
      demo: { command: expected, cwd: expected, args: [expected], env: { VALUE: expected } },
    },
  });
  expect(source).toEqual(original);
  expect(normalizeImportedMcpSource(source, "codex")).toEqual(source);
});

test.each(["claude", "cursor", "codex", "agent-plugins"] as const)(
  "MCP import respects %s transport evidence and preserves unknown spellings",
  (target) => {
    const remote = { url: "https://example.invalid/sse" };
    const source = { mcpServers: { demo: remote } };
    const original = structuredClone(source);
    expect(normalizeImportedMcpSource(source, target)).toEqual({
      mcpServers: { demo: target === "codex" ? { ...remote, type: "streamable-http" } : remote },
    });
    expect(source).toEqual(original);
    for (const type of ["stdio", "sse", "streamable-http", "streamableHttp", "streamable_http", "http-extra"]) {
      const input = { mcpServers: { demo: { ...remote, type } } };
      expect(normalizeImportedMcpSource(input, target)).toEqual(input);
    }
    expect(normalizeImportedMcpSource({ mcpServers: { demo: { ...remote, type: "http" } } }, target)).toEqual({
      mcpServers: { demo: { ...remote, type: target === "claude" ? "streamable-http" : "http" } },
    });
    const command = { mcpServers: { demo: { command: "node", args: ["server.js"] } } };
    expect(normalizeImportedMcpSource(command, target)).toEqual(command);
    const conflicting = { mcpServers: { demo: { command: "node", ...remote } } };
    expect(normalizeImportedMcpSource(conflicting, target)).toEqual(conflicting);
  }
);
