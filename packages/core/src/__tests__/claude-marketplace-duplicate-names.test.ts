import { describe, expect, test } from "bun:test";
import { checkProviderFormatConformance } from "@skillset/core";
import { checkClaudeMarketplace } from "../claude-format-conformance";

function marketplace(names: readonly unknown[]) {
  return { path: ".claude-plugin/marketplace.json", content: new TextEncoder().encode(JSON.stringify({
    name: "example", owner: { name: "Publisher" },
    plugins: names.map((name, index) => ({ name, source: `./plugin-${index}` })),
  })) };
}

describe("SET-800 duplicate marketplace plugin names", () => {
  test.each(["demo", "constructor", "toString"])("rejects repeated %s across distinct sources", (name) => {
    const file = marketplace([name, "unique", name, name]);
    const issues = checkClaudeMarketplace(file);
    expect(issues).toHaveLength(2);
    expect(issues.map(({ message }) => message)).toEqual([
      `destination field plugins[2].name duplicates plugins[0].name: ${name}`,
      `destination field plugins[3].name duplicates plugins[0].name: ${name}`,
    ]);
    expect(issues.every(({ code }) => code === "invalid-shape")).toBe(true);
    expect(checkProviderFormatConformance([file])).toEqual({ checkedFiles: 1, issues, ok: false });
  });
  test.each([[], ["one"], ["demo", "Demo"], ["constructor", "valueOf", "toString"]])("preserves unique names %j", (...names) => {
    const file = marketplace(names);
    expect(checkClaudeMarketplace(file)).toEqual([]);
    expect(checkProviderFormatConformance([file]).ok).toBe(true);
  });
  test("keeps malformed names diagnostic without coercion or crashes", () => {
    const file = marketplace([null, null, 1, 1, {}, {}, "1"]);
    const issues = checkClaudeMarketplace(file);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(({ message }) => message.includes("duplicates"))).toBe(false);
    expect(checkProviderFormatConformance([file]).ok).toBe(false);
  });
});
