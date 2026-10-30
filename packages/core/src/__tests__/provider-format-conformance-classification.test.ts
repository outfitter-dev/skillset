import { expect, test } from "bun:test";
import { checkProviderFormatConformance, formatProviderFormatConformanceReport, providerFormatConformanceFiles } from "../provider-format-conformance";
import type { ProviderFormatConformanceFile } from "../provider-format-conformance";
import type { RenderedFile } from "../types";

const content = new TextEncoder().encode("---\nname: demo\ndescription: Demonstrate classification.\n---\n\nBody.\n");
for (const path of ["other/demo/SKILL.md", "SKILL.md", "plugins/demo/chatgpt/skills/demo/SKILL.md"]) {
  test(`reports unclassified skill at ${path} without inventing provider evidence`, () => {
    const file: RenderedFile = { path, content, mode: 0o644, sourcePath: ".skillset/skills/demo/SKILL.md" };
    const selected = providerFormatConformanceFiles([file]);
    expect(selected).toHaveLength(1);
    const report = checkProviderFormatConformance(selected);
    expect(report).toMatchObject({ checkedFiles: 1, ok: false, issues: [{ code: "unclassified-skill", outputPath: path, sourcePath: file.sourcePath }] });
    expect(report.issues[0]).not.toHaveProperty("target");
    expect(report.issues[0]).not.toHaveProperty("standardProfile");
    expect(report.issues[0]).not.toHaveProperty("providerRef");
    expect(formatProviderFormatConformanceReport(report)).toContain("supply the skill's resolved provider or standard role");
    expect(formatProviderFormatConformanceReport(report)).not.toContain("undefined");
    expect(checkProviderFormatConformance([...selected, ...selected])).toEqual(report);
  });
}

test("direct role-aware and conventional callers retain classification", () => {
  const files: ProviderFormatConformanceFile[] = [
    { path: "SKILL.md", content, standardProfile: "agent-skills", destination: "skill" },
    { path: "other/demo/SKILL.md", content, target: "codex", destination: "skill" },
    { path: ".claude/skills/demo/SKILL.md", content },
  ];
  expect(checkProviderFormatConformance(files)).toMatchObject({ checkedFiles: 3, ok: true, issues: [] });
});

test("a missing role is not silently validated with Claude's permissive required fields", () => {
  const file = { path: "unknown/SKILL.md", content: new TextEncoder().encode("No frontmatter.\n") };
  expect(checkProviderFormatConformance([file])).toMatchObject({ ok: false, issues: [{ code: "unclassified-skill" }] });
});

test("does not classify a known plugin support asset as a primary skill", async () => {
  const { createTestFixtureRoot } = await import("../../../../scripts/test-helpers/fixture-root");
  const { buildSkillsetResult } = await import("../build");
  const { join } = await import("node:path");
  const root = await createTestFixtureRoot("conformance-asset-role-");
  for (const [path, text] of Object.entries({
    "skillset.yaml": "skillset:\n  name: asset-role\n",
    ".skillset/plugins/acme/skillset.yaml": "skillset:\n  name: acme\n",
    ".skillset/plugins/acme/skills/demo/SKILL.md": new TextDecoder().decode(content),
    ".skillset/plugins/acme/assets/SKILL.md": "Asset documentation.\n",
  })) await Bun.write(join(root, path), text);
  const build = await buildSkillsetResult(root, { isolated: true });
  expect(build.ok).toBe(true);
  const selected = providerFormatConformanceFiles(build.data, build.renderResults);
  expect(selected.some((file) => file.path.endsWith("/acme/assets/SKILL.md"))).toBe(false);
  expect(selected.some((file) => file.path.endsWith("/acme/skills/demo/SKILL.md"))).toBe(true);
  expect(checkProviderFormatConformance(selected).ok).toBe(true);
});
