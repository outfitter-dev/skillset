import { expect, test } from "bun:test";

import { normalizeImportedMcpSource as normalizeMcpImport } from "../portable-mcp-import";

const normalizeImportedMcpSource = (...args: Parameters<typeof normalizeMcpImport>) => normalizeMcpImport(...args).source;

test.each([
  ["${CLAUDE_PLUGIN_ROOT}/bin", "${PLUGIN_ROOT}/bin"],
  ["${CLAUDE_PLUGIN_DATA}/cache", "${PLUGIN_DATA}/cache"],
  ["$CLAUDE_PLUGIN_ROOTED/bin", "$CLAUDE_PLUGIN_ROOTED/bin"],
  ["$CLAUDE_PLUGIN_DATASET", "$CLAUDE_PLUGIN_DATASET"],
  ["$CLAUDE_PLUGIN_ROOT_OLD", "$CLAUDE_PLUGIN_ROOT_OLD"],
  ["$CLAUDE_PLUGIN_DATA2", "$CLAUDE_PLUGIN_DATA2"],
  ["${CLAUDE_PLUGIN_ROOTED}/bin", "${CLAUDE_PLUGIN_ROOTED}/bin"],
])("Claude MCP placeholder normalization preserves identifier boundaries: %s", (input, expected) => {
  const server = { command: input, args: [input], env: { VALUE: input } };
  const source = { mcpServers: { demo: server } };
  const original = structuredClone(source);
  expect(normalizeImportedMcpSource(source, "claude")).toEqual({
    mcpServers: {
      demo: { command: expected, args: [expected], env: { VALUE: expected } },
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


test.each(["${CLAUDE_PLUGIN_ROOT}/work", "$CLAUDE_PLUGIN_ROOT/work", "./work"])(
  "Claude cwd is not silently promoted to portable intent: %s", (cwd) => {
    const source = { mcpServers: { demo: { command: "node", cwd } } };
    const original = structuredClone(source);
    expect(() => normalizeImportedMcpSource(source, "claude")).toThrow("cwd");
    expect(source).toEqual(original);
    expect(normalizeImportedMcpSource(source, "codex")).toEqual(source);
  }
);

test("explicit shell arguments require review without suggesting a replacement", () => {
  const source = { mcpServers: { demo: { command: "sh", args: ["-c", 'printf %s "$CLAUDE_PLUGIN_ROOT"'], env: { VALUE: "$CLAUDE_PLUGIN_DATA" } } } };
  expect(() => normalizeImportedMcpSource(source, "claude")).toThrow("literal or shell meaning cannot be mapped automatically; review the source before importing");
});

 test.each(["$CLAUDE_PLUGIN_ROOT/bin", "$CLAUDE_PLUGIN_DATA/cache"])(
  "bare Claude variable requires review in each expandable field: %s", (value) => {
    for (const server of [{ command: value }, { command: "node", args: [value] }, { command: "node", env: { VALUE: value } }]) {
      const source = { mcpServers: { demo: server } };
      const original = structuredClone(source);
      expect(() => normalizeImportedMcpSource(source, "claude")).toThrow("literal or shell meaning cannot be mapped automatically; review the source before importing");
      expect(source).toEqual(original);
      expect(normalizeImportedMcpSource(source, "codex")).toEqual(source);
    }
  }
);

test("MCP observations escape JSON pointers, count exact tokens, and have stable ordering", () => {
  const first = { mcpServers: { "a/b~c": { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/${CLAUDE_PLUGIN_ROOT}"], env: { Z: "${CLAUDE_PLUGIN_DATA}", A: "${CLAUDE_PLUGIN_ROOTED}" } } } };
  const second = { mcpServers: { "a/b~c": { env: { A: "${CLAUDE_PLUGIN_ROOTED}", Z: "${CLAUDE_PLUGIN_DATA}" }, args: ["${CLAUDE_PLUGIN_ROOT}/${CLAUDE_PLUGIN_ROOT}"], command: "node" } } };
  const expected = [
    { code: "mcp.claude-root-token", sourcePointer: "/mcpServers/a~1b~0c/args/0", destinationPointer: "/mcpServers/a~1b~0c/args/0", occurrences: 2 },
    { code: "mcp.claude-data-token", sourcePointer: "/mcpServers/a~1b~0c/env/Z", destinationPointer: "/mcpServers/a~1b~0c/env/Z", occurrences: 1 },
  ] as const;
  expect(normalizeMcpImport(first, "claude").changes).toEqual(expected);
  expect(normalizeMcpImport(second, "claude").changes).toEqual(expected);
  expect(normalizeMcpImport(first, "cursor").changes).toEqual([]);
});

test("Codex observations distinguish inferred transport from header relocation", () => {
  const source = { mcpServers: { demo: { url: "https://private.invalid/mcp", http_headers: { "X-Private": "do-not-record" } } } };
  const result = normalizeMcpImport(source, "codex");
  expect(result.changes).toEqual([
    { code: "mcp.codex-url-transport", sourcePointer: "/mcpServers/demo/url", destinationPointer: "/mcpServers/demo/type", occurrences: 1 },
    { code: "mcp.codex-header-field", sourcePointer: "/mcpServers/demo/http_headers", destinationPointer: "/mcpServers/demo/headers", occurrences: 1 },
  ]);
  expect(JSON.stringify(result.changes)).not.toContain("private");
  expect(normalizeMcpImport(result.source, "codex").changes).toEqual([]);
});
