import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { SkillsetFeatureDiagnosticError } from "../operation-result";
import { loadBuildGraph, validateAdaptiveHookScriptSource } from "../resolver";

async function fixture(
  content: string
): Promise<{ root: string; hook: string; script: string }> {
  const root = await createTestFixtureRoot("skillset-hook-source-errors-");
  const hook = join(root, ".skillset/plugins/demo/hooks/start/hook.json");
  const script = join(root, ".skillset/plugins/demo/hooks/start/script.js");
  await Bun.write(
    join(root, "skillset.yaml"),
    "compile:\n  targets: [claude]\n"
  );
  await Bun.write(
    join(root, ".skillset/plugins/demo/skillset.yaml"),
    "skillset:\n  name: demo\n"
  );
  await Bun.write(hook, content);
  await Bun.write(script, "// fixture only; never executed\n");
  return { root, hook, script };
}
const hookJson = JSON.stringify({
  events: ["SessionStart"],
  run: { script: "./script.js" },
});

async function caught(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected rejection");
}

test("invalid hook JSON retains its diagnostic and syntax cause", async () => {
  const { root } = await fixture("{");
  const error = await caught(() => loadBuildGraph(root));
  expect(error).toBeInstanceOf(SkillsetFeatureDiagnosticError);
  expect(error).toMatchObject({
    code: "adaptive-hook-invalid-json",
    featureId: "adaptive-hooks",
    path: ".skillset/plugins/demo/hooks/start/hook.json",
  });
  expect((error as Error).cause).toBeInstanceOf(SyntaxError);
});

test("hook shape and valid controls keep their semantics", async () => {
  const bad = await fixture("[]");
  expect(await caught(() => loadBuildGraph(bad.root))).toMatchObject({
    code: "adaptive-hook-invalid",
  });
  const good = await fixture(hookJson);
  expect((await loadBuildGraph(good.root)).adaptiveHooks.length).toBe(1);
});

test.each(["ENOENT", "ENOTDIR"])(
  "missing script %s retains source diagnostic and cause",
  async (code) => {
    const { root, hook, script } = await fixture(hookJson);
    const missing =
      code === "ENOENT" ? join(root, "missing.js") : join(script, "child.js");
    const error = await caught(() =>
      validateAdaptiveHookScriptSource(root, missing, hook, "./missing.js")
    );
    expect(error).toMatchObject({
      code: "adaptive-hook-script-missing",
      featureId: "adaptive-hooks",
      path: ".skillset/plugins/demo/hooks/start/hook.json",
    });
    expect((error as Error).cause).toMatchObject({ code });
  }
);

test("an existing script directory is invalid rather than missing", async () => {
  const { root, hook } = await fixture(hookJson);
  const path = join(root, "directory");
  await mkdir(path);
  expect(
    await caught(() =>
      validateAdaptiveHookScriptSource(root, path, hook, "./directory")
    )
  ).toMatchObject({ code: "adaptive-hook-script-invalid" });
});

test.each(["EACCES", "EIO", "ELOOP", "internal"])(
  "hook reads and script stats preserve %s",
  async (code) => {
    const { root, hook, script } = await fixture(hookJson);
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
    import assert from "node:assert/strict";
    import { mock } from "bun:test";
    const fs = await import("node:fs/promises");
    const readFile = fs.readFile;
    const stat = fs.stat;
    const original = Object.assign(new TypeError("injected source failure"), ${JSON.stringify(code)} === "internal" ? {} : {code: ${JSON.stringify(code)}});
    let readFault = true;
    mock.module("node:fs/promises", () => ({...fs,
      readFile: async (path, ...args) => { if (readFault && path === ${JSON.stringify(hook)}) throw original; return readFile(path, ...args); },
      stat: async (path, ...args) => { if (!readFault && path === ${JSON.stringify(script)}) throw original; return stat(path, ...args); },
    }));
    const {loadBuildGraph, validateAdaptiveHookScriptSource} = await import("./packages/core/src/resolver.ts");
    await assert.rejects(loadBuildGraph(${JSON.stringify(root)}), error => error === original);
    readFault = false;
    await assert.rejects(validateAdaptiveHookScriptSource(${JSON.stringify(root)}, ${JSON.stringify(script)}, ${JSON.stringify(hook)}, "./script.js"), error => error === original);
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
