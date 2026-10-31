import { describe, expect, it } from "bun:test";
import { checkProviderFormatConformance } from "../index";

function check(lspServers: unknown, marketplace: boolean) {
  const plugin = { name: "example", description: "Example", lspServers };
  return checkProviderFormatConformance([{
    path: marketplace ? ".claude-plugin/marketplace.json" : "plugins/example/.claude-plugin/plugin.json",
    content: new TextEncoder().encode(JSON.stringify(marketplace ? {
      name: "market", owner: { name: "Owner" }, plugins: [{ ...plugin, source: "./example" }],
    } : plugin)),
  }]);
}
const valid = { command: "server", extensionToLanguage: { ".ts": "typescript" } };
for (const marketplace of [false, true]) {
  describe(marketplace ? "marketplace LSP" : "standalone LSP", () => {
    const prefix = marketplace ? "plugins[0].lspServers" : "lspServers";
    const providerRef = marketplace ? "claude-marketplace-schema" : "claude-plugin-manifest-schema";
    it("accepts paths, maps and mixed arrays", () => {
      for (const value of [undefined, [], {}, "./config.json", { server: valid }, ["./one.json", { server: valid }]]) expect(check(value, marketplace).ok).toBe(true);
    });
    it("rejects invalid reference paths with original indexes", () => {
      for (const path of ["", "x.json", "./x.JSON", "./x.txt"]) {
        expect(check(path, marketplace).issues).toHaveLength(1);
        expect(check([{}, path], marketplace).issues).toEqual([expect.objectContaining({ providerRef, code: "invalid-shape", message: expect.stringContaining(`${prefix}[1]`) })]);
      }
    });
    it("rejects malformed container and map values once", () => {
      for (const value of [null, 42, false]) expect(check(value, marketplace).issues).toHaveLength(1);
      for (const value of [null, 42, false, []]) {
        expect(check([{}, value], marketplace).issues).toHaveLength(1);
        expect(check({ server: value }, marketplace).issues).toHaveLength(1);
      }
    });
    it("checks command lexical rules without trimming or host path guesses", () => {
      for (const command of ["", "server --flag", 42, null]) expect(check({ server: { ...valid, command } }, marketplace).ok).toBe(false);
      for (const command of ["/path with spaces", "server\targ", "\t"]) expect(check({ server: { ...valid, command } }, marketplace).ok).toBe(true);
      expect(check({ server: { extensionToLanguage: valid.extensionToLanguage } }, marketplace).ok).toBe(false);
    });
    it("requires nonempty extension maps with dotted keys and nonempty languages", () => {
      for (const extensionToLanguage of [{}, null, [], { x: "x" }, { ab: "x" }, { ".": "x" }, { ".x": "" }, { ".x": 42 }]) expect(check({ server: { ...valid, extensionToLanguage } }, marketplace).ok).toBe(false);
      expect(check({ server: { command: "server" } }, marketplace).ok).toBe(false);
      expect(check({ server: { ...valid, extensionToLanguage: { ".x": " " } } }, marketplace).ok).toBe(true);
    });
    it("enforces strict fields and typed optional values without duplicate transport errors", () => {
      for (const extra of [{ unknown: true }, { args: [""] }, { args: [42] }, { env: { x: 42 } }, { transport: "http" }, { startupTimeout: 0 }, { shutdownTimeout: 1.5 }, { maxRestarts: -1 }, { diagnostics: null }, { workspaceFolder: 42 }]) expect(check({ server: { ...valid, ...extra } }, marketplace).ok).toBe(false);
      expect(check({ server: { ...valid, transport: 42 } }, marketplace).issues).toHaveLength(1);
      expect(check({ server: { ...valid, transport: "socket", args: [], env: {}, workspaceFolder: "", settings: null, initializationOptions: null, startupTimeout: 1, shutdownTimeout: 1, maxRestarts: 0, diagnostics: false, restartOnCrash: true } }, marketplace).ok).toBe(true);
      expect(check(JSON.parse('{"__proto__":{"command":"server","extensionToLanguage":{".x":"x"}}}'), marketplace).ok).toBe(true);
    });
  });
}
