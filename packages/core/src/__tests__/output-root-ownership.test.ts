import { expect, it } from "bun:test";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult } from "../build";
import { loadBuildGraph } from "../resolver";

it.each([true, false])("aligns graph, render and lock roots with Claude enabled=%s", async (claudeEnabled) => {
  const root = await createTestFixtureRoot("skillset-output-root-ownership-");
  const targets = claudeEnabled ? ["claude", "codex"] : ["codex"];
  const files = {
    "skillset.yaml": `skillset:\n  name: root-ownership\ncompile:\n  targets: ${JSON.stringify(targets)}\n`,
    ".skillset/rules/testing.md": "Keep tests focused.\n",
    ".skillset/rules/apps/web/testing.md": "Test web behavior.\n",
    ".skillset/skills/review/SKILL.md": "---\nname: review\ndescription: Review changes.\n---\n\nReview carefully.\n",
    ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
    ".skillset/plugins/demo/skills/helper/SKILL.md": "---\nname: helper\ndescription: Help with changes.\n---\n\nHelp carefully.\n",
    "authored.txt": "Preserve this authored file.\n",
  };
  for (const [path, content] of Object.entries(files)) await Bun.write(join(root, path), content);
  const graph = await loadBuildGraph(root);
  expect(graph.standardProjections.adopted).toEqual(expect.arrayContaining([
    "agent-instructions", "agent-skills", "agent-plugins-1.0",
  ]));
  expect(graph.outputRoots).toContain(".agents/skills");
  expect(graph.outputRoots).toContain("plugins");
  expect(graph.outputRoots.includes(".claude/rules")).toBe(claudeEnabled);

  const result = await buildSkillsetResult(root);
  expect(result.ok).toBe(true);
  const expected = [
    { root: ".agents/skills", output: "review/SKILL.md", standardProfile: "agent-skills" },
    { root: "plugins", output: "demo/skills/helper/SKILL.md", standardProfile: "agent-plugins-1.0" },
  ];
  for (const entry of expected) {
    const path = `${entry.root}/${entry.output}`;
    expect(result.data.filter((file) => file.path === path)).toHaveLength(1);
    expect(await Bun.file(join(root, path)).exists()).toBe(true);
    const lock = await Bun.file(join(root, entry.root, "skillset.lock")).json();
    expect(lock.items).toContainEqual(expect.objectContaining({
      outputPath: entry.output,
      owner: { standardProfile: entry.standardProfile },
      role: "standard",
    }));
  }
  expect(await Bun.file(join(root, "plugins/demo/plugin.json")).exists()).toBe(true);
  for (const relative of ["testing.md", "apps/web/testing.md"]) {
    const path = `.claude/rules/${relative}`;
    expect(result.data.some((file) => file.path === path)).toBe(claudeEnabled);
    expect(await Bun.file(join(root, path)).exists()).toBe(claudeEnabled);
    if (claudeEnabled) {
      const lock = await Bun.file(join(root, ".claude/rules/skillset.lock")).json();
      expect(lock.items).toContainEqual(expect.objectContaining({ outputPath: relative }));
      expect(await Bun.file(join(root, path)).text()).toContain(relative === "testing.md" ? "Keep tests focused." : "Test web behavior.");
    }
  }
  expect(await Bun.file(join(root, "authored.txt")).text()).toBe(files["authored.txt"]);
});
