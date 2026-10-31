import { expect, test } from "bun:test";
import { chmod, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withLockProvenance } from "@skillset/core/internal/lock-provenance";
import { buildSkillsetResult } from "@skillset/core";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { preflightAdoptionSkills } from "../adopt-skill-preflight";
import { persistAdoptionReceipt } from "../operation-receipt";
import { readReportBundle } from "@skillset/core/internal/report-store";
import { adoptSkillset, renderAdoptReportMarkdown } from "../adopt";

const source = ".skillset/skills/(group)/demo/SKILL.md";
const output = ".agents/skills/demo/SKILL.md";
const skill = (name: string) => `---\nname: ${name}\ndescription: Demonstrate ${name}.\n---\n\nAuthored ${name}.\n`;
async function fixture() {
  const root = await createTestFixtureRoot("adopt-managed-projections-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude, codex]\n  session_start_hook: off\n");
  await Bun.write(join(root, source), skill("demo"));
  await Bun.write(join(root, ".skillset/skills/(group)/demo/notes.txt"), "Companion.\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  return root;
}

test("verified generated skills retain grouped authored source while an unmanaged sibling is adopted", async () => {
  const root = await fixture();
  await Bun.write(join(root, ".agents/skills/unowned/SKILL.md"), skill("unowned"));
  const before = await readFile(join(root, source), "utf8");
  const preview = await adoptSkillset(root);
  expect(preview.ok).toBe(true);
  expect(preview.candidates).toContainEqual({ kind: "skills", path: ".agents/skills" });
  expect(preview.skillCoalescing).toContainEqual(expect.objectContaining({
    status: "compatible", selectedSource: ".skillset/skills/(group)/demo", sources: expect.arrayContaining([".agents/skills/demo"]), reason: expect.stringContaining("verified"),
  }));
  const result = await adoptSkillset(root, { write: true });
  expect(result.ok).toBe(true);
  expect(await readFile(join(root, ".skillset/skills/unowned/SKILL.md"), "utf8")).toContain("Authored unowned.");
  expect(await readFile(join(root, source), "utf8")).toBe(before);
  expect(result.imports.flatMap((entry) => entry.units).map((unit) => unit.name)).toEqual(["unowned"]);
});

for (const defect of ["edited", "missing-primary", "missing-resource", "extra-resource", "mode", "stale-source", "corrupt-lock", "missing-lock"] as const) {
  test(`managed ${defect} blocks adoption before any writes`, async () => {
    const root = await fixture();
    await Bun.write(join(root, ".agents/skills/unowned/SKILL.md"), skill("unowned"));
    if (defect === "missing-primary") await rm(join(root, output));
    if (defect === "edited") await writeFile(join(root, output), skill("edited"));
    if (defect === "missing-resource") await rm(join(root, ".agents/skills/demo/notes.txt"));
    if (defect === "extra-resource") await Bun.write(join(root, ".agents/skills/demo/private.txt"), "Unowned.\n");
    if (defect === "mode") await chmod(join(root, output), 0o755);
    if (defect === "stale-source") await writeFile(join(root, source), skill("demo") + "Changed.\n");
    if (defect === "corrupt-lock") await writeFile(join(root, ".agents/skills/skillset.lock"), "{");
    if (defect === "missing-lock") await rm(join(root, ".agents/skills/skillset.lock"));
    const before = await readFile(join(root, source), "utf8");
    const result = await adoptSkillset(root, { write: true });
    expect(result.ok).toBe(false);
    expect(result.writtenPaths).toEqual([]);
    expect(result.imports).toEqual([]);
    expect(await readFile(join(root, source), "utf8")).toBe(before);
  });
}


test("an entirely current managed root is reported without importing source again", async () => {
  const root = await fixture();
  const result = await adoptSkillset(root, { write: true });
  expect(result.ok).toBe(true);
  expect(result.skillCoalescing).toHaveLength(2);
  expect(result.imports.flatMap((entry) => entry.units)).toEqual([]);
});

test("plugin-qualified project copies retain their actual grouped source identities", async () => {
  const root = await createTestFixtureRoot("adopt-project-copies-");
  const files = normalizeSkillsetFixtureFiles({
    "skillset.yaml": "compile:\n  unsupportedDestination: warn\n  session_start_hook: off\nclaude: true\ncodex: true\nplugins:\n  internal_use:\n    skills:\n      alpha: true\n      beta: true\n",
    ".skillset/plugins/alpha/skillset.yaml": "skillset:\n  name: alpha\n",
    ".skillset/plugins/beta/skillset.yaml": "skillset:\n  name: beta\n",
    ".skillset/plugins/alpha/skills/(group)/demo/SKILL.md": skill("demo"),
    ".skillset/plugins/beta/skills/demo/SKILL.md": skill("demo") + "Beta.\n",
  });
  for (const [path, content] of Object.entries(files)) await Bun.write(join(root, path), content);
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const result = await adoptSkillset(root);
  expect(result.skillPreparationErrors).toEqual([]);
  // Shared-package discovery is a separate open acceptance slice; do not hide its refusal.
  expect(result.ok).toBe(false);
  expect(result.surveyDiagnostics).toContainEqual(expect.objectContaining({ code: "agent-plugin-import-blocked" }));
  for (const [name, path] of [["alpha-demo", ".skillset/plugins/alpha/skills/(group)/demo"], ["beta-demo", ".skillset/plugins/beta/skills/demo"]]) {
    expect(result.skillCoalescing).toContainEqual(expect.objectContaining({ sources: expect.arrayContaining([`.agents/skills/${name}`]), selectedSource: path }));
  }
});

for (const changed of ["source", "output", "lock"]) {
  test(`managed ${changed} changes invalidate a prepared adoption`, async () => {
    const root = await fixture();
    const candidates = [{ kind: "skills" as const, path: ".agents/skills" }];
    const preflight = await preflightAdoptionSkills(root, candidates, async (candidate) => ({ rootPath: root, sourcePath: join(root, candidate.path), kind: "skills", mergeTargetNativeSkill: true }));
    try {
      expect(preflight.errors).toEqual([]);
      const path = changed === "source" ? source : changed === "output" ? output : ".agents/skills/skillset.lock";
      await writeFile(join(root, path), (await readFile(join(root, path), "utf8")) + "Changed.\n");
      await expect(preflight.assertUnchanged()).rejects.toThrow();
    } finally { await preflight.dispose(); }
  });
}

test("symlinked managed companions are not read or accepted as equivalent", async () => {
  const root = await fixture();
  const outside = await createTestFixtureRoot("adopt-external-companion-");
  await Bun.write(join(outside, "notes.txt"), "Companion.\n");
  await rm(join(root, ".agents/skills/demo/notes.txt"));
  await symlink(join(outside, "notes.txt"), join(root, ".agents/skills/demo/notes.txt"));
  const result = await adoptSkillset(root, { write: true });
  expect(result.ok).toBe(false);
  expect(result.writtenPaths).toEqual([]);
  expect(await readFile(join(outside, "notes.txt"), "utf8")).toBe("Companion.\n");
});


test("a selected generated root with a missing lock cannot create a second canonical unit", async () => {
  const root = await fixture();
  await rm(join(root, ".agents/skills/skillset.lock"));
  const result = await adoptSkillset(root, { write: true, candidates: ["skills:.agents/skills"] });
  expect(result.ok).toBe(false);
  expect(result.writtenPaths).toEqual([]);
  expect(result.imports).toEqual([]);
});


test("draft and shipped copies retain distinct source paths in preview and durable receipts", async () => {
  const root = await fixture();
  const draft = ".skillset/skills/_drafts/(group)/demo/SKILL.md";
  await Bun.write(join(root, draft), skill("demo") + "Draft only.\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  const report = await adoptSkillset(root);
  expect(report.ok).toBe(true);
  expect(report.skillCoalescing).toContainEqual(expect.objectContaining({ sources: expect.arrayContaining([".agents/skills/draft-demo"]), selectedSource: ".skillset/skills/_drafts/(group)/demo" }));
  expect(report.skillCoalescing).toContainEqual(expect.objectContaining({ sources: expect.arrayContaining([".agents/skills/demo"]), selectedSource: ".skillset/skills/(group)/demo" }));
  const receipt = await persistAdoptionReceipt(report);
  expect((await readReportBundle(receipt.id)).report).toMatchObject({ payload: { skillCoalescing: report.skillCoalescing } });
  expect(renderAdoptReportMarkdown(report, { rootPath: root })).toContain("verified current ownership");
});


for (const auxiliary of ["tools", "openai", "both"]) {
  test(`current ${auxiliary} auxiliary lock records remain part of one verified skill`, async () => {
    const root = await fixture();
    if (auxiliary !== "openai") await writeFile(join(root, source), skill("demo").replace("description: Demonstrate demo.", "description: Demonstrate demo.\ntools:\n  read: true"));
    if (auxiliary !== "tools") await Bun.write(join(root, ".skillset/skills/(group)/demo/agents/openai.yaml"), "interface:\n  display_name: Demo\n  short_description: Demonstrate managed skills.\n");
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    const preview = await adoptSkillset(root);
    expect(preview.skillPreparationErrors).toEqual([]);
    expect(preview.ok).toBe(true);
    expect(preview.skillCoalescing).toContainEqual(expect.objectContaining({ selectedSource: ".skillset/skills/(group)/demo", sources: expect.arrayContaining([".agents/skills/demo"]) }));
    const sidecar = auxiliary === "tools" ? ".agents/skills/demo/.skillset.tools.yaml" : ".agents/skills/demo/agents/openai.yaml";
    await writeFile(join(root, sidecar), "Edited.\n");
    const blocked = await adoptSkillset(root, { write: true });
    expect(blocked.ok).toBe(false);
    expect(blocked.writtenPaths).toEqual([]);
  });
}

test("ordinary duplicate source directories with spaces preserve receipt paths", async () => {
  const root = await createTestFixtureRoot("adopt-space-paths-");
  for (const provider of [".agents", ".claude"]) await Bun.write(join(root, provider, "skills/my skill/SKILL.md"), skill("demo"));
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  const receipt = await persistAdoptionReceipt(report);
  expect((await readReportBundle(receipt.id)).report).toMatchObject({ payload: { skillCoalescing: report.skillCoalescing } });
});


for (const corruption of ["foreign", "duplicate"]) {
  test(`${corruption} auxiliary ownership does not authorize coalescing`, async () => {
    const root = await fixture();
    await writeFile(join(root, source), skill("demo").replace("description: Demonstrate demo.", "description: Demonstrate demo.\ntools:\n  read: true"));
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    const path = join(root, ".agents/skills/skillset.lock");
    const lock = JSON.parse(await readFile(path, "utf8"));
    const auxiliary = lock.items.find((item: { outputPath: string }) => item.outputPath.endsWith(".skillset.tools.yaml"));
    expect(auxiliary).toBeDefined();
    if (corruption === "foreign") auxiliary.sourcePath = ".skillset/skills/foreign/SKILL.md";
    else lock.items.push({ ...auxiliary });
    await writeFile(path, JSON.stringify(withLockProvenance(lock)));
    const result = await adoptSkillset(root, { write: true });
    expect(result.ok).toBe(false);
    expect(result.writtenPaths).toEqual([]);
  });
}
