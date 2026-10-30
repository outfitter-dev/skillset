import { expect, test } from "bun:test";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult } from "../build";
import { checkProviderFormatConformance, providerFormatConformanceFiles } from "../provider-format-conformance";
import { withLockProvenance } from "../lock-provenance";
import type { BuildScope, RenderedFile } from "../types";

const encoder = new TextEncoder();
async function fixture(isolated: boolean, scopes?: readonly BuildScope[]) {
  const root = await createTestFixtureRoot("conformance-resources-");
  const source = "---\nname: demo\ndescription: Demonstrate resources.\nimplicit_invocation:\n  codex: true\ntools:\n  read: true\n---\n\nPrimary body.\n";
  const files = {
    "skillset.yaml": "skillset:\n  name: resource-ownership\ncompile:\n  targets: [claude, codex]\n",
    ".skillset/skills/(group)/folder/SKILL.md": source,
    ".skillset/skills/(group)/folder/AAA/SKILL.md": "Standalone resource.\n",
    ".skillset/plugins/acme/skillset.yaml": "skillset:\n  name: acme\n",
    ".skillset/plugins/acme/skills/(group)/folder/SKILL.md": "---\nname: demo\ndescription: Demonstrate resources.\n---\n\nPrimary.\n",
    ".skillset/plugins/acme/skills/(group)/folder/references/SKILL.md": "Plugin resource.\n",
  };
  for (const [path, content] of Object.entries(files)) await Bun.write(join(root, path), content);
  const build = await buildSkillsetResult(root, { isolated, ...(scopes === undefined ? {} : { scopes }) });
  expect(build.ok).toBe(true);
  return build;
}

for (const isolated of [false, true]) {
  test(`validates primary skills without treating copied Markdown as skills (isolated=${isolated})`, async () => {
    const build = await fixture(isolated);
    const files = providerFormatConformanceFiles(build.data, build.renderResults);
    expect(files.some((file) => /\/(AAA|references)\/SKILL.md$/.test(file.path))).toBe(false);
    const primary = files.filter((file) => file.path.endsWith("/demo/SKILL.md"));
    expect(primary).toHaveLength(3);
    expect(primary.find((file) => file.path.includes("plugins/acme"))?.roles).toHaveLength(3);
    expect(checkProviderFormatConformance(files).ok).toBe(true);
    const corrupt = build.data.map((file) => file.path.endsWith("/demo/SKILL.md") ? { ...file, content: encoder.encode("---\nname: demo\n---\n\nBody.\n") } : file);
    expect(checkProviderFormatConformance(providerFormatConformanceFiles(corrupt, build.renderResults)).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "missing-required-field" })]));
  });
}

for (const scope of ["repo", "plugins", "project"] as const) {
  test(`uses only supplied lock ownership for isolated ${scope} scope`, async () => {
    const build = await fixture(true, [scope]);
    const files = providerFormatConformanceFiles(build.data, build.renderResults);
    expect(files.some((file) => /\/(AAA|references)\/SKILL.md$/.test(file.path))).toBe(false);
    expect(checkProviderFormatConformance(files).ok).toBe(true);
  });
}

test("preserves lockless legacy inputs", () => {
  const files: RenderedFile[] = [{ mode: 0o644, path: ".claude/skills/demo/references/SKILL.md", content: encoder.encode("Resource.\n") }];
  expect(providerFormatConformanceFiles(files)).toEqual(files);
  expect(checkProviderFormatConformance(providerFormatConformanceFiles(files)).ok).toBe(true);
});


test("rejects contradictory supplied primary ownership rather than accepting a resource", async () => {
  const build = await fixture(false);
  const primary = build.data.find((file) => file.path === ".agents/skills/demo/SKILL.md")!;
  for (const sourcePath of [undefined, ".skillset/skills/other/SKILL.md"]) {
    const { sourcePath: _sourcePath, ...withoutSource } = primary;
    const replacement = sourcePath === undefined ? withoutSource : { ...primary, sourcePath };
    const files = build.data.map((file) => file === primary ? replacement : file);
    expect(() => providerFormatConformanceFiles(files, build.renderResults)).toThrow("missing or inconsistent source ownership");
  }
  expect(() => providerFormatConformanceFiles(build.data.filter((file) => file !== primary), build.renderResults)).toThrow("missing or inconsistent source ownership");
  const lockFile = build.data.find((file) => file.path === ".agents/skills/skillset.lock")!;
  for (const outputPath of [undefined, "demo/missing/SKILL.md", "demo/AAA/SKILL.md"]) {
    const lock = JSON.parse(new TextDecoder().decode(lockFile.content));
    const item = lock.items.find((item: { outputPath: string }) => item.outputPath === "demo/SKILL.md");
    if (outputPath === undefined) delete item.outputPath;
    else item.outputPath = outputPath;
    const files = build.data.map((file) => file === lockFile ? { ...file, content: encoder.encode(JSON.stringify(withLockProvenance(lock))) } : file);
    expect(() => providerFormatConformanceFiles(files, build.renderResults)).toThrow("conformance ownership");
  }
  const broken = build.data.map((file) => file === lockFile ? { ...file, content: encoder.encode("not JSON") } : file);
  expect(() => providerFormatConformanceFiles(broken, build.renderResults)).toThrow("conformance ownership");
});

test("does not suppress neighboring paths or explicit non-skill roles", async () => {
  const build = await fixture(false);
  const resource = build.data.find((file) => file.path === ".agents/skills/demo/AAA/SKILL.md")!;
  const neighbor: RenderedFile = { ...resource, path: ".agents/skills/demo-extra/AAA/SKILL.md" };
  expect(providerFormatConformanceFiles([...build.data, neighbor], build.renderResults).some((file) => file.path === neighbor.path)).toBe(true);
  const hook = build.renderResults.find((result) => result.featureId === "standalone-skills" && result.target === "codex")!;
  const explicitRole = { ...hook, featureId: "plugin-hooks", destination: "hooks", outputs: [{ kind: "hooks", path: resource.path }] };
  const files = providerFormatConformanceFiles(build.data, [...build.renderResults, explicitRole]);
  expect(files.find((file) => file.path === resource.path)?.roles).toEqual([expect.objectContaining({ featureId: "plugin-hooks" })]);
});

test("preserves source-owned lock-named resources in direct lockless calls", () => {
  const resource: RenderedFile = {
    path: "references/skillset.lock", sourcePath: ".skillset/skills/demo/references/skillset.lock",
    mode: 0o644, content: encoder.encode("An opaque resource.\n"),
  };
  expect(providerFormatConformanceFiles([resource])).toEqual([]);
});
