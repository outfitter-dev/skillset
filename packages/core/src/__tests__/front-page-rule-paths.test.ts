import { expect, test } from "bun:test";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult } from "../build";

for (const codex of [false, true]) {
  for (const isolated of [false, true]) {
    test(`front-page paths report baseline and selected Codex loss (codex=${codex}, isolated=${isolated})`, async () => {
      const root = await createTestFixtureRoot("front-page-paths-");
      await Bun.write(join(root, "skillset.yaml"), `skillset:\n  name: front-page-paths\ncompile:\n  targets: ${codex ? "[codex]" : "[claude]"}\n`);
      await Bun.write(join(root, ".skillset/RULES.md"), "---\npaths: [src/**/*.ts]\n---\n\nKeep types precise.\n");
      await Bun.write(join(root, ".skillset/rules/shared.md"), "Shared rule.\n");
      const build = await buildSkillsetResult(root, { isolated });
      expect(build.ok).toBe(true);
      const results = build.renderResults.filter((result) => result.featureId === "codex-rule-paths-not-enforceable");
      expect(results).toHaveLength(codex ? 2 : 1);
      expect(results).toEqual(expect.arrayContaining([expect.objectContaining({
        sourceUnit: "rule:RULES", sourcePath: ".skillset/RULES.md", standardProfile: "agent-instructions", status: "degraded",
        outputs: [{ path: isolated ? ".skillset/cache/latest/AGENTS.md" : "AGENTS.md" }],
        reason: expect.stringContaining("cannot narrow"),
      })]));
      expect(results.some((result) => result.target === "codex")).toBe(codex);
      const agents = build.data.find((file) => file.path.endsWith("AGENTS.md"));
      expect(new TextDecoder().decode(agents!.content)).toContain("Keep types precise.");
    });
  }
}

test("an unrestricted front page has no narrowing loss", async () => {
  const root = await createTestFixtureRoot("front-page-unrestricted-");
  await Bun.write(join(root, "skillset.yaml"), "skillset:\n  name: unrestricted\ncompile:\n  targets: [codex]\n");
  await Bun.write(join(root, ".skillset/RULES.md"), "Keep types precise.\n");
  const build = await buildSkillsetResult(root);
  expect(build.ok).toBe(true);
  expect(build.renderResults.some((result) => result.featureId === "codex-rule-paths-not-enforceable")).toBe(false);
});

test("native authored AGENTS frontmatter-looking text remains literal without narrowing evidence", async () => {
  const root = await createTestFixtureRoot("front-page-native-");
  const authored = "---\r\npaths: [src/**/*.ts]\r\n---\r\n\r\nKeep native bytes.\r\n";
  await Bun.write(join(root, "skillset.yaml"), "skillset:\n  name: native-front-page\nworkspace:\n  nativeAgents: true\ncompile:\n  targets: [codex]\n");
  await Bun.write(join(root, "AGENTS.md"), authored);
  const build = await buildSkillsetResult(root);
  expect(build.ok).toBe(true);
  expect(build.renderResults.some((result) => result.featureId === "codex-rule-paths-not-enforceable")).toBe(false);
  expect(await Bun.file(join(root, "AGENTS.md")).text()).toBe(authored);
});
