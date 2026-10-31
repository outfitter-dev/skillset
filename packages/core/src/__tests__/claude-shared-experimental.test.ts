import { describe, expect, it } from "bun:test";
import { checkProviderFormatConformance } from "../index";
function check(experimental: unknown, marketplace: boolean) {
  const plugin = { name: "example", description: "Example", experimental };
  return checkProviderFormatConformance([{ path: marketplace ? ".claude-plugin/marketplace.json" : "plugins/example/.claude-plugin/plugin.json", content: new TextEncoder().encode(JSON.stringify(marketplace ? { name: "market", owner: { name: "Owner" }, plugins: [{ ...plugin, source: "./example" }] } : plugin)) }]);
}
for (const marketplace of [false, true]) describe(`${marketplace ? "marketplace" : "standalone"} experimental`, () => {
  const providerRef = marketplace ? "claude-marketplace-schema" : "claude-plugin-manifest-schema";
  const prefix = `${marketplace ? "plugins[0]." : ""}experimental`;
  it("accepts all five provider-known fields and their empty containers", () => {
    for (const value of [{}, { themes: "./themes", outputStyles: ["./styles"], monitors: [], evals: "arbitrary", syntaxHighlighting: { hljsLanguages: [] } }, { themes: [], outputStyles: [], evals: ["", "/absolute", "../relative"] }]) expect(check(value, marketplace).ok).toBe(true);
  });
  it("retains blocking unknown/nonobject policy without claiming parser rejection", () => {
    for (const value of [null, 42, [], "value"]) expect(check(value, marketplace).issues).toHaveLength(1);
    const issues=check({ future: true }, marketplace).issues;
    expect(issues).toEqual([expect.objectContaining({ providerRef, code:"unknown-destination-field", message:expect.stringContaining(`${prefix}.future`) })]);
  });
  it("validates known child types and only path-bearing fields as relative paths", () => {
    for (const field of ["themes", "outputStyles", "evals"]) {
      for (const value of [42, null, {}, [42]]) expect(check({ [field]:value }, marketplace).issues).toHaveLength(1);
    }
    for (const field of ["themes", "outputStyles"]) {
      for (const value of ["plain", "", "/absolute", "."]) expect(check({ [field]:value }, marketplace).ok).toBe(false);
      expect(check({ [field]:["./ok", "bad"] }, marketplace).issues).toEqual([expect.objectContaining({ providerRef, message:expect.stringContaining(`${prefix}.${field}[1]`) })]);
    }
    expect(check({ monitors:[{ name:"watch", command:"watch.sh", description:"Watch" }] }, marketplace).ok).toBe(true);
    expect(check({ monitors:[42] }, marketplace).issues).toHaveLength(1);
  });
  it("requires strict syntax highlighting container and language records", () => {
    for (const value of [null, 42, [], {}, { hljsLanguages:42 }, { hljsLanguages:[], future:true }, { hljsLanguages:[null] }, { hljsLanguages:[{}] }, { hljsLanguages:[{ id:"js", future:true }] }]) expect(check({ syntaxHighlighting:value }, marketplace).ok).toBe(false);
    expect(check({ syntaxHighlighting:{ hljsLanguages:[{ id:"js" }, { id:"js" }] } }, marketplace).ok).toBe(true);
    expect(check({ syntaxHighlighting:{ hljsLanguages:Array.from({length:16},()=>({id:"js"})) } }, marketplace).ok).toBe(true);
    expect(check({ syntaxHighlighting:{ hljsLanguages:Array.from({length:17},()=>({id:"js"})) } }, marketplace).issues).toHaveLength(1);
    expect(check({ syntaxHighlighting:{ hljsLanguages:[{id:"js"},42] } }, marketplace).issues).toEqual([expect.objectContaining({ providerRef, message:expect.stringContaining(`${prefix}.syntaxHighlighting.hljsLanguages[1]`) })]);
  });
  it("validates identifier bounds and syntax without trimming", () => {
    for (const id of ["a", "a-b_0", "a".repeat(64)]) expect(check({syntaxHighlighting:{hljsLanguages:[{id}]}},marketplace).ok).toBe(true);
    for (const id of [null,42,"","Js","1js","js.lang"," js","a".repeat(65)]) expect(check({syntaxHighlighting:{hljsLanguages:[{id}]}},marketplace).issues).toHaveLength(1);
  });
  it("validates optional remote and integrity independently against pinned syntax", () => {
    for (const remote of ["npm:pkg", "npm:@scope/pkg@1.2.3", "github:owner/repo@main#lang.js"]) expect(check({syntaxHighlighting:{hljsLanguages:[{id:"js",remote}]}},marketplace).ok).toBe(true);
    for (const remote of [null,42,"","https://example.com/lang.js","npm:UPPER","github:owner/repo#lang.js","npm:"+"a".repeat(253)]) expect(check({syntaxHighlighting:{hljsLanguages:[{id:"js",remote}]}},marketplace).issues).toHaveLength(1);
    for (const integrity of ["sha256-a=", "sha384-+/=", "sha512-"+"a".repeat(505)]) expect(check({syntaxHighlighting:{hljsLanguages:[{id:"js",integrity}]}},marketplace).ok).toBe(true);
    for (const integrity of [null,42,"","sha1-abc","sha256-?","sha512-"+"a".repeat(506)]) expect(check({syntaxHighlighting:{hljsLanguages:[{id:"js",integrity}]}},marketplace).issues).toHaveLength(1);
  });
});
