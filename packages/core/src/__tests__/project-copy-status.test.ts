import { expect, test } from "bun:test";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { doctorSkillset } from "../authoring";
import { buildSkillsetResult } from "../build";

for (const policy of ["warn", "skip", "error"] as const) {
  test(`status excludes unsupported Codex copies under ${policy} and retains supported destinations`, async () => {
    const root = await createTestFixtureRoot("project-copy-status-");
    const files: Record<string, string> = {
      "skillset.yaml": `compile:\n  targets: [claude, codex]\n  unsupportedDestination: ${policy}\n  session_start_hook: off\nplugins:\n  internal_use:\n    drafts:\n      demo: true\n`,
      ".skillset/skills/keep/SKILL.md": "---\nname: keep\ndescription: Keep.\n---\nKeep.\n",
      ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
      ".skillset/plugins/demo/skills/_drafts/review/SKILL.md": "---\nname: review\ndescription: Review.\nmetadata:\n  priority: 3\n---\nReview.\n",
      ".skillset/plugins/demo/skills/_drafts/valid/SKILL.md": "---\nname: valid\ndescription: Valid.\n---\nValid.\n",
    };
    for (const [path, content] of Object.entries(files)) await Bun.write(join(root, path), content);
    if (policy === "error") await expect(buildSkillsetResult(root)).rejects.toThrow("unsupported");
    else {
      await buildSkillsetResult(root);
      expect(await Bun.file(join(root, ".agents/skills/draft-review/SKILL.md")).exists()).toBe(false);
      expect(await Bun.file(join(root, ".claude/skills/draft-review/SKILL.md")).exists()).toBe(true);
      expect(await Bun.file(join(root, ".agents/skills/draft-valid/SKILL.md")).exists()).toBe(true);
    }
    const status = await doctorSkillset(root);
    expect(status.projectUse.map(({ effectiveName, target }) => `${effectiveName}:${target}`)).toEqual([
      "draft-review:claude", "draft-valid:claude", "draft-valid:codex",
    ]);
    expect(status.renderResults).toContainEqual(expect.objectContaining({
      sourceUnit: "plugin.demo.skill:review", target: "codex", status: "unsupported",
    }));
    if (policy === "error") expect(status.buildError).toBeDefined();
  });
}

test("shared classification preserves resolved license, draft metadata and exact standard bytes", async () => {
  const { loadBuildGraph } = await import("../resolver");
  const { createProjectCopyPlan } = await import("../project-copy-plan");
  const { renderAgentSkillStandardMarkdown } = await import("../render-agent-skills-standard");
  const root = await createTestFixtureRoot("project-copy-license-");
  await Bun.write(join(root, "skillset.yaml"), "skillset:\n  license: MIT\ncompile:\n  targets: [codex]\n  session_start_hook: off\ninternal_marker: false\n");
  await Bun.write(join(root, ".skillset/skills/_drafts/review/SKILL.md"), "---\nname: review\ndescription: Review.\nmetadata:\n  team: core\n---\nReview.\n");
  const graph = await loadBuildGraph(root);
  const plan = createProjectCopyPlan(graph);
  const copy = plan.copies[0]!;
  const options = { draft: true, effectiveName: copy.effectiveName, internal: true };
  const render = (classification?: ReturnType<typeof plan.codexClassification>) => renderAgentSkillStandardMarkdown(
    graph, undefined, copy.skill, `.agents/skills/${copy.effectiveName}`, "MIT", "agent-skills",
    { ...options, ...(classification === undefined ? {} : { classification }) }
  );
  const baseline = await render();
  const shared = await render(plan.codexClassification(copy));
  expect(shared).toEqual(baseline);
  if (!("content" in shared)) throw new Error("expected supported draft");
  expect(shared.content).toContain("license: MIT");
  expect(shared.content).toContain("internal: true");
  expect(shared.content).toContain("team: core");
  await buildSkillsetResult(root);
  expect(await Bun.file(join(root, ".agents/skills/draft-review/SKILL.md")).text()).toContain("license: MIT");
  expect((await doctorSkillset(root)).projectUse).toMatchObject([{ role: "bundle", effectiveName: "draft-review", target: "codex" }]);
});
