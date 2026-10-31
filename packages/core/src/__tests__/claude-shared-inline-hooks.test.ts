import { describe, expect, it } from "bun:test";
import { checkProviderFormatConformance } from "../index";

function check(hooks: unknown, marketplace: boolean) {
  const plugin = { name: "example", description: "Example", hooks };
  return checkProviderFormatConformance([{ path: marketplace ? ".claude-plugin/marketplace.json" : "plugins/example/.claude-plugin/plugin.json", sourcePath: "source/plugin.json", content: new TextEncoder().encode(JSON.stringify(marketplace ? { name: "market", owner: { name: "Owner" }, plugins: [{ ...plugin, source: "./example" }] } : plugin)) }]);
}
const command = { type: "command", command: "" };
const wrap = (handler: unknown) => ({ PostToolUse: [{ hooks: [handler] }] });
for (const marketplace of [false, true]) describe(`${marketplace ? "marketplace" : "standalone"} inline hooks`, () => {
  const providerRef = marketplace ? "claude-marketplace-schema" : "claude-plugin-manifest-schema";
  const prefix = `${marketplace ? "plugins[0]." : ""}hooks`;
  it("accepts every parser handler without applying render capability restrictions", () => {
    for (const handler of [command, {type:"prompt",prompt:""}, {type:"agent",prompt:""}, {type:"http",url:"http://example.com"}, {type:"mcp_tool",server:"",tool:""}]) {
      for (const event of ["PostToolUse", "SessionStart", "PreModelSwitch", "PostModelSwitch", "DirectoryAdded"]) expect(check({[event]:[{hooks:[handler]}]},marketplace).ok).toBe(true);
    }
  });
  it("accepts partial maps, empty arrays and mixed file/map declarations", () => {
    for (const hooks of [{}, {PostToolUse:[]}, {PostToolUse:[{hooks:[]}]}, ["./hooks.json", wrap(command)]]) expect(check(hooks,marketplace).ok).toBe(true);
  });
  it("rejects malformed event, matcher and handler containers with attributed paths", () => {
    for (const hooks of [{PostToolUse:42}, {PreToolUse:null}, {PostToolUse:[null]}, {PostToolUse:[[]]}, {PostToolUse:[{}]}, {PostToolUse:[{hooks:42}]}, wrap(null),wrap([]),wrap({}),wrap({type:42}),wrap({type:"future"})]) {
      const result=check(hooks,marketplace); expect(result.ok).toBe(false);
      expect(result.issues.every(i=>i.providerRef===providerRef && i.sourcePath==="source/plugin.json" && i.message.includes(prefix))).toBe(true);
    }
  });
  it("requires each branch's fields and rejects wrong typed optional fields", () => {
    for (const handler of [{type:"command"}, {type:"command",command:42}, {type:"prompt"}, {type:"agent",prompt:42}, {type:"http",url:42}, {type:"mcp_tool",server:""}, {...command,args:[42]}, {...command,if:null}, {...command,once:1}, {...command,async:"true"}, {...command,statusMessage:false}, {type:"prompt",prompt:"",continueOnBlock:"true"}, {type:"agent",prompt:"",model:false}, {type:"http",url:"https://example.com",headers:{x:42}}, {type:"http",url:"https://example.com",allowedEnvVars:[1]}, {type:"mcp_tool",server:"",tool:"",input:[]}]) expect(check(wrap(handler),marketplace).ok).toBe(false);
  });
  it("honors command enum, positive decimal timeout and nonempty rewake strings", () => {
    for (const patch of [{shell:"zsh"},{timeout:0},{timeout:-1},{timeout:"1"},{rewakeMessage:""},{rewakeSummary:""}]) expect(check(wrap({...command,...patch}),marketplace).ok).toBe(false);
    expect(check(wrap({...command,shell:"powershell",timeout:0.25,args:[""],if:"",statusMessage:"",once:false,async:true,asyncRewake:true,rewakeMessage:"x",rewakeSummary:"x"}),marketplace).ok).toBe(true);
  });
  it("allows unknown stripped fields and deliberately caught cloud values", () => {
    for (const cloud of [null,42,{},"future"]) expect(check(wrap({...command,cloud}),marketplace).ok).toBe(true);
    for (const handler of [{...command,url:42,unused:null}, {type:"agent",prompt:"",continueOnBlock:42}, {type:"mcp_tool",server:"",tool:"",input:{anything:[1,null,{}]}}]) expect(check(wrap(handler),marketplace).ok).toBe(true);
    expect(check({PostToolUse:[{hooks:[command],unused:null}]},marketplace).ok).toBe(true);
  });
  it("checks matcher strings and all five timeout branches", () => {
    expect(check({PostToolUse:[{matcher:42,hooks:[]}]},marketplace).ok).toBe(false);
    expect(check({PostToolUse:[{matcher:"",hooks:[]}]},marketplace).ok).toBe(true);
    for (const handler of [command,{type:"prompt",prompt:""},{type:"agent",prompt:""},{type:"http",url:"https://example.com"},{type:"mcp_tool",server:"",tool:""}]) {
      expect(check(wrap({...handler,timeout:0.5}),marketplace).ok).toBe(true);
      expect(check(wrap({...handler,timeout:null}),marketplace).ok).toBe(false);
    }
  });
  it("rejects unknown and prototype-like event names", () => {
    for (const event of ["Bogus","constructor","__proto__","toString","pretooluse"]) expect(check(JSON.parse(`{"${event}":[]}`),marketplace).ok).toBe(false);
  });
  it("accepts URL schemes allowed by the parser and rejects malformed URLs", () => {
    for (const url of ["mailto:person@example.com","ftp://example.com/path","https://example.com","http://example.com"]) expect(check(wrap({type:"http",url}),marketplace).ok).toBe(true);
    for (const url of ["", "relative/path", "https://[invalid"]) expect(check(wrap({type:"http",url}),marketplace).ok).toBe(false);
  });
  it("keeps original reference and nested handler indices without mutating input", () => {
    const hooks=["./hooks.json",{PostToolUse:[{hooks:[command,{type:"command",command:42}]}]}];
    const before=JSON.stringify(hooks);const result=check(hooks,marketplace);
    expect(result.issues).toEqual([expect.objectContaining({providerRef,code:"invalid-field-type",message:`destination field ${prefix}[1].PostToolUse[0].hooks[1].command must be a string`})]);
    expect(JSON.stringify(hooks)).toBe(before);expect(check(hooks,marketplace)).toEqual(result);
  });
  it("applies standalone guard observations without imposing them on raw marketplace parsing", () => {
    for (const group of [{hooks:[command],extra:{PreToolUse:[1]}},{hooks:[command],metadata:{PermissionRequest:42}},{hooks:[{...command,PreToolUse:[1]}]}]) {
      const result=check({PostToolUse:[group]},marketplace);expect(result.ok).toBe(marketplace);
      if(!marketplace)expect(result.issues[0]?.message).toContain("misplaced guarding hook");
    }
  });
  it("respects guard null/empty values, typed-handler boundary and depth limit", () => {
    for (const group of [{hooks:[command],extra:{PreToolUse:[]}}, {hooks:[command],extra:{PreToolUse:null}}, {hooks:[{...command,extra:{PreToolUse:[1]}}]}, {hooks:[command],a:{b:{c:{d:{PreToolUse:[1]}}}}}]) expect(check({PostToolUse:[group]},marketplace).ok).toBe(true);
    expect(check({PostToolUse:[{hooks:[command],a:{b:{c:{PreToolUse:[1]}}}}]},marketplace).ok).toBe(marketplace);
  });
});

it("observes inline hook objects without normalizing or deleting unknown and caught values", async () => {
  const { checkClaudeInlineHooks } = await import("../claude-inline-hooks-conformance");
  const hooks = { PostToolUse: [{ hooks: [{ ...command, cloud: { future: true }, extra: { keep: "value" } }], unused: null }] };
  const before = JSON.stringify(hooks);
  const file = { path: "plugins/example/.claude-plugin/plugin.json", content: new Uint8Array() };
  expect(checkClaudeInlineHooks(file, hooks, "hooks", "claude-plugin-manifest-schema")).toEqual([]);
  expect(JSON.stringify(hooks)).toBe(before);
});
