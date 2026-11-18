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
