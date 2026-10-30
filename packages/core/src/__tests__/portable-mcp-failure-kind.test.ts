import { expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { InputValidationError } from "../input-validation-error";
import { parsePortableMcpSource } from "../portable-mcp";
import { loadBuildGraph } from "../resolver";

async function fixture(server: unknown = { command: "node" }) {
  const root = await createTestFixtureRoot("mcp-failure-");
  const pluginRoot = join(root, ".skillset/plugins/demo");
  const sourcePath = join(pluginRoot, ".mcp.json");
  await Bun.write(
    join(root, "skillset.yaml"),
    "compile: {targets: [claude]}\n"
  );
  await Bun.write(
    join(pluginRoot, "skillset.yaml"),
    "skillset: {name: demo}\nmcp: true\n"
  );
  await Bun.write(sourcePath, JSON.stringify({ mcpServers: { demo: server } }));
  await Bun.write(
    join(pluginRoot, "scripts/server.js"),
    "// fixture; never executed\n"
  );
  return { root, pluginRoot, sourcePath };
}
async function caught(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected rejection");
}

test("MCP syntax error keeps logical diagnostic and typed syntax cause", async () => {
  const input = await fixture();
  await Bun.write(input.sourcePath, "{");
  const error = await caught(() => loadBuildGraph(input.root));
  expect(error).toMatchObject({
    code: "plugin-mcp-invalid",
    featureId: "plugin-mcp",
    path: ".skillset/plugins/demo/.mcp.json",
  });
  const cause = (error as Error).cause;
  expect(cause).toBeInstanceOf(InputValidationError);
  expect((cause as Error).cause).toBeInstanceOf(SyntaxError);
});

test.each([
  {},
  { command: 42 },
  { command: "node", args: [false] },
  { command: "node", cwd: "../outside" },
  { command: "node", env: { BAD: false } },
  { type: "sse", url: "relative" },
  { type: "sse", url: "http://example.com" },
])("MCP rejects authored invalid server %j as input", async (server) => {
  const input = await fixture(server);
  expect(await caught(() => parsePortableMcpSource(input))).toBeInstanceOf(
    InputValidationError
  );
});

const supportCases = [
  {
    name: "cwd",
    server: { command: "node", cwd: "./scripts/missing" },
    path: "scripts/missing",
  },
  {
    name: "command",
    server: { command: "./scripts/missing.js" },
    path: "scripts/missing.js",
  },
  {
    name: "argument",
    server: { command: "node", args: ["${PLUGIN_ROOT}/scripts/missing.js"] },
    path: "scripts/missing.js",
  },
];
for (const item of supportCases) {
  test(`missing ${item.name} keeps input error and errno cause`, async () => {
    const input = await fixture(item.server);
    const error = await caught(() => parsePortableMcpSource(input));
    expect(error).toBeInstanceOf(InputValidationError);
    expect((error as Error).message).toContain("does not exist");
    expect((error as Error).cause).toMatchObject({ code: "ENOENT" });
  });
}

for (const operation of [
  "read",
  "cwd",
  "command",
  "argument",
  "root-realpath",
  "child-realpath",
] as const) {
  test.each(["EACCES", "EIO", "ENOTDIR", "ELOOP", "internal"])(
    `${operation} preserves %s`,
    async (code) => {
      const support = supportCases.find((item) => item.name === operation);
      const input = await fixture(
        support?.server ??
          (operation === "child-realpath"
            ? { command: "./scripts/server.js" }
            : { command: "node" })
      );
      const path =
        operation === "read"
          ? input.sourcePath
          : operation === "root-realpath"
            ? input.pluginRoot
            : join(input.pluginRoot, support?.path ?? "scripts/server.js");
      const method =
        operation === "read"
          ? "readFile"
          : operation.endsWith("realpath")
            ? "realpath"
            : "stat";
      const result = Bun.spawnSync(
        [
          process.execPath,
          "--eval",
          `
      import assert from "node:assert/strict";
      import {mock} from "bun:test";
      const fs = await import("node:fs/promises");
      const original = Object.assign(new TypeError("injected MCP failure"), ${JSON.stringify(code)} === "internal" ? {} : {code: ${JSON.stringify(code)}});
      const method = ${JSON.stringify(method)};
      const originalMethod = fs[method];
      mock.module("node:fs/promises", () => ({...fs, [method]: async (path, ...args) => {
        if (path === ${JSON.stringify(path)}) throw original;
        return originalMethod(path, ...args);
      }}));
      const {parsePortableMcpSource} = await import("./packages/core/src/portable-mcp.ts");
      await assert.rejects(parsePortableMcpSource(${JSON.stringify(input)}), error => error === original);
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

for (const failure of ["URL", "source parser", "pinned schema"] as const) {
  test(`${failure} implementation faults remain internal`, async () => {
    const input = await fixture({ type: "sse", url: "https://example.com" });
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import assert from "node:assert/strict";
      import {mock} from "bun:test";
      const original = new TypeError("injected implementation failure");
      const failure = ${JSON.stringify(failure)};
      if (failure === "pinned schema") {
        const registry = await import("@skillset/registry");
        mock.module("@skillset/registry", () => ({...registry, listStandardProfileSchemaSnapshots: () => {throw original;}}));
      }
      const {parsePortableMcpSource} = await import("./packages/core/src/portable-mcp.ts");
      if (failure === "URL") {
        const NativeURL = URL;
        globalThis.URL = class extends NativeURL { constructor(...args) { super(...args); throw original; } };
      } else if (failure === "source parser") {
        const source = await Bun.file(${JSON.stringify(input.sourcePath)}).text();
        const parse = JSON.parse;
        JSON.parse = (text, ...args) => {if (text === source) throw original; return parse(text, ...args);};
      }
      await assert.rejects(parsePortableMcpSource(${JSON.stringify(input)}), error => error === original);
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
  });
}
