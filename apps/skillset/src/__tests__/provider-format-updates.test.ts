import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test } from "bun:test";
import { normalizeSkillsetFixtureFiles } from "../../../../scripts/test-helpers/skillset-config";

import { buildSkillset } from "../build";
import {
  renderProviderFormatUpdateReport,
  runProviderFormatUpdates,
} from "../provider-format-updates";

const CODEX_PLUGIN_MANIFEST = "plugins-codex/plugins/alpha/.codex-plugin/plugin.json";
const CODEX_AGENT = ".codex/agents/reviewer.toml";

test("SET-194: check preview reports safe provider-format updates without writing", async () => {
  const root = await builtFixture(pluginFixture());
  const manifestPath = join(root, CODEX_PLUGIN_MANIFEST);
  const original = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, `${original}\n// stale\n`, "utf8");
  await markCurrentPluginManifestAsManaged(root);

  const report = await runProviderFormatUpdates(root, "check");

  expect(report.wrote).toBe(false);
  expect(report.safeUpdates.map((action) => action.id)).toEqual([
    "codex-plugin-component-paths-adapter-update",
  ]);
  expect(report.safeUpdates[0]?.affectedPaths).toEqual([CODEX_PLUGIN_MANIFEST]);
  expect(await readFile(manifestPath, "utf8")).not.toBe(original);
  expect(renderProviderFormatUpdateReport(report)).toContain("safe adapter codex-plugin-component-paths-adapter-update");
});

test("SET-194: check --fix applies safe provider-format updates and reports changed files", async () => {
  const root = await builtFixture(pluginFixture());
  const manifestPath = join(root, CODEX_PLUGIN_MANIFEST);
  const original = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, `${original}\n// stale\n`, "utf8");
  await markCurrentPluginManifestAsManaged(root);

  const fixed = await runSkillsetCli("check", "--fix", "--root", root);

  expect(fixed.exitCode).toBe(0);
  expect(fixed.stderr).toBe("");
  expect(fixed.stdout).toContain("skillset: checked 1 source skills");
  expect(fixed.stdout).toContain("applied safe provider format updates");
  expect(fixed.stdout).toContain(`updated ${CODEX_PLUGIN_MANIFEST}`);
  expect(await readFile(manifestPath, "utf8")).toBe(original);
});

test("SET-194: update previews then writes the same safe provider-format plan", async () => {
  const root = await builtFixture(pluginFixture());
  const manifestPath = join(root, CODEX_PLUGIN_MANIFEST);
  const original = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, `${original}\n// stale\n`, "utf8");
  await markCurrentPluginManifestAsManaged(root);

  const preview = await runSkillsetCli("update", "--root", root);

  expect(preview.exitCode).toBe(0);
  expect(preview.stdout).toContain("rerun skillset update with --yes");
  expect(await readFile(manifestPath, "utf8")).not.toBe(original);

  const written = await runSkillsetCli("update", "--yes", "--root", root);

  expect(written.exitCode).toBe(0);
  expect(written.stdout).toContain("applied safe provider format updates");
  expect(await readFile(manifestPath, "utf8")).toBe(original);
});

test("SET-194: arbitrary edits on safe provider paths block writes", async () => {
  const root = await builtFixture(pluginFixture());
  const manifestPath = join(root, CODEX_PLUGIN_MANIFEST);
  const original = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, `${original}\n// hand edit\n`, "utf8");

  const blocked = await runSkillsetCli("update", "--yes", "--root", root);

  expect(blocked.exitCode).toBe(1);
  expect(blocked.stderr).toBe("");
  expect(blocked.stdout).toContain("manual-review codex-plugin-component-paths-adapter-update");
  expect(blocked.stdout).toContain("differs from its previous skillset.lock hash");
  expect(await readFile(manifestPath, "utf8")).not.toBe(original);
});

test("SET-194: unsafe provider-format drift remains blocked for manual review", async () => {
  const root = await builtFixture(agentFixture());
  const agentPath = join(root, CODEX_AGENT);
  const original = await readFile(agentPath, "utf8");
  await writeFile(agentPath, `${original}\n# stale\n`, "utf8");

  const blocked = await runSkillsetCli("update", "--yes", "--root", root);

  expect(blocked.exitCode).toBe(1);
  expect(blocked.stderr).toBe("");
  expect(blocked.stdout).toContain("manual-review codex-subagent-toml-manual-review");
  expect(blocked.stdout).toContain("provider format updates require manual review before writing");
  expect(await readFile(agentPath, "utf8")).not.toBe(original);
});

test("SET-194: check --fix blocks unsafe provider-format drift", async () => {
  const root = await builtFixture(agentFixture());
  const agentPath = join(root, CODEX_AGENT);
  const original = await readFile(agentPath, "utf8");
  await writeFile(agentPath, `${original}\n# stale\n`, "utf8");

  const blocked = await runSkillsetCli("check", "--fix", "--root", root);

  expect(blocked.exitCode).toBe(1);
  expect(blocked.stderr).toBe("");
  expect(blocked.stdout).toContain("manual-review codex-subagent-toml-manual-review");
  expect(await readFile(agentPath, "utf8")).not.toBe(original);
});

test("SET-194: update rejects scoped writes before safety planning", async () => {
  const root = await builtFixture(pluginFixture());

  const scoped = await runSkillsetCli("update", "--yes", "--scope", "plugins", "--root", root);

  expect(scoped.exitCode).toBe(1);
  expect(scoped.stderr).toContain("update does not support --scope");
});

async function builtFixture(files: Record<string, string>): Promise<string> {
  const root = await fixture(files);
  await buildSkillset(root);
  return root;
}

async function markCurrentPluginManifestAsManaged(root: string): Promise<void> {
  const lockPath = join(root, "plugins-codex/skillset.lock");
  const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
    readonly outputRoot: string;
    readonly items: Array<{
      files?: readonly string[];
      outputHash?: string;
    }>;
  };
  const item = lock.items.find((candidate) => candidate.files?.includes("plugins/alpha/.codex-plugin/plugin.json"));
  if (item?.files === undefined) throw new Error("missing plugin manifest lock item");
  item.outputHash = await hashLockItem(root, lock.outputRoot, item.files);
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

async function hashLockItem(root: string, outputRoot: string, files: readonly string[]): Promise<string> {
  const hash = createHash("sha256");
  hash.update("skillset-output-v1\0");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(await readFile(join(root, outputRoot === "." ? file : join(outputRoot, file))));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function pluginFixture(): Record<string, string> {
  return {
    ".skillset/config.yaml": `
skillset:
  name: provider-update-root
claude: false
codex: true
`,
    ".skillset/src/plugins/alpha/skillset.yaml": `
skillset:
  name: alpha
`,
    ".skillset/src/plugins/alpha/skills/demo/SKILL.md": `
---
name: demo
description: Demo skill.
---

Body.
`,
  };
}

function agentFixture(): Record<string, string> {
  return {
    ".skillset/config.yaml": `
skillset:
  name: provider-update-root
claude: false
codex: true
`,
    ".skillset/src/agents/reviewer.md": `
---
name: reviewer
description: Reviews code.
---

Review code.
`,
  };
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-provider-format-updates-"));
  for (const [path, content] of Object.entries(normalizeSkillsetFixtureFiles(files))) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, `${content.trim()}\n`, "utf8");
  }
  return root;
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
