import { expect, test } from "bun:test";
import { readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { captureMcpDependencyCandidates, mcpDependencyFindings, qualifyMcpDependencySources } from "../adoption-mcp-dependencies";
import { recordImportedFindings } from "../adoption-findings";
import { MIGRATION_STATE_PATH } from "../migration-state";
import type { JsonValue, BuildGraph } from "../types";

const path = ".skillset/plugins/demo/.mcp.json";
async function capture(server: JsonValue, files: readonly string[] = []) {
  const root = await createTestFixtureRoot("mcp-candidates-");
  for (const file of files) await Bun.write(join(root, file), "script");
  const parsed = { mcpServers: { "a~/b": server, second: server } };
  const content = JSON.stringify(parsed);
  await Bun.write(join(root, path), content);
  const source = await captureMcpDependencyCandidates(root, parsed, content, { path, configPath: ".skillset/plugins/demo/skillset.yaml" });
  return { root, content, source: { ...source, outputRoot: "output/plugins/demo", emittedPaths: [] } };
}

test.each([
  ["no arguments", { command: "node" }],
  ["missing", { command: "node", args: ["server/missing.js"] }],
  ["dynamic", { command: "node", args: ["${ENTRYPOINT}"] }],
  ["absolute", { command: "node", args: ["/outside.js"] }],
  ["parent", { command: "node", args: ["../outside.js"] }],
  ["flags", { command: "node", args: ["--eval", "script.js"] }],
  ["extra args", { command: "node", args: ["script.js", "other"] }],
  ["cwd", { command: "node", args: ["script.js"], cwd: "other" }],
] as const)("%s remains unverified rather than a precise omitted original", async (_label, server) => {
  const { source, content } = await capture(server as unknown as JsonValue, ["script.js"]);
  const flags = mcpDependencyFindings(source, content);
  expect(flags).toHaveLength(2);
  expect(flags.every((flag) => flag.code === "adopt.mcp-local-candidate-unverified" && flag.severity === "warning")).toBe(true);
});

test("escaped pointers distinguish stable occurrences in the same source", async () => {
  const { source, content } = await capture({ command: "node", args: ["server/start.js"] }, ["server/start.js"]);
  const flags = mcpDependencyFindings(source, content);
  expect(new Set(flags.map((flag) => flag.id)).size).toBe(2);
  expect(flags[0]?.evidence[0]?.summary).toContain("/mcpServers/a~0~1b/args/0");
  expect(mcpDependencyFindings(source, content)).toEqual(flags);
});

test("symlink components never establish original file presence", async () => {
  const { root, content } = await capture({ command: "node", args: ["linked/start.js"] }, ["actual/start.js"]);
  await symlink(join(root, "actual"), join(root, "linked"));
  const source = await captureMcpDependencyCandidates(root, JSON.parse(content), content, { path, configPath: "unused" });
  expect(source.candidates.every((candidate) => !candidate.originalFile)).toBe(true);
});

test("failed and unselected rendering provide no omission evidence", async () => {
  const { root, source } = await capture({ command: "node", args: ["server/start.js"] }, ["server/start.js"]);
  const graph = { rootPath: root, plugins: [] } as unknown as BuildGraph;
  expect(qualifyMcpDependencySources([source], graph, { ok: false, data: [] })).toEqual([]);
  expect(qualifyMcpDependencySources([source], graph, { ok: true, data: [] })).toEqual([]);
});

test("stale capture and concurrent JSON edits cannot create an authoritative ledger", async () => {
  const { root, source, content } = await capture({ command: "node", args: ["server/start.js"] }, ["server/start.js"]);
  expect(() => mcpDependencyFindings(source, `${content}\n`)).toThrow("changed after");
  await expect(recordImportedFindings(root, { mcpDependencies: [source] }, {
    testHooks: { beforeInitialInspection: async () => { await Bun.write(join(root, path), `${content}\n`); } },
  })).rejects.toThrow();
  expect(await Bun.file(join(root, MIGRATION_STATE_PATH)).exists()).toBe(false);
  expect(await readFile(join(root, path), "utf8")).toBe(`${content}\n`);
});

test("selected Cursor without an emitted native manifest provides no omission proof", async () => {
  const { root, source } = await capture({ command: "node", args: ["server/start.js"] }, ["server/start.js"]);
  const graph = {
    rootPath: root,
    root: { outputs: { plugins: { cursor: "plugins" }, targetOutputs: { cursor: { plugins: true } } } },
    plugins: [{ id: "demo", configPath: source.configPath, targets: { cursor: { enabled: true } } }],
  } as unknown as BuildGraph;
  expect(qualifyMcpDependencySources([source], graph, { ok: true, data: [] })).toEqual([]);
});
