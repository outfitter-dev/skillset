import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { explainPath } from "../authoring";
import { buildSkillset } from "../build";
import { readClaudeNativeToolRules, readEffectiveToolsPolicy } from "../skill-policy";
import { planToolsRealization } from "../tools-realization";
import type { JsonRecord } from "../types";
import { parseMarkdown } from "../yaml";

const diagnostic = "cannot render portable per-server MCP policy for Claude";

for (const server of ["team", "team_db", "team.db", "team db", "team-db", "reports__v2", "reports", "tail_", "plugin_tools_db"]) {
  for (const value of [true, false, ["get_*"], []]) {
    test(`rejects unbound Claude server intent ${server}: ${JSON.stringify(value)}`, () => {
      const source: JsonRecord = { tools: { mcp: { [server]: value } } };
      expect(() => readClaudeNativeToolRules(source, {}, "fixture")).toThrow(diagnostic);
      const policy = readEffectiveToolsPolicy(source, {}, "claude", "fixture");
      expect(() => planToolsRealization(policy)).toThrow(diagnostic);
    });
  }
}

test("preserves global denial, no-op maps and explicit native intent", () => {
  expect(readClaudeNativeToolRules({ tools: { mcp: false } }, {}, "fixture")).toEqual({ allow: [], deny: ["mcp__*"] });
  expect(readClaudeNativeToolRules({ tools: { mcp: {} } }, {}, "fixture")).toEqual({ allow: [], deny: [] });
  expect(planToolsRealization(readEffectiveToolsPolicy({ tools: { mcp: {} } }, {}, "claude", "fixture")).entries).toEqual([]);
  const allow = ["mcp__reports__*", "mcp__team_db__query"];
  const deny = ["mcp__other"];
  expect(readClaudeNativeToolRules({ tools: { claude: { allow, deny } } }, {}, "fixture")).toEqual({ allow, deny });
  for (const rule of allow) {
    expect(() => readClaudeNativeToolRules({ tools: { mcp: false, claude: { allow: [rule] } } }, {}, "fixture")).toThrow("contradicts effective tools.mcp: false");
  }
});

test("checks effective provider policy without banning other providers' source", () => {
  const source: JsonRecord = { tools: { mcp: { team_db: true }, claude: { mcp: false } } };
  expect(readClaudeNativeToolRules(source, {}, "fixture").deny).toEqual(["mcp__*"]);
  for (const target of ["codex", "cursor"] as const) {
    const plan = planToolsRealization(readEffectiveToolsPolicy(source, {}, target, "fixture"));
    expect(plan.entries[0]?.value).toEqual({ team_db: true });
    expect(plan.entries[0]?.tier).toBe("metadata-only");
  }
  expect(() => readClaudeNativeToolRules({ tools: { mcp: false, claude: { mcp: { team_db: true } } } }, {}, "fixture")).toThrow(diagnostic);
  expect(() => readClaudeNativeToolRules({ tools: { mcp: { team_db: true }, claude: { mcp: {} } } }, {}, "fixture")).toThrow(diagnostic);
});

async function fixture(policy: string, targets = "claude: true\ncodex: false\ncursor: false", mode = "error", plugin = false): Promise<string> {
  const root = await createTestFixtureRoot("skillset-mcp-boundary-");
  await Bun.write(join(root, "skillset.yaml"), `skillset:\n  name: policy-test\ncompile:\n  unsupportedDestination: ${mode}\n${targets}\n`);
  if (plugin) await Bun.write(join(root, ".skillset/plugins/tools/skillset.yaml"), "skillset:\n  name: tools\n");
  await Bun.write(join(root, plugin ? ".skillset/plugins/tools/skills/policy/SKILL.md" : ".skillset/skills/policy/SKILL.md"), `---\nname: policy\ndescription: Policy boundary.\n${policy}\n---\nPolicy body.\n`);
  return root;
}

for (const mode of ["error", "warn", "skip", "force"]) {
  for (const plugin of [false, true]) {
    test(`blocks unbound MCP policy before output (${mode}, plugin ${plugin})`, async () => {
      const root = await fixture("tools:\n  mcp:\n    team_db: false\n  claude:\n    allow: [mcp__team_db__query]", undefined, mode, plugin);
      const source = join(root, plugin ? ".skillset/plugins/tools/skills/policy/SKILL.md" : ".skillset/skills/policy/SKILL.md");
      const before = await readFile(source, "utf8");
      await expect(buildSkillset(root)).rejects.toThrow(diagnostic);
      await expect(explainPath(root, plugin ? ".skillset/plugins/tools/skills/policy/SKILL.md" : ".skillset/skills/policy/SKILL.md")).rejects.toThrow(diagnostic);
      expect(await readFile(source, "utf8")).toBe(before);
      for (const output of [".claude/skills/policy/SKILL.md", ".agents/skills/policy/SKILL.md", "plugins/tools/skills/policy/SKILL.md", ".claude/skills/skillset.lock", ".agents/skills/skillset.lock", "plugins/skillset.lock"]) {
        expect(await Bun.file(join(root, output)).exists()).toBe(false);
      }
    });
  }
}

test("renders native Claude rules unchanged and permits other selected targets", async () => {
  const native = await fixture("tools:\n  claude:\n    allow: [mcp__reports__*]\n    deny: [mcp__team_db]");
  await buildSkillset(native);
  const output = parseMarkdown(await readFile(join(native, ".claude/skills/policy/SKILL.md"), "utf8"), "output");
  expect(output.frontmatter["allowed-tools"]).toEqual(["mcp__reports__*"]);
  expect(output.frontmatter["disallowed-tools"]).toEqual(["mcp__team_db"]);
  const other = await fixture("tools:\n  mcp:\n    team_db: true", "claude: false\ncodex: true\ncursor: true");
  await buildSkillset(other);
  expect(await Bun.file(join(other, ".claude/skills/policy/SKILL.md")).exists()).toBe(false);
  expect(await Bun.file(join(other, ".agents/skills/policy/SKILL.md")).exists()).toBe(true);
  expect(await Bun.file(join(other, ".cursor/skills/policy/SKILL.md")).exists()).toBe(true);
});

test("a blocked rebuild preserves the previous generated artifact", async () => {
  const root = await fixture("tools:\n  mcp: false");
  await buildSkillset(root);
  const outputPath = join(root, ".claude/skills/policy/SKILL.md");
  const before = await readFile(outputPath, "utf8");
  const lockPath = join(root, ".claude/skills/skillset.lock");
  const lockBefore = await readFile(lockPath, "utf8");
  await Bun.write(join(root, ".skillset/skills/policy/SKILL.md"), "---\nname: policy\ndescription: Policy boundary.\ntools:\n  mcp:\n    team_db: true\n---\nChanged body.\n");
  await expect(buildSkillset(root)).rejects.toThrow(diagnostic);
  expect(await readFile(outputPath, "utf8")).toBe(before);
  expect(await readFile(lockPath, "utf8")).toBe(lockBefore);
});
