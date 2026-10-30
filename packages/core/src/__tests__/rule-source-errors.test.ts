import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult } from "../build";
import { InputValidationError } from "../input-validation-error";
import { loadBuildGraph } from "../resolver";

async function fixture(files: Record<string, string>, native = false): Promise<string> {
  const root = await createTestFixtureRoot("rule-source-errors-");
  await mkdir(join(root, ".skillset"));
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [codex]\n" + (native ? "workspace:\n  nativeAgents: true\n" : ""));
  for (const [path, content] of Object.entries(files)) await Bun.write(join(root, path), content);
  return root;
}

async function caught(root: string): Promise<Error> {
  try { await loadBuildGraph(root); } catch (error) { return error as Error; }
  throw new Error("Expected rejection");
}

test("rule source guards produce typed input errors with existing messages", async () => {
  const cases: Array<{ files: Record<string, string>; native?: boolean; message: string }> = [
    { files: { "AGENTS.md": "Native", ".skillset/RULES.md": "Adaptive" }, native: true, message: "mutually exclusive" },
    { files: {}, native: true, message: "requires authored root AGENTS.md" },
    { files: { "AGENTS.md": "Native", ".skillset/rules/root.md": "Unscoped" }, native: true, message: "rejects unscoped root rules" },
    { files: { ".skillset/rules/app/[topic].md": "Bad" }, message: "has [ or ] in its filename" },
    { files: { ".skillset/rules/.skillset/topic.md": "Bad" }, message: "inside the .skillset/ source root" },
    { files: { ".skillset/rules/apps/[…]/topic.md": "Bad" }, message: "rename it to [...]" },
    { files: { ".skillset/rules/topic.md": "---\ndialect: unknown\n---\nBody" }, message: "dialect" },
  ];
  for (const entry of cases) {
    const error = await caught(await fixture(entry.files, entry.native));
    expect(error).toBeInstanceOf(InputValidationError);
    expect(error.message).toContain(entry.message);
  }
});

test.each([
  [".skillset/rules/topic.md", "paths: 42"],
  [".skillset/skills/demo/SKILL.md", "description: 42"],
  [".skillset/subagents/reviewer.md", "description: 42"],
])("returned schema diagnostics are input errors for %s", async (path, field) => {
  const root = await fixture({ [path]: `---\nname: demo\n${field}\n---\nBody\n` });
  const error = await caught(root);
  expect(error).toBeInstanceOf(InputValidationError);
  expect(error.message).toContain("frontmatter failed schema validation");
});

test("valid native guidance, scopes, dialect and frontmatter still load", async () => {
  const native = await fixture({ "AGENTS.md": "Native", ".skillset/rules/docs/topic.md": "Scoped" }, true);
  expect((await loadBuildGraph(native)).rules.length).toBe(2);
  const adaptive = await fixture({ ".skillset/rules/app/[slug]/topic.md": "---\ndialect: claude\n---\nBody\n" });
  expect((await loadBuildGraph(adaptive)).rules[0]?.dialect).toBe("claude");
});

for (const operation of ["readFile", "readdir", "stat", "schema"] ) {
  test(`${operation} faults remain operational rather than source validation`, async () => {
    const root = await fixture({ ".skillset/rules/docs/topic.md": "Body\n" });
    const script = `
      import assert from "node:assert/strict";
      import { mock } from "bun:test";
      let failure;
      ${operation === "schema" ? `
        const schema = await import("@skillset/schema");
        mock.module("@skillset/schema", () => ({ ...schema, validateRuleFrontmatter: () => { throw failure; } }));
      ` : `
        const fs = await import("node:fs/promises");
        const original = fs[${JSON.stringify(operation)}];
        mock.module("node:fs/promises", () => ({ ...fs, [${JSON.stringify(operation)}]: async (path, ...args) => {
          if (String(path).includes("/.skillset/rules")) throw failure;
          return original(path, ...args);
        }}));
      `}
      const { loadBuildGraph } = await import("./packages/core/src/resolver.ts");
      for (const code of ["EACCES", "EIO", "internal"]) {
        failure = Object.assign(new TypeError("injected rule failure"), code === "internal" ? {} : { code });
        await assert.rejects(loadBuildGraph(${JSON.stringify(root)}), error => error === failure);
      }
    `;
    const child = Bun.spawnSync([process.execPath, "--eval", script], { cwd: fileURLToPath(new URL("../../../../", import.meta.url)), stdout: "pipe", stderr: "pipe" });
    expect(new TextDecoder().decode(child.stderr)).toBe("");
    expect(child.exitCode).toBe(0);
  });
}


test("native source kind and managed ownership conflicts are input errors", async () => {
  const directory = await fixture({}, true);
  await mkdir(join(directory, "AGENTS.md"));
  const invalidKind = await caught(directory);
  expect(invalidKind).toBeInstanceOf(InputValidationError);
  expect(invalidKind.message).toContain("must be a regular file");
  const managed = await fixture({ ".skillset/RULES.md": "Managed guidance" });
  expect((await buildSkillsetResult(managed)).ok).toBe(true);
  await Bun.write(join(managed, "skillset.yaml"), "compile:\n  targets: [codex]\nworkspace:\n  nativeAgents: true\n");
  const owned = await caught(managed);
  expect(owned).toBeInstanceOf(InputValidationError);
  expect(owned.message).toContain("still claimed by skillset.lock");
});

test("native source disappearing after discovery remains an operational failure", async () => {
  const root = await fixture({ "AGENTS.md": "Native guidance" }, true);
  const child = Bun.spawnSync([process.execPath, "--eval", `
    import assert from "node:assert/strict";
    import { mock } from "bun:test";
    const fs = await import("node:fs/promises");
    const readFile = fs.readFile;
    let removed = false;
    mock.module("node:fs/promises", () => ({ ...fs, readFile: async (path, ...args) => {
      const content = await readFile(path, ...args);
      if (!removed && path === ${JSON.stringify(join(root, "AGENTS.md"))}) {
        removed = true;
        await fs.rm(path);
      }
      return content;
    }}));
    const { loadBuildGraph } = await import("./packages/core/src/resolver.ts");
    const { InputValidationError } = await import("./packages/core/src/input-validation-error.ts");
    await assert.rejects(loadBuildGraph(${JSON.stringify(root)}), error => error.code === "ENOENT" && !(error instanceof InputValidationError));
    assert.equal(removed, true);
  `], { cwd: fileURLToPath(new URL("../../../../", import.meta.url)), stdout: "pipe", stderr: "pipe" });
  expect(new TextDecoder().decode(child.stderr)).toBe("");
  expect(child.exitCode).toBe(0);
});
