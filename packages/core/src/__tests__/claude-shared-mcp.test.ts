import { describe, expect, it } from "bun:test";
import { checkProviderFormatConformance } from "../index";

function check(mcpServers: unknown, marketplace: boolean) {
  const plugin = { name: "example", description: "Example", mcpServers };
  const value = marketplace ? { name: "market", owner: { name: "Owner" }, plugins: [{ ...plugin, source: "./example" }] } : plugin;
  return checkProviderFormatConformance([{
    path: marketplace ? ".claude-plugin/marketplace.json" : "plugins/example/.claude-plugin/plugin.json",
    content: new TextEncoder().encode(JSON.stringify(value)),
  }]);
}
const variants = [
  { command: "tool" }, { type: "stdio", command: "tool" },
  { type: "sse", url: "" }, { type: "http", url: "" }, { type: "streamable-http", url: "" },
  { type: "ws", url: "" }, { type: "sse-ide", url: "", ideName: "" },
  { type: "ws-ide", url: "", ideName: "" }, { type: "sdk", name: "" },
  { type: "claudeai-proxy", url: "", id: "" },
];
for (const marketplace of [false, true]) {
  describe(marketplace ? "marketplace MCP" : "standalone MCP", () => {
    const prefix = marketplace ? "plugins[0].mcpServers" : "mcpServers";
    const providerRef = marketplace ? "claude-marketplace-schema" : "claude-plugin-manifest-schema";
    it("accepts every pinned transport, empty remote strings and unknown keys", () => {
      for (const config of variants) {
        expect(check({ server: { ...config, future: { x: 42 }, role: null } }, marketplace).ok).toBe(true);
      }
      expect(check({}, marketplace).ok).toBe(true);
      expect(check(Object.fromEntries([["__proto__", { command: "tool" }]]), marketplace).ok).toBe(true);
    });
    it("requires each variant's fields with context", () => {
      for (const config of variants) {
        for (const field of Object.keys(config).filter((key) => key !== "type")) {
          for (const malformed of [undefined, null, 42]) {
            const report = check({ server: { ...config, [field]: malformed } }, marketplace);
            expect(report.ok).toBe(false);
            expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ providerRef, message: expect.stringContaining(`${prefix}.server.${field}`) })]));
          }
        }
      }
    });
    it("rejects unknown discriminators and nonobject server entries", () => {
      for (const type of [null, 42, "future", "toString", "__proto__"]) {
        expect(check({ server: { type, command: "tool" } }, marketplace).ok).toBe(false);
      }
      for (const value of [null, 42, [], false, "tool"]) {
        expect(check({ server: value }, marketplace).issues).toEqual([expect.objectContaining({ code: "invalid-field-type", providerRef, message: `${"destination field " + prefix}.server must be an object` })]);
      }
      expect(check({ server: { command: "" } }, marketplace).ok).toBe(false);
      expect(check({ server: { command: " " } }, marketplace).ok).toBe(true);
    });
    it("checks references and mixed arrays without losing indices", () => {
      for (const reference of ["./mcp.json", "./x.mcpb", "./x.dxt", "https://example.test/x.mcpb", "file:///tmp/x.dxt"]) {
        expect(check(reference, marketplace).ok).toBe(true);
        expect(check([reference, { server: { command: "tool" } }], marketplace).ok).toBe(true);
      }
      for (const reference of ["mcp.json", "/mcp.json", "https://example.test/x.json", "./x.txt", "./x.MCPB", "https://example.test/x.mcpb?x=1", "https://[bad/x.dxt"]) {
        expect(check(reference, marketplace).ok).toBe(false);
      }
      for (const value of [null, false, 42, []]) {
        const report = check(["./good.json", value], marketplace);
        expect(report.ok).toBe(false);
        expect(report.issues.some((finding) => finding.message.includes(`${prefix}[1]`))).toBe(true);
      }
      expect(check([], marketplace).ok).toBe(true);
      expect(check(42, marketplace).issues).toHaveLength(1);
    });
    it("validates timeout and declared fields while ignoring other-variant fields", () => {
      for (const config of variants) {
        for (const timeout of [0, -1, 1.5, "1", null]) {
          expect(check({ server: { ...config, timeout } }, marketplace).ok).toBe(false);
        }
        expect(check({ server: { ...config, timeout: 1, alwaysLoad: true } }, marketplace).ok).toBe(true);
        expect(check({ server: { ...config, alwaysLoad: null } }, marketplace).ok).toBe(false);
      }
      expect(check({ s: { command: "tool", args: [""] , env: { X: "" }, oauth: 42, tools: 42, url: 42 } }, marketplace).ok).toBe(true);
      expect(check({ s: { type: "ws", url: "", oauth: 42, tools: 42, env: 42 } }, marketplace).ok).toBe(true);
      for (const patch of [{ args: [1] }, { env: { X: 1 } }, { env: [] }, { args: null }]) {
        expect(check({ s: { command: "tool", ...patch } }, marketplace).ok).toBe(false);
      }
      for (const type of ["http", "sse", "streamable-http", "ws"]) {
        expect(check({ s: { type, url: "", headers: { X: "" }, headersHelper: "" } }, marketplace).ok).toBe(true);
        expect(check({ s: { type, url: "", headers: { X: 42 } } }, marketplace).ok).toBe(false);
      }
      expect(check({ s: { type: "ws-ide", url: "", ideName: "", authToken: null } }, marketplace).ok).toBe(false);
      expect(check({ s: { type: "sse-ide", url: "", ideName: "", authToken: null } }, marketplace).ok).toBe(true);
    });
    it("validates OAuth only for HTTP and SSE with literal HTTPS syntax", () => {
      for (const type of ["http", "sse", "streamable-http"]) {
        for (const oauth of [{ callbackPort: 0 }, { callbackPort: 1.5 }, { scopes: "" }, { scopes: 42 }, { xaa: null }, { clientId: 42 }, { authServerMetadataUrl: "HTTPS://example.test" }, { authServerMetadataUrl: "https://[bad" }, { authServerMetadataUrl: "http://example.test" }, null]) {
          expect(check({ s: { type, url: "", oauth } }, marketplace).ok).toBe(false);
        }
        expect(check({ s: { type, url: "", oauth: { clientId: "", callbackPort: 1, scopes: " ", authServerMetadataUrl: "https://example.test", xaa: false, future: 42 } } }, marketplace).ok).toBe(true);
      }
    });
    it("validates tools and permissions while preserving caught fields", () => {
      for (const type of ["http", "sse", "streamable-http"]) {
        for (const patch of [{ tools: [42] }, { tools: [{}] }, { tools: [{ name: "", permission_policy: "future" }] }, { toolPermissions: { x: "future" } }, { discoveryCache: null }]) {
          expect(check({ s: { type, url: "", ...patch } }, marketplace).ok).toBe(false);
        }
        expect(check({ s: { type, url: "", tools: [{ name: "", permission_policy: "always_ask", future: 42 }], toolPermissions: { x: "allow", y: "ask", z: "blocked" }, discoveryCache: false, request_timeout_ms: null, role: { any: "value" } } }, marketplace).ok).toBe(true);
      }
    });
    it("accepts proxy nullish and caught values but validates declared members", () => {
      const proxy = { type: "claudeai-proxy", url: "", id: "" };
      expect(check({ s: { ...proxy, cachedInitResponse: null, cachedDiscoverResponse: { x: [42] }, eligible: null, ineligibleReason: null, discoverSupport: [42] } }, marketplace).ok).toBe(true);
      for (const patch of [{ cachedInitResponse: [] }, { cachedDiscoverResponse: 42 }, { eligible: 42 }, { ineligibleReason: false }, { stateless: "true" }, { enterpriseManaged: null }, { displayName: 42 }, { iconUrl: null }, { toolPermissions: { x: 42 } }]) {
        expect(check({ s: { ...proxy, ...patch } }, marketplace).ok).toBe(false);
      }
    });
  });
}
