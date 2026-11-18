import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createOperationalPathContext, resolveOperationalPath } from "@skillset/core";
import { readReportBundle } from "@skillset/core/internal/report-store";
import { parseYamlRecord } from "@skillset/core/internal/yaml";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { adoptSkillset, renderAdoptReportMarkdown } from "../adopt";
import { persistAdoptionReceipt } from "../operation-receipt";

async function fixture(description = "Review changes — exactly.", targets = "claude") {
  const root = await createTestFixtureRoot("skillset-manifest-roundtrip-");
  const original = JSON.stringify({ name: "demo", description });
  await Bun.write(join(root, ".claude-plugin/plugin.json"), original);
  await Bun.write(join(root, "skillset.yaml"), `compile:\n  targets: [${targets}]\n`);
  return { root, original };
}

test("direct Claude identity qualifies only after the actual isolated output round trip and persists value-free", async () => {
  const { root, original } = await fixture();
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  const entries = report.imports.flatMap((item) => item.normalizations ?? []);
  expect(entries.filter((entry) => entry.roundTrip !== undefined).map((entry) => entry.code)).toEqual(["manifest.name", "manifest.description"]);
  for (const entry of entries) {
    expect(entry.fidelity).toBe("unknown"); // Runtime semantics are still outside this metadata proof.
    expect(entry.roundTrip).toMatchObject({ fidelity: "exact", scope: "claude-manifest-identity", target: "claude", output: { path: ".skillset/cache/latest/plugins/demo/.claude-plugin/plugin.json", pointer: entry.source.pointer } });
    expect(entry.roundTrip?.authorityHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
  }
  const canonical = parseYamlRecord(await readFile(join(root, ".skillset/plugins/demo/skillset.yaml"), "utf8"), "source") as { skillset: { name: string; description: string } };
  expect(canonical.skillset).toMatchObject(JSON.parse(original));
  const outputPath = resolveOperationalPath(createOperationalPathContext(root), entries[0]!.roundTrip!.output.path);
  expect(JSON.parse(await readFile(outputPath, "utf8"))).toMatchObject(JSON.parse(original));
  const receipt = await persistAdoptionReceipt(report);
  expect((await readReportBundle(receipt.id)).report).toHaveProperty("payload.normalizations", entries);
  expect(renderAdoptReportMarkdown(report, { rootPath: root })).toContain("Exact same-provider metadata round trip");
  expect(JSON.stringify(entries)).not.toContain("Review changes");
  expect(await readFile(join(root, ".claude-plugin/plugin.json"), "utf8")).toBe(original);
});

test("description trimming retains an observation without exact qualification", async () => {
  const { root, original } = await fixture("  Review changes.  ");
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  const entries = report.imports.flatMap((item) => item.normalizations ?? []);
  expect(entries.find((entry) => entry.code === "manifest.name")?.roundTrip).toBeDefined();
  expect(entries.find((entry) => entry.code === "manifest.description")?.roundTrip).toBeUndefined();
  expect(await readFile(join(root, ".claude-plugin/plugin.json"), "utf8")).toBe(original);
});

test("an unselected Claude output cannot qualify a manifest observation", async () => {
  const { root } = await fixture("Description.", "cursor");
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  expect(report.imports.flatMap((item) => item.normalizations ?? [])).toHaveLength(2);
  expect(report.imports.flatMap((item) => item.normalizations ?? []).every((entry) => entry.roundTrip === undefined)).toBe(true);
});

for (const [field, value] of [["name", "demo"], ["description", "Review changes — exactly."]] as const) {
  test(`an inherited ${field} override remains outside the positive route`, async () => {
    const { root } = await fixture();
    await Bun.write(join(root, "skillset.yaml"), `compile:\n  targets: [claude]\nclaude:\n  manifest:\n    ${field}: ${value}\n`);
    const report = await adoptSkillset(root, { write: true });
    expect(report.ok).toBe(true);
    const entries = report.imports.flatMap((item) => item.normalizations ?? []);
    expect(entries.find((entry) => entry.code === `manifest.${field}`)?.roundTrip).toBeUndefined();
    expect(entries.filter((entry) => entry.roundTrip !== undefined)).toHaveLength(1);
  });
}

test("a failed isolated build retains observations without qualifying identity", async () => {
  const { root } = await fixture("Description.", "claude, cursor");
  await Bun.write(join(root, "skills/review/SKILL.md"), "---\nname: review\ndescription: Review.\nallowed-tools: Bash\n---\nReview.\n");
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(false);
  expect(report.buildError).toBeDefined();
  const entries = report.imports.flatMap((item) => item.normalizations ?? []);
  expect(entries).toHaveLength(2);
  expect(entries.every((entry) => entry.roundTrip === undefined)).toBe(true);
  const receipt = await persistAdoptionReceipt(report);
  expect((await readReportBundle(receipt.id)).report).toHaveProperty("payload.normalizations", entries);
});

test("qualification uses the actual render graph even if source changes after rendering", async () => {
  const { spyOn } = await import("bun:test");
  const buildModule = await import("@skillset/core/internal/build");
  const build = buildModule.buildSkillsetResultWithAuthority;
  const { root, original } = await fixture();
  let changed = false;
  const wrapped = spyOn(buildModule, "buildSkillsetResultWithAuthority").mockImplementation(async (path, options, inspection, repair, hooks = {}) => build(path, options, inspection, repair, {
    ...hooks,
    afterRender: async (graph) => {
      await hooks.afterRender?.(graph);
      const config = join(root, ".skillset/plugins/demo/skillset.yaml");
      await Bun.write(config, (await readFile(config, "utf8")).replace("Review changes — exactly.", "Changed after render."));
      changed = true;
    },
  }));
  try {
    const report = await adoptSkillset(root, { write: true });
    expect(changed).toBe(true);
    expect(report.buildError).toBeUndefined();
    const entries = report.imports.flatMap((item) => item.normalizations ?? []);
    expect(entries.every((entry) => entry.roundTrip !== undefined)).toBe(true);
    const output = resolveOperationalPath(createOperationalPathContext(root), entries[0]!.roundTrip!.output.path);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject(JSON.parse(original));
    expect(await readFile(join(root, ".skillset/plugins/demo/skillset.yaml"), "utf8")).toContain("Changed after render.");
  } finally {
    wrapped.mockRestore();
  }
});
