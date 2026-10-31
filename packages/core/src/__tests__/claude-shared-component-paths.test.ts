import { describe, expect, it } from "bun:test";
import { checkProviderFormatConformance } from "../index";

function check(fields: Record<string, unknown>, marketplace: boolean) {
  const plugin = { name: "example", description: "Example", ...fields };
  return checkProviderFormatConformance([{
    path: marketplace ? ".claude-plugin/marketplace.json" : "plugins/example/.claude-plugin/plugin.json",
    content: new TextEncoder().encode(JSON.stringify(marketplace ? {
      name: "market", owner: { name: "Owner" }, plugins: [{ ...plugin, source: "./example" }],
    } : plugin)),
  }]);
}
const fields = ["agents", "commands", "skills", "outputStyles", "themes", "workflows"] as const;
for (const marketplace of [false, true]) {
  describe(marketplace ? "marketplace component paths" : "standalone component paths", () => {
    const prefix = marketplace ? "plugins[0]." : "";
    const providerRef = marketplace ? "claude-marketplace-schema" : "claude-plugin-manifest-schema";
    for (const field of fields) {
      it(`${field} accepts string and array references`, () => {
        for (const value of ["./example.md", ["./example.md"], [], undefined]) expect(check({ [field]: value }, marketplace).ok).toBe(true);
      });
      it(`${field} rejects unprefixed references with correct attribution`, () => {
        for (const value of ["example.md", ["./valid.md", "example.md"]]) {
          const result = check({ [field]: value }, marketplace);
          expect(result.issues).toHaveLength(1);
          expect(result.issues[0]).toMatchObject({ code: "invalid-shape", providerRef });
          expect(result.issues[0]?.message).toContain(`${prefix}${field}${Array.isArray(value) ? "[1]" : ""}`);
        }
      });
      it(`${field} handles dot and prefix-only references`, () => {
        expect(check({ [field]: "." }, marketplace).ok).toBe(field === "skills");
        expect(check({ [field]: "./" }, marketplace).ok).toBe(field !== "agents");
      });
      it(`${field} reports malformed outer values once`, () => {
        for (const value of [null, 42, false]) expect(check({ [field]: value }, marketplace).issues).toHaveLength(1);
        expect(check({ [field]: [42] }, marketplace).issues).toHaveLength(1);
      });
    }
    it("requires the case-sensitive agents suffix", () => {
      for (const value of ["./agent", "./agent.MD"]) expect(check({ agents: value }, marketplace).ok).toBe(false);
      expect(check({ skills: [".", "./"] }, marketplace).ok).toBe(true);
    });
    it("keeps command maps separate from path arrays", () => {
      expect(check({ commands: { demo: { content: "hello" } } }, marketplace).ok).toBe(true);
      expect(check({ commands: [{ demo: { content: "hello" } }] }, marketplace).issues).toHaveLength(1);
    });
    it("retains original indexes alongside malformed members", () => {
      const result = check({ skills: [42, "bad"] }, marketplace);
      expect(result.issues).toHaveLength(2);
      expect(result.issues.some((entry) => entry.message.includes(`${prefix}skills[1]`))).toBe(true);
    });
  });
}
