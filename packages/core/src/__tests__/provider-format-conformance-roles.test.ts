import { expect, it } from "bun:test";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult } from "../build";
import { checkProviderFormatConformance, providerFormatConformanceFiles } from "../provider-format-conformance";

const encoder = new TextEncoder();

async function sharedBuild() {
  const root = await createTestFixtureRoot("skillset-conformance-roles-");
  for (const [path, content] of Object.entries({
    "skillset.yaml": "skillset:\n  name: shared-conformance\n  license: none\ncompile:\n  targets: [claude, codex]\n",
    ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
    ".skillset/plugins/demo/skills/helper/SKILL.md": "---\nname: helper\ndescription: Help with changes.\nclaude:\n  frontmatter:\n    metadata:\n      claude-note: preserved\n---\n\nHelp carefully.\n",
    ".skillset/plugins/demo/hooks/hooks.json": '{"hooks":{}}',
    ".skillset/skills/review/SKILL.md": "---\nname: review\ndescription: Review changes.\n---\n\nReview carefully.\n",
  })) await Bun.write(join(root, path), content);
  const build = await buildSkillsetResult(root, { isolated: true });
  expect(build.ok).toBe(true);
  return build;
}

it("checks both actual shared hook roles independently of outcome order", async () => {
  const build = await sharedBuild();
  const hook = build.data.find((file) => file.path.endsWith("/plugins/demo/hooks/hooks.json"));
  if (hook === undefined) throw new Error("missing shared hook output");
  const outcomes = build.renderResults.filter((outcome) => outcome.featureId === "plugin-hooks" && outcome.outputs?.some((output) => output.path === hook.path));
  expect(outcomes.map((outcome) => outcome.target).sort()).toEqual(["claude", "codex"]);
  expect(checkProviderFormatConformance(providerFormatConformanceFiles([hook], outcomes))).toEqual({ checkedFiles: 1, issues: [], ok: true });

  const corrupt = { ...hook, content: encoder.encode('{"description":"Claude-only field","hooks":{}}') };
  const forward = checkProviderFormatConformance(providerFormatConformanceFiles([corrupt], outcomes));
  const reverse = checkProviderFormatConformance(providerFormatConformanceFiles([corrupt], outcomes.toReversed()));
  expect(forward.ok).toBe(false);
  expect(forward.checkedFiles).toBe(1);
  expect(forward.issues).toContainEqual(expect.objectContaining({ code: "unknown-destination-field", target: "codex", outputPath: hook.path }));
  expect(reverse).toEqual(forward);
  expect(checkProviderFormatConformance(providerFormatConformanceFiles([corrupt], [...outcomes, ...outcomes]))).toEqual(forward);
});

it("retains distinct provider diagnostics while deduplicating repeated files", async () => {
  const build = await sharedBuild();
  const hook = build.data.find((file) => file.path.endsWith("/plugins/demo/hooks/hooks.json"));
  if (hook === undefined) throw new Error("missing shared hook output");
  const broken = { ...hook, content: encoder.encode("{") };
  const files = providerFormatConformanceFiles([broken], build.renderResults);
  const report = checkProviderFormatConformance(files);
  expect(report.checkedFiles).toBe(1);
  expect(report.issues.map((issue) => issue.target).sort()).toEqual(["claude", "codex"]);
  expect(checkProviderFormatConformance([...files, ...files])).toEqual(report);
});

it("preserves shared skill compatible fields and standalone validation", async () => {
  const build = await sharedBuild();
  const files = providerFormatConformanceFiles(build.data, build.renderResults);
  expect(checkProviderFormatConformance(files).issues).toEqual([]);
  const shared = build.data.find((file) => file.path.endsWith("/plugins/demo/skills/helper/SKILL.md"));
  if (shared === undefined) throw new Error("missing shared skill");
  expect(new TextDecoder().decode(shared.content)).toContain("claude-note: preserved");
  const compatible = { ...shared, content: encoder.encode("---\nname: helper\ndescription: Help.\nx-provider-note: true\n---\n\nBody.\n") };
  expect(checkProviderFormatConformance(providerFormatConformanceFiles([compatible], build.renderResults)).issues).toEqual([]);
  const invalid = { ...shared, content: encoder.encode("---\nname: helper\nx-provider-note: true\n---\n\nBody.\n") };
  const report = checkProviderFormatConformance(providerFormatConformanceFiles([invalid], build.renderResults));
  expect(report.ok).toBe(false);
  expect(report.issues.every((issue) => issue.code === "missing-required-field")).toBe(true);
  expect(report.issues.map((issue) => issue.standardProfile ?? issue.target).sort()).toEqual(["agent-plugins-1.0", "claude", "codex"]);
  expect(checkProviderFormatConformance(providerFormatConformanceFiles([invalid], build.renderResults.toReversed()))).toEqual(report);
});

it("honors explicit hook roles over legacy-looking paths and keeps direct callers valid", () => {
  const path = "plugins/demo/claude/hooks/hooks.json";
  const content = encoder.encode('{"description":"Claude field","hooks":{}}');
  expect(checkProviderFormatConformance([{ path, content }]).ok).toBe(true);
  const report = checkProviderFormatConformance([{ path, content, destination: "hooks", target: "codex" }]);
  expect(report.issues).toContainEqual(expect.objectContaining({ target: "codex", code: "unknown-destination-field" }));
  expect(report.issues.every((issue) => issue.target === "codex")).toBe(true);
});
