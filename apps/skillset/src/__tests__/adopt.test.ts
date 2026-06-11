import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { ADOPT_REPORT_DIR, adoptSkillset, renderAdoptReportMarkdown } from "../adopt";
import { ISOLATED_OUT_ROOT } from "../build";

const AGENTS_CONTENT = "# Demo agents\n\nHandwritten instructions.\n";

const MARKETPLACE_FIXTURE: Record<string, string> = {
  ".claude-plugin/marketplace.json": JSON.stringify({
    name: "demo-marketplace",
    plugins: [{ name: "demo", source: "./plugins/demo" }],
  }),
  ".claude/commands/x.md": "---\ndescription: Project command.\n---\n\nDo x.\n",
  "AGENTS.md": AGENTS_CONTENT,
  "README.md": "# Demo repo\n",
  "plugins/demo/.claude-plugin/plugin.json": JSON.stringify({
    name: "demo",
    version: "1.0.0",
  }),
  "plugins/demo/commands/hello.md": "---\ndescription: Say hello.\n---\n\nSay hello.\n",
  "plugins/demo/skills/demo-skill/SKILL.md":
    "---\nname: demo-skill\ndescription: Demo skill.\n---\n\nBody.\n",
};

test("adopt plan mode surveys only and writes nothing", async () => {
  const root = await fixture(MARKETPLACE_FIXTURE);
  const before = await walkFiles(root);

  const report = await adoptSkillset(root);

  expect(report.write).toBe(false);
  expect(report.ok).toBe(true);
  expect(report.alreadyAdopted).toBe(false);
  expect(report.candidates).toEqual([
    { kind: "instructions", path: "AGENTS.md" },
    { kind: "plugin", path: "plugins/demo" },
  ]);
  expect(report.surveySkips.map((skip) => skip.path)).toEqual([".claude/commands"]);
  expect(report.imports).toEqual([]);
  expect(report.builtFiles).toBe(0);
  expect(report.cutover).toEqual([]);
  expect(await walkFiles(root)).toEqual(before);
});

test("adopt write mode imports everything, builds the mirror, and writes the report", async () => {
  const root = await fixture(MARKETPLACE_FIXTURE);
  const before = await walkFiles(root);

  const report = await adoptSkillset(root, { write: true });

  expect(report.ok).toBe(true);
  expect(report.write).toBe(true);
  expect(report.imports.map((result) => [result.candidate.kind, result.ok])).toEqual([
    ["instructions", true],
    ["plugin", true],
  ]);
  expect(report.builtFiles).toBeGreaterThan(0);
  expect(report.buildError).toBeUndefined();
  expect(report.cutover).toEqual(["AGENTS.md"]);

  // Imported source lands in canonical .skillset/ homes; instructions copy verbatim.
  expect(await readFile(join(root, ".skillset/config.yaml"), "utf8")).toContain("targets:");
  expect(await exists(join(root, ".skillset/plugins/demo/skillset.yaml"))).toBe(true);
  expect(await readFile(join(root, ".skillset/instructions/agents.md"), "utf8")).toBe(
    AGENTS_CONTENT
  );

  // The build is isolated: the projection lives in the mirror, not the live tree.
  expect(await exists(join(root, ISOLATED_OUT_ROOT))).toBe(true);
  expect(await exists(join(root, "plugins-claude"))).toBe(false);

  // The migration report persists in both shapes.
  const markdown = await readFile(join(root, ADOPT_REPORT_DIR, "report.md"), "utf8");
  expect(markdown).toBe(renderAdoptReportMarkdown(report, { rootPath: root }));
  expect(markdown).toContain("## Summary");
  expect(markdown).toContain("## Cutover");
  expect(markdown).toContain("`AGENTS.md`");
  expect(markdown).toContain("unmanaged");
  const json = JSON.parse(await readFile(join(root, ADOPT_REPORT_DIR, "report.json"), "utf8")) as {
    ok: boolean;
  };
  expect(json.ok).toBe(true);

  // Purity: adoption only ever creates paths under .skillset/.
  const added = [...(await walkFiles(root))].filter((path) => !before.has(path));
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((path) => path.startsWith(".skillset/"))).toBe(true);
});

test("adopt records an instructions collision as a failed import without throwing", async () => {
  const root = await fixture({
    ...MARKETPLACE_FIXTURE,
    ".skillset/instructions/agents.md": "pre-existing\n",
  });

  const report = await adoptSkillset(root, { write: true });

  expect(report.ok).toBe(false);
  const failed = report.imports.find((result) => result.candidate.kind === "instructions");
  expect(failed?.ok).toBe(false);
  expect(failed?.detail).toContain("already exists");
  expect(await readFile(join(root, ".skillset/instructions/agents.md"), "utf8")).toBe(
    "pre-existing\n"
  );
  // The collision must not block the rest of the migration.
  expect(report.imports.find((result) => result.candidate.kind === "plugin")?.ok).toBe(true);
  expect(report.cutover).toEqual([]);
  expect(renderAdoptReportMarkdown(report, { rootPath: root })).toContain("## Failed imports");
});

test("adopt fails on lint errors and the CLI exits nonzero", async () => {
  const files = {
    ".claude/skills/bad/SKILL.md":
      "---\nname: bad\ndescription: Uses Claude dynamic context.\n---\n\nUse $ARGUMENTS here.\n",
  };

  const report = await adoptSkillset(await fixture(files), { write: true });
  expect(report.ok).toBe(false);
  expect(
    report.lintIssues.some(
      (issue) => issue.severity === "error" && issue.code === "codex-claude-dynamic-context"
    )
  ).toBe(true);
  const markdown = renderAdoptReportMarkdown(report, { rootPath: "ignored" });
  expect(markdown).toContain("- result: fail");
  expect(markdown).toContain("codex-claude-dynamic-context");

  const cliRoot = await fixture(files);
  const result = await runSkillsetCli("adopt", cliRoot, "--yes");
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("FAIL lint");
  expect(result.stdout).toContain("adopt found problems");
});

test("adopt CLI without --yes prints the survey and writes nothing", async () => {
  const root = await fixture(MARKETPLACE_FIXTURE);
  const before = await walkFiles(root);

  const result = await runSkillsetCli("adopt", root);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("import candidate instructions AGENTS.md");
  expect(result.stdout).toContain("import candidate plugin plugins/demo");
  expect(result.stdout).toContain("skipped commands .claude/commands");
  expect(result.stdout).toContain("rerun with --yes to adopt");
  expect(await walkFiles(root)).toEqual(before);
});

test("adopt CLI rejects isolation and build-shape flags", async () => {
  const isolated = await runSkillsetCli("adopt", ".", "--isolated");
  expect(isolated.exitCode).toBe(1);
  expect(isolated.stderr).toContain("--isolated is only supported with build, check, or diff");

  const scoped = await runSkillsetCli("adopt", ".", "--scope", "plugins");
  expect(scoped.exitCode).toBe(1);
  expect(scoped.stderr).toContain("not supported with adopt");

  const updated = await runSkillsetCli("adopt", ".", "--updated");
  expect(updated.exitCode).toBe(1);
  expect(updated.stderr).toContain("not supported with adopt");

  const include = await runSkillsetCli("adopt", ".", "--include", "ci");
  expect(include.exitCode).toBe(1);
  expect(include.stderr).toContain("--include is not supported with adopt");
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-adopt-"));
  for (const [path, content] of Object.entries(files)) {
    await Bun.write(join(root, path), content);
  }
  return root;
}

async function walkFiles(root: string): Promise<ReadonlySet<string>> {
  const files = new Set<string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.add(relative(root, path).replaceAll("\\", "/"));
    }
  };
  await walk(root);
  return files;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
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
