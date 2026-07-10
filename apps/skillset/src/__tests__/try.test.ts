import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test } from "bun:test";
import { createOperationalPathContext, resolveOperationalPath } from "@skillset/core";

import {
  listTryRuns,
  readTryStatus,
  startTryRun,
  tailTryRun,
} from "../try";

test("try runs a Codex prompt and records inspectable artifacts", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: runtime-fixture
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo try skill.
---

Use this skill to answer fixture questions.
`,
  });
  const bin = await fakeCodexBin(root);
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };

  const report = await startTryRun(root, {
    env: { ...process.env, SKILLSET_TRY_CODEX_BIN: bin },
    prompt: "List the available fixture skills.",
    target: "codex",
    xdg,
  });

  expect(report.ok).toBe(true);
  expect(report.state).toBe("passed");
  expect(report.runPath).toStartWith(".skillset/cache/runtime-tests/runs/");
  expect(await exists(cachePath(root, xdg, report.tailPath))).toBe(true);
  expect(await readFile(cachePath(root, xdg, report.reportPath), "utf8")).toContain("fake codex final");

  const status = await readTryStatus(root, report.runId, { xdg });
  expect(status.state).toBe("passed");
  expect(status.command?.join(" ")).toContain("--output-last-message");
  expect(status.command?.join(" ")).toContain("--skip-git-repo-check");
  expect(status.finalMessagePath).toBeDefined();

  const tail = await tailTryRun(root, report.runId, 20, { xdg });
  expect(tail.map((line) => line.stream)).toContain("stdout");
  expect(tail.some((line) => line.message.includes("List the available fixture skills."))).toBe(true);

  const runs = await listTryRuns(root, { xdg });
  expect(runs.map((run) => run.runId)).toContain(report.runId);
});

test("try runs a Claude prompt with isolated settings and explicit plugin dirs", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: runtime-claude-fixture
claude: true
`,
    ".skillset/plugins/acme/skillset.yaml": `
skillset:
  name: acme
  title: Acme
  summary: Acme plugin fixture.
claude: true
`,
    ".skillset/plugins/acme/skills/demo/SKILL.md": `
---
name: demo
description: Demo Claude try skill.
---

Use this skill to answer fixture questions.
`,
  });
  const bin = await fakeClaudeBin(root);
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };

  const report = await startTryRun(root, {
    env: { ...process.env, SKILLSET_TRY_CLAUDE_BIN: bin },
    plugins: ["acme"],
    prompt: "Inspect Claude fixture.",
    target: "claude",
    xdg,
  });

  expect(report.ok).toBe(true);
  expect(report.state).toBe("passed");

  const status = await readTryStatus(root, report.runId, { xdg });
  const command = status.command?.join(" ");
  expect(command).toContain("--setting-sources \"\"");
  expect(command).toContain("--plugin-dir");
  expect(command).toContain("plugins/acme/claude");

  const tail = await tailTryRun(root, report.runId, 20, { xdg });
  expect(tail.some((line) => line.message.includes("fake-claude prompt=Inspect Claude fixture."))).toBe(true);
});

test("try runs a Cursor prompt with trusted isolated workspace and explicit plugin dirs", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: runtime-cursor-fixture
compile:
  targets: [cursor]
cursor: true
`,
    ".skillset/plugins/acme/skillset.yaml": `
skillset:
  name: acme
  title: Acme
  summary: Acme Cursor plugin fixture.
cursor: true
`,
    ".skillset/plugins/acme/skills/demo/SKILL.md": `
---
name: demo
description: Demo Cursor try skill.
---

Use this skill to answer fixture questions.
`,
  });
  const bin = await fakeCursorBin(root);
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };

  const report = await startTryRun(root, {
    env: { ...process.env, SKILLSET_TRY_CURSOR_BIN: bin },
    plugins: ["acme"],
    prompt: "Inspect Cursor fixture.",
    target: "cursor",
    xdg,
  });

  expect(report.ok).toBe(true);
  expect(report.state).toBe("passed");

  const status = await readTryStatus(root, report.runId, { xdg });
  const command = status.command?.join(" ");
  expect(command).toContain("--print");
  expect(command).toContain("--output-format json");
  expect(command).toContain("--mode ask");
  expect(command).toContain("--trust");
  expect(command).toContain("--workspace");
  expect(command).toContain("--plugin-dir");
  expect(command).toContain("plugins/acme/cursor");

  const tail = await tailTryRun(root, report.runId, 20, { xdg });
  expect(tail.some((line) => line.message.includes("fake-cursor prompt=Inspect Cursor fixture."))).toBe(true);
});

test("try resolves Claude setting sources from defaults, env, and CLI options", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: runtime-claude-config-fixture
claude: true
`,
    ".skillset/plugins/acme/skillset.yaml": `
skillset:
  name: acme
  title: Acme
  summary: Acme plugin fixture.
claude: true
`,
    ".skillset/plugins/acme/skills/demo/SKILL.md": `
---
name: demo
description: Demo Claude try skill.
---

Use this skill to answer fixture questions.
`,
  });
  const bin = await fakeClaudeBin(root);
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };

  const fromDefault = await startTryRun(root, {
    env: { ...process.env, SKILLSET_TRY_CLAUDE_BIN: bin },
    prompt: "Inspect Claude default fixture.",
    target: "claude",
    xdg,
  });
  expect((await readTryStatus(root, fromDefault.runId, { xdg })).command?.join(" ")).toContain("--setting-sources \"\"");

  const fromEnv = await startTryRun(root, {
    env: {
      ...process.env,
      SKILLSET_TRY_CLAUDE_BIN: bin,
      SKILLSET_TRY_CLAUDE_SETTING_SOURCES: "user",
    },
    prompt: "Inspect Claude env fixture.",
    target: "claude",
    xdg,
  });
  expect((await readTryStatus(root, fromEnv.runId, { xdg })).command?.join(" ")).toContain("--setting-sources user");

  const fromOption = await startTryRun(root, {
    claudeSettingSources: "local",
    env: {
      ...process.env,
      SKILLSET_TRY_CLAUDE_BIN: bin,
      SKILLSET_TRY_CLAUDE_SETTING_SOURCES: "user",
    },
    prompt: "Inspect Claude option fixture.",
    target: "claude",
    xdg,
  });
  expect((await readTryStatus(root, fromOption.runId, { xdg })).command?.join(" ")).toContain("--setting-sources local");
});

test("try validates selected plugins before running", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: runtime-plugin-selector-fixture
claude: true
codex: true
`,
    ".skillset/plugins/acme/skillset.yaml": `
skillset:
  name: acme
  title: Acme
  summary: Acme plugin fixture.
claude: true
`,
    ".skillset/plugins/acme/skills/demo/SKILL.md": `
---
name: demo
description: Demo Claude try skill.
---

Use this skill to answer fixture questions.
`,
    ".skillset/plugins/codex-only/skillset.yaml": `
skillset:
  name: codex-only
  title: Codex Only
  summary: Codex-only plugin fixture.
claude: false
codex: true
`,
    ".skillset/plugins/codex-only/skills/demo/SKILL.md": `
---
name: demo
description: Demo Codex-only try skill.
---

Use this skill to answer fixture questions.
`,
  });
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };

  await expect(startTryRun(root, {
    plugins: ["missing"],
    prompt: "Inspect missing plugin.",
    target: "claude",
    xdg,
  })).rejects.toThrow("unknown try plugin \"missing\"; available plugins: acme, codex-only");

  await expect(startTryRun(root, {
    plugins: ["acme", "acme"],
    prompt: "Inspect duplicate plugin.",
    target: "claude",
    xdg,
  })).rejects.toThrow("duplicate try plugin \"acme\"");

  await expect(startTryRun(root, {
    plugins: ["codex-only"],
    prompt: "Inspect disabled plugin.",
    target: "claude",
    xdg,
  })).rejects.toThrow("try plugin \"codex-only\" is not enabled for claude");

  await expect(startTryRun(root, {
    plugins: ["acme"],
    prompt: "Inspect Codex plugin selection.",
    target: "codex",
    xdg,
  })).rejects.toThrow("try --plugin is only supported for targets with local plugin-dir support: claude, cursor");
});

test("SET-272: try CLI starts directly and supports status, tail, and list", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: runtime-cli-fixture
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo try CLI skill.
---

CLI fixture body.
`,
  });
  const bin = await fakeCodexBin(root);
  const env = {
    ...process.env,
    SKILLSET_TRY_CODEX_BIN: bin,
    XDG_CACHE_HOME: join(root, "xdg-cache"),
  };

  const run = await runSkillsetCli(env, "try", "--target", "codex", "--prompt", "Inspect CLI fixture.", "--json", "--root", root);
  expect(run.exitCode).toBe(0);
  const report = JSON.parse(run.stdout) as { runId: string; runPath: string; state: string };
  expect(report.state).toBe("passed");
  expect(report.runPath).toStartWith(".skillset/cache/runtime-tests/runs/");

  const status = await runSkillsetCli(env, "try", "status", report.runId, "--json", "--root", root);
  expect(status.exitCode).toBe(0);
  expect(JSON.parse(status.stdout)).toEqual(expect.objectContaining({ runId: report.runId, state: "passed" }));

  const tail = await runSkillsetCli(env, "try", "tail", report.runId, "--lines", "10", "--json", "--root", root);
  expect(tail.exitCode).toBe(0);
  expect(tail.stdout).toContain("Inspect CLI fixture.");

  const list = await runSkillsetCli(env, "try", "list", "--json", "--root", root);
  expect(list.exitCode).toBe(0);
  expect(list.stdout).toContain(report.runId);

  const retired = await runSkillsetCli(env, "runtime-tester", "run", "--target", "codex", "--prompt", "Old command.", "--root", root);
  expect(retired.exitCode).toBe(1);
  expect(retired.stderr).toContain("expected command");
});

test("try CLI supports Claude setting source override", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: runtime-cli-claude-fixture
claude: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Demo try CLI Claude skill.
---

CLI Claude fixture body.
`,
  });
  const bin = await fakeClaudeBin(root);
  const env = {
    ...process.env,
    SKILLSET_TRY_CLAUDE_BIN: bin,
    XDG_CACHE_HOME: join(root, "xdg-cache"),
  };

  const run = await runSkillsetCli(
    env,
    "try",
    "--target",
    "claude",
    "--prompt",
    "Inspect CLI Claude fixture.",
    "--claude-setting-sources",
    "local",
    "--json",
    "--root",
    root
  );
  expect(run.exitCode).toBe(0);
  const report = JSON.parse(run.stdout) as { runId: string; state: string };
  expect(report.state).toBe("passed");

  const status = await runSkillsetCli(env, "try", "status", report.runId, "--json", "--root", root);
  expect(status.exitCode).toBe(0);
  expect(JSON.parse(status.stdout).command.join(" ")).toContain("--setting-sources local");
});

test("SET-272: background tries complete through the renamed worker command", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: background-try-fixture
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Background try fixture.
---

Background fixture body.
`,
  });
  const env = {
    ...process.env,
    SKILLSET_TRY_CODEX_BIN: await fakeCodexBin(root),
    XDG_CACHE_HOME: join(root, "xdg-cache"),
  };
  const xdg = { env };

  const started = await runSkillsetCli(
    env,
    "try",
    "--target",
    "codex",
    "--prompt",
    "Inspect background fixture.",
    "--background",
    "--json",
    "--root",
    root
  );
  expect(started.exitCode).toBe(0);
  const report = JSON.parse(started.stdout) as { runId: string; state: string };
  expect(report.state).toBe("queued");

  let state = report.state;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && state !== "passed" && state !== "failed") {
    await Bun.sleep(20);
    state = (await readTryStatus(root, report.runId, { xdg })).state;
  }
  expect(state).toBe("passed");
}, 15_000);

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-try-"));
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, `${content.trim()}\n`, "utf8");
  }
  return root;
}

async function fakeCodexBin(root: string): Promise<string> {
  const bin = join(root, "bin", "fake-codex");
  await mkdir(dirname(bin), { recursive: true });
  await writeFile(bin, `#!/bin/sh
last=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--output-last-message" ]; then
    last="$arg"
  fi
  prev="$arg"
done
input="$(cat)"
echo "fake-codex cwd=$(pwd)"
echo "fake-codex prompt=$input"
if [ -n "$last" ]; then
  printf 'fake codex final\\n' > "$last"
fi
`, "utf8");
  await chmod(bin, 0o755);
  return bin;
}

async function fakeClaudeBin(root: string): Promise<string> {
  const bin = join(root, "bin", "fake-claude");
  await mkdir(dirname(bin), { recursive: true });
  await writeFile(bin, `#!/bin/sh
last=""
for arg in "$@"; do
  last="$arg"
done
echo "fake-claude cwd=$(pwd)"
echo "fake-claude prompt=$last"
`, "utf8");
  await chmod(bin, 0o755);
  return bin;
}

async function fakeCursorBin(root: string): Promise<string> {
  const bin = join(root, "bin", "fake-cursor");
  await mkdir(dirname(bin), { recursive: true });
  await writeFile(bin, `#!/bin/sh
last=""
for arg in "$@"; do
  last="$arg"
done
echo "fake-cursor cwd=$(pwd)"
echo "fake-cursor prompt=$last"
`, "utf8");
  await chmod(bin, 0o755);
  return bin;
}

function cachePath(
  root: string,
  xdg: { readonly env: { readonly XDG_CACHE_HOME: string } },
  logicalPath: string
): string {
  return resolveOperationalPath(createOperationalPathContext(root, { env: xdg.env }), logicalPath);
}

async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

async function runSkillsetCli(
  env: Record<string, string | undefined>,
  ...args: readonly string[]
): Promise<{ readonly exitCode: number; readonly stderr: string; readonly stdout: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    env,
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
