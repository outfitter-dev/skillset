import { describe, expect, it } from "bun:test";
import { checkProviderFormatConformance } from "../index";
function check(monitors: unknown, marketplace: boolean, experimental: boolean) {
  const plugin = { name: "example", description: "Example", ...(experimental ? { experimental: { monitors } } : { monitors }) };
  return checkProviderFormatConformance([{ path: marketplace ? ".claude-plugin/marketplace.json" : "plugins/example/.claude-plugin/plugin.json", content: new TextEncoder().encode(JSON.stringify(marketplace ? { name: "market", owner: { name: "Owner" }, plugins: [{ ...plugin, source: "./example" }] } : plugin)) }]);
}
const valid = { name: "watch", command: "watch.sh", description: "Watch" };
for (const marketplace of [false, true]) for (const experimental of [false, true]) {
  describe(`${marketplace ? "marketplace" : "standalone"} ${experimental ? "experimental" : "root"} monitors`, () => {
    const prefix = `${marketplace ? "plugins[0]." : ""}${experimental ? "experimental." : ""}monitors`;
    const providerRef = marketplace ? "claude-marketplace-schema" : "claude-plugin-manifest-schema";
    it("accepts path, empty array, optional trigger and nontrimmed required strings", () => {
      for (const value of [undefined, [], "./m.json", [valid], [{ ...valid, when: "always" }], [{ ...valid, when: "on-skill-invoke:x" }], [{ name: " ", command: " ", description: " " }]]) expect(check(value, marketplace, experimental).ok).toBe(true);
    });
    it("checks relative JSON references", () => {
      for (const value of ["", "m.json", "/m.json", "./m.JSON", "./m.txt"]) {
        const issues = check(value, marketplace, experimental).issues;
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ code: "invalid-shape", providerRef, message: expect.stringContaining(prefix) });
      }
    });
    it("checks container and indexed record types without duplicates", () => {
      for (const value of [null, 42, false, {}]) expect(check(value, marketplace, experimental).issues).toHaveLength(1);
      for (const value of [null, 42, [], "./m.json"]) {
        const issues = check([valid, value], marketplace, experimental).issues;
        expect(issues).toEqual([expect.objectContaining({ code: "invalid-field-type", providerRef, message: `destination field ${prefix}[1] must be an object` })]);
      }
    });
    it("requires all three nonempty strings and closes monitor records", () => {
      for (const field of ["name", "command", "description"] as const) {
        for (const value of [undefined, null, 42, ""]) expect(check([{ ...valid, [field]: value }], marketplace, experimental).ok).toBe(false);
      }
      expect(check([{ ...valid, future: true }], marketplace, experimental).ok).toBe(false);
    });
    it("requires a nonempty invocation suffix", () => {
      for (const when of [null, 42, "", "sometimes", "on-skill-invoke:"]) expect(check([{ ...valid, when }], marketplace, experimental).issues).toHaveLength(1);
    });
    it("rejects exact duplicate names while retaining case and type distinctions", () => {
      const issues = check([valid, { ...valid, command: "other" }], marketplace, experimental).issues;
      expect(issues).toEqual([expect.objectContaining({ code: "invalid-shape", providerRef, message: expect.stringContaining(`${prefix}[1].name`) })]);
      expect(check([valid, { ...valid, name: "Watch" }, { ...valid, name: "constructor" }], marketplace, experimental).ok).toBe(true);
      expect(check([{ ...valid, name: 42 }, { ...valid, name: 42 }], marketplace, experimental).issues).toHaveLength(2);
    });
  });
}
