import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { buildSkillsetResult, diffSkillsetResult, verifySkillsetResult } from "../build";
import { explainPath } from "../authoring";
import { collectRenderResults } from "../render-result-collector";
import { renderBuildGraph } from "../render";
import { loadBuildGraph } from "../resolver";

const code = "render/codex-marketplace-assets-omitted";
const outputPath = ".agents/plugins/marketplace.json";
const assets = "            logo: ./assets/private-logo.svg\n            logoDark: ./assets/dark.svg\n            composerIcon: ./assets/icon.svg\n            screenshots: [./assets/screen.png]";

async function fixture(mode = "error", fields = assets, extra = ""): Promise<string> {
  const root = await createTestFixtureRoot("skillset-marketplace-loss-");
  await Bun.write(join(root, "skillset.yaml"), `skillset:\n  name: catalog-test\ncompile:\n  unsupportedDestination: ${mode}\nclaude: false\ncodex: true\ncursor: false\nmarketplaces:\n  curated:\n    targets: [codex]\n    plugins:\n      - plugin: remote\n        id: listing-name\n        codex:\n          source:\n            source: url\n            url: https://example.com/remote.git\n          interface:\n            displayName: Remote\n${fields}\n${extra}`);
  return root;
}

test("blocks silent remote asset loss before writing and preserves source", async () => {
  const root = await fixture();
  const before = await readFile(join(root, "skillset.yaml"), "utf8");
  await expect(buildSkillsetResult(root)).rejects.toThrow("omits remote interface assets");
  await expect(diffSkillsetResult(root)).rejects.toThrow("omits remote interface assets");
  await expect(verifySkillsetResult(root)).rejects.toThrow("omits remote interface assets");
  expect(await readFile(join(root, "skillset.yaml"), "utf8")).toBe(before);
  expect(await Bun.file(join(root, outputPath)).exists()).toBe(false);
  expect(await Bun.file(join(root, "skillset.lock")).exists()).toBe(false);
});

for (const mode of ["warn", "skip", "force"]) {
  test(`records omitted fields and lock evidence under ${mode}`, async () => {
    const root = await fixture(mode);
    const result = await buildSkillsetResult(root);
    expect(result.ok).toBe(true);
    const loss = result.renderResults.find((item) => item.diagnostics?.some((diagnostic) => diagnostic.code === code));
    expect(loss).toMatchObject({ status: "lossy", policy: `unsupported:${mode}`, sourceUnit: "config:root", sourcePath: "skillset.yaml", target: "codex", outputs: [{ kind: "marketplace", path: outputPath }] });
    expect(loss?.reason).toContain("listing-name");
    for (const field of ["logo", "logoDark", "composerIcon", "screenshots"]) expect(loss?.reason).toContain(field);
    expect(JSON.stringify(loss)).not.toContain("private-logo.svg");
    expect(result.diagnostics.some((item) => item.code === `unsupported-destination-${mode}`)).toBe(true);
    const catalog = await Bun.file(join(root, outputPath)).json();
    expect(catalog.plugins[0].interface).toEqual({ displayName: "Remote", category: "Other" });
    const lock = await Bun.file(join(root, "skillset.lock")).json();
    expect(lock.renderResults).toContainEqual(loss);
    const explained = await explainPath(root, "skillset.yaml");
    expect(JSON.stringify(explained)).toContain(code);
  });
}

test("attributes inherited interface separately from a native catalog override", async () => {
  const root = await fixture("warn", "            screenshots: [./assets/override.png]");
  await Bun.write(join(root, ".skillset/plugins/remote/skillset.yaml"), "skillset:\n  name: remote\n  listing:\n    logo: ./assets/inherited.svg\n    screenshots: [./assets/shot.png]\n");
  await Bun.write(join(root, ".skillset/plugins/remote/assets/inherited.svg"), "logo");
  await Bun.write(join(root, ".skillset/plugins/remote/assets/shot.png"), "shot");
  const result = await buildSkillsetResult(root);
  const losses = result.renderResults.filter((item) => item.diagnostics?.some((diagnostic) => diagnostic.code === code));
  expect(losses).toHaveLength(2);
  const inherited = losses.find((item) => item.sourceUnit === "plugin.remote.config:root");
  expect(inherited?.reason).toContain("logo");
  expect(inherited?.reason).not.toContain("screenshots");
  expect(losses.find((item) => item.sourceUnit === "config:root")?.reason).toContain("screenshots");
});

test("empty asset lists stay invalid and unselected native entries produce no loss", async () => {
  const empty = await fixture("error", "            screenshots: []");
  await expect(buildSkillsetResult(empty)).rejects.toThrow("must be a non-empty string array");
  const root = await fixture("error", "", "      - plugin: absent\n        targets: [claude]\n        codex:\n          source:\n            source: url\n            url: https://example.com/absent.git\n          interface:\n            logo: ./not-selected.svg\n");
  expect((await buildSkillsetResult(root)).renderResults.some((item) => item.status === "lossy")).toBe(false);
});

test("excluded catalog scope records no active loss and maps included output paths", async () => {
  const root = await fixture();
  const graph = await loadBuildGraph(root);
  const rendered = await renderBuildGraph(graph);
  const excluded = collectRenderResults(graph, rendered, { claudeMarketplacePlugins: [], includedPaths: new Set() });
  expect(excluded.some((item) => item.status === "lossy")).toBe(false);
  expect(excluded.some((item) => item.policy === "scope:excluded" && item.reason?.includes("marketplace"))).toBe(true);
  const mapped = collectRenderResults(graph, rendered, { claudeMarketplacePlugins: [], includedPaths: new Set([outputPath]), mapOutputPath: (path) => `preview/${path}` });
  expect(mapped.find((item) => item.status === "lossy")?.outputs).toEqual([{ kind: "marketplace", path: `preview/${outputPath}` }]);
});

test("a blocked rebuild preserves the previous catalog and lock", async () => {
  const root = await fixture("warn");
  await buildSkillsetResult(root);
  const before = await readFile(join(root, outputPath), "utf8");
  const lock = await readFile(join(root, "skillset.lock"), "utf8");
  const config = await readFile(join(root, "skillset.yaml"), "utf8");
  await Bun.write(join(root, "skillset.yaml"), config.replace("unsupportedDestination: warn", "unsupportedDestination: error"));
  await expect(buildSkillsetResult(root)).rejects.toThrow("omits remote interface assets");
  expect(await readFile(join(root, outputPath), "utf8")).toBe(before);
  expect(await readFile(join(root, "skillset.lock"), "utf8")).toBe(lock);
});

test("local materialized assets remain native and are not reported as omitted", async () => {
  const root = await fixture("error", "            logo: ./assets/logo.svg");
  const config = await readFile(join(root, "skillset.yaml"), "utf8");
  await Bun.write(join(root, "skillset.yaml"), config.replace("source: url\n            url: https://example.com/remote.git", "source: local\n            path: ./plugins/remote"));
  await Bun.write(join(root, ".skillset/plugins/remote/skillset.yaml"), "skillset:\n  name: remote\n");
  await Bun.write(join(root, ".skillset/plugins/remote/assets/logo.svg"), "logo");
  const result = await buildSkillsetResult(root);
  expect(result.renderResults.some((item) => item.diagnostics?.some((diagnostic) => diagnostic.code === code))).toBe(false);
  expect((await Bun.file(join(root, outputPath)).json()).plugins[0].interface.logo).toBe("./assets/logo.svg");
});

test("native plugin interface contributes inherited remote loss", async () => {
  const root = await fixture("warn", "");
  await Bun.write(join(root, ".skillset/plugins/remote/skillset.yaml"), "skillset:\n  name: remote\ncodex:\n  interface:\n    logo: ./assets/native.svg\n");
  await Bun.write(join(root, ".skillset/plugins/remote/assets/native.svg"), "native");
  const result = await buildSkillsetResult(root);
  expect(result.renderResults.find((item) => item.diagnostics?.some((diagnostic) => diagnostic.code === code))).toMatchObject({ sourceUnit: "plugin.remote.config:root", status: "lossy" });
});

for (const source of ["source: npm\n            package: remote-package", "source: git-subdir\n            url: https://example.com/remote.git\n            path: ./plugin"]) {
  test(`reports asset loss for remote source ${source.split("\n")[0]}`, async () => {
    const root = await fixture("warn");
    const config = await readFile(join(root, "skillset.yaml"), "utf8");
    await Bun.write(join(root, "skillset.yaml"), config.replace("source: url\n            url: https://example.com/remote.git", source));
    const result = await buildSkillsetResult(root);
    expect(result.renderResults.some((item) => item.diagnostics?.some((diagnostic) => diagnostic.code === code))).toBe(true);
  });
}

test("disabled Codex and excluded build scopes do not block unrelated output", async () => {
  const root = await fixture();
  await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo.\n---\nDemo.\n");
  const scoped = await buildSkillsetResult(root, { scopes: ["repo"] });
  expect(scoped.ok).toBe(true);
  expect(scoped.renderResults.some((item) => item.status === "lossy")).toBe(false);
  expect(await Bun.file(join(root, outputPath)).exists()).toBe(false);
  const config = await readFile(join(root, "skillset.yaml"), "utf8");
  await Bun.write(join(root, "skillset.yaml"), config.replace("codex: true", "codex: false"));
  const disabled = await buildSkillsetResult(root);
  expect(disabled.renderResults.some((item) => item.diagnostics?.some((diagnostic) => diagnostic.code === code))).toBe(false);
});

test("matches the selected target when another provider reuses the entry id", async () => {
  const root = await fixture("error", "");
  const config = await readFile(join(root, "skillset.yaml"), "utf8");
  await Bun.write(join(root, "skillset.yaml"), config.replace("    plugins:\n", "    plugins:\n      - plugin: other\n        id: listing-name\n        targets: [claude]\n        codex:\n          interface:\n            logo: ./unselected.svg\n"));
  const result = await buildSkillsetResult(root);
  expect(result.ok).toBe(true);
  expect(result.renderResults.some((item) => item.status === "lossy")).toBe(false);
});
