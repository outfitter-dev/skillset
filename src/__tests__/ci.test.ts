import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseYamlRecord } from "../yaml";
import { buildSkillset } from "../build";
import { CI_REPORT_MARKER, CI_WORKFLOW_PATH, ciSkillset, renderCiReportMarkdown, renderCiWorkflow } from "../ci";
import { initSkillset } from "../setup";

const DEMO_FIXTURE: Record<string, string> = {
  ".skillset/config.yaml": `
skillset:
  name: ci-root
claude: true
codex: false
`,
  ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Body.
`,
};

const GENERATED_SKILL = ".claude/skills/demo/SKILL.md";

test("ci passes on a built fixture with no source changes", async () => {
  const root = await builtFixture();

  const report = await ciSkillset(root, { since: "HEAD" });

  expect(report.ok).toBe(true);
  expect(report.lintIssues).toEqual([]);
  expect(report.changeIssues).toEqual([]);
  expect(report.fixedPaths).toEqual([]);
  expect(report.buildError).toBeUndefined();
  expect(report.changeError).toBeUndefined();
  expect(renderCiReportMarkdown(report)).toContain("All checks passed");
});

test("ci reports generated drift without writing when fix is off", async () => {
  const root = await builtFixture();
  const generatedPath = join(root, GENERATED_SKILL);
  const edited = `${await readFile(generatedPath, "utf8")}\nhand edit\n`;
  await writeFile(generatedPath, edited);

  const report = await ciSkillset(root, { since: "HEAD" });

  expect(report.ok).toBe(false);
  expect(report.drift.changed).toEqual([GENERATED_SKILL]);
  expect(report.fixedPaths).toEqual([]);
  expect(await readFile(generatedPath, "utf8")).toBe(edited);
  const markdown = renderCiReportMarkdown(report);
  expect(markdown).toContain("### Stale generated output");
  expect(markdown).toContain("skillset build --yes");
});

test("ci --fix rebuilds drifted generated output mechanically", async () => {
  const root = await builtFixture();
  const generatedPath = join(root, GENERATED_SKILL);
  const original = await readFile(generatedPath, "utf8");
  await writeFile(generatedPath, `${original}\nhand edit\n`);

  const report = await ciSkillset(root, { fix: true, since: "HEAD" });

  expect(report.ok).toBe(true);
  expect(report.fixedPaths).toEqual([GENERATED_SKILL]);
  expect(report.drift.changed).toEqual([]);
  expect(await readFile(generatedPath, "utf8")).toBe(original);
  const markdown = renderCiReportMarkdown(report);
  expect(markdown).toContain("### Rebuilt generated output");
  expect(markdown).toContain("rebuilt mechanically");
});

test("ci --fix clears drift but still fails on missing change entries", async () => {
  const root = await builtFixture();
  await writeFile(
    join(root, ".skillset/skills/demo/SKILL.md"),
    "---\nname: demo\ndescription: Demo.\n---\n\nEdited body.\n"
  );

  const report = await ciSkillset(root, { fix: true, since: "HEAD" });

  expect(report.ok).toBe(false);
  expect(report.fixedPaths).toEqual([".claude/skills/.skillset.lock", GENERATED_SKILL]);
  expect(report.drift.changed).toEqual([]);
  expect(report.changeIssues.some((issue) => issue.severity === "error")).toBe(true);
  expect(await readFile(join(root, GENERATED_SKILL), "utf8")).toContain("Edited body.");
  const markdown = renderCiReportMarkdown(report);
  expect(markdown).toContain("### Change entries");
  expect(markdown).toContain("skillset change add");
});

test("ci surfaces build errors instead of fixing", async () => {
  const root = await fixture({
    ...DEMO_FIXTURE,
    ".skillset/config.yaml": `
skillset:
  name: ci-root
compile:
  build: bogus
claude: true
codex: false
`,
  });
  await commitFixture(root);

  const report = await ciSkillset(root, { fix: true, since: "HEAD" });

  expect(report.ok).toBe(false);
  expect(report.buildError).toBeDefined();
  expect(report.fixedPaths).toEqual([]);
  expect(renderCiReportMarkdown(report)).toContain("### Build error");
});

test("ci surfaces an unresolvable change baseline as a change error", async () => {
  const root = await fixture(DEMO_FIXTURE);
  await buildSkillset(root);

  const report = await ciSkillset(root);

  expect(report.ok).toBe(false);
  expect(report.changeError).toContain("baseline");
  expect(renderCiReportMarkdown(report)).toContain("### Change check could not run");
});

test("ci --fix does not rebuild when the change baseline is unresolvable", async () => {
  const root = await fixture(DEMO_FIXTURE);
  await buildSkillset(root);
  const generatedPath = join(root, GENERATED_SKILL);
  const edited = `${await readFile(generatedPath, "utf8")}\nhand edit\n`;
  await writeFile(generatedPath, edited);

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(false);
  expect(report.changeError).toContain("baseline");
  expect(report.fixedPaths).toEqual([]);
  expect(report.drift.changed).toEqual([GENERATED_SKILL]);
  expect(await readFile(generatedPath, "utf8")).toBe(edited);
});

test("ci CLI exits nonzero on drift and writes the markdown report", async () => {
  const root = await builtFixture();
  const generatedPath = join(root, GENERATED_SKILL);
  await writeFile(generatedPath, `${await readFile(generatedPath, "utf8")}\nhand edit\n`);
  const reportPath = join(root, "ci-report.md");

  const failed = await runSkillsetCli("ci", "--root", root, "--since", "HEAD", "--report", reportPath);
  expect(failed.exitCode).toBe(1);
  expect(failed.stdout).toContain("generated-output drift");
  expect(await readFile(reportPath, "utf8")).toStartWith(CI_REPORT_MARKER);

  const fixed = await runSkillsetCli("ci", "--fix", "--root", root, "--since", "HEAD", "--report", reportPath);
  expect(fixed.exitCode).toBe(0);
  expect(fixed.stdout).toContain("ci passed after rebuilding 1 generated file");
  expect(await readFile(reportPath, "utf8")).toContain("rebuilt mechanically");

  const clean = await runSkillsetCli("ci", "--root", root, "--since", "HEAD");
  expect(clean.exitCode).toBe(0);
  expect(clean.stdout).toContain("ci passed");
});

test("ci CLI rejects misplaced and unsupported flags", async () => {
  const fixOutsideCi = await runSkillsetCli("build", "--fix");
  expect(fixOutsideCi.exitCode).toBe(1);
  expect(fixOutsideCi.stderr).toContain("--fix is only supported with ci");

  const reportOutsideCi = await runSkillsetCli("check", "--report", "out.md");
  expect(reportOutsideCi.exitCode).toBe(1);
  expect(reportOutsideCi.stderr).toContain("--report is only supported with ci");

  const yesWithCi = await runSkillsetCli("ci", "--yes");
  expect(yesWithCi.exitCode).toBe(1);
  expect(yesWithCi.stderr).toContain("ci does not take --yes or --dry-run");

  const sinceWithBuild = await runSkillsetCli("build", "--since", "HEAD");
  expect(sinceWithBuild.exitCode).toBe(1);
  expect(sinceWithBuild.stderr).toContain("--since is only supported with ci or change commands");
});

test("init --with-ci scaffolds a valid workflow and keeps user edits", async () => {
  const root = await fixture({});

  const report = await initSkillset({ cwd: root, includeCi: true, useGitRoot: false, write: true });
  const planned = report.files.find((file) => file.path === CI_WORKFLOW_PATH);
  expect(planned?.status).toBe("create");

  const workflowPath = join(root, CI_WORKFLOW_PATH);
  const content = await readFile(workflowPath, "utf8");
  expect(content).toBe(renderCiWorkflow());
  const parsed = parseYamlRecord(content, CI_WORKFLOW_PATH);
  expect(parsed.name).toBe("Skillset CI");
  expect(parsed.jobs).toBeDefined();
  expect(content).toContain("skillset ci");
  expect(content).toContain("--fix");

  const customized = content.replace("bunx skillset@beta", "bunx skillset@9.9.9");
  await writeFile(workflowPath, customized);
  const rerun = await initSkillset({ cwd: root, includeCi: true, useGitRoot: false, write: true });
  const replanned = rerun.files.find((file) => file.path === CI_WORKFLOW_PATH);
  expect(replanned?.status).toBe("exists");
  expect(await readFile(workflowPath, "utf8")).toBe(customized);
});

test("init without --with-ci does not plan a workflow", async () => {
  const root = await fixture({});
  const report = await initSkillset({ cwd: root, useGitRoot: false, write: false });
  expect(report.files.some((file) => file.path === CI_WORKFLOW_PATH)).toBe(false);
});

async function builtFixture(): Promise<string> {
  const root = await fixture(DEMO_FIXTURE);
  await commitFixture(root);
  await buildSkillset(root);
  return root;
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-ci-"));
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}

async function commitFixture(root: string): Promise<void> {
  await runGit(root, "init", "-q");
  await runGit(root, "config", "user.email", "skillset@example.com");
  await runGit(root, "config", "user.name", "Skillset Test");
  await runGit(root, "add", ".");
  await runGit(root, "commit", "-qm", "baseline");
}

async function runGit(root: string, ...args: readonly string[]): Promise<void> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", root, ...args],
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed\n${stdout}${stderr}`);
  }
}

async function runSkillsetCli(...args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}
