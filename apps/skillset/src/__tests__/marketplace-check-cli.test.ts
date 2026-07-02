import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";
import { buildSkillsetResult, writeKnownSkillsetsIndex } from "@skillset/core";

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
    generatedPath: "plugins/local-tools/claude/.claude-plugin/plugin.json",
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
  expect(checked.stdout).toContain("missing generated file: plugins/local-tools/claude/.claude-plugin/plugin.json");
  await expect(readdir(root)).resolves.toEqual(before);
});

test("SET-236: marketplace update previews and writes an external Claude marketplace index", async () => {
  const parent = await mkdtemp(join(tmpdir(), "skillset-marketplace-update-"));
  const marketplace = await fixture({
    "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    title: Outfitter
    description: Curated Outfitter plugins.
    targets: [claude]
    plugins:
      - id: trails
        plugin: trails-tools
        repo: github:outfitter-dev/trails
`,
  }, parent);
  const external = await fixture({
    "skillset.yaml": `
skillset:
  name: trails
`,
    ".skillset/plugins/trails-tools/skillset.yaml": `
skillset:
  name: trails-tools
  description: Trails tools.
`,
    ".skillset/plugins/trails-tools/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Use this demo skill.
`,
  }, parent);
  await buildSkillsetResult(external);
  const xdg = xdgOptions(parent);
  await writeKnownSkillsetsIndex({
    schemaVersion: 1,
    skillsets: [{
      cacheKey: "trails",
      identities: ["github:outfitter-dev/trails"],
      path: external,
      repository: "git@github.com:outfitter-dev/trails.git",
    }],
  }, xdg);

  const preview = await runSkillsetCliWithEnv(xdg.env, "marketplace", "update", "outfitter", "--root", marketplace);

  expect(preview).toMatchObject({ exitCode: 0, stderr: "" });
  expect(preview.stdout).toContain("skillset: marketplace update passed");
  expect(preview.stdout).toContain("would write: .claude-plugin/marketplace.json");
  expect(preview.stdout).toContain("skillset: marketplace update preview wrote no files");
  await expect(readdir(marketplace)).resolves.not.toContain("plugins-claude");

  const updated = await runSkillsetCliWithEnv(xdg.env, "marketplace", "update", "outfitter", "--yes", "--root", marketplace);

  expect(updated).toMatchObject({ exitCode: 0, stderr: "" });
  expect(updated.stdout).toContain("wrote: .claude-plugin/marketplace.json");
  expect(updated.stdout).toContain("wrote: skillset.lock");
  const marketplaceJson = JSON.parse(await readFile(join(marketplace, ".claude-plugin/marketplace.json"), "utf8")) as {
    readonly plugins: readonly { readonly name: string; readonly source: { readonly source: string; readonly url: string; readonly path: string } }[];
  };
  expect(marketplaceJson.plugins).toEqual([expect.objectContaining({
    name: "trails-tools",
    source: {
      path: "plugins/trails-tools/claude",
      source: "git-subdir",
      url: "outfitter-dev/trails",
    },
  })]);
  const lock = JSON.parse(await readFile(join(marketplace, "skillset.lock"), "utf8")) as {
    readonly marketplaces: { readonly entries: readonly { readonly catalog: string; readonly repo?: string }[] };
  };
  expect(lock.marketplaces.entries).toEqual([expect.objectContaining({
    catalog: "outfitter",
    repo: "github:outfitter-dev/trails",
  })]);
});

test("SET-236: marketplace update renders mixed local and external Claude entries", async () => {
  const parent = await mkdtemp(join(tmpdir(), "skillset-marketplace-mixed-"));
  const marketplace = await fixture({
    "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    targets: [claude]
    plugins:
      - plugin: local-tools
      - id: trails
        plugin: trails-tools
        repo: github:outfitter-dev/trails
`,
    ".skillset/plugins/local-tools/skillset.yaml": `
skillset:
  name: local-tools
  description: Local tools.
`,
    ".skillset/plugins/local-tools/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Use this demo skill.
`,
  }, parent);
  const external = await fixture({
    "skillset.yaml": `
skillset:
  name: trails
`,
    ".skillset/plugins/trails-tools/skillset.yaml": `
skillset:
  name: trails-tools
  description: Trails tools.
`,
    ".skillset/plugins/trails-tools/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Use this demo skill.
`,
  }, parent);
  await buildSkillsetResult(marketplace);
  await buildSkillsetResult(external);
  const xdg = xdgOptions(parent);
  await writeKnownSkillsetsIndex({
    schemaVersion: 1,
    skillsets: [{
      cacheKey: "trails",
      identities: ["github:outfitter-dev/trails"],
      path: external,
    }],
  }, xdg);

  const updated = await runSkillsetCliWithEnv(xdg.env, "marketplace", "update", "outfitter", "--yes", "--root", marketplace);

  expect(updated).toMatchObject({ exitCode: 0, stderr: "" });
  const marketplaceJson = JSON.parse(await readFile(join(marketplace, ".claude-plugin/marketplace.json"), "utf8")) as {
    readonly plugins: readonly { readonly name: string; readonly source: unknown }[];
  };
  expect(marketplaceJson.plugins).toEqual([
    expect.objectContaining({ name: "local-tools", source: "./plugins/local-tools/claude" }),
    expect.objectContaining({
      name: "trails-tools",
      source: expect.objectContaining({
        path: "plugins/trails-tools/claude",
        source: "git-subdir",
        url: "outfitter-dev/trails",
      }),
    }),
  ]);
});

test("SET-236: marketplace update requires resolved sha proof for floating external refs", async () => {
  const parent = await mkdtemp(join(tmpdir(), "skillset-marketplace-floating-"));
  const marketplace = await fixture({
    "skillset.yaml": `
skillset:
  name: marketplace-root
marketplaces:
  outfitter:
    targets: [claude]
    plugins:
      - id: trails
        plugin: trails-tools
        repo: github:outfitter-dev/trails
        channel: latest
`,
  }, parent);
  const external = await fixture({
    "skillset.yaml": `
skillset:
  name: trails
`,
    ".skillset/plugins/trails-tools/skillset.yaml": `
skillset:
  name: trails-tools
`,
    ".skillset/plugins/trails-tools/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Use this demo skill.
`,
  }, parent);
  await buildSkillsetResult(external);
  const xdg = xdgOptions(parent);
  await writeKnownSkillsetsIndex({
    schemaVersion: 1,
    skillsets: [{
      cacheKey: "trails",
      identities: ["github:outfitter-dev/trails"],
      path: external,
    }],
  }, xdg);

  const updated = await runSkillsetCliWithEnv(xdg.env, "marketplace", "update", "outfitter", "--yes", "--root", marketplace);

  expect(updated.exitCode).toBe(1);
  expect(updated.stderr).toBe("");
  expect(updated.stdout).toContain("skillset: marketplace update failed");
  expect(updated.stdout).toContain("channel marketplace entry is not locked");
  await expect(readdir(marketplace)).resolves.not.toContain("plugins-claude");
});

async function fixture(files: Record<string, string>, parent?: string): Promise<string> {
  const root = await mkdtemp(join(parent ?? tmpdir(), "skillset-marketplace-cli-"));
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
  return runSkillsetCliWithEnv({ XDG_CONFIG_HOME: join(tmpdir(), "skillset-marketplace-cli-xdg") }, ...args);
}

async function runSkillsetCliWithEnv(
  env: Readonly<Record<string, string | undefined>>,
  ...args: readonly string[]
): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    env: { ...process.env, ...env },
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

function xdgOptions(root: string): { env: Record<string, string>; homeDir: string } {
  return {
    env: {
      XDG_CONFIG_HOME: join(root, "config"),
    },
    homeDir: join(root, "home"),
  };
}
