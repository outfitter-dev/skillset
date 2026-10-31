import { expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { readPluginDependencies } from "../dependencies";
import { InputValidationError } from "../input-validation-error";
import { loadBuildGraph } from "../resolver";
import { validateSupports } from "../supports";

async function caught(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected rejection");
}

for (const onMismatch of ["warn", "error"] as const) {
  test(`${onMismatch} preserves missing and malformed package policy`, async () => {
    const rootPath = await createTestFixtureRoot("supports-failure-");
    for (const content of [undefined, "{"]) {
      if (content !== undefined)
        await Bun.write(join(rootPath, "package.json"), content);
      const warnings: string[] = [];
      const action = () =>
        validateSupports(
          {
            packages: [
              {
                name: "demo",
                range: "*",
                source: "repo:package.json",
                onMismatch,
              },
            ],
          },
          { rootPath, label: "fixture", warnings }
        );
      if (onMismatch === "warn") {
        await action();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("could not be read as package JSON");
      } else {
        const error = await caught(action);
        expect(error).toBeInstanceOf(InputValidationError);
        expect((error as Error).message).toContain(
          "could not be read as package JSON"
        );
        if (content === undefined)
          expect((error as Error).cause).toMatchObject({ code: "ENOENT" });
        else expect((error as Error).cause).toBeInstanceOf(SyntaxError);
        expect(warnings).toEqual([]);
      }
    }
  });

  test.each(["EACCES", "EIO", "ELOOP", "ENOTDIR", "internal"])(
    `${onMismatch} propagates %s without warnings`,
    async (code) => {
      const root = await createTestFixtureRoot("supports-io-");
      await Bun.write(
        join(root, "skillset.yaml"),
        "compile: {targets: [claude]}\n"
      );
      await Bun.write(
        join(root, ".skillset/plugins/demo/skillset.yaml"),
        `skillset: {name: demo}\nsupports:\n  packages:\n    - {name: demo, range: '*', source: 'repo:package.json', onMismatch: ${onMismatch}}\n`
      );
      const result = Bun.spawnSync(
        [
          process.execPath,
          "--eval",
          `
      import assert from "node:assert/strict";
      import { mock } from "bun:test";
      const fs = await import("node:fs/promises");
      const original = Object.assign(new TypeError("injected failure"), ${JSON.stringify(code)} === "internal" ? {} : {code: ${JSON.stringify(code)}});
      const readFile = fs.readFile;
      mock.module("node:fs/promises", () => ({...fs, readFile: async (path, ...args) => {
        if (path === ${JSON.stringify(join(root, "package.json"))}) throw original;
        return readFile(path, ...args);
      }}));
      const {validateSupports} = await import("./packages/core/src/supports.ts");
      const warnings = [];
      await assert.rejects(validateSupports({packages: [{name: "demo", range: "*", source: "repo:package.json", onMismatch: ${JSON.stringify(onMismatch)}}]}, {rootPath: ${JSON.stringify(root)}, label: "fixture", warnings}), error => error === original);
      assert.deepEqual(warnings, []);
      const {loadBuildGraph} = await import("./packages/core/src/resolver.ts");
      await assert.rejects(loadBuildGraph(${JSON.stringify(root)}), error => error.code === "plugin-manifest-invalid" && error.cause === original);
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

test("dependency shape and range rejections retain typed causes", () => {
  expect(() => readPluginDependencies([], "fixture")).toThrow(
    InputValidationError
  );
  expect(() =>
    readPluginDependencies(
      { plugins: [{ name: "demo", range: "bad" }] },
      "fixture"
    )
  ).toThrow(InputValidationError);
  expect(
    readPluginDependencies({ plugins: ["plugin:demo"] }, "fixture")
  ).toEqual([
    {
      kind: "internal",
      name: "demo",
      sourceLabel: "fixture",
      unversioned: false,
    },
  ]);
});

test.each([
  ["origin: wrong", "origin must be an object"],
  ["origin: {}", "origin.path"],
  ["origin: {path: source, repo: owner/repo}", "repo and ref together"],
  ["dependencies: {plugins: [plugin:demo]}", "must not depend on itself"],
  ["dependencies: {plugins: [plugin:absent]}", "unknown plugin absent"],
])("graph preserves input validation cause for %s", async (entry, message) => {
  const root = await createTestFixtureRoot("supports-graph-");
  await Bun.write(
    join(root, "skillset.yaml"),
    "compile: {targets: [claude]}\n"
  );
  const manifest = entry.startsWith("origin:")
    ? `skillset:\n  name: demo\n  ${entry}\n`
    : `skillset: {name: demo}\n${entry}\n`;
  await Bun.write(join(root, ".skillset/plugins/demo/skillset.yaml"), manifest);
  const error = await caught(() => loadBuildGraph(root));
  expect((error as Error).message).toContain(message);
  expect((error as Error).cause).toBeInstanceOf(InputValidationError);
});
