import { describe, expect, it } from "bun:test";
import { checkProviderFormatConformance } from "../index";

function check(dependencies: unknown, marketplace: boolean) {
  const plugin = { name: "example", description: "Example", dependencies };
  return checkProviderFormatConformance([{
    path: marketplace ? ".claude-plugin/marketplace.json" : "plugins/example/.claude-plugin/plugin.json",
    content: new TextEncoder().encode(JSON.stringify(marketplace ? {
      name: "market", owner: { name: "Owner" }, plugins: [{ ...plugin, source: "./example" }],
    } : plugin)),
  }]);
}
for (const marketplace of [false, true]) {
  describe(marketplace ? "marketplace dependencies" : "standalone dependencies", () => {
    const prefix = marketplace ? "plugins[0].dependencies" : "dependencies";
    const providerRef = marketplace ? "claude-marketplace-schema" : "claude-plugin-manifest-schema";
    it("accepts the pinned string grammar without inventing semver checks", () => {
      for (const dependency of ["plugin", "a-b.c_9", "plugin@market", "plugin@^", "plugin@^arbitrary text", "plugin@market@^1.2.3"]) {
        expect(check([dependency], marketplace).ok).toBe(true);
      }
      expect(check([], marketplace).ok).toBe(true);
      expect(check(undefined, marketplace).ok).toBe(true);
    });
    it("rejects malformed dependency strings", () => {
      for (const dependency of ["", "bad space", "_plugin", "a/b", "a@", "a@market@other", "a@^1@2"]) {
        expect(check([dependency], marketplace).issues).toEqual([expect.objectContaining({ code: "invalid-shape", providerRef, message: `destination field ${prefix}[0] must be a valid plugin dependency identifier` })]);
      }
    });
    it("rejects scalar and array entries with stable paths", () => {
      for (const dependency of [null, false, 42, []]) {
        expect(check(["valid", dependency], marketplace).issues).toEqual([expect.objectContaining({ code: "invalid-field-type", providerRef, message: `destination field ${prefix}[1] must be a string or an object` })]);
      }
    });
    it("requires and validates names independently from optional marketplace", () => {
      for (const dependency of [{}, { name: 42 }, { name: "" }, { name: "_bad" }, { name: "a@b" }, { name: "good", marketplace: null }, { name: "good", marketplace: "" }, { name: "good", marketplace: "bad space" }]) {
        expect(check([dependency], marketplace).ok).toBe(false);
      }
      expect(check([{ name: "good", marketplace: "market-1" }, { name: "constructor" }], marketplace).ok).toBe(true);
    });
    it("accepts extra object input fields without claiming provider preservation", () => {
      for (const version of [null, "", 42, [], {}, false]) {
        expect(check([{ name: "good", version, future: { x: [42] } }], marketplace).ok).toBe(true);
      }
    });
    it("does not duplicate the outer field diagnostic", () => {
      expect(check({}, marketplace).issues).toHaveLength(1);
      expect(check(null, marketplace).issues).toHaveLength(1);
    });
  });
}
