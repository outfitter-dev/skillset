import { expect, test } from "bun:test";
import { join } from "node:path";
import { parseYamlRecord } from "@skillset/core/internal/yaml";
import { readReportBundle } from "@skillset/core/internal/report-store";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { adoptExistingMarketplace } from "../marketplace-adoption";
import { adoptSkillset, renderAdoptReportMarkdown } from "../adopt";
import { persistAdoptionReceipt } from "../operation-receipt";

const catalogPath = ".claude-plugin/marketplace.json";

async function fixture(config: string, name = "shared") {
  const root = await createTestFixtureRoot("skillset-marketplace-collision-");
  const catalog = JSON.stringify({ name, owner: { name: "Imported publisher" }, plugins: [{ name: "helper", source: "./plugins/helper" }] });
  await Bun.write(join(root, "skillset.yaml"), config);
  await Bun.write(join(root, catalogPath), catalog);
  return { root, catalog };
}

for (const existing of [
  { targets: ["codex"], description: "Preserve Codex catalog", plugins: [{ plugin: "existing" }] },
  { targets: ["cursor"], description: "Preserve Cursor catalog", plugins: [] },
  { targets: [], plugins: [] },
  null,
] as const) {
  test(`preserves an existing catalog key before assigning imported fields: ${JSON.stringify(existing)}`, async () => {
    const config = JSON.stringify({ skillset: { name: "workspace" }, marketplaces: { shared: existing } }, null, 2) + "\n";
    const { root, catalog } = await fixture(config);
    const report = await adoptExistingMarketplace(root, ["helper"]);
    expect(report?.catalog).toBeUndefined();
    expect(report?.normalizations ?? []).toEqual([]);
    expect(report?.warnings.join(" ")).toContain("marketplaces.shared");
    expect(report?.warnings.join(" ")).toContain("not imported");
    expect(await Bun.file(join(root, "skillset.yaml")).text()).toBe(config);
    expect(await Bun.file(join(root, catalogPath)).text()).toBe(catalog);
  });
}

test("a distinct catalog preserves existing provider membership and imports Claude separately", async () => {
  const existing = { targets: ["codex"], description: "Existing", plugins: [{ plugin: "existing" }] };
  const { root } = await fixture(JSON.stringify({ skillset: { name: "workspace" }, marketplaces: { existing } }));
  const report = await adoptExistingMarketplace(root, ["helper"]);
  expect(report?.catalog).toBe("shared");
  const config = parseYamlRecord(await Bun.file(join(root, "skillset.yaml")).text(), "config");
  expect(config).toHaveProperty("marketplaces.existing", existing);
  expect(config).toHaveProperty("marketplaces.shared.targets", ["claude"]);
  expect(report?.normalizations?.some((entry) => entry.code === "marketplace.name")).toBe(true);
});

test("an inherited object property name is not an authored catalog collision", async () => {
  const { root } = await fixture("skillset:\n  name: workspace\nmarketplaces: {}\n", "constructor");
  const report = await adoptExistingMarketplace(root, ["helper"]);
  expect(report?.catalog).toBe("constructor");
});

test("adoption exposes the collision without replacing intent or recording unmade assignments", async () => {
  const existing = { targets: ["codex"], description: "Preserve catalog", plugins: [{ plugin: "helper" }] };
  const { root, catalog } = await fixture(JSON.stringify({ skillset: { name: "workspace" }, compile: { targets: ["claude", "codex"] }, marketplaces: { shared: existing } }));
  await Bun.write(join(root, "plugins/helper/.claude-plugin/plugin.json"), JSON.stringify({ name: "helper" }));
  const report = await adoptSkillset(root, { write: true });
  expect(report.marketplace?.catalog).toBeUndefined();
  expect(report.marketplace?.normalizations ?? []).toEqual([]);
  expect(report.marketplace?.warnings.join(" ")).toContain("marketplaces.shared");
  const config = parseYamlRecord(await Bun.file(join(root, "skillset.yaml")).text(), "config");
  expect(config).toHaveProperty("marketplaces.shared", existing);
  expect(config).not.toHaveProperty("skillset.author");
  expect(await Bun.file(join(root, catalogPath)).text()).toBe(catalog);
  expect(renderAdoptReportMarkdown(report, { rootPath: root })).toContain("marketplaces.shared");
  const receipt = await persistAdoptionReceipt(report);
  const stored = JSON.stringify((await readReportBundle(receipt.id)).report);
  expect(stored).not.toContain("marketplace.name");
  expect(stored).not.toContain("marketplace.target");
  expect(stored).not.toContain("marketplace.owner");
});
