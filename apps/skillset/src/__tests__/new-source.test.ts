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
  expect(written.stdout).toContain("next: skillset build --yes");
  expect(written.stdout).toContain("next: skillset check");

  const skill = await readFile(join(root, ".skillset/skills/docs-cli-expert/SKILL.md"), "utf8");
  expect(skill).toContain("name: docs-cli-expert");
  expect(skill).toContain('title: "Docs CLI Expert"');
  expect(skill).toContain('description: "Use when working with Docs CLI Expert workflows."');

  const jsonWritten = await runSkillsetCli("new", "skill", "JSON Skill", "--root", root, "--yes", "--json");
  expect(jsonWritten.exitCode).toBe(0);
  const jsonWrites = (JSON.parse(jsonWritten.stdout) as { data: { writes: unknown[] } }).data.writes;
  expect(jsonWrites).toEqual([".skillset/skills/json-skill/SKILL.md"]);
  expect(jsonWrites.every((path) => typeof path === "string")).toBe(true);

  await expect(runSkillsetCli("build", "--root", root, "--yes")).resolves.toMatchObject({ exitCode: 0 });
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
    "{\n  \"skill_name\": \"docs-cli\",\n  \"evals\": []\n}\n"
  );

  const check = await runSkillsetCli("check", "--root", root);
  expect(check.exitCode).toBe(1);
  expect(check.stdout).toContain("generated-output drift");
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

test("SET-309: new instruction previews and writes canonical workspace source", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-new-instruction-"));
  await expect(
    runSkillsetCli("init", "--root", root, "--yes")
  ).resolves.toMatchObject({ exitCode: 0 });

  const preview = await runSkillsetCli(
    "new",
    "instruction",
    "Review Guidance",
    "--root",
    root
  );
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("+ .skillset/rules/review-guidance.md");
  expect(preview.stdout).toContain("write confirmation required");
  expect(
    await fileExists(join(root, ".skillset/rules/review-guidance.md"))
  ).toBe(false);

  const written = await runSkillsetCli(
    "new",
    "instruction",
    "Review Guidance",
    "--root",
    root,
    "--yes",
    "--json"
  );
  expect(written.exitCode).toBe(0);
  const result = JSON.parse(written.stdout);
  expect(result.data.writes).toEqual([".skillset/rules/review-guidance.md"]);
  expect(
    await readFile(join(root, ".skillset/rules/review-guidance.md"), "utf8")
  ).toBe("# Review Guidance\n\nAdd repository instructions here.\n");

  await expect(
    runSkillsetCli("build", "--root", root, "--yes")
  ).resolves.toMatchObject({ exitCode: 0 });
  await expect(runSkillsetCli("check", "--root", root)).resolves.toMatchObject({
    exitCode: 0,
  });
});

test("SET-309: new instruction supports plugin placement and collision safety", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-new-instruction-plugin-"));
  await expect(
    runSkillsetCli("init", "--root", root, "--yes")
  ).resolves.toMatchObject({ exitCode: 0 });
  await mkdir(join(root, ".skillset/plugins/acme"), { recursive: true });
  await Bun.write(
    join(root, ".skillset/plugins/acme/skillset.yaml"),
    "skillset:\n  name: acme\n"
  );

  const written = await runSkillsetCli(
    "new",
    "instruction",
    "Review Guidance",
    "--in",
    "acme",
    "--root",
    root,
    "--yes"
  );
  expect(written.exitCode).toBe(0);
  expect(written.stdout).toContain(
    "+ .skillset/plugins/acme/rules/review-guidance.md"
  );

  const collision = await runSkillsetCli(
    "new",
    "instruction",
    "Review Guidance",
    "--in",
    "acme",
    "--root",
    root,
    "--yes"
  );
  expect(collision.exitCode).toBe(1);
  expect(collision.stderr).toContain(
    "refusing to overwrite existing source file"
  );

  const preset = await runSkillsetCli(
    "new",
    "instruction",
    "Other Guidance",
    "--preset",
    "minimal",
    "--root",
    root
  );
  expect(preset.exitCode).toBe(1);
  expect(preset.stderr).toContain(
    "new instruction does not support --preset"
  );
});

test("SET-310: new hook previews and writes a schema-valid attached adaptive unit", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-new-hook-"));
  await expect(
    runSkillsetCli("init", "--root", root, "--yes")
  ).resolves.toMatchObject({ exitCode: 0 });
  await mkdir(join(root, ".skillset/plugins/guard"), { recursive: true });
  const configPath = join(root, ".skillset/plugins/guard/skillset.yaml");
  await Bun.write(configPath, "skillset:\n  name: guard\n");

  const args = [
    "new",
    "hook",
    "Shell Policy",
    "--event",
    "PreToolUse",
    "--command",
    "echo checking shell",
    "--attach",
    "plugin:guard",
    "--root",
    root,
  ] as const;
  const preview = await runSkillsetCli(...args);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("+ .skillset/plugins/guard/hooks/shell-policy.json");
  expect(preview.stdout).toContain("~ .skillset/plugins/guard/skillset.yaml");
  expect(await fileExists(join(root, ".skillset/plugins/guard/hooks/shell-policy.json"))).toBe(false);
  expect(await readFile(configPath, "utf8")).toBe("skillset:\n  name: guard\n");

  const written = await runSkillsetCli(...args, "--yes", "--json");
  expect(written.exitCode).toBe(0);
  expect(JSON.parse(written.stdout).data.writes).toEqual([
    ".skillset/plugins/guard/hooks/shell-policy.json",
    ".skillset/plugins/guard/skillset.yaml",
  ]);
  expect(JSON.parse(await readFile(
    join(root, ".skillset/plugins/guard/hooks/shell-policy.json"),
    "utf8"
  ))).toEqual({
    description: "Shell Policy",
    events: ["PreToolUse"],
    name: "shell-policy",
    run: { command: "echo checking shell" },
  });
  expect(await readFile(configPath, "utf8")).toContain("auto:\n    - shell-policy");

  await mkdir(join(root, ".skillset/plugins/guard/scripts"), {
    recursive: true,
  });
  await Bun.write(
    join(root, ".skillset/plugins/guard/scripts/check.sh"),
    "#!/usr/bin/env sh\necho check\n"
  );
  const scriptHook = await runSkillsetCli(
    "new",
    "hook",
    "Script Policy",
    "--event",
    "SessionStart",
    "--script",
    "{{scripts.dir}}/check.sh",
    "--attach",
    "plugin:guard",
    "--root",
    root,
    "--yes"
  );
  expect(scriptHook.exitCode).toBe(0);
  expect(
    JSON.parse(
      await readFile(
        join(root, ".skillset/plugins/guard/hooks/script-policy.json"),
        "utf8"
      )
    ).run
  ).toEqual({ script: "{{scripts.dir}}/check.sh" });

  await expect(runSkillsetCli("build", "--root", root, "--yes")).resolves.toMatchObject({
    exitCode: 0,
  });
  for (const target of ["claude", "codex", "cursor"]) {
    expect(
      await fileExists(join(root, "plugins/guard", target, "hooks/hooks.json"))
    ).toBe(true);
  }
  await expect(runSkillsetCli("check", "--root", root)).resolves.toMatchObject({
    exitCode: 0,
  });
});

test("SET-310: new hook rejects invalid intent, incompatible scopes, and collisions before writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-new-hook-invalid-"));
  await expect(
    runSkillsetCli("init", "--root", root, "--yes")
  ).resolves.toMatchObject({ exitCode: 0 });
  await mkdir(join(root, ".skillset/plugins/guard/skills/writer"), { recursive: true });
  await Bun.write(
    join(root, ".skillset/plugins/guard/skillset.yaml"),
    "skillset:\n  name: guard\n"
  );
  await Bun.write(
    join(root, ".skillset/plugins/guard/skills/writer/SKILL.md"),
    "---\nname: writer\ndescription: Writer.\n---\n\nBody.\n"
  );

  const incomplete = await runSkillsetCli(
    "new", "hook", "Missing Action", "--event", "PreToolUse",
    "--attach", "plugin:guard", "--root", root, "--yes"
  );
  expect(incomplete.exitCode).toBe(1);
  expect(incomplete.stderr).toContain("requires exactly one of --command or --script");

  const invalid = await runSkillsetCli(
    "new", "hook", "Bad Event", "--event", "NotAnEvent", "--command", "true",
    "--attach", "plugin:guard", "--root", root, "--yes"
  );
  expect(invalid.exitCode).toBe(1);
  expect(invalid.stderr).toContain("unknown adaptive hook event NotAnEvent");

  const missingScript = await runSkillsetCli(
    "new", "hook", "Script Policy", "--event", "PreToolUse",
    "--script", "{{scripts.dir}}/missing.sh",
    "--attach", "plugin:guard", "--root", root, "--yes"
  );
  expect(missingScript.exitCode).toBe(1);
  expect(missingScript.stderr).toContain("does not resolve to an existing source file");

  const incompatible = await runSkillsetCli(
    "new", "hook", "Skill Policy", "--event", "PreToolUse", "--command", "true",
    "--provider", "codex", "--attach", "plugin.guard.skill:writer", "--root", root, "--yes"
  );
  expect(incompatible.exitCode).toBe(1);
  expect(incompatible.stderr).toContain("no faithful skill-local hook destination");

  const unsupportedFrontmatterEvent = await runSkillsetCli(
    "new", "hook", "Workspace Policy", "--event", "WorkspaceOpen", "--command", "true",
    "--attach", "plugin.guard.skill:writer", "--root", root, "--yes"
  );
  expect(unsupportedFrontmatterEvent.exitCode).toBe(1);
  expect(unsupportedFrontmatterEvent.stderr).toContain(
    "Claude does not support adaptive hook event WorkspaceOpen"
  );

  const unsupportedFrontmatterScript = await runSkillsetCli(
    "new", "hook", "Scripted Skill Policy", "--event", "PreToolUse",
    "--script", "{{scripts.dir}}/check.sh", "--attach", "plugin.guard.skill:writer",
    "--root", root, "--yes"
  );
  expect(unsupportedFrontmatterScript.exitCode).toBe(1);
  expect(unsupportedFrontmatterScript.stderr).toContain(
    "frontmatter hook rendering does not have stable runtime path proof"
  );

  const validArgs = [
    "new", "hook", "Shell Policy", "--event", "PreToolUse", "--command", "true",
    "--attach", "plugin:guard", "--root", root, "--yes",
  ] as const;
  expect((await runSkillsetCli(...validArgs)).exitCode).toBe(0);
  const collision = await runSkillsetCli(...validArgs);
  expect(collision.exitCode).toBe(1);
  expect(collision.stderr).toContain("hook attachment shell-policy already exists");
  expect(await fileExists(join(root, ".skillset/plugins/guard/hooks/missing-action.json"))).toBe(false);
  expect(await fileExists(join(root, ".skillset/plugins/guard/hooks/bad-event.json"))).toBe(false);
  expect(await fileExists(join(root, ".skillset/plugins/guard/hooks/script-policy.json"))).toBe(false);
  expect(await fileExists(join(root, ".skillset/plugins/guard/skills/writer/hooks/skill-policy.json"))).toBe(false);
  expect(await fileExists(join(root, ".skillset/plugins/guard/skills/writer/hooks/workspace-policy.json"))).toBe(false);
  expect(await fileExists(join(root, ".skillset/plugins/guard/skills/writer/hooks/scripted-skill-policy.json"))).toBe(false);
});

test("SET-310: non-hook source kinds reject hook-only flags", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillset-new-non-hook-options-"));
  await expect(
    runSkillsetCli("init", "--root", root, "--yes")
  ).resolves.toMatchObject({ exitCode: 0 });

  const result = await runSkillsetCli(
    "new",
    "skill",
    "Demo",
    "--event",
    "PreToolUse",
    "--command",
    "true",
    "--script",
    "check.sh",
    "--attach",
    "skill:other",
    "--provider",
    "claude",
    "--root",
    root,
    "--yes"
  );

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(
    "new skill does not support hook options: --attach, --command, --event, --provider, --script"
  );
  expect(await fileExists(join(root, ".skillset/skills/demo/SKILL.md"))).toBe(
    false
  );
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

test("SET-165/310: new supports project agents and requires complete hook intent", async () => {
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
  expect(hook.stderr).toContain("new hook requires --attach <source-unit>");
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
