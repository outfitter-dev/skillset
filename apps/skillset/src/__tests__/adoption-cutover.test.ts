import { expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ISOLATED_OUT_ROOT, readReportBundle } from "@skillset/core";
import { adoptSkillset, renderAdoptReportMarkdown } from "../adopt";
import { persistAdoptionReceipt } from "../operation-receipt";
import { contractFixture, runSkillsetCli } from "./contract-test-helpers";

it("reports every live collision and retains cutover steps in report show", async () => {
  const originals = {
    "AGENTS.md": "# Authored guidance\n",
    ".claude/skills/helper/SKILL.md": "---\nname: helper\ndescription: Help.\n---\n\nHelp.\n",
    ".claude-plugin/marketplace.json": JSON.stringify({ name: "existing", owner: { name: "Owner" }, plugins: [{ name: "demo", source: "./plugins/demo" }] }),
    "plugins/demo/.claude-plugin/plugin.json": JSON.stringify({ name: "demo", description: "Demo." }),
    "plugins/demo/skills/tidy/SKILL.md": "---\nname: tidy\ndescription: Tidy.\n---\n\nTidy.\n",
  };
  const root = await contractFixture(originals);
  const report = await adoptSkillset(root, { targets: ["claude"], write: true });
  expect(report.ok).toBe(true);
  expect(report.cutover).toEqual(expect.arrayContaining([
    ".claude/skills/helper/SKILL.md",
    ".claude-plugin/marketplace.json",
    "plugins/demo/.claude-plugin/plugin.json",
    "plugins/demo/skills/tidy/SKILL.md",
  ]));
  expect(report.cutover).not.toContain("AGENTS.md");
  for (const [path, content] of Object.entries(originals)) {
    expect(await readFile(join(root, path), "utf8")).toBe(`${content.trim()}\n`);
  }
  const receipt = await persistAdoptionReceipt(report);
  const bundle = await readReportBundle(receipt.path);
  expect(bundle.markdown).toContain("## Cutover");
  expect(bundle.markdown).toContain(".claude/skills/helper/SKILL.md");
  expect(bundle.markdown).toContain("Build (isolated)");
  const shown = await runSkillsetCli("report", "show", receipt.path);
  expect(shown.exitCode).toBe(0);
  expect(shown.stdout).toContain("## Cutover");
  expect(shown.stdout).toContain("skillset build --yes");
});

for (const native of [false, true]) {
  it(`preserves both Claude guidance files for guided synthesis (native=${native})`, async () => {
    const root = await contractFixture({
      ...(native ? { "AGENTS.md": "# Existing native guidance\n" } : {}),
      "CLAUDE.md": "# Root Claude guidance\n",
      ".claude/CLAUDE.md": "# Project Claude guidance\n",
    });
    const report = await adoptSkillset(root, { targets: ["claude"], write: true });
    expect(report.ok).toBe(true);
    expect(report.imports).toHaveLength(0);
    expect(report.surveySkips.filter((skip) => skip.surface === "guided-root-guidance").map((skip) => skip.path)).toEqual([".claude/CLAUDE.md", "CLAUDE.md"]);
    expect(await readFile(join(root, "CLAUDE.md"), "utf8")).toBe("# Root Claude guidance\n");
    expect(await readFile(join(root, ".claude/CLAUDE.md"), "utf8")).toBe("# Project Claude guidance\n");
    const receipt = await persistAdoptionReceipt(report);
    const bundle = await readReportBundle(receipt.path);
    expect(bundle.markdown).toContain("Guided root guidance");
    expect(bundle.markdown).toContain(".claude/CLAUDE.md");
    expect(bundle.markdown).toContain("synthesize");
  });
}

it("records native-mode updates to an existing workspace config as writes", async () => {
  const root = await contractFixture({
    "skillset.yaml": "skillset:\n  name: existing\ncompile:\n  targets: [claude]\n",
    "AGENTS.md": "# Existing authored guidance\n",
  });
  const report = await adoptSkillset(root, { write: true });
  expect(report.ok).toBe(true);
  expect(await readFile(join(root, "skillset.yaml"), "utf8")).toContain("nativeAgents: true");
  expect(report.writtenPaths).toContain("skillset.yaml");
});

it("keeps isolated success and writes when live cutover inspection fails", async () => {
  const root = await contractFixture({
    ".claude/skills/helper/SKILL.md": "---\nname: helper\ndescription: Help.\n---\n\nHelp.\n",
    "plugins/skillset.lock": "{ malformed\n",
  });
  const report = await adoptSkillset(root, { targets: ["claude"], write: true });
  expect(report.ok).toBe(false);
  expect(report.buildError).toBeUndefined();
  expect(report.builtFiles).toBeGreaterThan(0);
  expect(report.cutoverError).toContain("lock");
  const isolatedWrites = report.writtenPaths.filter((path) => path.startsWith(`${ISOLATED_OUT_ROOT}/`));
  expect(isolatedWrites.length).toBeGreaterThanOrEqual(report.builtFiles);
  expect(isolatedWrites).toContain(`${ISOLATED_OUT_ROOT}/.claude/skills/helper/SKILL.md`);
  const receipt = await persistAdoptionReceipt(report);
  const bundle = await readReportBundle(receipt.path);
  expect(bundle.report.payload).toMatchObject({
    phases: { build: { status: "passed", count: report.builtFiles } },
    diagnosticCodes: expect.arrayContaining(["adopt.cutover-inspection-failed"]),
  });
  expect(bundle.report.payload).not.toHaveProperty("cutover");
  expect(bundle.markdown).toContain("Live cutover inspection failed");
  const fullMarkdown = renderAdoptReportMarkdown(report, { rootPath: root });
  expect(fullMarkdown).toContain(`Wrote ${report.builtFiles} generated files`);
  expect(fullMarkdown).toContain("Live cutover inspection failed");
  expect(fullMarkdown).not.toContain("Run `skillset build --yes`");
  expect(bundle.markdown).not.toContain("run `skillset build --yes`");
  expect(await readFile(join(root, "plugins/skillset.lock"), "utf8")).toBe("{ malformed\n");
});
