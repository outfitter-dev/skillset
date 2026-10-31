import { describe, expect, it } from "bun:test";
import { checkProviderFormatConformance } from "../index";

const valid = { type: "string", title: "", description: "" };
function check(fields: Record<string, unknown>, marketplace: boolean) {
  const plugin = { name: "example", description: "Example", ...fields };
  const value = marketplace ? { name: "market", owner: { name: "Owner" }, plugins: [{ ...plugin, source: "./example" }] } : plugin;
  return checkProviderFormatConformance([{
    path: marketplace ? ".claude-plugin/marketplace.json" : "plugins/example/.claude-plugin/plugin.json",
    content: new TextEncoder().encode(JSON.stringify(value)),
  }]);
}
for (const marketplace of [false, true]) {
  describe(marketplace ? "marketplace user config" : "standalone user config", () => {
    const providerRef = marketplace ? "claude-marketplace-schema" : "claude-plugin-manifest-schema";
    const prefix = marketplace ? "plugins[0]." : "";
    it("rejects nonobject config values once with context", () => {
      for (const entry of [null, 42, [], false, "text"]) {
        const report = check({ userConfig: { x: entry } }, marketplace);
        expect(report.issues).toEqual([expect.objectContaining({ code: "invalid-field-type", providerRef, message: `destination field ${prefix}userConfig.x must be an object` })]);
      }
    });
    it("requires each nested declaration field", () => {
      for (const field of ["type", "title", "description"]) {
        const entry: Record<string, unknown> = { ...valid }; delete entry[field];
        const report = check({ userConfig: { x: entry } }, marketplace);
        expect(report.issues).toEqual([expect.objectContaining({ code: "missing-required-field", providerRef, message: `missing required destination field ${prefix}userConfig.x.${field}` })]);
      }
    });
    it("checks known types, enum, defaults and strict keys", () => {
      for (const patch of [{ type: "other" }, { type: null }, { title: 42 }, { description: [] }, { min: "1" }, { max: false }, { multiple: 1 }, { required: null }, { sensitive: "yes" }, { default: null }, { default: [1] }, { future: true }]) {
        expect(check({ userConfig: { x: { ...valid, ...patch } } }, marketplace).ok).toBe(false);
      }
    });
    it("accepts the parser's uncorrelated values and empty strings", () => {
      for (const type of ["string", "number", "boolean", "directory", "file"]) {
        for (const defaultValue of ["", [], [""], 0, false]) {
          expect(check({ userConfig: { x: { ...valid, type, default: defaultValue, min: 2.5, max: -1, required: false, multiple: true, sensitive: true } } }, marketplace).ok).toBe(true);
        }
      }
    });
    it("applies identifier restrictions only at root", () => {
      for (const name of ["x-y", "1port", "", "a.b"]) {
        const config = Object.fromEntries([[name, valid]]);
        expect(check({ userConfig: config }, marketplace).ok).toBe(false);
        expect(check({ channels: [{ server: "unlisted", userConfig: config }] }, marketplace).ok).toBe(true);
      }
      const config = Object.fromEntries([["__proto__", valid], ["_valid9", valid]]);
      expect(check({ userConfig: config }, marketplace).ok).toBe(true);
      expect(check({ channels: [{ server: " ", userConfig: config }] }, marketplace).ok).toBe(true);
    });
    it("checks channel shape and nested config with accurate context", () => {
      for (const channel of [null, 42, [], {}, { server: 42 }, { server: "" }, { server: "a", displayName: 42 }, { server: "a", userConfig: [] }, { server: "a", future: true }]) {
        expect(check({ channels: [channel] }, marketplace).ok).toBe(false);
      }
      const report = check({ channels: [{ server: "a", userConfig: { "x-y": 42 } }] }, marketplace);
      expect(report.issues).toEqual([expect.objectContaining({ code: "invalid-field-type", providerRef, message: `destination field ${prefix}channels[0].userConfig.x-y must be an object` })]);
      expect(check({ channels: [] }, marketplace).ok).toBe(true);
      expect(check({ channels: [{ server: " ", displayName: "", userConfig: {} }] }, marketplace).ok).toBe(true);
    });
    it("keeps invalid outer containers to one finding", () => {
      expect(check({ userConfig: [] }, marketplace).issues).toHaveLength(1);
      expect(check({ channels: {} }, marketplace).issues).toHaveLength(1);
    });
  });
}
