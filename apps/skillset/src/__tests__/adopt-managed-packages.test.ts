import * as sourceImport from "../import";
import { withLockProvenance } from "@skillset/core/internal/lock-provenance";
import { expect, spyOn, test } from "bun:test";
import { chmod, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSkillsetResult } from "@skillset/core";
import { inspectAdoptionPluginPackages } from "@skillset/core/internal/adoption-managed-plugins";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { adoptSkillset } from "../adopt";
import { persistAdoptionReceipt } from "../operation-receipt";
import { readReportBundle } from "@skillset/core/internal/report-store";

async function fixture() {
  const root = await createTestFixtureRoot("adopt-managed-package-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude, codex]\n  unsupportedDestination: warn\n  session_start_hook: off\n");
  await Bun.write(join(root, ".skillset/plugins/alpha/skillset.yaml"), "skillset:\n  name: alpha\n");
  await Bun.write(join(root, ".skillset/plugins/alpha/skills/(group)/demo/SKILL.md"), "---\nname: demo\ndescription: Demonstrate package ownership.\n---\n\nDemo.\n");
  await Bun.write(join(root, ".skillset/plugins/alpha/README.md"), "# Alpha\n");
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  return root;
}

test("shared package combines manifest, provider and grouped child claims and retains source in receipt", async () => {
  const root = await fixture();
  const preview = await adoptSkillset(root);
  expect(preview.ok).toBe(true);
  expect(preview.pluginCoalescing).toContainEqual(expect.objectContaining({ selectedSource: ".skillset/plugins/alpha", sources: ["plugins/alpha"] }));
  expect(preview.candidates.filter((entry) => entry.kind === "plugin")).toEqual([]);
  const applied = await adoptSkillset(root, { write: true });
  expect(applied.ok).toBe(true);
  expect(applied.imports.flatMap((entry) => entry.units)).toEqual([]);
  const receipt = await persistAdoptionReceipt(applied);
  expect((await readReportBundle(receipt.id)).report).toMatchObject({ payload: { pluginCoalescing: applied.pluginCoalescing } });
});

test("a valid neighboring lock does not conceal an unowned package", async () => {
  const root = await fixture();
  await Bun.write(join(root, "plugins/unowned/.claude-plugin/plugin.json"), JSON.stringify({ name: "unowned", description: "Unowned plugin." }));
  const preview = await adoptSkillset(root);
  expect(preview.ok).toBe(true);
  expect(preview.candidates).toContainEqual({ kind: "plugin", path: "plugins/unowned" });
});

for (const defect of ["extra", "missing", "edited", "mode", "source", "lock", "missing-lock", "symlink"] as const) {
  test(`package ${defect} blocks adoption before writes`, async () => {
    const root = await fixture();
    const path = join(root, "plugins/alpha/README.md");
    if (defect === "extra") await Bun.write(join(root, "plugins/alpha/unowned.txt"), "Unowned");
    if (defect === "missing") await rm(path);
    if (defect === "edited") await writeFile(path, "Edited");
    if (defect === "mode") await chmod(path, 0o755);
    if (defect === "source") await writeFile(join(root, ".skillset/plugins/alpha/README.md"), "Changed");
    if (defect === "lock") await writeFile(join(root, "plugins/skillset.lock"), "{");
    if (defect === "missing-lock") await rm(join(root, "plugins/skillset.lock"));
    if (defect === "symlink") { await rm(path); await symlink(join(root, ".skillset/plugins/alpha/README.md"), path); }
    const result = await adoptSkillset(root, { write: true });
    expect(result.ok).toBe(false);
    expect(result.writtenPaths).toEqual([]);
    expect(result.imports).toEqual([]);
    expect(result.surveyDiagnostics).toContainEqual(expect.objectContaining({ code: "managed-plugin-ownership-unknown" }));
  });
}

test("direct package inspector returns fresh proof and notices changed output", async () => {
  const root = await fixture();
  const inspect = () => inspectAdoptionPluginPackages(root, ["plugins/alpha"]);
  expect(await inspect()).toContainEqual(expect.objectContaining({ kind: "managed", path: "plugins/alpha", sourcePath: ".skillset/plugins/alpha" }));
  await writeFile(join(root, "plugins/alpha/README.md"), "Changed");
  expect(await inspect()).toContainEqual(expect.objectContaining({ kind: "unknown" }));
});

for (const defect of ["duplicate-claim", "wrong-root", "empty-directory", "missing-manifests"]) {
  test(`complete package proof refuses ${defect}`, async () => {
    const root = await fixture();
    const lockPath = join(root, "plugins/skillset.lock");
    if (defect === "empty-directory") await mkdir(join(root, "plugins/alpha/unowned"));
    else if (defect === "missing-manifests") {
      await rm(join(root, "plugins/alpha/plugin.json"));
      await rm(join(root, "plugins/alpha/.claude-plugin"), { recursive: true });
    } else {
      const lock = JSON.parse(await readFile(lockPath, "utf8"));
      if (defect === "duplicate-claim") lock.items.push({ ...lock.items[0] });
      else lock.outputRoot = "elsewhere";
      await writeFile(lockPath, JSON.stringify(withLockProvenance(lock)));
    }
    const result = await adoptSkillset(root, { write: true });
    expect(result.ok).toBe(false);
    expect(result.writtenPaths).toEqual([]);
    expect(result.surveyDiagnostics).toContainEqual(expect.objectContaining({ code: "managed-plugin-ownership-unknown" }));
  });
}

for (const changed of ["source", "output", "lock"]) {
  test(`package ${changed} mutation during skill preparation is rejected before initialization`, async () => {
    const root = await fixture();
    await Bun.write(join(root, ".agents/skills/unowned/SKILL.md"), "---\nname: unowned\ndescription: Unowned.\n---\nBody.\n");
    const prepare = sourceImport.prepareImportSource;
    const spy = spyOn(sourceImport, "prepareImportSource").mockImplementation(async (...args) => {
      const prepared = await prepare(...args);
      const path = changed === "source" ? ".skillset/plugins/alpha/README.md" : changed === "output" ? "plugins/alpha/README.md" : "plugins/skillset.lock";
      await writeFile(join(root, path), "Changed");
      return prepared;
    });
    try {
      await expect(adoptSkillset(root, { write: true })).rejects.toThrow("managed package evidence changed");
      await expect(lstat(join(root, ".skillset/skills/unowned"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { spy.mockRestore(); }
  });
}
