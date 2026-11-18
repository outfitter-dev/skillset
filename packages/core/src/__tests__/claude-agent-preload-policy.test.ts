import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillset } from "../build";
import { parseMarkdown } from "../yaml";

async function fixture(policy: string, agentPolicy = "skills: [review]", plugin = false): Promise<string> {
  const root = await createTestFixtureRoot("skillset-preload-policy-");
  await Bun.write(join(root, "skillset.yaml"), "skillset:\n  name: preload-test\nclaude: true\ncodex: false\ncursor: false\n");
  await Bun.write(join(root, ".skillset/subagents/reviewer.md"), `---\nname: reviewer\ndescription: Reviews work.\n${agentPolicy}\n---\nReview work.\n`);
  const skillPath = plugin ? ".skillset/plugins/tools/skills/review/SKILL.md" : ".skillset/skills/review/SKILL.md";
  await Bun.write(join(root, skillPath), `---\nname: review\ndescription: Review policy.\n${policy}\n---\nReview body.\n`);
  if (plugin) await Bun.write(join(root, ".skillset/plugins/tools/skillset.yaml"), "skillset:\n  name: tools\n");
  return root;
}

for (const policy of [
  "implicit_invocation: false",
  "implicit_invocation:\n  claude: false\n  codex: true",
  "implicit_invocation: true\nclaude:\n  frontmatter:\n    disable-model-invocation: true",
  "claude:\n  frontmatter:\n    disable-model-invocation: true",
]) {
  test(`rejects a managed Claude preload with effective disablement: ${policy}`, async () => {
    const root = await fixture(policy);
    const sourcePath = join(root, ".skillset/skills/review/SKILL.md");
    const before = await readFile(sourcePath, "utf8");
    await expect(buildSkillset(root)).rejects.toThrow("cannot preload");
    expect(await readFile(sourcePath, "utf8")).toBe(before);
    expect(await Bun.file(join(root, ".claude/agents/reviewer.md")).exists()).toBe(false);
    expect(await Bun.file(join(root, ".claude/skills/review/SKILL.md")).exists()).toBe(false);
    expect(await Bun.file(join(root, ".agents/skills/review/SKILL.md")).exists()).toBe(false);
  });
}

for (const [policy, expected] of [
  ["", undefined],
  ["implicit_invocation: true", false],
  ["implicit_invocation: false\nclaude:\n  frontmatter:\n    disable-model-invocation: false", false],
] as const) {
  test(`permits effective Claude preload eligibility: ${policy || "default"}`, async () => {
    const root = await fixture(policy);
    await buildSkillset(root);
    const output = await readFile(join(root, ".claude/skills/review/SKILL.md"), "utf8");
    expect(parseMarkdown(output, "skill").frontmatter["disable-model-invocation"]).toBe(expected);
    const agent = await readFile(join(root, ".claude/agents/reviewer.md"), "utf8");
    expect(parseMarkdown(agent, "agent").frontmatter.skills).toEqual(["review"]);
  });
}

test("validates plugin managed preloads while preserving eligible shared packages", async () => {
  const root = await fixture("implicit_invocation: false", "skills: [plugin.tools.skill:review]", true);
  await expect(buildSkillset(root)).rejects.toThrow("cannot preload");
  expect(await Bun.file(join(root, "plugins/tools/skills/review/SKILL.md")).exists()).toBe(false);
  await Bun.write(join(root, ".skillset/plugins/tools/skills/review/SKILL.md"), "---\nname: review\ndescription: Review policy.\nimplicit_invocation: true\n---\nReview body.\n");
  await buildSkillset(root);
  const agent = parseMarkdown(await readFile(join(root, ".claude/agents/reviewer.md"), "utf8"), "agent");
  expect(agent.frontmatter.skills).toEqual(["tools:review"]);
});

test("does not infer eligibility of explicit native references", async () => {
  const root = await fixture("implicit_invocation: false", "claude:\n  skills:\n    - native: review");
  await buildSkillset(root);
  const agent = parseMarkdown(await readFile(join(root, ".claude/agents/reviewer.md"), "utf8"), "agent");
  expect(agent.frontmatter.skills).toEqual(["review"]);
});

test("does not impose Claude preload rules on disabled agents or other providers", async () => {
  const root = await fixture("implicit_invocation: false", "skills: [review]\nclaude: false");
  await buildSkillset(root);
  expect(await Bun.file(join(root, ".claude/agents/reviewer.md")).exists()).toBe(false);
  await Bun.write(join(root, "skillset.yaml"), "skillset:\n  name: preload-test\nclaude: false\ncodex: true\ncursor: true\n");
  await buildSkillset(root);
  expect(await Bun.file(join(root, ".codex/agents/reviewer.toml")).exists()).toBe(true);
  expect(await Bun.file(join(root, ".cursor/agents/reviewer.md")).exists()).toBe(true);
});

for (const [manifest, expected] of [
  ["skillset:\n  name: tools\n  manifest:\n    name: alternate\n", "alternate"],
  ["skillset:\n  name: tools\nclaude:\n  manifest:\n    name: effective\n", "effective"],
] as const) {
  test(`uses effective Claude manifest identity for plugin preload: ${expected}`, async () => {
    const root = await fixture("implicit_invocation: true", "skills: [plugin.tools.skill:review]", true);
    await Bun.write(join(root, ".skillset/plugins/tools/skillset.yaml"), manifest);
    await buildSkillset(root);
    const agent = parseMarkdown(await readFile(join(root, ".claude/agents/reviewer.md"), "utf8"), "agent");
    const emittedManifest = JSON.parse(await readFile(join(root, "plugins/tools/.claude-plugin/plugin.json"), "utf8"));
    expect(emittedManifest.name).toBe(expected);
    expect(emittedManifest.skills).toBe("./skills/");
    expect(agent.frontmatter.skills).toEqual([`${emittedManifest.name}:review`]);
    const skillOutput = parseMarkdown(await readFile(join(root, "plugins/tools/skills/review/SKILL.md"), "utf8"), "skill");
    expect(skillOutput.frontmatter.name).toBe("review");
    expect(await readFile(join(root, ".skillset/plugins/tools/skillset.yaml"), "utf8")).toBe(manifest);
  });
}
