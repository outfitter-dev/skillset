import { cursorKeywordBoundary, portablePluginMetadataConflicts, firstPortablePluginMetadataSource, type ProviderPluginManifestEntry } from "../plugin-manifest-authority";
import { importSource } from "../import";
import { persistAdoptionReceipt } from "../operation-receipt";
import { readReportBundle } from "@skillset/core/internal/report-store";
import type { JsonValue } from "@skillset/core/internal/types";
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { createOperationalPathContext, ISOLATED_OUT_ROOT, resolveOperationalPath } from "@skillset/core";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { adoptSkillset } from "../adopt";
import { classifyPluginAdoptionCandidates } from "../plugin-adoption";

const shared = ["shared", "tools"];
const cursor = ["cursor", "plugin", ...shared];
async function fixture() {
  const root = await createTestFixtureRoot("adopt-discovery-keywords-");
  const originals = new Map<string, string>();
  for (const name of ["coding-tutor", "compound-engineering"]) {
    for (const provider of ["claude", "codex", "cursor"]) {
      const path = `plugins/${name}/.${provider}-plugin/plugin.json`;
      const text = JSON.stringify({ name, description: "Keyword fixture.", version: "1.0.0", keywords: provider === "cursor" ? cursor : shared });
      originals.set(path, text);
      await Bun.write(join(root, path), text);
    }
    await Bun.write(join(root, `plugins/${name}/skills/helper/SKILL.md`), "---\nname: helper\ndescription: Help.\n---\n\nHelpful body.\n");
  }
  return { root, originals };
}

test("Compound-shaped nested plugins retain Cursor discovery without widening shared keywords", async () => {
  const { root, originals } = await fixture();
  const survey = await classifyPluginAdoptionCandidates(root, ["plugins/coding-tutor", "plugins/compound-engineering"]);
  expect(survey.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  for (const name of ["coding-tutor", "compound-engineering"]) {
    const config = parseYaml(await readFile(join(root, `.skillset/plugins/${name}/skillset.yaml`), "utf8"));
    expect(config.skillset.keywords).toEqual(shared);
    expect(config.skillset.listing.keywords).toEqual(shared);
    expect(config.cursor.manifest.keywords).toEqual(cursor);
    const output = resolveOperationalPath(createOperationalPathContext(root), `${ISOLATED_OUT_ROOT}/plugins/${name}`);
    for (const [path, keywords] of [["plugin.json", shared], [".claude-plugin/plugin.json", shared], [".cursor-plugin/plugin.json", cursor]] as const) {
      expect(JSON.parse(await readFile(join(output, path), "utf8")).keywords).toEqual(keywords);
    }
    expect(report.imports.flatMap((entry) => entry.normalizations ?? [])).toContainEqual(expect.objectContaining({
      code: "manifest.metadata", dialect: "cursor", source: { path: ".cursor-plugin/plugin.json", pointer: "/keywords" },
      destination: { path: `.skillset/plugins/${name}/skillset.yaml`, pointer: "/cursor/manifest/keywords" }, fidelity: "unknown",
    }));
  }
  for (const [path, content] of originals) expect(await readFile(join(root, path), "utf8")).toBe(content);
});


function entries(claude: JsonValue | undefined = shared, codex: JsonValue | undefined = shared, native: JsonValue | undefined = cursor): ProviderPluginManifestEntry[] {
  return [["claude", { keywords: claude }], ["codex", { keywords: codex }], ["cursor", { keywords: native }]];
}

test("the shared decision is occurrence-aware and independent of provider input order", () => {
  const input = entries();
  const variants = [input, [...input].reverse(), [input[1]!, input[2]!, input[0]!], [...input, input[0]!, input[2]!]];
  for (const variant of variants) {
    expect(cursorKeywordBoundary(variant)).toEqual({ canonical: { provider: "claude", value: shared }, cursor });
    expect(firstPortablePluginMetadataSource(variant, "keywords")).toEqual({ provider: "claude", value: shared });
    expect(portablePluginMetadataConflicts(variant)).toEqual([]);
  }
  expect(cursorKeywordBoundary([...input, ["cursor", { keywords: ["different"] }]])).toBeUndefined();
  expect(portablePluginMetadataConflicts([...input, ["cursor", { keywords: ["different"] }]])).toContainEqual(expect.objectContaining({ field: "keywords" }));
});

test.each([undefined, null, "scalar", {}, [1], [""], ["  "]])("invalid or missing keyword input %j is not reclassified", (value) => {
  for (const position of [0, 1, 2]) {
    const input = entries();
    input[position] = [input[position]![0], { keywords: value as JsonValue | undefined }];
    expect(cursorKeywordBoundary(input)).toBeUndefined();
  }
});

test("missing provider, unequal shared lists and reordered lists remain distinct", () => {
  expect(cursorKeywordBoundary(entries().slice(1))).toBeUndefined();
  expect(cursorKeywordBoundary(entries(shared, [...shared].reverse()))).toBeUndefined();
  expect(portablePluginMetadataConflicts(entries(shared, ["different"]))).toContainEqual(expect.objectContaining({ field: "keywords" }));
  const duplicates = ["a", "a", "b"];
  expect(cursorKeywordBoundary(entries(duplicates, duplicates, []))).toEqual({ canonical: { provider: "claude", value: duplicates }, cursor: [] });
  expect(cursorKeywordBoundary(entries([], [], duplicates))).toEqual({ canonical: { provider: "claude", value: [] }, cursor: duplicates });
  expect(cursorKeywordBoundary(entries(duplicates, ["a", "b", "a"]))).toBeUndefined();
});

test("direct import uses the same boundary and retains unknown-fidelity evidence", async () => {
  const { root } = await fixture();
  await Bun.write(join(root, "skillset.yaml"), "skillset:\n  name: test\n  license: none\n");
  const report = await importSource({ rootPath: root, sourcePath: join(root, "plugins/coding-tutor"), kind: "plugin" });
  const config = parseYaml(await readFile(join(report.targetPath, "skillset.yaml"), "utf8"));
  expect(config.skillset.keywords).toEqual(shared);
  expect(config.cursor.manifest.keywords).toEqual(cursor);
  expect(report.warnings.join(" ")).toContain("under cursor.manifest");
  expect(report.capabilityAssessments?.every((item) => item.fidelity === "unknown")).toBe(true);
});

test("true shared metadata conflicts still stop adoption before source writes", async () => {
  const { root } = await fixture();
  const path = join(root, "plugins/coding-tutor/.codex-plugin/plugin.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  await Bun.write(path, JSON.stringify({ ...manifest, description: "Different identity metadata." }));
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(false);
  expect(report.imports).toEqual([]);
  expect(report.surveyDiagnostics).toContainEqual(expect.objectContaining({ code: "plugin-metadata-conflict", severity: "error" }));
  expect(await Bun.file(join(root, ".skillset/plugins/coding-tutor/skillset.yaml")).exists()).toBe(false);
});

test("immutable receipt carries scoped observations without keyword values", async () => {
  const { root } = await fixture();
  const report = await adoptSkillset(root, { write: true });
  const receipt = await persistAdoptionReceipt(report);
  const stored = (await readReportBundle(receipt.id)).report;
  expect(stored.payload).toMatchObject({ normalizations: expect.arrayContaining([expect.objectContaining({ dialect: "cursor", destination: { path: ".skillset/plugins/coding-tutor/skillset.yaml", pointer: "/cursor/manifest/keywords" } })]) });
  expect(JSON.stringify(stored)).not.toContain(JSON.stringify(cursor));
});

test("equivalent grouped roots retain exact provider discovery after staging", async () => {
  const root = await createTestFixtureRoot("grouped-keywords-");
  const paths: string[] = [];
  for (const provider of ["cursor", "codex", "claude"]) {
    const path = `plugins/${provider}-demo`;
    paths.push(path);
    await Bun.write(join(root, path, `.${provider}-plugin/plugin.json`), JSON.stringify({ name: "demo", description: "Grouped.", version: "1.0.0", keywords: provider === "cursor" ? cursor : shared }));
    await Bun.write(join(root, path, "skills/helper/SKILL.md"), "---\nname: helper\ndescription: Help.\n---\n\nSame source.\n");
  }
  const a = await classifyPluginAdoptionCandidates(root, paths);
  const b = await classifyPluginAdoptionCandidates(root, [...paths].reverse());
  expect(a).toEqual(b);
  expect(a.groups).toHaveLength(1);
  expect(a.groups[0]?.relation).toBe("equivalent");
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  expect(report.imports).toHaveLength(1);
  const config = parseYaml(await readFile(join(root, ".skillset/plugins/demo/skillset.yaml"), "utf8"));
  expect(config.skillset.keywords).toEqual(shared);
  expect(config.cursor.manifest.keywords).toEqual(cursor);
});

test.each([[[], ["native", "native"]], [["a", "a", "b"], []]] as const)("empty and duplicate lists retain exact rendered arrays %j / %j", async (baseline, native) => {
  const { root, originals } = await fixture();
  for (const [path, text] of originals) {
    const manifest = JSON.parse(text);
    await Bun.write(join(root, path), JSON.stringify({ ...manifest, keywords: path.includes(".cursor-plugin") ? native : baseline }));
  }
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  const output = resolveOperationalPath(createOperationalPathContext(root), `${ISOLATED_OUT_ROOT}/plugins/coding-tutor`);
  expect(JSON.parse(await readFile(join(output, "plugin.json"), "utf8")).keywords).toEqual(baseline);
  expect(JSON.parse(await readFile(join(output, ".cursor-plugin/plugin.json"), "utf8")).keywords).toEqual(native);
});

test("explicit canonical source remains authoritative during direct import", async () => {
  const { root } = await fixture();
  await Bun.write(join(root, "skillset.yaml"), "skillset:\n  name: test\n  license: none\n");
  const sourcePath = join(root, "plugins/coding-tutor");
  const explicit = "skillset:\n  name: coding-tutor\n  keywords: [authored]\n";
  await Bun.write(join(sourcePath, "skillset.yaml"), explicit);
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(await readFile(join(report.targetPath, "skillset.yaml"), "utf8")).toBe(explicit);
  expect(report.normalizations?.some((entry) => entry.destination.pointer === "/cursor/manifest/keywords")).toBe(false);
});
