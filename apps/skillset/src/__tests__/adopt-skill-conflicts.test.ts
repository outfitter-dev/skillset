import { expect, test } from "bun:test";
import { chmod, lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { persistAdoptionReceipt } from "../operation-receipt";
import { readReportBundle } from "@skillset/core/internal/report-store";
import { preflightAdoptionSkills } from "../adopt-skill-preflight";
import { adoptSkillset } from "../adopt";

const skill = (body: string) => `---\nname: demo\ndescription: Demo.\n---\n\n${body}\n`;
async function fixture(first = "Same.", second = "Different.") {
  const root = await createTestFixtureRoot("skillset-adopt-conflicts-");
  await Bun.write(join(root, ".agents/skills/demo/SKILL.md"), skill(first));
  await Bun.write(join(root, ".claude/skills/demo/SKILL.md"), skill(second));
  return root;
}

for (const write of [false, true]) {
  test(`divergent selected skills stop before source initialization (write=${write})`, async () => {
    const root = await fixture();
    const before = await readdir(root);
    const report = await adoptSkillset(root, { write });
    expect(report.ok).toBe(false);
    expect(report.write).toBe(false);
    expect(report.writtenPaths).toEqual([]);
    expect(report.skillCoalescing).toContainEqual(expect.objectContaining({ status: "conflict", destination: ".skillset/skills/demo", sources: [".agents/skills/demo", ".claude/skills/demo"] }));
    expect(await readdir(root)).toEqual(before);
    await expect(lstat(join(root, ".skillset"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(root, ".agents/skills/demo/SKILL.md"), "utf8")).toBe(skill("Same."));
  });
}

test("compatible copies record content evidence without claiming provider authority", async () => {
  const root = await fixture("Same.", "Same.");
  const preview = await adoptSkillset(root);
  expect(preview.ok).toBe(true);
  expect(preview.skillCoalescing).toContainEqual(expect.objectContaining({ status: "compatible", selectedSource: ".agents/skills/demo", reason: expect.stringContaining("matching portable") }));
  const applied = await adoptSkillset(root, { write: true });
  expect(applied.ok).toBe(true);
  expect(applied.skillCoalescing).toEqual(preview.skillCoalescing);
  expect(await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")).toContain("Same.");
});

test("unselected divergent copies do not block explicit candidate selection", async () => {
  const root = await fixture();
  const report = await adoptSkillset(root, { write: true, candidates: ["skills:.claude/skills"] });
  expect(report.ok).toBe(true);
  expect(await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")).toContain("Different.");
});

test("a later skill conflict cannot leave an earlier plugin import", async () => {
  const root = await fixture();
  await Bun.write(join(root, "plugins/first/.claude-plugin/plugin.json"), JSON.stringify({ name: "first" }));
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(false);
  expect(report.imports).toEqual([]);
  await expect(lstat(join(root, ".skillset"))).rejects.toMatchObject({ code: "ENOENT" });
});

for (const difference of ["bytes", "presence", "mode"]) {
  test(`resource ${difference} divergence blocks before source writes`, async () => {
    const root = await fixture("Same.", "Same.");
    await Bun.write(join(root, ".agents/skills/demo/run.sh"), "echo first\n");
    if (difference !== "presence") await Bun.write(join(root, ".claude/skills/demo/run.sh"), difference === "bytes" ? "echo second\n" : "echo first\n");
    if (difference === "mode") {
      await chmod(join(root, ".agents/skills/demo/run.sh"), 0o755);
      await chmod(join(root, ".claude/skills/demo/run.sh"), 0o644);
    }
    const report = await adoptSkillset(root, { write: true });
    expect(report.ok).toBe(false);
    expect(report.skillCoalescing?.[0]?.status).toBe("conflict");
    await expect(lstat(join(root, ".skillset"))).rejects.toMatchObject({ code: "ENOENT" });
  });
}

test("existing authored source is preserved when a candidate diverges", async () => {
  const root = await fixture("Same.", "Same.");
  await Bun.write(join(root, "skillset.yaml"), "compile:\n  targets: [claude]\n");
  await Bun.write(join(root, ".skillset/skills/demo/SKILL.md"), skill("Authored."));
  const config = await readFile(join(root, "skillset.yaml"), "utf8");
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(false);
  expect(report.writtenPaths).toEqual([]);
  expect(await readFile(join(root, "skillset.yaml"), "utf8")).toBe(config);
  expect(await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")).toBe(skill("Authored."));
});

test("three-way native policy conflicts are compared against accumulated fields", async () => {
  const root = await fixture("Same.", "Same.");
  const native = (value: boolean) => skill("Same.").replace("description: Demo.", `description: Demo.\nclaude:\n  frontmatter:\n    user-invocable: ${value}`);
  await Bun.write(join(root, ".claude/skills/demo/SKILL.md"), native(false));
  await Bun.write(join(root, ".cursor/skills/demo/SKILL.md"), native(true));
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(false);
  expect(report.skillCoalescing?.[0]?.status).toBe("conflict");
  await expect(lstat(join(root, ".skillset"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("preflight refuses changed source content and newly occupied destinations", async () => {
  for (const change of ["source", "destination"]) {
    const root = await fixture("Same.", "Same.");
    const candidates = [{ kind: "skills" as const, path: ".claude/skills" }];
    const prepared = await preflightAdoptionSkills(root, candidates, async (candidate) => ({ kind: "skills", provider: "claude", mergeTargetNativeSkill: true, rootPath: root, sourcePath: join(root, candidate.path) }));
    try {
      await Bun.write(join(root, change === "source" ? ".claude/skills/demo/SKILL.md" : ".skillset/skills/demo/SKILL.md"), skill("Changed."));
      await expect(prepared.assertUnchanged()).rejects.toThrow("after preflight");
    } finally { await prepared.dispose(); }
  }
});

test("conflict receipts retain decisions and mark unexecuted phases", async () => {
  const root = await fixture();
  const report = await adoptSkillset(root, { write: true });
  const receipt = await persistAdoptionReceipt(report);
  const stored = await readReportBundle(receipt.id);
  expect(stored.report).toMatchObject({ payload: {
    skillCoalescing: report.skillCoalescing,
    diagnosticCodes: ["adopt.skill-source-conflict"],
    phases: { setup: { status: "failed" }, import: { status: "not-run" }, lint: { status: "not-run" }, build: { status: "not-run" } },
  } });
});
