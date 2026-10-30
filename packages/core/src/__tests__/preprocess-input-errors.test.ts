import { expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { InputValidationError } from "../input-validation-error";
import { preprocessText, type PreprocessContext } from "../preprocess";

async function fixture(): Promise<PreprocessContext> {
  const rootPath = await createTestFixtureRoot("preprocess-input-errors-");
  const shared = join(rootPath, ".skillset/shared");
  await mkdir(join(shared, "partials"), { recursive: true });
  await mkdir(join(rootPath, ".skillset/skills/demo"), { recursive: true });
  await writeFile(join(shared, "reference.md"), "Reference");
  await writeFile(join(shared, "partials/outer.md"), "{{> inner}}");
  await writeFile(join(shared, "partials/inner.md"), "{{> missing}}");
  return { rootPath, sourceRoot: ".skillset", sourcePath: join(rootPath, ".skillset/skills/demo/SKILL.md"), frontmatter: {} };
}

async function caught(operation: Promise<unknown>): Promise<unknown> {
  try { await operation; } catch (error) { return error; }
  throw new Error("Expected rejection");
}

test("authored reference and variable failures are typed input errors", async () => {
  const context = await fixture();
  for (const content of [
    "{{shared:reference.md}}", "@{{relative.md}}", "{{> root:reference.md}}",
    "{{> missing}}", "{{> plugin:missing}}", "{{> invalid.name}}",
    "{{> shared:../escape.md}}", "{{> shared:/absolute}}",
    "@{{shared:missing.md}}", "{{this.missing}}", "{{skillset.unknown}}",
    "{{parent.unknown}}", "{{parent.tree depth:9}}", "{{parent.tree invalid}}",
    "{{$ARGUMENTS[bad]}}",
  ]) {
    expect(await caught(preprocessText(content, context))).toBeInstanceOf(InputValidationError);
  }
  expect(await caught(preprocessText("{{$ARGUMENTS}}", { ...context, promptArguments: false }))).toBeInstanceOf(InputValidationError);
  expect(await caught(preprocessText("{{$ARGUMENTS.name}}", { ...context, target: "claude" }))).toBeInstanceOf(InputValidationError);
});

test("nested missing references and cycles retain typed cause chains", async () => {
  const context = await fixture();
  const missing = await caught(preprocessText("{{> outer}}", context)) as Error;
  expect(missing).toBeInstanceOf(InputValidationError);
  expect(missing.message).toMatch(/failed to read partial outer.*failed to read partial inner.*failed to read partial missing/u);
  expect(missing.cause).toBeInstanceOf(InputValidationError);
  expect((missing.cause as Error).cause).toBeInstanceOf(InputValidationError);
  await writeFile(join(context.rootPath, ".skillset/shared/partials/inner.md"), "{{> outer}}");
  const cycle = await caught(preprocessText("{{> outer}}", context)) as Error;
  expect(cycle).toBeInstanceOf(InputValidationError);
  expect(cycle.message).toContain("creates a cycle");
  expect(cycle.cause).toBeInstanceOf(InputValidationError);
});

test("symlink escapes are typed while valid shared paths still render", async () => {
  const context = await fixture();
  const outside = join(context.rootPath, "outside.md");
  await writeFile(outside, "Outside");
  await symlink(outside, join(context.rootPath, ".skillset/shared/escape.md"));
  const error = await caught(preprocessText("@{{shared:escape.md}}", context)) as Error;
  expect(error).toBeInstanceOf(InputValidationError);
  expect(error.message).toContain("resolves outside its partial root");
  expect(error.cause).toBeInstanceOf(InputValidationError);
  expect(await preprocessText("{{> shared:reference.md}}", context)).toBe("Reference");
});

test("serialization failures retain causes without claiming input provenance", async () => {
  const context = await fixture();
  const original = new TypeError("custom serializer failed");
  const value = { toJSON() { throw original; } };
  const error = await caught(preprocessText("{{this.value}}", { ...context, frontmatter: { value } as never })) as Error;
  expect(error).not.toBeInstanceOf(InputValidationError);
  expect(error.cause).toBe(original);
  const cyclic = Bun.YAML.parse("value: &value\n  self: *value\n") as PreprocessContext["frontmatter"];
  const cycle = await caught(preprocessText("{{this.value}}", { ...context, frontmatter: cyclic })) as Error;
  expect(cycle).not.toBeInstanceOf(InputValidationError);
  expect(cycle.cause).toBeInstanceOf(TypeError);
  const alias = { x: 1 };
  expect(await preprocessText("{{this.value}}", { ...context, frontmatter: { value: [alias, alias] } })).toContain('"x": 1');
});

for (const operation of ["stat", "realpath", "readFile", "readdir"] as const) {
  test(`${operation} preserves operational and unexpected failures`, async () => {
    const context = await fixture();
    const code = `
      import assert from "node:assert/strict";
      import { mock } from "bun:test";
      const fs = await import("node:fs/promises");
      const originalOperation = fs[${JSON.stringify(operation)}];
      let failure;
      const context = ${JSON.stringify(context)};
      mock.module("node:fs/promises", () => ({ ...fs,
        [${JSON.stringify(operation)}]: async (path, ...args) => {
          if (String(path).startsWith(context.rootPath)) throw failure;
          return originalOperation(path, ...args);
        },
      }));
      const { preprocessText } = await import("./packages/core/src/preprocess.ts");
      for (const code of ${JSON.stringify(["EACCES", "EIO", "ELOOP", "ENOTDIR", "internal", ...(operation === "stat" ? [] : ["ENOENT"])])}) {
        failure = Object.assign(new TypeError("injected " + code), code === "internal" ? {} : { code });
        for (const content of ${JSON.stringify(operation === "readdir" ? ["{{parent.tree}}"] : operation === "readFile" ? ["{{> outer}}", "{{> shared:reference.md}}"] : ["{{> outer}}", "{{> shared:reference.md}}", "@{{shared:reference.md}}"])}) {
          await assert.rejects(preprocessText(content, context), error => error === failure);
        }
      }
    `;
    const child = Bun.spawnSync([process.execPath, "--eval", code], {
      cwd: fileURLToPath(new URL("../../../../", import.meta.url)), stdout: "pipe", stderr: "pipe",
    });
    expect(new TextDecoder().decode(child.stderr)).toBe("");
    expect(child.exitCode).toBe(0);
  });
}


test("unexpected containment helper errors are not authored-path rejections", async () => {
  const context = await fixture();
  const child = Bun.spawnSync([process.execPath, "--eval", `
    import assert from "node:assert/strict";
    import { mock } from "bun:test";
    const paths = await import("./packages/core/src/path.ts");
    const resolveInside = paths.resolveInside;
    const failure = new TypeError("containment helper fault");
    mock.module("./packages/core/src/path.ts", () => ({ ...paths,
      resolveInside: (root, candidate, ...args) => {
        if (candidate.startsWith("/")) throw failure;
        return resolveInside(root, candidate, ...args);
      },
    }));
    const { preprocessText } = await import("./packages/core/src/preprocess.ts");
    for (const content of ["{{> outer}}", "@{{shared:reference.md}}"] ) {
      await assert.rejects(preprocessText(content, ${JSON.stringify(context)}), error => error === failure);
    }
  `], { cwd: fileURLToPath(new URL("../../../../", import.meta.url)), stdout: "pipe", stderr: "pipe" });
  expect(new TextDecoder().decode(child.stderr)).toBe("");
  expect(child.exitCode).toBe(0);
});
