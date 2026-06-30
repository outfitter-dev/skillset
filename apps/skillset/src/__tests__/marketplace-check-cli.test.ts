import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { buildSkillsetResult } from "@skillset/core";

test("SET-234: marketplace check reports readiness and supports JSON output", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    targets: [claude]
    plugins:
      - plugin: local-tools
`,
    ".skillset/plugins/local-tools/skillset.yaml": `
skillset:
  name: local-tools
`,
    ".skillset/plugins/local-tools/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Use this demo skill.
`,
  });
  await buildSkillsetResult(root);

  const checked = await runSkillsetCli("marketplace", "check", "outfitter", "--root", root);

  expect(checked).toMatchObject({ exitCode: 0, stderr: "" });
  expect(checked.stdout).toContain("skillset: marketplace check passed");
  expect(checked.stdout).toContain("marketplace-ready: outfitter/local-tools claude plugin local-tools");

  const json = await runSkillsetCli("marketplace", "check", "outfitter", "--json", "--root", root);
  const report = JSON.parse(json.stdout) as {
    readonly ok: boolean;
    readonly entries: readonly { readonly readiness: string; readonly generatedPath?: string }[];
  };

  expect(json).toMatchObject({ exitCode: 0, stderr: "" });
  expect(report.ok).toBe(true);
  expect(report.entries).toEqual([expect.objectContaining({
    generatedPath: "plugins-claude/plugins/local-tools/.claude-plugin/plugin.json",
    readiness: "marketplace-ready",
  })]);
});

test("SET-234: marketplace check is read-only and fails when provider output is unbuilt", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    targets: [claude]
    plugins:
      - plugin: local-tools
`,
    ".skillset/plugins/local-tools/skillset.yaml": `
skillset:
  name: local-tools
`,
  });
  const before = await readdir(root);

  const checked = await runSkillsetCli("marketplace", "check", "--root", root);

  expect(checked.exitCode).toBe(1);
  expect(checked.stderr).toBe("");
  expect(checked.stdout).toContain("skillset: marketplace check failed");
  expect(checked.stdout).toContain("missing generated file: plugins-claude/plugins/local-tools/.claude-plugin/plugin.json");
  await expect(readdir(root)).resolves.toEqual(before);
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-marketplace-cli-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    await Bun.write(join(root, path), `${content.trim()}\n`);
  }
  return root;
}

async function runSkillsetCli(
  ...args: readonly string[]
): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    env: { ...process.env, XDG_CONFIG_HOME: join(tmpdir(), "skillset-marketplace-cli-xdg") },
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
