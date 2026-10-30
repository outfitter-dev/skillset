import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult, diffSkillsetResult, verifySkillsetResult, ISOLATED_OUT_ROOT } from "../build";
import { doctorSkillset, explainPath } from "../authoring";
import { createOperationalPathContext, resolveOperationalPath } from "../operational-cache";
import { loadBuildGraph } from "../resolver";
import type { BuildScope } from "../types";

const skill = "---\nname: demo\ndescription: Demo guidance.\n---\nReview carefully.\n";
const cases: { scope: BuildScope; directory: string; files: Record<string, string>; packageOutput: string; asset: string }[] = [
  {
    scope: "plugins", directory: "plugins/acme",
    files: {
      ".skillset/plugins/acme/skillset.yaml": "skillset:\n  name: acme\n  description: Demo package.\n",
      ".skillset/plugins/acme/skills/demo/SKILL.md": skill,
      ".skillset/plugins/acme/assets/AGENTS.md": "Package asset, not a rule.\n",
    },
    packageOutput: "plugins/acme/skills/demo/SKILL.md", asset: "plugins/acme/assets/AGENTS.md",
  },
  {
    scope: "repo", directory: ".agents/skills/demo",
    files: {
      ".skillset/skills/demo/SKILL.md": skill,
      ".skillset/skills/demo/references/AGENTS.md": "Skill reference, not a rule.\n",
    },
    packageOutput: ".agents/skills/demo/SKILL.md", asset: ".agents/skills/demo/references/AGENTS.md",
  },
];

for (const example of cases) for (const isolated of [false, true]) for (const providers of [false, true]) {
  test(`rule under ${example.scope} root uses project scope, isolated=${isolated}, provider=${providers}`, async () => {
    const root = await createTestFixtureRoot("rule-output-scope-");
    const ruleSource = `.skillset/rules/${example.directory}/guidance.md`;
    const ruleOutput = `${example.directory}/AGENTS.md`;
    for (const [path, content] of Object.entries({
      "skillset.yaml": `skillset:\n  name: scoped-rules\ncompile:\n  targets: ${providers ? "[codex]" : "[]"}\n`,
      ...example.files,
      [ruleSource]: "# Scoped rule guidance\n",
    })) await Bun.write(join(root, path), content);
    const options = { isolated };
    const output = (path: string) => resolveOperationalPath(createOperationalPathContext(root), isolated ? join(ISOLATED_OUT_ROOT, path) : path);
    const mappedRule = isolated ? join(ISOLATED_OUT_ROOT, ruleOutput) : ruleOutput;
    const project = { ...options, scopes: ["project"] as const };
    const packageScope = { ...options, scopes: [example.scope] };

    const preview = await diffSkillsetResult(root, project);
    expect(preview.data.added).toContain(mappedRule);
    expect(await Bun.file(output(ruleOutput)).exists()).toBe(false);
    const built = await buildSkillsetResult(root, project);
    expect(built.ok).toBe(true);
    expect(built.writes.writtenPaths).toContain(mappedRule);
    const ruleResults = built.renderResults.filter((result) => result.outputs?.some((item) => item.path === mappedRule));
    expect(ruleResults.length).toBeGreaterThan(0);
    expect(ruleResults.every((result) => result.policy !== "scope:excluded")).toBe(true);
    expect(await Bun.file(output(ruleOutput)).text()).toContain("Scoped rule guidance");
    expect(await Bun.file(output(example.packageOutput)).exists()).toBe(false);
    expect(await Bun.file(output(example.asset)).exists()).toBe(false);
    const lockBytes = await Bun.file(output("skillset.lock")).text();
    const lock = JSON.parse(lockBytes);
    expect(lock.items.some((item: { files: string[]; owner: { standardProfile?: string } }) => item.files.includes(ruleOutput) && item.owner.standardProfile === "agent-instructions")).toBe(true);
    expect((await verifySkillsetResult(root, project)).ok).toBe(true);
    expect((await doctorSkillset(root, project)).drift.added).toEqual([]);
    expect((await explainPath(root, ruleOutput, { scopes: ["project"] })).kind).toBe("generated");

    const before = await Bun.file(output(ruleOutput)).text();
    const packaged = await buildSkillsetResult(root, packageScope);
    expect(packaged.ok).toBe(true);
    expect(packaged.writes.paths).not.toContain(mappedRule);
    const excludedRules = packaged.renderResults.filter((result) => result.featureId === "project-instructions");
    expect(excludedRules.some((result) => result.policy === "scope:excluded")).toBe(true);
    expect(await Bun.file(output(ruleOutput)).text()).toBe(before);
    expect(await Bun.file(output("skillset.lock")).text()).toBe(lockBytes);
    expect(await Bun.file(output(example.packageOutput)).exists()).toBe(true);
    expect(await Bun.file(output(example.asset)).text()).toContain("not a rule");
    expect((await verifySkillsetResult(root, packageScope)).ok).toBe(true);
    expect((await diffSkillsetResult(root, packageScope)).data.removed).not.toContain(mappedRule);
    expect((await buildSkillsetResult(root, options)).ok).toBe(true);
    expect((await verifySkillsetResult(root, options)).ok).toBe(true);

    await rm(join(root, ruleSource));
    expect((await buildSkillsetResult(root, packageScope)).ok).toBe(true);
    expect(await Bun.file(output(ruleOutput)).text()).toBe(before);
    if (providers) {
      expect((await buildSkillsetResult(root, project)).ok).toBe(true);
      expect(await Bun.file(output(ruleOutput)).exists()).toBe(false);
      expect(await Bun.file(output(example.asset)).exists()).toBe(true);
    }
  });
}

test("standards-only instruction beneath a conventional package root needs no directory ownership", async () => {
  const root = await createTestFixtureRoot("instruction-only-package-scope-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: []\nworkspace:\n  nativeAgents: true\n");
  const native = "# Native guidance\r\nPreserve authored bytes.\r\n";
  await Bun.write(join(root, "AGENTS.md"), native);
  await Bun.write(join(root, ".skillset/rules/plugins/acme/guidance.md"), "# Scoped guidance\n");
  expect((await loadBuildGraph(root)).outputRoots).toEqual([]);
  const result = await buildSkillsetResult(root, { scopes: ["project"] });
  expect(result.ok).toBe(true);
  expect(result.writes.paths).toContain("plugins/acme/AGENTS.md");
  expect(result.writes.paths).not.toContain("AGENTS.md");
  expect(await Bun.file(join(root, "AGENTS.md")).text()).toBe(native);
  expect((await verifySkillsetResult(root, { scopes: ["project"] })).ok).toBe(true);
  expect(await Bun.file(join(root, "plugins/skillset.lock")).exists()).toBe(false);
});

test("rule ownership cannot override a conflicting package asset", async () => {
  const root = await createTestFixtureRoot("rule-package-collision-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [codex]\n");
  const example = cases[0]!;
  for (const [path, content] of Object.entries(example.files)) await Bun.write(join(root, path), content);
  await Bun.write(join(root, ".skillset/rules/plugins/acme/assets/guidance.md"), "# Conflicting rule\n");
  await expect(buildSkillsetResult(root, { scopes: ["project"] })).rejects.toThrow("conflicting writers");
  expect(await Bun.file(join(root, example.asset)).exists()).toBe(false);
  expect(await Bun.file(join(root, "skillset.lock")).exists()).toBe(false);
});
