import { describe, expect, it } from "bun:test";
import { checkProviderFormatConformance } from "../index";

const guard = { PreToolUse: [1] };
const matcher = { hooks: [{ type: "command", command: "check" }] };
const nest = (value: unknown, count: number): unknown => count === 0 ? value : { child: nest(value, count - 1) };
function check(fields: Record<string, unknown>, marketplace = false) {
  const plugin = { name: "example", description: "Example", ...fields };
  return checkProviderFormatConformance([{ path: marketplace ? ".claude-plugin/marketplace.json" : "plugins/example/.claude-plugin/plugin.json", sourcePath: "source/plugin.json", content: new TextEncoder().encode(JSON.stringify(marketplace ? { name: "market", owner: { name: "Owner" }, plugins: [{ ...plugin, source: "./example" }] } : plugin)) }]);
}
const misplaced = (fields: Record<string, unknown>, marketplace = false) => check(fields, marketplace).issues.filter(issue => issue.message.includes("misplaced guarding hook"));

describe("standalone misplaced hook preflight", () => {
  it("detects the settings reproduction through the public API with file attribution", () => {
    const result = check({ settings: { unrelated: { PreToolUse: [matcher] } } });
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ providerRef: "claude-plugin-manifest-schema", code: "invalid-shape", outputPath: "plugins/example/.claude-plugin/plugin.json", sourcePath: "source/plugin.json" });
    expect(result.issues[0]!.message).toContain("hooks");
    expect(result).toEqual(check({ settings: { unrelated: { PreToolUse: [matcher] } } }));
  });
  it("checks immediate guards before the depth cutoff", () => {
    for (const depth of [2, 3]) expect(misplaced({ settings: nest(guard, depth) })).toHaveLength(1);
    expect(check({ settings: nest(guard, 4) }).ok).toBe(true);
  });
  it("applies exclusions at every scanned depth", () => {
    for (const key of ["metadata", "mcpServers", "lspServers", "experimental"]) {
      expect(check({ settings: { [key]: guard } }).ok).toBe(true);
      expect(check({ settings: { child: { [key]: matcher } } }).ok).toBe(true);
    }
    expect(misplaced({ metadata: guard })).toHaveLength(0);
  });
  it("scans experimental separately with the synthetic unlifted boundary", () => {
    expect(misplaced({ experimental: nest(guard, 3) })).toHaveLength(1);
    expect(misplaced({ experimental: nest(guard, 4) })).toHaveLength(0);
    expect(misplaced({ experimental: { metadata: guard } })).toHaveLength(0);
  });
  it("keeps null and empty guard keys distinct from other values", () => {
    for (const value of [null, []]) expect(check({ settings: { PermissionRequest: value } }).ok).toBe(true);
    for (const value of [false, 0, "", {}, [null]]) expect(misplaced({ settings: { PermissionRequest: value } })).toHaveLength(1);
  });
  it("recognizes matcher shapes without treating empty or event-map hooks as matchers", () => {
    for (const value of [matcher, { matcher: null, hooks: {} }, { hooks: { type: "future" } }]) expect(misplaced({ settings: value })).toHaveLength(1);
    for (const value of [{ hooks: [] }, { hooks: {} }, { hooks: "text" }, { PostToolUse: [], hooks: [1] }, { PostToolUse: [matcher] }]) expect(check({ settings: value }).ok).toBe(true);
    expect(misplaced({ settings: { PostToolUse: [], matcher: null, hooks: [1] } })).toHaveLength(1);
  });
  it("stops below typed hook handlers but checks their immediate guards first", () => {
    const wrap = (handler: unknown) => ({ settings: { PostToolUse: [], hooks: [handler] } });
    expect(check(wrap({ type: "command", extra: guard })).ok).toBe(true);
    expect(misplaced(wrap({ type: "command", ...guard }))).toHaveLength(1);
    expect(misplaced(wrap({ extra: guard }))).toHaveLength(1);
  });
  it("detects nested hook arrays without traversing arbitrary object descendants", () => {
    for (const value of [[matcher], [[guard]], [{ PermissionRequest: false }]]) expect(misplaced({ hooks: [value] })).toHaveLength(1);
    for (const value of [[{ extra: guard }], [{ PreToolUse: [] }], [{ hooks: [] }]]) expect(misplaced({ hooks: [value] })).toHaveLength(0);
  });
  it("does not apply standalone preflight to marketplace entries", () => {
    expect(check({ settings: { unrelated: guard } }, true).ok).toBe(true);
    expect(check({ metadata: guard }, true).ok).toBe(true);
    expect(misplaced({ hooks: [[matcher]] }, true)).toHaveLength(0);
  });
});

it("observes objects without modifying them and preserves scan ordering", async () => {
  const { checkClaudeMisplacedHooks } = await import("../claude-hook-guard-scan");
  const value = { settings: guard, experimental: guard, hooks: [[matcher]] };
  const before = JSON.stringify(value);
  const file = { path: "plugins/example/.claude-plugin/plugin.json", content: new Uint8Array() };
  const result = checkClaudeMisplacedHooks(file, value);
  expect(result).toHaveLength(3);
  expect(result.map(item => item.message)).toEqual([
    expect.stringContaining("top level"), expect.stringContaining("under experimental"), expect.stringContaining("nested hooks array"),
  ]);
  expect(checkClaudeMisplacedHooks(file, value)).toEqual(result);
  expect(JSON.stringify(value)).toBe(before);
  const inherited = Object.create(guard);
  expect(checkClaudeMisplacedHooks(file, { settings: inherited })).toEqual([]);
});
