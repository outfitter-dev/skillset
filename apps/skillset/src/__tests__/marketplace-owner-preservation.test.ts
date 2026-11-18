import { expect, test } from "bun:test";
import { join } from "node:path";
import { createOperationalPathContext, resolveOperationalPath } from "@skillset/core";
import { readReportBundle } from "@skillset/core/internal/report-store";
import { parseYamlRecord } from "@skillset/core/internal/yaml";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { adoptSkillset, renderAdoptReportMarkdown } from "../adopt";
import { adoptExistingMarketplace } from "../marketplace-adoption";
import { persistAdoptionReceipt } from "../operation-receipt";

const catalogPath = ".claude-plugin/marketplace.json";
async function fixture(metadata: Record<string, unknown>, owner: Record<string, unknown>, plugins: unknown[] = [{ name: "helper", source: "./plugins/helper" }]) {
  const root = await createTestFixtureRoot("skillset-marketplace-owner-");
  const catalog = JSON.stringify({ name: "acme", owner, plugins });
  await Bun.write(join(root, "skillset.yaml"), JSON.stringify({ skillset: { name: "workspace", ...metadata }, compile: { targets: ["claude"] } }));
  await Bun.write(join(root, catalogPath), catalog);
  await Bun.write(join(root, "plugins/helper/.claude-plugin/plugin.json"), JSON.stringify({ name: "helper" }));
  return { root, catalog };
}

for (const nativeOwner of [
  { name: "Publisher", email: "new@example.invalid" },
  { name: "Publisher" },
  { name: "Publisher", email: "old@example.invalid", url: "https://example.invalid/publisher" },
]) {
  test(`same-name owner retains exact native fields: ${JSON.stringify(nativeOwner)}`, async () => {
    const author = { name: "Publisher", email: "old@example.invalid" };
    const { root, catalog } = await fixture({ author }, nativeOwner);
    const report = await adoptSkillset(root, { write: true });
    expect(report.ok).toBe(true);
    const config = parseYamlRecord(await Bun.file(join(root, "skillset.yaml")).text(), "config");
    expect(config).toHaveProperty("skillset.author", author);
    expect(config).toHaveProperty("skillset.owner", nativeOwner);
    const output = resolveOperationalPath(createOperationalPathContext(root), ".skillset/cache/latest/.claude-plugin/marketplace.json");
    expect((await Bun.file(output).json()).owner).toEqual(nativeOwner);
    expect(report.marketplace?.normalizations?.filter((entry) => entry.code === "marketplace.owner").map((entry) => entry.destination.pointer)).toEqual(["/skillset/owner"]);
    expect(await Bun.file(join(root, catalogPath)).text()).toBe(catalog);
  });
}

test("equal owner records reuse the existing author regardless of key order", async () => {
  const { root } = await fixture({ author: { name: "Publisher", email: "same@example.invalid" } }, { email: "same@example.invalid", name: "Publisher" });
  const report = await adoptExistingMarketplace(root, ["helper"]);
  const config = parseYamlRecord(await Bun.file(join(root, "skillset.yaml")).text(), "config");
  expect(config).not.toHaveProperty("skillset.owner");
  expect(report?.normalizations?.filter((entry) => entry.code === "marketplace.owner")).toEqual([]);
  expect(report?.warnings).toEqual([]);
});

test("an explicit unequal workspace owner is preserved with a value-free warning receipt", async () => {
  const owner = { name: "Publisher", email: "explicit@example.invalid" };
  const { root, catalog } = await fixture({ owner }, { name: "Publisher", email: "native@example.invalid" });
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  expect(report.marketplace?.warnings.join(" ")).toContain("skillset.owner");
  expect(report.marketplace?.normalizations?.filter((entry) => entry.code === "marketplace.owner")).toEqual([]);
  expect(parseYamlRecord(await Bun.file(join(root, "skillset.yaml")).text(), "config")).toHaveProperty("skillset.owner", owner);
  expect(await Bun.file(join(root, catalogPath)).text()).toBe(catalog);
  const receipt = await persistAdoptionReceipt(report);
  const stored = JSON.stringify((await readReportBundle(receipt.id)).report);
  expect(stored).toContain("adopt.marketplace-warning");
  expect(stored).not.toContain("explicit@example.invalid");
  expect(stored).not.toContain("native@example.invalid");
});

test("ignored malformed catalog entries are reported by source index alongside named skips", async () => {
  const { root, catalog } = await fixture({}, { name: "Publisher" }, [null, {}, 3, { source: "private-entry-content" }, { name: "helper", source: "./plugins/helper" }, { name: "remote", source: "remote" }]);
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  expect(report.marketplace?.skippedPlugins).toEqual(["remote"]);
  const warnings = report.marketplace?.warnings.join(" ") ?? "";
  for (const index of [0, 1, 2, 3]) expect(warnings).toContain(`/plugins/${index}`);
  expect(warnings).not.toContain("private-entry-content");
  expect(report.marketplace?.normalizations?.filter((entry) => entry.code === "marketplace.plugin").map((entry) => entry.source.pointer)).toEqual(["/plugins/4/name"]);
  expect(renderAdoptReportMarkdown(report, { rootPath: root })).toContain("/plugins/3");
  expect(await Bun.file(join(root, catalogPath)).text()).toBe(catalog);
  const receipt = await persistAdoptionReceipt(report);
  expect(JSON.stringify((await readReportBundle(receipt.id)).report)).toContain("adopt.marketplace-warning");
});

test("ignored entry evidence survives a catalog with no selected plugin", async () => {
  const { root } = await fixture({}, { name: "Publisher" }, [null, {}]);
  const before = await Bun.file(join(root, "skillset.yaml")).text();
  const report = await adoptExistingMarketplace(root, []);
  expect(report?.catalog).toBeUndefined();
  expect(report?.warnings.join(" ")).toContain("/plugins/0");
  expect(report?.warnings.join(" ")).toContain("/plugins/1");
  expect(await Bun.file(join(root, "skillset.yaml")).text()).toBe(before);
});
