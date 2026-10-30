import { expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult } from "../build";
import { independentlyObservedOutputBaseline, independentlyObserveOutputBaseline } from "../output-safety";

const config = "compile:\n  targets: [codex]\n";
async function fixture(): Promise<string> {
  const root = await createTestFixtureRoot("output-baseline-errors-");
  await Bun.write(join(root, "skillset.yaml"), config);
  await Bun.write(join(root, ".skillset/rules/root.md"), "# Root guidance\n");
  await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo skill\n---\n\nBody.\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  expect(await independentlyObservedOutputBaseline(root)).toBe(true);
  return root;
}

function probe(code: string): void {
  const child = Bun.spawnSync([process.execPath, "--eval", code], {
    cwd: fileURLToPath(new URL("../../../../", import.meta.url)), stdout: "pipe", stderr: "pipe",
  });
  expect(new TextDecoder().decode(child.stderr)).toBe("");
  expect(child.exitCode).toBe(0);
}

test("baseline recovery retains malformed config and absent config fallback", async () => {
  const root = await fixture();
  for (const malformed of ["bad: [", "workspace: []\n", "codex: invalid\n", "skillset: []\n", "claude:\n  plugins:\n    path: ../outside\n"]) {
    await writeFile(join(root, "skillset.yaml"), malformed);
    expect(await independentlyObservedOutputBaseline(root)).toBe(true);
  }
  await rm(join(root, "skillset.yaml"));
  expect(await independentlyObservedOutputBaseline(root)).toBe(true);
});

test("corrupt locks allow alternate valid roots but do not themselves prove a baseline", async () => {
  const root = await fixture();
  for (const malformed of ["{", "{}"] ) {
    await writeFile(join(root, "skillset.lock"), malformed);
    expect(await independentlyObservedOutputBaseline(root)).toBe(true);
    expect(await independentlyObservedOutputBaseline(root, { scopes: ["project"] })).toBe(false);
  }
  await rm(join(root, ".agents/skills/skillset.lock"));
  expect(await independentlyObservedOutputBaseline(root)).toBe(false);
});

test("config read failures propagate while ENOENT still recovers", async () => {
  const root = await fixture();
  probe(`
    import assert from "node:assert/strict";
    import { mock } from "bun:test";
    const fs = await import("node:fs/promises");
    const readFile = fs.readFile;
    let failure;
    mock.module("node:fs/promises", () => ({ ...fs, readFile: async (path, ...args) => {
      if (path === ${JSON.stringify(join(root, "skillset.yaml"))}) throw failure;
      return readFile(path, ...args);
    }}));
    const { independentlyObservedOutputBaseline: inspect } = await import("./packages/core/src/output-safety.ts");
    for (const code of ["EACCES", "EIO", "ENOTDIR", "internal"]) {
      failure = Object.assign(new TypeError("config read fault"), code === "internal" ? {} : { code });
      await assert.rejects(inspect(${JSON.stringify(root)}), error => error === failure);
    }
    failure = Object.assign(new Error("absent"), { code: "ENOENT" });
    assert.equal(await inspect(${JSON.stringify(root)}), true);
  `);
});

test("unreadable locks and managed output do not disappear into fallback", async () => {
  const root = await fixture();
  probe(`
    import assert from "node:assert/strict";
    import { mock } from "bun:test";
    const fs = await import("node:fs/promises");
    const readFile = fs.readFile;
    let faultPath, failure;
    mock.module("node:fs/promises", () => ({ ...fs, readFile: async (path, ...args) => {
      if (path === faultPath) throw failure;
      return readFile(path, ...args);
    }}));
    const { independentlyObservedOutputBaseline: inspect } = await import("./packages/core/src/output-safety.ts");
    const { GeneratedLockReadError } = await import("./packages/core/src/generated-lock-read.ts");
    for (const code of ["EACCES", "EIO", "ENOTDIR", "internal"]) {
      failure = Object.assign(new TypeError("read fault"), code === "internal" ? {} : { code });
      faultPath = ${JSON.stringify(join(root, "skillset.lock"))};
      await assert.rejects(inspect(${JSON.stringify(root)}), error => error instanceof GeneratedLockReadError && error.kind === "unreadable" && error.cause.cause === failure);
      faultPath = ${JSON.stringify(join(root, "AGENTS.md"))};
      await assert.rejects(inspect(${JSON.stringify(root)}), error => error === failure);
    }
    // A true result is scoped evidence, not a complete scan of later roots.
    faultPath = ${JSON.stringify(join(root, ".agents/skills/skillset.lock"))};
    assert.equal(await inspect(${JSON.stringify(root)}), true);
  `);
});

for (const boundary of ["yaml", "workspace", "outputs", "metadata", "path"] ) {
  test(`unexpected ${boundary} helper failures remain visible`, async () => {
    const root = await fixture();
    await writeFile(join(root, "skillset.yaml"), config + "codex:\n  plugins:\n    path: plugins\n");
    const modulePath = boundary === "yaml" ? "yaml" : boundary === "workspace" ? "xdg" : boundary === "path" ? "path" : "config";
    const functionName = boundary === "yaml" ? "parseYamlRecord" : boundary === "workspace" ? "readSkillsetWorkspaceConfig" : boundary === "outputs" ? "readOutputConfig" : boundary === "metadata" ? "readSkillsetMetadata" : "resolveInside";
    probe(`
      import assert from "node:assert/strict";
      import { mock } from "bun:test";
      const original = await import("./packages/core/src/${modulePath}.ts");
      const originalFunction = original[${JSON.stringify(functionName)}];
      const failure = new TypeError("helper fault");
      mock.module("./packages/core/src/${modulePath}.ts", () => ({ ...original,
        [${JSON.stringify(functionName)}]: (...args) => {
          ${boundary === "outputs" ? 'if (Object.keys(args[0]).length === 0) return originalFunction(...args);' : ''}
          throw failure;
        },
      }));
      const { independentlyObservedOutputBaseline: inspect } = await import("./packages/core/src/output-safety.ts");
      await assert.rejects(inspect(${JSON.stringify(root)}), error => error === failure);
    `);
  });
}

test("YAML alias resource limits are not malformed-source fallback", async () => {
  const root = await fixture();
  await writeFile(join(root, "skillset.yaml"), "a: &a [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]\n");
  await expect(independentlyObservedOutputBaseline(root)).rejects.toBeInstanceOf(ReferenceError);
});


test("complete baseline observation retains corrupt locks after a valid witness", async () => {
  const root = await fixture();
  await writeFile(join(root, ".agents/skills/skillset.lock"), "{");
  const observed = await independentlyObserveOutputBaseline(root);
  expect(observed.hasBaseline).toBe(true);
  expect(observed.corruptLocks).toHaveLength(1);
  expect(observed.corruptLocks[0]?.kind).toBe("invalid-json");
  expect(observed.corruptLocks[0]?.logicalPath).toBe(".agents/skills/skillset.lock");
});
