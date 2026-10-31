import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CLAUDE_MARKETPLACE_EVIDENCE } from "@skillset/registry";
import { marketplaceDeclarations, marketplaceDigest } from "../../../../scripts/test-helpers/claude-marketplace-coverage";
import coverage from "./fixtures/claude-marketplace-coverage.json";

const root = resolve(import.meta.dirname, "../../../..");
const read = (path: string) => readFile(resolve(root, path), "utf8");

test("SET-488: every marketplace declaration and rule has a reviewed coverage owner", async () => {
  const actual = marketplaceDeclarations(await read(coverage.path));
  expect(actual).toEqual(Object.fromEntries(coverage.declarations.map(({ name, hash }) => [name, hash])));
  const ruleIds = new Set(CLAUDE_MARKETPLACE_EVIDENCE.rules.map(({ id }) => id));
  const covered = new Set<string>();
  for (const entry of [...coverage.declarations, ...coverage.dependencies]) {
    expect(entry.reason.length).toBeGreaterThan(0);
    for (const id of entry.ruleIds) { expect(ruleIds.has(id)).toBe(true); covered.add(id); }
  }
  expect([...covered].sort()).toEqual([...ruleIds].sort());
  expect(marketplaceDigest(JSON.stringify(CLAUDE_MARKETPLACE_EVIDENCE))).toBe(coverage.evidenceHash);
});

test("SET-488: delegated validators and consumed inventories require evidence review on change", async () => {
  for (const dependency of coverage.dependencies) {
    const declarations = marketplaceDeclarations(await read(dependency.path));
    const selected = dependency.declarations.length === 0 ? declarations : Object.fromEntries(dependency.declarations.map((name) => {
      expect(declarations[name]).toBeDefined(); return [name, declarations[name]];
    }));
    expect(marketplaceDigest(JSON.stringify(selected))).toBe(dependency.hash);
  }
});

test("SET-488: coverage detects inline predicates, new declarations, imports and missing owners", async () => {
  const source = await read(coverage.path);
  const baseline = marketplaceDeclarations(source);
  for (const changed of [
    source.replace("source.timeout > 600", "source.timeout > 601"),
    `${source}\nfunction unreviewedRule() { return true; }`,
    `${source}\nconst unreviewedLimit = 900;`,
    source.replace('from "./claude-inline-hooks-conformance"', 'from "./unreviewed-inline-hooks"'),
    source.replace("function checkClaudeMarketplacePluginArrays(", "function renamedClaudeMarketplacePluginArrays("),
  ]) {
    expect(changed).not.toBe(source);
    expect(marketplaceDeclarations(changed)).not.toEqual(baseline);
  }
  expect(marketplaceDeclarations(`// unrelated comment\n${source}`)).toEqual(baseline);
  expect(() => marketplaceDeclarations("function broken( {")).toThrow();
});

test("SET-488: delegated condition and registry inventory mutations change the guarded fingerprints", async () => {
  const hooks = await read("packages/core/src/claude-inline-hooks-conformance.ts");
  expect(marketplaceDeclarations(hooks.replace('typeof handler.type !== "string"', 'typeof handler.type !== "number"'))).not.toEqual(marketplaceDeclarations(hooks));
  const inventories = await read("packages/registry/src/claude-marketplace-inventories.ts");
  expect(marketplaceDeclarations(inventories.replace('archive: ["url"]', 'archive: ["url", "sha256"]'))).not.toEqual(marketplaceDeclarations(inventories));
});
