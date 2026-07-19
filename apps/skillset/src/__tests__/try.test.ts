import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test } from "bun:test";
import { createOperationalPathContext, resolveOperationalPath } from "@skillset/core";
import { validateCliResult, type SkillsetCliResult } from "@skillset/schema";

import {
  listTryRuns,
  readTryStatus,
  startTryRun,
  tailTryRun,
} from "../try";
import { runTryCommand } from "../try-cli";
import { runSkillsetTest } from "../test-runner";
import { parseCliEventStream } from "../cli-output";

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
    env: { ...process.env, SKILLSET_TEST_CODEX_BIN: bin },
    prompt: "List the available fixture skills.",
    target: "codex",
    xdg,
  });

  expect(report.ok).toBe(true);
  expect(report.state).toBe("passed");
  expect(report.runPath).toStartWith(".skillset/cache/tests/ad-hoc/runs/");
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
  const retainedEvents = parseCliEventStream(await readFile(cachePath(root, xdg, report.tailPath), "utf8"));
  expect(retainedEvents.at(-1)?.event).toBe("completed");
  expect(retainedEvents.every((event) => event.command === "test")).toBe(true);

  const runs = await listTryRuns(root, { xdg });
  expect(runs.map((run) => run.runId)).toContain(report.runId);
});

test("ad hoc test target diagnostics use the canonical target list", async () => {
  await expect(runTryCommand("/tmp", {
    background: false,
    json: false,
    plugins: [],
    prompt: "Inspect the fixture.",
    skillsetOptions: {},
  })).rejects.toThrow("skillset: ad hoc test requires --target claude, codex, or cursor");
});

test("provider output cannot terminate the retained test event stream", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: provider-status-text-fixture
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Provider status text fixture.
---

Body.
`,
  });
  const bin = await fakeCodexStatusTextBin(root);
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };
  const report = await startTryRun(root, {
    env: { ...process.env, SKILLSET_TEST_CODEX_BIN: bin },
    prompt: "Print misleading status text.",
    target: "codex",
    xdg,
  });

  const events = parseCliEventStream(await readFile(cachePath(root, xdg, report.tailPath), "utf8"));
  expect(events.filter((event) => event.event === "completed")).toHaveLength(1);
  expect(events.at(-1)?.event).toBe("completed");
  expect(events.some((event) => event.event === "stdout" && typeof event.data.message === "string" && event.data.message.includes("test passed"))).toBe(true);
  expect(events.some((event) => event.event === "stderr" && typeof event.data.message === "string" && event.data.message.includes("test failed: provider text"))).toBe(true);
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
    env: { ...process.env, SKILLSET_TEST_CLAUDE_BIN: bin },
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
    env: { ...process.env, SKILLSET_TEST_CURSOR_BIN: bin },
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
    env: { ...process.env, SKILLSET_TEST_CLAUDE_BIN: bin },
    prompt: "Inspect Claude default fixture.",
    target: "claude",
    xdg,
  });
  expect((await readTryStatus(root, fromDefault.runId, { xdg })).command?.join(" ")).toContain("--setting-sources \"\"");

  const fromEnv = await startTryRun(root, {
    env: {
      ...process.env,
      SKILLSET_TEST_CLAUDE_BIN: bin,
      SKILLSET_TEST_CLAUDE_SETTING_SOURCES: "user",
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
      SKILLSET_TEST_CLAUDE_BIN: bin,
      SKILLSET_TEST_CLAUDE_SETTING_SOURCES: "user",
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
  })).rejects.toThrow("unknown test plugin \"missing\"; available plugins: acme, codex-only");

  await expect(startTryRun(root, {
    plugins: ["acme", "acme"],
    prompt: "Inspect duplicate plugin.",
    target: "claude",
    xdg,
  })).rejects.toThrow("duplicate test plugin \"acme\"");

  await expect(startTryRun(root, {
    plugins: ["codex-only"],
    prompt: "Inspect disabled plugin.",
    target: "claude",
    xdg,
  })).rejects.toThrow("test plugin \"codex-only\" is not enabled for claude");

  await expect(startTryRun(root, {
    plugins: ["acme"],
    prompt: "Inspect Codex plugin selection.",
    target: "codex",
    xdg,
  })).rejects.toThrow("test --plugin is only supported for targets with local plugin-dir support: claude, cursor");
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
    SKILLSET_TEST_CODEX_BIN: bin,
    XDG_CACHE_HOME: join(root, "xdg-cache"),
  };

  const run = await runSkillsetCli(env, "test", "--target", "codex", "--prompt", "Inspect CLI fixture.", "--json", "--root", root);
  expect(run.exitCode).toBe(0);
  const runEnvelope = JSON.parse(run.stdout) as SkillsetCliResult;
  expect(validateCliResult(runEnvelope)).toEqual({ diagnostics: [], ok: true });
  expect(runEnvelope.command).toBe("test");
  expect(runEnvelope.kind).toBe("test");
  const report = runEnvelope.data as { kind: string; runId: string; runPath: string; state: string };
  expect(report.kind).toBe("ad-hoc");
  expect(report.state).toBe("passed");
  expect(report.runPath).toStartWith(".skillset/cache/tests/ad-hoc/runs/");

  const status = await runSkillsetCli(env, "test", "status", report.runId, "--json", "--root", root);
  expect(status.exitCode).toBe(0);
  const statusEnvelope = JSON.parse(status.stdout) as SkillsetCliResult;
  expect(validateCliResult(statusEnvelope)).toEqual({ diagnostics: [], ok: true });
  expect(statusEnvelope.command).toBe("test status");
  expect(statusEnvelope.data).toEqual(expect.objectContaining({ runId: report.runId, state: "passed" }));

  const tail = await runSkillsetCli(env, "test", "tail", report.runId, "--lines", "10", "--json", "--root", root);
  expect(tail.exitCode).toBe(0);
  const tailEnvelope = JSON.parse(tail.stdout) as SkillsetCliResult;
  expect(validateCliResult(tailEnvelope)).toEqual({ diagnostics: [], ok: true });
  expect(tailEnvelope.command).toBe("test tail");
  expect(JSON.stringify(tailEnvelope.data)).toContain("Inspect CLI fixture.");
  expect(JSON.stringify(tailEnvelope.data)).toContain("test passed");
  expect(tail.stdout).not.toContain("try passed");

  const list = await runSkillsetCli(env, "test", "list", "--json", "--root", root);
  expect(list.exitCode).toBe(0);
  const listEnvelope = JSON.parse(list.stdout) as SkillsetCliResult;
  expect(validateCliResult(listEnvelope)).toEqual({ diagnostics: [], ok: true });
  expect(listEnvelope.command).toBe("test list");
  expect(JSON.stringify(listEnvelope.data)).toContain(report.runId);

  const oldTry = await runSkillsetCli(env, "try", "--target", "codex", "--prompt", "Old command.", "--root", root);
  expect(oldTry.exitCode).toBe(1);
  expect(oldTry.stderr).toContain("expected command");

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
    SKILLSET_TEST_CLAUDE_BIN: bin,
    XDG_CACHE_HOME: join(root, "xdg-cache"),
  };

  const run = await runSkillsetCli(
    env,
    "test",
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
  const report = (JSON.parse(run.stdout) as SkillsetCliResult).data as { runId: string; state: string };
  expect(report.state).toBe("passed");

  const status = await runSkillsetCli(env, "test", "status", report.runId, "--json", "--root", root);
  expect(status.exitCode).toBe(0);
  const statusData = (JSON.parse(status.stdout) as SkillsetCliResult).data as { command: string[] };
  expect(statusData.command.join(" ")).toContain("--setting-sources local");
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
    SKILLSET_TEST_CODEX_BIN: await fakeCodexBin(root),
    XDG_CACHE_HOME: join(root, "xdg-cache"),
  };
  const xdg = { env };

  const started = await runSkillsetCli(
    env,
    "test",
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
  const report = (JSON.parse(started.stdout) as SkillsetCliResult).data as { runId: string; state: string };
  expect(report.state).toBe("queued");

  let state = report.state;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && state !== "passed" && state !== "failed") {
    await Bun.sleep(20);
    state = (await readTryStatus(root, report.runId, { xdg })).state;
  }
  expect(state).toBe("passed");
}, 15_000);

test("SET-273: declared runtime tests reuse try across providers and retain normalized evidence", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: declared-runtime-fixture
claude: true
codex: true
cursor: true
`,
    ".skillset/prompts/claude.md": "Inspect the Claude runtime fixture.",
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Declared runtime fixture.
---

Runtime fixture body.
`,
    ".skillset/tests/runtime.yaml": `
select:
  skills:
    primary: [demo]
targets: [claude, codex, cursor]
activation:
  - name: codex runtime
    targets: [codex]
    prompt: Inspect the Codex runtime fixture.
    expect:
      skill: demo
    runtime:
      timeoutMs: 5000
      expect:
        contains: fake codex final
        notContains: impossible failure text
  - name: claude runtime
    targets: [claude]
    promptFile: prompts/claude.md
    expect:
      skill: demo
    runtime:
      claude:
        settingSources: isolated
      expect:
        contains: Inspect the Claude runtime fixture.
  - name: cursor runtime
    targets: [cursor]
    prompt: Inspect the Cursor runtime fixture.
    expect:
      skill: demo
    runtime:
      expect:
        contains: fake-cursor
checks:
  projection: true
`,
  });
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };
  const runtimeEnv = {
    ...process.env,
    SKILLSET_TEST_CLAUDE_BIN: await fakeClaudeBin(root),
    SKILLSET_TEST_CODEX_BIN: await fakeCodexBin(root),
    SKILLSET_TEST_CURSOR_BIN: await fakeCursorBin(root),
  };
  const report = await runSkillsetTest(root, "runtime", {
    runtimeEnv,
    xdg,
  });

  expect(report.ok).toBe(true);
  expect(report.runtimeTests).toHaveLength(3);
  expect(report.runtimeTests.map((result) => result.target)).toEqual(["codex", "claude", "cursor"]);
  expect(report.runtimeTests.every((result) => result.ok)).toBe(true);
  expect(report.runtimeTests.map((result) => result.promptProvenance)).toEqual([
    "inline",
    ".skillset/prompts/claude.md",
    "inline",
  ]);
  for (const result of report.runtimeTests) {
    expect(result.runPath).toStartWith(".skillset/cache/tests/ad-hoc/runs/");
    expect(await exists(cachePath(root, xdg, String(result.reportPath)))).toBe(true);
    expect(await exists(cachePath(root, xdg, String(result.outputPath)))).toBe(true);
    expect(result.assertions.every((assertion) => assertion.ok)).toBe(true);
  }
  const structured = JSON.parse(await readFile(cachePath(root, xdg, report.reportPath), "utf8")) as {
    runtimeTests: Array<{ promptProvenance: string; target: string }>;
  };
  expect(structured.runtimeTests.map((result) => result.target)).toEqual(["codex", "claude", "cursor"]);
  expect(await readFile(cachePath(root, xdg, report.reportMarkdownPath), "utf8")).toContain("## Runtime Tests");

  const cli = await runSkillsetCli(
    { ...runtimeEnv, XDG_CACHE_HOME: xdg.env.XDG_CACHE_HOME },
    "test",
    "runtime",
    "--root",
    root
  );
  expect(cli.exitCode).toBe(0);
  expect(cli.stdout).toContain("runtime tests: 3");
  expect(cli.stdout).toContain("pass: runtime claude runtime [claude]");
});

test("SET-273: declared runtime expectation failures are distinct from provider failures", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: declared-runtime-assertion-fixture
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Assertion fixture.
---

Assertion fixture body.
`,
    ".skillset/tests/runtime.yaml": `
select:
  skills:
    primary: [demo]
targets: [codex]
activation:
  - prompt: Inspect the assertion fixture.
    expect:
      skill: demo
    runtime:
      expect:
        contains: text that is not returned
checks:
  projection: true
`,
  });
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };
  const report = await runSkillsetTest(root, "runtime", {
    runtimeEnv: { ...process.env, SKILLSET_TEST_CODEX_BIN: await fakeCodexBin(root) },
    xdg,
  });

  expect(report.ok).toBe(false);
  expect(report.runtimeTests).toHaveLength(1);
  expect(report.runtimeTests[0]).toEqual(expect.objectContaining({
    failureClass: "assertion",
    ok: false,
    state: "passed",
    target: "codex",
  }));

  const authBin = await fakeFailureBin(root, "declared-auth-codex", "Not logged in. Run setup-token.", 1);
  const authReport = await runSkillsetTest(root, "runtime", {
    runtimeEnv: { ...process.env, SKILLSET_TEST_CODEX_BIN: authBin },
    xdg,
  });
  expect(authReport.runtimeTests[0]).toEqual(expect.objectContaining({
    assertions: [],
    detail: "Not logged in. Run setup-token.",
    failureClass: "auth",
    ok: false,
  }));
});

test("SET-273: declared runtime render failures stop before provider invocation", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: declared-runtime-setup-fixture
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Setup fixture.
---

Setup fixture body.
`,
    ".skillset/tests/runtime.yaml": `
select:
  skills:
    primary: [demo]
targets: [codex]
activation:
  - prompt: Inspect the missing unit.
    expect:
      skill: missing
    runtime:
      expect:
        contains: never invoked
checks:
  projection: true
`,
  });
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };
  const report = await runSkillsetTest(root, "runtime", {
    runtimeEnv: { ...process.env, SKILLSET_TEST_CODEX_BIN: join(root, "must-not-run") },
    xdg,
  });

  expect(report.ok).toBe(false);
  expect(report.runtimeTests).toEqual([
    expect.objectContaining({
      detail: "expected skill missing was not rendered for codex",
      failureClass: "render",
      ok: false,
      target: "codex",
    }),
  ]);
  expect(await exists(cachePath(root, xdg, ".skillset/cache/tests/ad-hoc/latest.json"))).toBe(false);
});

test("SET-273: failed isolated builds produce normalized render failures", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: declared-runtime-build-fixture
codex: true
`,
    ".skillset/plugins/demo/skillset.yaml": `
skillset:
  name: demo
bin: true
`,
    ".skillset/plugins/demo/skills/helper/SKILL.md": `
---
name: helper
description: Render failure fixture.
---

Render failure body.
`,
    ".skillset/plugins/demo/bin/tool": "#!/bin/sh\n",
    ".skillset/tests/runtime.yaml": `
select:
  plugins: [demo]
targets: [codex]
activation:
  - prompt: Inspect the render failure.
    expect:
      plugin: demo
    runtime:
      expect:
        contains: never invoked
checks:
  projection: true
`,
  });
  const report = await runSkillsetTest(root, "runtime", {
    runtimeEnv: { ...process.env, SKILLSET_TEST_CODEX_BIN: join(root, "must-not-run") },
  });

  expect(report.ok).toBe(false);
  expect(report.checks[0]).toEqual(expect.objectContaining({ kind: "projection", ok: false }));
  expect(report.runtimeTests).toEqual([
    expect.objectContaining({ failureClass: "render", ok: false, target: "codex" }),
  ]);
});

test("SET-273: runtime prompt files stay source-local and are exclusive with inline prompts", async () => {
  const files = {
    "skillset.yaml": `
skillset:
  name: runtime-prompt-contract
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Prompt contract fixture.
---

Prompt fixture body.
`,
  };
  const bothRoot = await fixture({
    ...files,
    ".skillset/prompts/demo.md": "Prompt file.",
    ".skillset/tests/runtime.yaml": `
select:
  skills:
    primary: [demo]
activation:
  - prompt: Inline prompt.
    promptFile: prompts/demo.md
    expect:
      skill: demo
    runtime:
      expect:
        contains: demo
checks:
  projection: true
`,
  });
  await expect(runSkillsetTest(bothRoot, "runtime")).rejects.toThrow("must name exactly one of prompt or promptFile");

  const escapeRoot = await fixture({
    ...files,
    ".skillset/tests/runtime.yaml": `
select:
  skills:
    primary: [demo]
activation:
  - promptFile: ../skillset.yaml
    expect:
      skill: demo
    runtime:
      expect:
        contains: demo
checks:
  projection: true
`,
  });
  await expect(runSkillsetTest(escapeRoot, "runtime")).rejects.toThrow("inside the source root");

  const symlinkRoot = await fixture({
    ...files,
    ".skillset/tests/runtime.yaml": `
select:
  skills:
    primary: [demo]
activation:
  - promptFile: prompts/leak.md
    expect:
      skill: demo
    runtime:
      expect:
        contains: sentinel
checks:
  projection: true
`,
    "outside.md": "external prompt sentinel",
  });
  await mkdir(join(symlinkRoot, ".skillset/prompts"), { recursive: true });
  await symlink("../../outside.md", join(symlinkRoot, ".skillset/prompts/leak.md"));
  await expect(runSkillsetTest(symlinkRoot, "runtime")).rejects.toThrow("resolves outside the source root");
});

test("SET-273: try classifies setup, auth, and timeout failures", async () => {
  const root = await fixture({
    "skillset.yaml": `
skillset:
  name: runtime-failure-fixture
claude: true
codex: true
`,
    ".skillset/skills/demo/SKILL.md": `
---
name: demo
description: Runtime failure fixture.
---

Runtime failure body.
`,
  });
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };

  const missing = await startTryRun(root, {
    env: { ...process.env, SKILLSET_TEST_CODEX_BIN: join(root, "missing-codex") },
    name: "missing-runtime",
    prompt: "Missing runtime.",
    target: "codex",
    xdg,
  });
  expect((await readTryStatus(root, missing.runId, { xdg })).failureClass).toBe("binary");

  const authBin = await fakeFailureBin(root, "auth-claude", "Not logged in. Run setup-token.", 1);
  const auth = await startTryRun(root, {
    env: { ...process.env, SKILLSET_TEST_CLAUDE_BIN: authBin },
    name: "auth-runtime",
    prompt: "Auth runtime.",
    target: "claude",
    xdg,
  });
  expect((await readTryStatus(root, auth.runId, { xdg })).failureClass).toBe("auth");

  const timeoutBin = await fakeSleepingBin(root);
  const timeout = await startTryRun(root, {
    env: { ...process.env, SKILLSET_TEST_CODEX_BIN: timeoutBin },
    name: "timeout-runtime",
    prompt: "Timeout runtime.",
    target: "codex",
    timeoutMs: 10,
    xdg,
  });
  const timeoutStatus = await readTryStatus(root, timeout.runId, { xdg });
  expect(timeoutStatus.failureClass).toBe("timeout");
  expect(timeoutStatus.error).toContain("test command timed out");
  expect(timeoutStatus.error).not.toContain("try command");
});

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

async function fakeCodexStatusTextBin(root: string): Promise<string> {
  const bin = await fakeCodexBin(root);
  const script = await readFile(bin, "utf8");
  await writeFile(
    bin,
    script.replace(
      'echo "fake-codex cwd=$(pwd)"',
      'printf \'test passed\\n\'\nprintf \'test failed: provider text\\n\' >&2\necho "fake-codex cwd=$(pwd)"'
    ),
    "utf8"
  );
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

async function fakeFailureBin(root: string, name: string, message: string, exitCode: number): Promise<string> {
  const bin = join(root, "bin", name);
  await mkdir(dirname(bin), { recursive: true });
  await writeFile(bin, `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(message)} >&2\nexit ${exitCode}\n`, "utf8");
  await chmod(bin, 0o755);
  return bin;
}

async function fakeSleepingBin(root: string): Promise<string> {
  const bin = join(root, "bin", "sleeping-codex");
  await mkdir(dirname(bin), { recursive: true });
  await writeFile(bin, "#!/bin/sh\nsleep 1\n", "utf8");
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
