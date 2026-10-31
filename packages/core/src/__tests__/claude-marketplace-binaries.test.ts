import { expect, test } from "bun:test";
import { checkProviderFormatConformance } from "../index";
import { checkClaudeMarketplace } from "../claude-format-conformance";

const digest = "a".repeat(64);
const valid = { tool: { sha256: digest } };
const entries = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`tool-${i}`, { sha256: digest }]));
const cases: readonly (readonly [string, unknown])[] = [
  ["empty", {}], ["valid", valid], ["null", null], ["number", 42], ["text", "file"], ["array", [valid]],
  ["invalid basename", { "../tool": { sha256: digest } }], ["invalid hash", { tool: { sha256: "A".repeat(64) } }],
  ["extra member keys", { tool: { sha256: digest, future: { keep: true } } }],
  ["mixed", { bad: null, ...valid }], ...[16, 17, 64, 65].map(count => [`${count} entries`, entries(count)] as const),
];
for (const [name, binaries] of cases) test(`marketplace recognizes ${name} binary input without inventing a strict rejection`, () => {
  const file = { path: ".claude-plugin/marketplace.json", sourcePath: "source/marketplace.json", content: new TextEncoder().encode(JSON.stringify({ name: "market", owner: { name: "Owner" }, plugins: [{ name: "example", source: "./example", binaries }] })) };
  const before = file.content.slice();
  expect(checkClaudeMarketplace(file)).toEqual([]);
  expect(checkProviderFormatConformance([file]).ok).toBe(true);
  expect(file.content).toEqual(before);
});
test("keeps unknown names and standalone field support separate", () => {
  const content = new TextEncoder().encode(JSON.stringify({ name: "example", binaries: valid }));
  const result = checkProviderFormatConformance([{ path: "plugins/example/.claude-plugin/plugin.json", content }]);
  expect(result.issues.some(issue => issue.code === "unknown-destination-field" && issue.message.includes("binaries"))).toBe(true);
  const marketplace = { name: "market", owner: { name: "Owner" }, plugins: [{ name: "example", source: "./example", binaires: valid }] };
  expect(checkClaudeMarketplace({ path: ".claude-plugin/marketplace.json", content: new TextEncoder().encode(JSON.stringify(marketplace)) }).some(issue => issue.code === "unknown-destination-field")).toBe(true);
});
