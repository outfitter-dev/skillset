import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildSkillsetResult } from "@skillset/core";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";

const cli = join(import.meta.dir, "..", "cli.ts");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

test("SET-554 status exposes coherent project-use provenance in JSON and human output", async () => {
  const root = await fixture({
    "skillset.yaml": `skillset:
  name: project-use-status
claude: true
codex: true
cursor: true
plugins:
  internal_use:
    skills:
      demo: true
`,
    ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\n",
    ".skillset/plugins/demo/skills/use-me/SKILL.md": `---
name: use-me
description: Use this skill.
---

Use this skill.
`,
  });
  await buildSkillsetResult(root);

  const jsonResult = await runStatus(root, "--json");
  expect(jsonResult.exitCode).toBe(0);
  expect(jsonResult.stderr).toBe("");
  const report = (JSON.parse(jsonResult.stdout) as {
    readonly data: {
      readonly projectUse: readonly Record<string, unknown>[];
    };
  }).data;
  expect(report.projectUse).toEqual([
    statusEntry("claude"),
    statusEntry("codex"),
    statusEntry("cursor"),
  ]);

  const humanResult = await runStatus(root);
  expect(humanResult.exitCode).toBe(0);
  expect(humanResult.stderr).toBe("");
  for (const target of ["claude", "codex", "cursor"] as const) {
    expect(humanResult.stdout).toContain(
      `project use [${target}]: source=plugin.demo.skill:use-me (.skillset/plugins/demo/skills/use-me/SKILL.md); selection=plugins.internal_use.skills.demo: true; effectiveName=use-me; role=project-use; owner=${target}`
    );
  }
});

function statusEntry(target: "claude" | "codex" | "cursor") {
  return {
    effectiveName: "use-me",
    owner: { target },
    role: "project-use",
    selectionRule: "plugins.internal_use.skills.demo: true",
    sourcePath: ".skillset/plugins/demo/skills/use-me/SKILL.md",
    sourceUnit: "plugin.demo.skill:use-me",
    target,
  };
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-project-use-status-"));
  roots.push(root);
  for (const [path, content] of Object.entries(
    normalizeSkillsetFixtureFiles(files)
  )) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  return root;
}

async function runStatus(
  root: string,
  ...args: readonly string[]
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const proc = Bun.spawn(
    [process.execPath, cli, "status", "--root", root, ...args],
    {
      env: { ...Bun.env, NODE_ENV: "test" },
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}
