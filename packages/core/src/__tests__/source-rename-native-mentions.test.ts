import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillset } from "../build";
import { planSourceRename, renameSource } from "../source-rename";

const WARNING = "unmarked source mention may need manual update in AGENTS.md";
const FROM = ".skillset/shared/references/old.txt";
const TO = ".skillset/shared/references/new.txt";

async function fixture(guidance: string, native: "declared" | "detected" | "generated" = "declared") {
  const root = await createTestFixtureRoot("rename-native-mentions-");
  const files = {
    "skillset.yaml": "skillset:\n  name: native-mentions\ncompile:\n  targets: [claude]\n"
      + (native === "declared" ? "workspace:\n  nativeAgents: true\n" : ""),
    [native === "generated" ? ".skillset/RULES.md" : "AGENTS.md"]: guidance,
    [FROM]: "Rename this resource.\n",
    ".skillset/shared/references/nested/retained.txt": "Keep this distinct resource.\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo\nresources:\n  - shared:references/old.txt\n---\n\nRead @{{shared:references/old.txt}}.\n",
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

function request(rootPath: string) {
  return { from: FROM, rootPath, to: TO };
}

test("rename warns for native authored mentions without parsing or rewriting root bytes", async () => {
  const guidance = "---\r\nnot-yaml: [\r\n---\r\nReview .skillset/shared/references/old.txt and old.txt.\r\n";
  const root = await fixture(guidance);
  await buildSkillset(root);
  const original = await readFile(join(root, "AGENTS.md"));
  const plan = await planSourceRename(request(root));
  expect(plan.warnings.filter((warning) => warning === WARNING)).toHaveLength(1);
  expect(plan.operations.some((operation) => "path" in operation && operation.path === "AGENTS.md")).toBe(false);
  expect(plan.generatedOperations.some((operation) => operation.path === "AGENTS.md")).toBe(false);
  expect(await readFile(join(root, "AGENTS.md"))).toEqual(original);
  expect(await Bun.file(join(root, FROM)).exists()).toBe(true);
  expect(await Bun.file(join(root, TO)).exists()).toBe(false);

  const applied = await renameSource({ ...request(root), expectedPlanHash: plan.planHash });
  expect(applied.applied).toBe(true);
  expect(applied.warnings).toContain(WARNING);
  expect(applied.writtenPaths).not.toContain("AGENTS.md");
  expect(await readFile(join(root, "AGENTS.md"))).toEqual(original);
  expect(await Bun.file(join(root, FROM)).exists()).toBe(false);
  expect(await readFile(join(root, TO), "utf8")).toBe("Rename this resource.\n");
});

test("rename warns for safely detected native source without persisting its choice during preview", async () => {
  const root = await fixture("# Guidance\nReview old.txt.\n", "detected");
  const config = await readFile(join(root, "skillset.yaml"));
  const plan = await planSourceRename(request(root));
  expect(plan.warnings).toContain(WARNING);
  expect(await readFile(join(root, "skillset.yaml"))).toEqual(config);
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe("# Guidance\nReview old.txt.\n");
});

test("rename does not treat the generated root as authored mention evidence", async () => {
  const root = await fixture("# Guidance\nReview old.txt.\n", "generated");
  await buildSkillset(root);
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("old.txt");
  const plan = await planSourceRename(request(root));
  expect(plan.warnings).not.toContain(WARNING);
  expect(plan.warnings).toContain("unmarked source mention may need manual update in .skillset/RULES.md");
});

for (const unmarked of [false, true]) {
  test(`native marked references remain intact with unmarked mention ${unmarked}`, async () => {
    const guidance = "# Guidance\nRead @{{shared:references/nested/retained.txt}}.\n"
      + (unmarked ? "Also review old.txt manually.\n" : "");
    const root = await fixture(guidance);
    await buildSkillset(root);
    const plan = await planSourceRename(request(root));
    expect(plan.warnings.includes(WARNING)).toBe(unmarked);
    await renameSource({ ...request(root), expectedPlanHash: plan.planHash });
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(guidance);
  });
}

test("native source with no matching mention adds no warning", async () => {
  const root = await fixture("# Guidance\nKeep author ownership explicit.\n");
  expect((await planSourceRename(request(root))).warnings).not.toContain(WARNING);
});

test("native marker-like syntax stays literal and receives a manual-update warning", async () => {
  const guidance = "# Guidance\nRead @{{shared:references/old.txt}}.\n";
  const root = await fixture(guidance);
  await buildSkillset(root);
  const plan = await planSourceRename(request(root));
  expect(plan.warnings).toContain(WARNING);
  expect(plan.operations.some((operation) => "path" in operation && operation.path === "AGENTS.md")).toBe(false);
  await renameSource({ ...request(root), expectedPlanHash: plan.planHash });
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(guidance);
  expect(await Bun.file(join(root, FROM)).exists()).toBe(false);
  expect(await Bun.file(join(root, TO)).exists()).toBe(true);
});
