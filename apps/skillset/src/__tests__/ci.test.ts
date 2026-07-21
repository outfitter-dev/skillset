import { expect, test } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { parseYamlRecord } from "@skillset/core/internal/yaml";
import { gitSafeEnv } from "../git-env";
import { buildSkillset, createOperationalPathContext, resolveOperationalPath } from "@skillset/core";
import { CI_REPORT_MARKER, CI_WORKFLOW_PATH, ciSkillset, renderCiReportMarkdown, renderCiWorkflow } from "../ci";
import { initSkillset } from "../setup";

const DEMO_FIXTURE: Record<string, string> = {
  "skillset.yaml": `
skillset:
  name: ci-root
claude: true
codex: false
cursor: false
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
  expect(report.sourceSuggestions?.[0]?.status).toBe("suggestible");
  expect(report.sourceSuggestions?.[0]?.sourcePath).toBe(".skillset/skills/demo/SKILL.md");
  expect(await readFile(generatedPath, "utf8")).toBe(edited);
  const markdown = renderCiReportMarkdown(report);
  expect(markdown).toContain("### Stale generated output");
  expect(markdown).toContain("### Reconciliation");
  expect(markdown).toContain("Generated Markdown body can be moved back to the source file");
  expect(markdown).toContain("skillset build --yes");
});

test("ci does not recommend output reconciliation that reconcile would refuse", async () => {
  const root = await fixture({
    ...DEMO_FIXTURE,
    ".skillset/skills/other/SKILL.md": `
---
name: other
description: Other.
---

Other body.
`,
  });
  await commitFixture(root);
  await buildSkillset(root);
  const otherPath = ".claude/skills/other/SKILL.md";
  await writeFile(join(root, GENERATED_SKILL), "---\nname: demo\n---\n\nDemo output edit.\n");
  await writeFile(join(root, otherPath), "---\nname: other\n---\n\nOther output edit.\n");

  const report = await ciSkillset(root, { since: "HEAD" });

  expect(report.sourceSuggestions).toHaveLength(2);
  expect(report.sourceSuggestions?.every((suggestion) => suggestion.status === "refused")).toBe(true);
  expect(report.sourceSuggestions?.every((suggestion) =>
    suggestion.message.includes("unrelated generated drift exists")
  )).toBe(true);
});

test("check JSON promotes readiness failures to envelope diagnostics", async () => {
  const root = await builtFixture();
  await writeFile(join(root, GENERATED_SKILL), "stale\n");

  const result = await runSkillsetCli("check", "--root", root, "--json");
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toMatchObject({
    command: "check",
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "check-generated-drift", path: GENERATED_SKILL, severity: "error" }),
    ]),
    exitCode: 1,
    kind: "diagnostics",
    ok: false,
  });
});

test("check --only outputs supports structured output", async () => {
  const root = await builtFixture();

  const result = await runSkillsetCli("check", "--only", "outputs", "--root", root, "--json");
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toMatchObject({
    command: "check",
    data: { checkedFiles: expect.any(Number), failures: [] },
    diagnostics: [],
    exitCode: 0,
    kind: "diagnostics",
    ok: true,
  });
});

test("check --only outputs serializes drift diagnostics", async () => {
  const root = await builtFixture();
  await writeFile(join(root, GENERATED_SKILL), "stale\n");

  const result = await runSkillsetCli("check", "--only", "outputs", "--root", root, "--json");

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toMatchObject({
    diagnostics: [expect.objectContaining({ path: GENERATED_SKILL, severity: "error" })],
    exitCode: 1,
    kind: "diagnostics",
    ok: false,
  });
});

test("check preserves generated-output diagnostics without drift", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: large-agents\nclaude: false\ncodex: true\n",
    ".skillset/rules/big.md": `# Big\n\n${"- padding line\n".repeat(2500)}`,
  });
  await buildSkillset(root);

  const report = await ciSkillset(root);
  const result = await runSkillsetCli("check", "--root", root, "--json");
  const envelope = JSON.parse(result.stdout) as { diagnostics: Array<{ code: string; path?: string; severity: string }> };

  expect(report.ok).toBe(true);
  expect(report.drift).toEqual({ added: [], changed: [], missing: [], removed: [] });
  expect(report.outputDiagnostics).toContainEqual(expect.objectContaining({ code: "codex-agents-size", outputPath: "AGENTS.md" }));
  expect(envelope.diagnostics).toContainEqual(expect.objectContaining({ code: "codex-agents-size", path: "AGENTS.md", severity: "warning" }));
});

test("ci report explains generated changelog drift", () => {
  const markdown = renderCiReportMarkdown({
    changeIssues: [],
    drift: { added: [], changed: [".skillset/skills/demo/CHANGELOG.md"], missing: [], removed: [] },
    fixedPaths: [],
    lintIssues: [],
    ok: false,
    outputEditedPaths: [],
    outputDiagnostics: [],
    providerUpdatePaths: [],
    warnings: [],
  });

  expect(markdown).toContain("Generated `CHANGELOG.md` files are managed projections");
  expect(markdown).toContain("skillset change reason <@ref>");
  expect(markdown).toContain("skillset change amend <@ref>");
  expect(markdown).toContain("skillset release amend <@ref>");
});

test("check --write refuses target-side generated edits", async () => {
  const root = await builtFixture();
  const generatedPath = join(root, GENERATED_SKILL);
  const original = await readFile(generatedPath, "utf8");
  await writeFile(generatedPath, `${original}\nhand edit\n`);

  const report = await ciSkillset(root, { fix: true, since: "HEAD" });

  expect(report.ok).toBe(false);
  expect(report.fixedPaths).toEqual([]);
  expect(report.drift.changed).toEqual([GENERATED_SKILL]);
  expect(report.outputEditedPaths).toContain(GENERATED_SKILL);
  expect(await readFile(generatedPath, "utf8")).toContain("hand edit");
  const markdown = renderCiReportMarkdown(report);
  expect(markdown).toContain("### Target-side generated edits");
  expect(markdown).toContain("will not overwrite");
  expect(markdown).toContain("skillset reconcile <path> --use output");
  expect(markdown).toContain("skillset reconcile <path> --use source");
  expect(markdown).toContain("### Reconciliation");
});

test("check --write refuses unmanaged output collisions", async () => {
  const unmanaged = "hand-authored\n";
  const root = await fixture({
    ...DEMO_FIXTURE,
    [GENERATED_SKILL]: unmanaged,
  });

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(false);
  expect(report.fixedPaths).toEqual([]);
  expect(report.outputDiagnostics).toContainEqual(expect.objectContaining({
    code: "unmanaged-output-collision",
    outputPath: GENERATED_SKILL,
  }));
  expect(await readFile(join(root, GENERATED_SKILL), "utf8")).toBe(unmanaged);
});

test("check --write refuses managed edits in the isolated mirror", async () => {
  const root = await fixture(DEMO_FIXTURE);
  await buildSkillset(root, { isolated: true });
  const mirroredSkill = join(".skillset/cache/latest", GENERATED_SKILL);
  const generatedPath = resolveOperationalPath(createOperationalPathContext(root), mirroredSkill);
  await writeFile(generatedPath, `${await readFile(generatedPath, "utf8")}\nhand edit\n`);

  const report = await ciSkillset(root, { fix: true, isolated: true });

  expect(report.ok).toBe(false);
  expect(report.fixedPaths).toEqual([]);
  expect(report.drift.changed).toContain(mirroredSkill);
  expect(report.outputEditedPaths).toContain(mirroredSkill);
  expect(await readFile(generatedPath, "utf8")).toContain("hand edit");
});

test("check --write refreshes stale locks after an output edit is reconciled", async () => {
  const root = await builtFixture();
  const sourcePath = join(root, ".skillset/skills/demo/SKILL.md");
  const generatedPath = join(root, GENERATED_SKILL);
  await writeFile(sourcePath, `${await readFile(sourcePath, "utf8").then((text) => text.trimEnd())}\n\nReconciled.\n`);
  await writeFile(generatedPath, `${await readFile(generatedPath, "utf8").then((text) => text.trimEnd())}\n\nReconciled.\n`);

  const report = await ciSkillset(root, { fix: true });

  expect(report.ok).toBe(true);
  expect(report.outputEditedPaths).toEqual([]);
  expect(report.fixedPaths.some((path) => path.endsWith("skillset.lock"))).toBe(true);
  expect(await readFile(generatedPath, "utf8")).toContain("Reconciled.");
});

test("ci --fix explains rebuilt generated changelog drift", async () => {
  const root = await changelogFixture();
  const changelogPath = join(root, ".skillset/skills/demo/CHANGELOG.md");
  const original = await readFile(changelogPath, "utf8");
  await writeFile(changelogPath, `${original}\nhand edit\n`);
  const reportPath = join(root, "ci-report.md");

  const result = await runSkillsetCli("check", "--ci", "--fix", "--root", root, "--since", "HEAD", "--report", reportPath);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).not.toContain("fixed .skillset/skills/demo/CHANGELOG.md");
  expect(result.stdout).toContain("generated CHANGELOG.md files are managed projections");
  expect(await readFile(changelogPath, "utf8")).toContain("hand edit");
  const markdown = await readFile(reportPath, "utf8");
  expect(markdown).toContain("### Target-side generated edits");
  expect(markdown).toContain("Generated `CHANGELOG.md` files are managed projections");
  expect(markdown).toContain("skillset change reason <@ref>");
});

test("ci --fix leaves drift untouched when change entries are missing", async () => {
  const root = await builtFixture();
  await writeFile(
    join(root, ".skillset/skills/demo/SKILL.md"),
    "---\nname: demo\ndescription: Demo.\n---\n\nEdited body.\n"
  );

  const report = await ciSkillset(root, { fix: true, since: "HEAD" });

  expect(report.ok).toBe(false);
  expect(report.fixedPaths).toEqual([]);
  expect(report.drift.changed).toEqual([GENERATED_SKILL, ".claude/skills/skillset.lock"]);
  expect(report.changeIssues.some((issue) => issue.severity === "error")).toBe(true);
  expect(await readFile(join(root, GENERATED_SKILL), "utf8")).not.toContain("Edited body.");
  const markdown = renderCiReportMarkdown(report);
  expect(markdown).toContain("### Stale generated output");
  expect(markdown).toContain("### Change entries");
  expect(markdown).toContain("skillset change add");
});

test("ci surfaces build errors instead of fixing", async () => {
  const root = await fixture({
    ...DEMO_FIXTURE,
    "skillset.yaml": `
skillset:
  name: ci-root
compile:
  build: bogus
claude: true
codex: false
cursor: false
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

  const report = await ciSkillset(root, { ci: true });

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

  const report = await ciSkillset(root, { ci: true, fix: true });

  expect(report.ok).toBe(false);
  expect(report.changeError).toContain("baseline");
  expect(report.fixedPaths).toEqual([]);
  expect(report.drift.changed).toEqual([GENERATED_SKILL]);
  expect(await readFile(generatedPath, "utf8")).toBe(edited);
});

test("SET-205: ci reports package-facing changes without a package Changeset", async () => {
  const root = await builtFixture();
  await writeRawFiles(root, {
    "apps/skillset/src/package-feature.ts": "export const packageFeature = true;",
  });
  await commitAll(root, "package-facing change");

  const report = await ciSkillset(root, { since: "HEAD~1" });
  const markdown = renderCiReportMarkdown(report);

  expect(report.ok).toBe(false);
  expect(report.changesetIssues?.[0]).toContain("Package-facing changes require a .changeset/*.md entry");
  expect(report.packageFiles?.map((file) => file.path)).toEqual(["apps/skillset/src/package-feature.ts"]);
  expect(markdown).toContain("### Package Changesets");
  expect(markdown).toContain("Use `.changeset/*.md` for published compiler package changes");
});

test("SET-205: ci accepts package-facing changes with a package Changeset", async () => {
  const root = await builtFixture();
  await writeRawFiles(root, {
    ".changeset/package-feature.md": `
---
"skillset": patch
---

Document the package-facing feature boundary.
`,
    "apps/skillset/src/package-feature.ts": "export const packageFeature = true;",
  });
  await commitAll(root, "package-facing change with changeset");

  const report = await ciSkillset(root, { since: "HEAD~1" });

  expect(report.ok).toBe(true);
  expect(report.changesetIssues).toBeUndefined();
  expect(report.changesetFiles?.map((file) => file.path)).toEqual([".changeset/package-feature.md"]);
  expect(report.packageFiles?.map((file) => file.path)).toEqual(["apps/skillset/src/package-feature.ts"]);
});

test("SET-205: ci does not require package Changesets for source-unit edits", async () => {
  const root = await builtFixture();
  await writeRawFiles(root, {
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
---

Edited source body.
`,
  });
  await commitAll(root, "source unit change");

  const report = await ciSkillset(root, { since: "HEAD~1" });

  expect(report.ok).toBe(false);
  expect(report.changeIssues.some((issue) => issue.severity === "error")).toBe(true);
  expect(report.changesetIssues).toBeUndefined();
  expect(report.packageFiles).toBeUndefined();
  expect(renderCiReportMarkdown(report)).not.toContain("### Package Changesets");
});

test("ci normalizes old source layout only for git-ref baselines", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-ci-legacy-"));
  await writeRawFiles(root, {
	".skillset/config.yaml": `
claude: true
codex: false
cursor: false
`,
    ".skillset/src/skillset.yaml": `
skillset:
  name: ci-root
  version: 0.1.0
`,
    ".skillset/src/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
version: 0.1.0
---

Body.
`,
  });
  await commitFixture(root);

  await rm(join(root, ".skillset"), { force: true, recursive: true });
  await writeRawFiles(root, {
    "skillset.yaml": `
claude: true
codex: false
cursor: false
skillset:
  name: ci-root
  version: 0.1.0
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo.
version: 0.1.0
---

Body.
`,
  });
  await buildSkillset(root);

  const report = await ciSkillset(root, { since: "HEAD" });

  expect(report.changeError).toBeUndefined();
  expect(report.changeIssues).toEqual([]);
  expect(report.ok).toBe(true);
});

test("ci CLI exits nonzero on drift and writes the markdown report", async () => {
  const root = await builtFixture();
  const generatedPath = join(root, GENERATED_SKILL);
  await writeFile(generatedPath, `${await readFile(generatedPath, "utf8")}\nhand edit\n`);
  const reportPath = join(root, "ci-report.md");

  const failed = await runSkillsetCli("check", "--ci", "--root", root, "--since", "HEAD", "--report", reportPath);
  expect(failed.exitCode).toBe(1);
  expect(failed.stdout).toContain("generated-output drift");
  expect(await readFile(reportPath, "utf8")).toStartWith(CI_REPORT_MARKER);

  const fixed = await runSkillsetCli("check", "--ci", "--fix", "--root", root, "--since", "HEAD", "--report", reportPath);
  expect(fixed.exitCode).toBe(1);
  expect(fixed.stdout).toContain("target-side generated edit");
  expect(await readFile(reportPath, "utf8")).toContain("will not overwrite");

  await buildSkillset(root);
  const clean = await runSkillsetCli("check", "--ci", "--root", root, "--since", "HEAD");
  expect(clean.exitCode).toBe(0);
  expect(clean.stdout).toContain("check passed");
});

test("ci CLI rejects misplaced and unsupported flags", async () => {
  const fixOutsideCi = await runSkillsetCli("build", "--fix");
  expect(fixOutsideCi.exitCode).toBe(1);
  expect(fixOutsideCi.stderr).toContain("readiness flags are only supported with check");

  const reportOutsideCi = await runSkillsetCli("check", "--report", "out.md");
  expect(reportOutsideCi.exitCode).toBe(1);
  expect(reportOutsideCi.stderr).toContain("--report and --since require check --ci");

  const yesWithCi = await runSkillsetCli("check", "--ci", "--yes");
  expect(yesWithCi.exitCode).toBe(1);
  expect(yesWithCi.stderr).toContain("check does not take mutation confirmation flags");

  const sinceWithBuild = await runSkillsetCli("build", "--since", "HEAD");
  expect(sinceWithBuild.exitCode).toBe(1);
  expect(sinceWithBuild.stderr).toContain("--since is only supported with check --ci or change commands");
});

test("init --include ci scaffolds a valid workflow and keeps user edits", async () => {
  const root = await fixture({});

  const report = await initSkillset({ cwd: root, include: ["ci"], useGitRoot: false, write: true });
  const planned = report.files.find((file) => file.path === CI_WORKFLOW_PATH);
  expect(planned?.status).toBe("create");

  const workflowPath = join(root, CI_WORKFLOW_PATH);
  const content = await readFile(workflowPath, "utf8");
  expect(content).toBe(renderCiWorkflow());
  const parsed = parseYamlRecord(content, CI_WORKFLOW_PATH);
  expect(parsed.name).toBe("Skillset CI");
  expect(parsed.jobs).toBeDefined();
  expect(content).toContain("skillset check --ci");
  expect(content).toContain("--fix");

  const customized = content.replace("bunx skillset check --ci", "bunx skillset@9.9.9 check --ci");
  await writeFile(workflowPath, customized);
  const rerun = await initSkillset({ cwd: root, include: ["ci"], useGitRoot: false, write: true });
  const replanned = rerun.files.find((file) => file.path === CI_WORKFLOW_PATH);
  expect(replanned?.status).toBe("exists");
  expect(await readFile(workflowPath, "utf8")).toBe(customized);
});

test("init without --include ci does not plan a workflow", async () => {
  const root = await fixture({});
  const report = await initSkillset({ cwd: root, useGitRoot: false, write: false });
  expect(report.files.some((file) => file.path === CI_WORKFLOW_PATH)).toBe(false);
});

test("init --include rejects unknown values and non-setup commands", async () => {
  const root = await fixture({});

  const unknown = await runSkillsetCli("init", "--root", root, "--include", "bogus");
  expect(unknown.exitCode).toBe(1);
  expect(unknown.stderr).toContain("expected --include ci");

  const retiredAgents = await runSkillsetCli("init", "--root", root, "--include", "agents");
  expect(retiredAgents.exitCode).toBe(1);
  expect(retiredAgents.stderr).toContain("expected --include ci");

  const retiredAgentsList = await runSkillsetCli("init", "--root", root, "--include", "agents,ci");
  expect(retiredAgentsList.exitCode).toBe(1);
  expect(retiredAgentsList.stderr).toContain("expected --include ci");

  const wrongCommand = await runSkillsetCli("build", "--include", "ci");
  expect(wrongCommand.exitCode).toBe(1);
  expect(wrongCommand.stderr).toContain("setup options are only supported with init");
});

async function builtFixture(): Promise<string> {
  const root = await fixture(DEMO_FIXTURE);
  await commitFixture(root);
  await buildSkillset(root);
  return root;
}

async function changelogFixture(): Promise<string> {
  const root = await fixture(DEMO_FIXTURE);
  await writeRawFiles(root, {
    ".skillset/changes/history.jsonl": `${JSON.stringify({
      bump: "patch",
      evidence: [{ scope: "skill:demo", sourceHash: "sha256:one" }],
      id: "111111aaaaaa",
      reason: "Clarified the standalone skill behavior for CI drift.",
      scope: "skill:demo",
    })}`,
  });
  await commitFixture(root);
  await buildSkillset(root);
  return root;
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-ci-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}

async function writeRawFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, `${content.trim()}\n`, "utf8");
  }
}

async function commitFixture(root: string): Promise<void> {
  await runGit(root, "init", "-q");
  await runGit(root, "config", "user.email", "skillset@example.com");
  await runGit(root, "config", "user.name", "Skillset Test");
  await commitAll(root, "baseline");
}

async function commitAll(root: string, message: string): Promise<void> {
  await runGit(root, "add", ".");
  await runGit(root, "commit", "-qm", message);
}

async function runGit(root: string, ...args: readonly string[]): Promise<void> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", root, ...args],
    env: gitSafeEnv(),
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
