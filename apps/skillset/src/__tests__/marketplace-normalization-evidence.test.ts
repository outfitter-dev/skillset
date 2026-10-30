import { expect, test } from "bun:test";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { readReportBundle } from "@skillset/core/internal/report-store";
import { parseYamlRecord } from "@skillset/core/internal/yaml";
import { adoptExistingMarketplace } from "../marketplace-adoption";
import { adoptSkillset, renderAdoptReportMarkdown } from "../adopt";
import { persistAdoptionReceipt } from "../operation-receipt";

const path = ".claude-plugin/marketplace.json";
async function fixture(catalog: unknown, config = "{}\n") {
  const root = await createTestFixtureRoot("skillset-marketplace-evidence-");
  const raw = JSON.stringify(catalog);
  await Bun.write(join(root, path), raw);
  await Bun.write(join(root, "skillset.yaml"), config);
  return { root, raw };
}

test("marketplace assignments record their exact source selections without values", async () => {
  const { root, raw } = await fixture({ name: "acme", metadata: { description: "Private catalog description" }, owner: { name: "Private owner", email: "private@example.com" }, plugins: [null, { name: "skipped" }, { name: "helper" }] });
  const report = await adoptExistingMarketplace(root, ["helper"]);
  const entries = report?.normalizations ?? [];
  expect(entries.map((entry) => [entry.code, entry.source.pointer, entry.destination.pointer])).toEqual([
    ["marketplace.name", "/name", "/marketplaces/acme"],
    ["marketplace.target", "", "/marketplaces/acme/targets"],
    ["marketplace.description", "/metadata/description", "/marketplaces/acme/description"],
    ["marketplace.owner", "/owner", "/skillset/author"],
    ["marketplace.plugin", "/plugins/2/name", "/marketplaces/acme/plugins/0/plugin"],
  ]);
  expect(entries.every((entry) => entry.fidelity === "unknown" && entry.dialect === "claude" && entry.source.path === path && entry.destination.path === "skillset.yaml")).toBe(true);
  expect(JSON.stringify(entries)).not.toContain("Private");
  expect(JSON.stringify(entries)).not.toContain("private@example.com");
  const config = parseYamlRecord(await Bun.file(join(root, "skillset.yaml")).text(), "config");
  expect(config).toHaveProperty("skillset.author.email", "private@example.com");
  expect(await Bun.file(join(root, path)).text()).toBe(raw);
});

test("adoption reports and receipts carry marketplace observations without claiming absent owner or description", async () => {
  const { root, raw } = await fixture({ name: "acme", plugins: [{ name: "helper", source: "./plugins/helper" }] }, "compile:\n  targets: [claude]\n");
  await Bun.write(join(root, "plugins/helper/.claude-plugin/plugin.json"), JSON.stringify({ name: "helper" }));
  const report = await adoptSkillset(root, { write: true });
  expect(report.marketplace?.normalizations?.map((entry) => entry.code)).toEqual(["marketplace.name", "marketplace.target", "marketplace.plugin"]);
  const markdown = renderAdoptReportMarkdown(report, { rootPath: root });
  expect(markdown).toContain("marketplace.name");
  expect(markdown).not.toContain("keeping its name, owner and description");
  const receipt = await persistAdoptionReceipt(report);
  const stored = await readReportBundle(receipt.id);
  expect(JSON.stringify(stored.report)).toContain("marketplace.plugin");
  expect(await Bun.file(join(root, path)).text()).toBe(raw);
});


for (const [description, pointer, value] of [
  [undefined, "/metadata/description", "Nested"],
  [null, "/metadata/description", "Nested"],
  ["Direct", "/description", "Direct"],
  ["  Direct  ", "/description", "  Direct  "],
  ["", undefined, undefined],
  [false, undefined, undefined],
] as const) {
  test(`description evidence follows the exact fallback branch: ${String(description)}`, async () => {
    const { root } = await fixture({ name: "acme", ...(description === undefined ? {} : { description }), metadata: { description: "Nested" }, plugins: [{ name: "helper" }] });
    const report = await adoptExistingMarketplace(root, ["helper"]);
    const entries = report?.normalizations?.filter((entry) => entry.code === "marketplace.description") ?? [];
    expect(entries.map((entry) => entry.source.pointer)).toEqual(pointer === undefined ? [] : [pointer]);
    const config = parseYamlRecord(await Bun.file(join(root, "skillset.yaml")).text(), "config");
    if (value === undefined) expect(config).not.toHaveProperty("marketplaces.acme.description");
    else expect(config).toHaveProperty("marketplaces.acme.description", value);
  });
}

for (const [metadata, owner, destination] of [
  [{}, { name: "Publisher" }, "/skillset/author"],
  [{ author: { name: "Author" } }, { name: "Publisher" }, "/skillset/owner"],
  [{ author: { name: "Publisher", email: "existing@example.com" } }, { name: "Publisher", email: "ignored@example.com" }, undefined],
  [{ owner: { name: "Existing" } }, { name: "Publisher" }, undefined],
  [{}, { email: "missing-name@example.com" }, undefined],
  [{}, "Publisher", undefined],
] as const) {
  test(`owner evidence records only actual assignment: ${JSON.stringify([metadata, owner])}`, async () => {
    const { root } = await fixture({ name: "acme", owner, plugins: [{ name: "helper" }] }, JSON.stringify({ skillset: metadata }));
    const report = await adoptExistingMarketplace(root, ["helper"]);
    expect(report?.normalizations?.filter((entry) => entry.code === "marketplace.owner").map((entry) => entry.destination.pointer)).toEqual(destination === undefined ? [] : [destination]);
    const config = parseYamlRecord(await Bun.file(join(root, "skillset.yaml")).text(), "config");
    if (destination === undefined) expect(config.skillset).toEqual(metadata);
  });
}

for (const [catalog, config, selected] of [
  [[], "{}\n", ["helper"]],
  [{ name: "Bad/name", plugins: [{ name: "helper" }] }, "{}\n", ["helper"]],
  [{ name: "acme", plugins: [{ name: "helper" }] }, "{}\n", []],
  [{ name: "acme", plugins: [{ name: "helper" }] }, "marketplaces:\n  existing:\n    targets: [claude]\n    plugins: []\n", ["helper"]],
] as const) {
  test(`undeclared marketplace produces no assignment evidence: ${JSON.stringify([catalog, selected])}`, async () => {
    const { root, raw } = await fixture(catalog, config);
    const report = await adoptExistingMarketplace(root, selected);
    expect(report?.catalog).toBeUndefined();
    expect(report?.normalizations ?? []).toEqual([]);
    expect(await Bun.file(join(root, "skillset.yaml")).text()).toBe(config);
    expect(await Bun.file(join(root, path)).text()).toBe(raw);
  });
}

test("duplicate selected membership retains source array indices and distinct destination entries", async () => {
  const { root } = await fixture({ name: "acme", plugins: [{ name: "helper" }, {}, { name: "remote" }, { name: "helper" }] });
  const report = await adoptExistingMarketplace(root, ["helper"]);
  expect(report?.normalizations?.filter((entry) => entry.code === "marketplace.plugin").map((entry) => [entry.source.pointer, entry.destination.pointer])).toEqual([
    ["/plugins/0/name", "/marketplaces/acme/plugins/0/plugin"],
    ["/plugins/3/name", "/marketplaces/acme/plugins/1/plugin"],
  ]);
  expect(report?.skippedPlugins).toEqual(["remote"]);
});

test("failed adoption keeps completed marketplace observations in the value-free receipt", async () => {
  const { root } = await fixture({ name: "acme", owner: { name: "Secret publisher", email: "private@example.com" }, description: "Private description", plugins: [{ name: "helper", source: "./plugins/helper" }] }, "compile:\n  targets: [claude, codex]\n");
  await Bun.write(join(root, "plugins/helper/.claude-plugin/plugin.json"), JSON.stringify({ name: "helper" }));
  await Bun.write(join(root, "plugins/helper/skills/demo/SKILL.md"), "---\nname: demo\ndescription: Demo.\nmetadata: { nested: { value: true } }\n---\nBody.\n");
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(false);
  expect(report.buildError).toBeDefined();
  expect(report.marketplace?.normalizations).toHaveLength(5);
  const receipt = await persistAdoptionReceipt(report);
  const bundle = await readReportBundle(receipt.id);
  const serialized = JSON.stringify(bundle.report);
  expect(serialized).toContain("marketplace.owner");
  expect(serialized).not.toContain("Secret publisher");
  expect(serialized).not.toContain("private@example.com");
  expect(serialized).not.toContain("Private description");
});
