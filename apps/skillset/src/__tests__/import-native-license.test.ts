import { expect, test } from "bun:test";
import { lstat, mkdir, readFile, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { buildSkillsetResult } from "@skillset/core/internal/build";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { importSource } from "../import";
import { adoptSkillset } from "../adopt";
import { persistAdoptionReceipt } from "../operation-receipt";
import { readReportBundle } from "@skillset/core/internal/report-store";

const notice = "Authored license notice\r\nCopyright Example Authors\r\nFull original terms.\r\n";
async function fixture(license?: string) {
  const root = await createTestFixtureRoot("skillset-native-license-");
  const sourcePath = join(root, "original");
  const manifest = JSON.stringify({ name: "demo", description: "Demo", ...(license === undefined ? {} : { license }) });
  await Bun.write(join(sourcePath, ".cursor-plugin/plugin.json"), manifest);
  await Bun.write(join(sourcePath, "skills/demo-skill/SKILL.md"), "---\nname: demo-skill\ndescription: Demo skill\n---\n\nBody.\n");
  await Bun.write(join(root, "skillset.yaml"), "skillset:\n  name: workspace\ncompile:\n  targets: [cursor]\n");
  return { root, sourcePath, manifest };
}
async function rejected(root: string, sourcePath: string, message: string) {
  let claimed = false;
  await expect(importSource({ rootPath: root, sourcePath, kind: "plugin", testHooks: { beforeClaim: async () => { claimed = true; } } })).rejects.toThrow(message);
  expect(claimed).toBe(false);
  expect(await lstat(join(root, ".skillset/plugins/demo")).catch(() => undefined)).toBeUndefined();
  expect(await readdir(join(root, ".skillset/plugins"))).toEqual([]);
}

for (const file of ["LICENSE", "LICENSE.txt"]) {
  test(`preserves lone native ${file} in plugin and inherited skill output`, async () => {
    const { root, sourcePath } = await fixture();
    await Bun.write(join(sourcePath, file), notice);
    const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
    expect(await readFile(join(report.targetPath, "LICENSE.txt"), "utf8")).toBe(notice);
    expect(await readFile(join(sourcePath, file), "utf8")).toBe(notice);
    expect(report.copiedFiles).toContain("LICENSE.txt");
    const observations = (report.normalizations ?? []).filter((entry) => entry.code === "native.license-path");
    if (file === "LICENSE") {
      expect(observations).toEqual([expect.objectContaining({ dialect: "cursor", source: { path: "LICENSE", pointer: "" }, destination: { path: ".skillset/plugins/demo/LICENSE.txt", pointer: "" }, fidelity: "unknown" })]);
      expect(report.copiedFiles).not.toContain("LICENSE");
    } else expect(observations).toEqual([]);
    expect((await buildSkillsetResult(root)).ok).toBe(true);
    for (const output of ["plugins/demo/LICENSE.txt", "plugins/demo/skills/demo-skill/LICENSE.txt"]) {
      expect(await readFile(join(root, output), "utf8")).toBe(notice);
    }
  });
  for (const license of ["MIT", "Apache-2.0", "none"]) {
    test(`rejects native ${license} plus ${file} before claim`, async () => {
      const { root, sourcePath, manifest } = await fixture(license);
      await Bun.write(join(sourcePath, file), notice);
      await rejected(root, sourcePath, "license metadata and bundled license text");
      expect(await readFile(join(sourcePath, file), "utf8")).toBe(notice);
      expect(await readFile(join(sourcePath, ".cursor-plugin/plugin.json"), "utf8")).toBe(manifest);
    });
  }
}

test("rejects both native notice spellings without choosing one", async () => {
  const { root, sourcePath } = await fixture();
  await Bun.write(join(sourcePath, "LICENSE"), notice);
  await Bun.write(join(sourcePath, "LICENSE.txt"), "Other text\n");
  await rejected(root, sourcePath, "both LICENSE and LICENSE.txt");
  expect(await readFile(join(sourcePath, "LICENSE"), "utf8")).toBe(notice);
});

for (const kind of ["symlink", "broken-symlink", "directory"]) {
  test(`rejects original license ${kind} rather than silently omitting it`, async () => {
    const { root, sourcePath } = await fixture();
    const candidate = join(sourcePath, "LICENSE");
    if (kind === "directory") await mkdir(candidate);
    else {
      const outside = join(root, "outside-license");
      if (kind === "symlink") await Bun.write(outside, notice);
      await symlink(outside, candidate);
    }
    await rejected(root, sourcePath, "must be a regular file");
    expect((await lstat(candidate)).isSymbolicLink()).toBe(kind !== "directory");
  });
}

test("preexisting canonical license configuration remains authoritative", async () => {
  const { root, sourcePath } = await fixture("MIT");
  const config = "skillset:\n  name: demo\n  description: Demo\n  license: MIT\n";
  await Bun.write(join(sourcePath, "skillset.yaml"), config);
  await Bun.write(join(sourcePath, "LICENSE"), notice);
  await Bun.write(join(sourcePath, "LICENSE.txt"), notice);
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect(await readFile(join(report.targetPath, "skillset.yaml"), "utf8")).toBe(config);
  expect(await readFile(join(report.targetPath, "LICENSE"), "utf8")).toBe(notice);
  expect((report.normalizations ?? []).filter((entry) => entry.code === "native.license-path")).toEqual([]);
});

test("explicit import target cannot hide another native manifest license conflict", async () => {
  const { root, sourcePath } = await fixture();
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), JSON.stringify({ name: "demo", description: "Demo", license: "MIT" }));
  await Bun.write(join(sourcePath, "LICENSE.txt"), notice);
  await expect(importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "cursor" })).rejects.toThrow("license metadata and bundled license text");
  expect(await readdir(join(root, ".skillset/plugins"))).toEqual([]);
});

test("records each actual native origin when a shared notice is normalized", async () => {
  const { root, sourcePath } = await fixture();
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), JSON.stringify({ name: "demo", description: "Demo" }));
  await Bun.write(join(sourcePath, ".codex-plugin/plugin.json"), JSON.stringify({ name: "demo", description: "Demo" }));
  await Bun.write(join(sourcePath, "LICENSE"), notice);
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect((report.normalizations ?? []).filter((entry) => entry.code === "native.license-path").map((entry) => entry.dialect).sort()).toEqual(["claude", "codex", "cursor"]);
  expect(await readFile(join(report.targetPath, "LICENSE.txt"), "utf8")).toBe(notice);
});

test("metadata-only native license retains its existing identifier notice", async () => {
  const { root, sourcePath } = await fixture("MIT");
  await importSource({ rootPath: root, sourcePath, kind: "plugin" });
  expect((await buildSkillsetResult(root)).ok).toBe(true);
  expect(await readFile(join(root, "plugins/demo/LICENSE.txt"), "utf8")).toContain("SPDX-License-Identifier: MIT");
});

for (const license of [undefined, "MIT"]) {
  test(`root adoption retains license evidence and original bytes (metadata: ${license ?? "absent"})`, async () => {
    const root = await createTestFixtureRoot("skillset-adopt-native-license-");
    const manifest = JSON.stringify({ name: "demo", description: "Demo", ...(license === undefined ? {} : { license }) });
    await Bun.write(join(root, ".cursor-plugin/plugin.json"), manifest);
    await Bun.write(join(root, "LICENSE"), notice);
    await Bun.write(join(root, "skills/demo-skill/SKILL.md"), "---\nname: demo-skill\ndescription: Demo skill\n---\n\nBody.\n");
    await Bun.write(join(root, "skillset.yaml"), "skillset:\n  name: workspace\ncompile:\n  targets: [cursor]\n");
    await adoptSkillset(root, { write: false });
    expect(await lstat(join(root, ".skillset/plugins/demo")).catch(() => undefined)).toBeUndefined();
    expect(await readFile(join(root, "LICENSE"), "utf8")).toBe(notice);
    const report = await adoptSkillset(root, { write: true });
    expect(report.ok).toBe(license === undefined);
    const receipt = await persistAdoptionReceipt(report);
    const bundle = await readReportBundle(receipt.id);
    if (license === undefined) {
      expect(report.imports.flatMap((entry) => entry.normalizations ?? [])).toEqual(expect.arrayContaining([expect.objectContaining({ code: "native.license-path", dialect: "cursor" })]));
      expect(bundle.report).toMatchObject({ payload: { normalizations: expect.arrayContaining([expect.objectContaining({ code: "native.license-path" })]) } });
      expect(await readFile(join(root, ".skillset/plugins/demo/LICENSE.txt"), "utf8")).toBe(notice);
    } else {
      expect(report.imports.some((entry) => !entry.ok)).toBe(true);
      expect(await lstat(join(root, ".skillset/plugins/demo")).catch(() => undefined)).toBeUndefined();
      expect(report.imports.flatMap((entry) => entry.normalizations ?? []).some((entry) => entry.code === "native.license-path")).toBe(false);
    }
    expect(await readFile(join(root, "LICENSE"), "utf8")).toBe(notice);
    expect(await readFile(join(root, ".cursor-plugin/plugin.json"), "utf8")).toBe(manifest);
  });
}

test("license path evidence stays unknown while direct Claude identity retains its narrow proof", async () => {
  const root = await createTestFixtureRoot("skillset-license-identity-proof-");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
  await Bun.write(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "demo", description: "Demo" }));
  await Bun.write(join(root, "LICENSE"), notice);
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  const entries = report.imports.flatMap((entry) => entry.normalizations ?? []);
  expect(entries.filter((entry) => entry.code === "native.license-path")).toEqual([expect.objectContaining({ fidelity: "unknown", source: { path: "LICENSE", pointer: "" } })]);
  expect(entries.find((entry) => entry.code === "native.license-path")?.roundTrip).toBeUndefined();
  for (const code of ["manifest.name", "manifest.description"]) {
    expect(entries.find((entry) => entry.code === code)?.roundTrip).toMatchObject({ fidelity: "exact", scope: "claude-manifest-identity" });
  }
});
