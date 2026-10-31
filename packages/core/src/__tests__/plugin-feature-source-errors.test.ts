import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { InputValidationError } from "../input-validation-error";
import { resolveInside } from "../path";
import { loadBuildGraph } from "../resolver";

async function fixture(config: string) {
  const root = await createTestFixtureRoot("feature-source-errors-");
  const pluginRoot = join(root, ".skillset/plugins/demo");
  await Bun.write(
    join(root, "skillset.yaml"),
    "compile: {targets: [claude]}\n"
  );
  await Bun.write(
    join(pluginRoot, "skillset.yaml"),
    `skillset: {name: demo}\n${config}\n`
  );
  return { root, pluginRoot };
}
async function caught(action: () => unknown): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected rejection");
}

test.each([
  ["mcp: true", "requires conventional source"],
  ["mcp: {source: 'outside:file'}", "repo:<path>"],
  ["mcp: {source: 'repo:missing.json'}", "missing path"],
  ["mcp: {source: 'repo:../outside.json'}", "outside repo root"],
  ["mcp: {source: 'repo:.'}", "outside repo root"],
  ["mcp: {source: 'repo:plugins/demo/mcp.json'}", "generated output root"],
])("feature source %s preserves typed cause", async (config, message) => {
  const { root } = await fixture(config);
  const error = await caught(() => loadBuildGraph(root));
  expect(error).toMatchObject({
    code: "plugin-mcp-invalid",
    featureId: "plugin-mcp",
    path: ".skillset/plugins/demo/skillset.yaml",
  });
  expect((error as Error).message).toContain(message);
  expect((error as Error).cause).toBeInstanceOf(InputValidationError);
});

test("feature source kinds reject directories and files precisely", async () => {
  const mcp = await fixture("mcp: true");
  await mkdir(join(mcp.pluginRoot, ".mcp.json"));
  const bin = await fixture("bin: true");
  await Bun.write(join(bin.pluginRoot, "bin"), "not a directory");
  for (const input of [mcp, bin]) {
    const error = await caught(() => loadBuildGraph(input.root));
    expect((error as Error).cause).toBeInstanceOf(InputValidationError);
    expect((error as Error).message).toContain(
      input === mcp ? "must be a file" : "must be a directory"
    );
  }
});

test("containment rejects have a distinct signal but path implementation faults do not", async () => {
  const error = await caught(() =>
    resolveInside("/repo", "../escape", { path: posix })
  );
  expect(error).toMatchObject({ name: "PathContainmentError" });
  const original = new TypeError("path implementation fault");
  expect(
    await caught(() =>
      resolveInside("/repo", "ok", {
        path: {
          ...posix,
          resolve: () => {
            throw original;
          },
        },
      })
    )
  ).toBe(original);
});

for (const selected of ["conventional", "explicit"] as const) {
  test.each(["EACCES", "EIO", "ENOTDIR", "internal", "vanished"])(
    `${selected} preserves %s stat failure`,
    async (code) => {
      const input = await fixture(
        selected === "conventional"
          ? "mcp: true"
          : "mcp: {source: 'repo:server.json'}"
      );
      const path =
        selected === "conventional"
          ? join(input.pluginRoot, ".mcp.json")
          : join(input.root, "server.json");
      await Bun.write(
        path,
        JSON.stringify({ mcpServers: { demo: { command: "node" } } })
      );
      const result = Bun.spawnSync(
        [
          process.execPath,
          "--eval",
          `
      import assert from "node:assert/strict";
      import {mock} from "bun:test";
      const fs = await import("node:fs/promises");
      const stat = fs.stat;
      const code = ${JSON.stringify(code)};
      const original = Object.assign(new TypeError("injected stat failure"), code === "internal" ? {} : {code: code === "vanished" ? "ENOENT" : code});
      let seen = false;
      mock.module("node:fs/promises", () => ({...fs, stat: async (path, ...args) => {
        if (path === ${JSON.stringify(path)}) {
          if (code !== "vanished" || seen) throw original;
          seen = true;
        }
        return stat(path, ...args);
      }}));
      const {loadBuildGraph} = await import("./packages/core/src/resolver.ts");
      await assert.rejects(loadBuildGraph(${JSON.stringify(input.root)}), error => error.code === "plugin-mcp-invalid" && error.cause === original);
    `,
        ],
        {
          cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      expect(new TextDecoder().decode(result.stderr)).toBe("");
      expect(result.exitCode).toBe(0);
    }
  );
}

test("conventional and explicit MCP selections still load", async () => {
  for (const selected of ["conventional", "explicit"]) {
    const input = await fixture(
      selected === "conventional"
        ? "mcp: true"
        : "mcp: {source: 'repo:server.json'}"
    );
    const path =
      selected === "conventional"
        ? join(input.pluginRoot, ".mcp.json")
        : join(input.root, "server.json");
    await Bun.write(
      path,
      JSON.stringify({ mcpServers: { demo: { command: "node" } } })
    );
    const graph = await loadBuildGraph(input.root);
    expect(graph.plugins[0]?.features[0]?.sourcePath).toBe(path);
  }
});
