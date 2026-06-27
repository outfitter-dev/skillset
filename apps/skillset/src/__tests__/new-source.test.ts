import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

test("SET-165: new skill previews by default and writes ordinary repo source with confirmation", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-new-ordinary-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });

  const preview = await runSkillsetCli("new", "skill", "Docs CLI Expert", "--root", root);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("+ .skillset/skills/docs-cli-expert/SKILL.md");
  expect(preview.stdout).toContain("write confirmation required");
  expect(await fileExists(join(root, ".skillset/skills/docs-cli-expert/SKILL.md"))).toBe(false);

  const written = await runSkillsetCli("new", "skill", "Docs CLI Expert", "--root", root, "--yes");
  expect(written.exitCode).toBe(0);
  expect(written.stdout).toContain("created skill docs-cli-expert");
  expect(written.stdout).toContain("next: skillset check");
  expect(written.stdout).toContain("next: skillset verify");

  const skill = await readFile(join(root, ".skillset/skills/docs-cli-expert/SKILL.md"), "utf8");
  expect(skill).toContain("name: docs-cli-expert");
  expect(skill).toContain('title: "Docs CLI Expert"');
  expect(skill).toContain('description: "Use when working with Docs CLI Expert workflows."');

  const check = await runSkillsetCli("check", "--root", root);
  expect(check.exitCode).toBe(0);
});

test("SET-165: new skill separates stable id and display name in dedicated source repos", async () => {
  const parent = await mkdtemp(join(tmpdir(), "skillset-new-dedicated-"));
  await expect(runSkillsetCli("create", "team-loadout", "--root", parent, "--yes")).resolves.toMatchObject({
    exitCode: 0,
  });
  const root = join(parent, "team-loadout");

  const written = await runSkillsetCli(
    "new",
    "skill",
    "--id",
    "docs-cli",
    "--name",
    "Docs CLI: Expert",
    "--preset",
    "support,evals",
    "--root",
    root,
    "--yes"
  );
  expect(written.exitCode).toBe(0);
  expect(written.stdout).toContain("+ .skillset/skills/docs-cli/SKILL.md");
  expect(written.stdout).toContain("+ .skillset/skills/docs-cli/references/.gitkeep");
  expect(written.stdout).toContain("+ .skillset/skills/docs-cli/assets/.gitkeep");
  expect(written.stdout).toContain("+ .skillset/skills/docs-cli/scripts/.gitkeep");
  expect(written.stdout).toContain("+ .skillset/skills/docs-cli/evals/evals.json");

  const skill = await readFile(join(root, ".skillset/skills/docs-cli/SKILL.md"), "utf8");
  expect(skill).toContain("name: docs-cli");
  expect(skill).toContain('title: "Docs CLI: Expert"');
  expect(await fileExists(join(root, ".skillset/skills/docs-cli/SKILL.md"))).toBe(true);
  expect(await readFile(join(root, ".skillset/skills/docs-cli/evals/evals.json"), "utf8")).toBe(
    "{\n  \"evals\": []\n}\n"
  );

  const check = await runSkillsetCli("check", "--root", root);
  expect(check.exitCode).toBe(0);
});

test("SET-165: new skill can place source inside an existing plugin container", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-new-plugin-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  await mkdir(join(root, ".skillset/plugins/acme-tools"), { recursive: true });
  await Bun.write(join(root, ".skillset/plugins/acme-tools/skillset.yaml"), "skillset:\n  name: acme-tools\n");

  const written = await runSkillsetCli(
    "new",
    "skill",
    "Docs CLI Expert",
    "--in",
    "acme-tools",
    "--root",
    root,
    "--yes"
  );

  expect(written.exitCode).toBe(0);
  expect(written.stdout).toContain("+ .skillset/plugins/acme-tools/skills/docs-cli-expert/SKILL.md");
  expect(await fileExists(join(root, ".skillset/plugins/acme-tools/skills/docs-cli-expert/SKILL.md"))).toBe(true);
});

test("SET-165: new refuses collisions and missing plugin containers", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-new-collision-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
  await expect(runSkillsetCli("new", "skill", "Docs CLI Expert", "--root", root, "--yes")).resolves.toMatchObject({
    exitCode: 0,
  });

  const collision = await runSkillsetCli("new", "skill", "Docs CLI Expert", "--root", root, "--yes");
  expect(collision.exitCode).toBe(1);
  expect(collision.stderr).toContain("refusing to overwrite existing source file");

  const missingContainer = await runSkillsetCli("new", "skill", "Other Skill", "--in", "missing", "--root", root);
  expect(missingContainer.exitCode).toBe(1);
  expect(missingContainer.stderr).toContain("new --in container does not exist or has no skillset.yaml");

  await mkdir(join(root, ".skillset/plugins/empty"), { recursive: true });
  const manifestlessContainer = await runSkillsetCli(
    "new",
    "skill",
    "Other Skill",
    "--in",
    "empty",
    "--root",
    root
  );
  expect(manifestlessContainer.exitCode).toBe(1);
  expect(manifestlessContainer.stderr).toContain("new --in container does not exist or has no skillset.yaml");
});

test("SET-165: new supports project agents and defers split hook scaffolding", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-new-agent-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });

  const agent = await runSkillsetCli("new", "agent", "Release Reviewer", "--root", root, "--yes");
  expect(agent.exitCode).toBe(0);
  expect(agent.stdout).toContain("+ .skillset/agents/release-reviewer.md");
  const source = await readFile(join(root, ".skillset/agents/release-reviewer.md"), "utf8");
  expect(source).toContain("name: release-reviewer");
  expect(source).toContain('description: "Use this agent for Release Reviewer work."');

  const hook = await runSkillsetCli("new", "hook", "source-change-guard", "--root", root);
  expect(hook.exitCode).toBe(1);
  expect(hook.stderr).toContain("new hook is not available yet");
});

test("SET-165: new rejects import-only flags", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-new-flags-"));
  await expect(runSkillsetCli("init", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });

  const kind = await runSkillsetCli("new", "skill", "Flag Probe", "--kind", "plugin", "--root", root);
  expect(kind.exitCode).toBe(1);
  expect(kind.stderr).toContain("--kind is only supported with import");

  const from = await runSkillsetCli("new", "skill", "Flag Probe", "--from", "codex", "--root", root);
  expect(from.exitCode).toBe(1);
  expect(from.stderr).toContain("--from is only supported with import");
});

test("SET-165: new requires an initialized workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-new-uninitialized-"));

  const result = await runSkillsetCli("new", "skill", "Fresh Skill", "--root", root, "--yes");

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("new requires an initialized Skillset workspace");
  expect(result.stderr).toContain("skillset init --yes");
  expect(await fileExists(join(root, ".skillset/skills/fresh-skill/SKILL.md"))).toBe(false);
});

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

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}
