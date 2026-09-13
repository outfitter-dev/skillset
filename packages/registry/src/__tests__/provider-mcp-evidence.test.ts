import { describe, expect, it } from "bun:test";

import {
  defineProviderMcpEvidence,
  getProviderMcpEvidence,
  listProviderMcpEvidence,
} from "../provider-mcp-evidence";

describe("provider MCP evidence", () => {
  it("pins the rendering facts consumed by every provider renderer", () => {
    expect(listProviderMcpEvidence().map((entry) => entry.target)).toEqual([
      "claude",
      "codex",
      "cursor",
    ]);
    expect(getProviderMcpEvidence("claude")).toMatchObject({
      dataPlaceholder: "CLAUDE_PLUGIN_DATA",
      remoteHeadersField: "headers",
      rootPlaceholder: "CLAUDE_PLUGIN_ROOT",
      sseType: "sse",
      stdioCwd: false,
      stdioType: null,
      streamableHttpType: "http",
    });
    expect(getProviderMcpEvidence("codex")).toMatchObject({
      dataPlaceholder: "PLUGIN_DATA",
      remoteHeadersField: "http_headers",
      rootPlaceholder: "PLUGIN_ROOT",
      sseType: null,
      stdioCwd: true,
      stdioType: null,
      streamableHttpType: null,
    });
    expect(getProviderMcpEvidence("cursor")).toMatchObject({
      dataPlaceholder: null,
      remoteHeadersField: "headers",
      rootPlaceholder: "PLUGIN_ROOT",
      sseType: "sse",
      stdioCwd: true,
      stdioType: "stdio",
      streamableHttpType: null,
    });
  });

  it("keeps versioned or dated HTTPS source evidence with each fact set", () => {
    for (const entry of listProviderMcpEvidence()) {
      expect(entry.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(entry.providerVersion.length).toBeGreaterThan(0);
      expect(entry.sources.length).toBeGreaterThan(0);
      expect(
        entry.sources.every((source) => source.url.startsWith("https://"))
      ).toBe(true);
    }
  });

  it("rejects incomplete, duplicate, and non-HTTPS evidence", () => {
    const entries = listProviderMcpEvidence();
    expect(() => defineProviderMcpEvidence(entries.slice(1))).toThrow(
      "missing provider MCP evidence claude"
    );
    expect(() =>
      defineProviderMcpEvidence([
        ...entries,
        entries[0] as (typeof entries)[number],
      ])
    ).toThrow("duplicate provider MCP evidence claude");
    expect(() =>
      defineProviderMcpEvidence([
        {
          ...(entries[0] as (typeof entries)[number]),
          sources: [{ note: "insecure", url: "http://example.com" }],
        },
        ...entries.slice(1),
      ])
    ).toThrow("requires HTTPS sources");
  });
});
