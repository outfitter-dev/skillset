import { describe, expect, it } from "bun:test";
import { checkProviderFormatConformance } from "../index";
function check(hooks: unknown, marketplace: boolean) {
  const plugin = { name: "example", description: "Example", hooks };
  return checkProviderFormatConformance([{ path: marketplace ? ".claude-plugin/marketplace.json" : "plugins/example/.claude-plugin/plugin.json", content: new TextEncoder().encode(JSON.stringify(marketplace ? { name: "market", owner: { name: "Owner" }, plugins: [{ ...plugin, source: "./example" }] } : plugin)) }]);
}
for (const marketplace of [false, true]) describe(`${marketplace ? "marketplace" : "standalone"} hook references`, () => {
  const providerRef = marketplace ? "claude-marketplace-schema" : "claude-plugin-manifest-schema";
  const prefix = `${marketplace ? "plugins[0]." : ""}hooks`;
  it("accepts relative JSON paths, maps and arrays without reading referenced files", () => {
    for (const value of [undefined, "./hooks.json", {}, [], ["./hooks.json", {}]]) expect(check(value, marketplace).ok).toBe(true);
  });
  it("checks direct relative JSON paths", () => {
    for (const value of ["", "hooks.json", "/hooks.json", "./hooks.JSON", "./hooks.txt"]) expect(check(value, marketplace).issues).toEqual([expect.objectContaining({ code:"invalid-shape", providerRef, message:expect.stringContaining(prefix) })]);
  });
  it("retains original array indices for path and element errors", () => {
    for (const value of [null, 42, false, []]) expect(check([{},value], marketplace).issues).toEqual([expect.objectContaining({ code:"invalid-field-type", providerRef, message:`destination field ${prefix}[1] must be a string or an object` })]);
    expect(check([{},"bad.json"], marketplace).issues).toEqual([expect.objectContaining({ code:"invalid-shape", providerRef, message:`destination field ${prefix}[1] must start with ./` })]);
  });
  it("leaves wrong root containers to one outer diagnostic", () => {
    for (const value of [null,42,false]) expect(check(value,marketplace).issues).toHaveLength(1);
  });
});
