import { describe, expect, it } from "bun:test";
import { checkProviderFormatConformance } from "../index";

function check(command: unknown, marketplace: boolean) {
  const commands = { example: command };
  const value = marketplace
    ? { name: "market", owner: { name: "Owner" }, plugins: [{ name: "example", source: "./example", commands }] }
    : { name: "example", description: "Example", commands };
  return checkProviderFormatConformance([{
    path: marketplace ? ".claude-plugin/marketplace.json" : "plugins/example/.claude-plugin/plugin.json",
    content: new TextEncoder().encode(JSON.stringify(value)),
  }]);
}
for (const marketplace of [false, true]) {
  describe(marketplace ? "marketplace command maps" : "standalone command maps", () => {
    const prefix = marketplace ? "plugins[0].commands.example" : "commands.example";
    const providerRef = marketplace ? "claude-marketplace-schema" : "claude-plugin-manifest-schema";
    it("rejects nonobject entries with the correct context", () => {
      for (const command of [42, null, false, [], "text"]) {
        const report = check(command, marketplace);
        expect(report.ok).toBe(false);
        expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({
          code: "invalid-field-type", providerRef, message: expect.stringContaining(prefix),
        })]));
      }
    });
    for (const field of ["source", "content", "description", "argumentHint", "model", "allowedTools"]) {
      it(`validates ${field}`, () => {
        const report = check({ content: "body", [field]: 42 }, marketplace);
        expect(report.ok).toBe(false);
        expect(report.issues.some((finding) => finding.code === "invalid-field-type" && finding.message.includes(prefix + "." + field))).toBe(true);
      });
    }
    it("requires exactly one truthy source or content", () => {
      for (const command of [{}, { content: "" }, { source: "./a.md", content: "body" }]) {
        expect(check(command, marketplace).ok).toBe(false);
      }
      for (const command of [{ source: "./a.md" }, { content: "body" }, { source: "./a.md", content: "" }, { content: " " }]) {
        expect(check(command, marketplace).ok).toBe(true);
      }
    });
    it("preserves path and known-list bounds", () => {
      expect(check({ source: "a.md" }, marketplace).ok).toBe(false);
      expect(check({ content: "body", allowedTools: [42] }, marketplace).ok).toBe(false);
      expect(check({ content: "body", allowedTools: ["Read"], model: "", description: "" }, marketplace).ok).toBe(true);
    });
    it("does not close command objects beyond the pinned parser", () => {
      expect(check({ content: "body", future: { nested: [42] } }, marketplace).ok).toBe(true);
    });
  });
}
