import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test } from "bun:test";
import { createOperationalPathContext, resolveOperationalPath } from "@skillset/core";

import {
  readSkillsetEvalStatus,
  runSkillsetEvals,
  tailSkillsetEvalRun,
} from "../eval-runner";

test("SET-387: eval run executes the deterministic owner-aware case-target matrix without grading", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: eval-runtime\ncompile:\n  targets: [claude, codex]\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo eval skill.\n---\n\nUse this skill.\n",
    ".skillset/skills/demo/evals/evals.json": JSON.stringify({
      skill_name: "demo",
      evals: [{
        expected_output: "A deliberately ungraded expectation.",
        expectations: ["The response may mention the brief."],
        files: ["evals/files/brief.txt"],
        id: 1,
        prompt: "Read evals/files/brief.txt.",
      }],
    }),
    ".skillset/skills/demo/evals/files/brief.txt": "Eval brief\n",
    ".skillset/plugins/acme/skillset.yaml": "skillset:\n  name: acme\n  title: Acme\n  summary: Eval owner fixture.\n",
    ".skillset/plugins/acme/skills/demo/SKILL.md": "---\nname: demo\ndescription: Plugin-owned duplicate eval skill.\n---\n\nUse this skill.\n",
    ".skillset/plugins/acme/skills/demo/evals/evals.json": JSON.stringify({
      skill_name: "demo",
      evals: [{ expected_output: "Plugin expectation.", id: 1, prompt: "Run the plugin-owned eval." }],
    }),
  });
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };
  const report = await runSkillsetEvals(root, {
    env: {
      ...process.env,
      SKILLSET_TEST_CLAUDE_BIN: await fakeClaudeBin(root),
      SKILLSET_TEST_CODEX_BIN: await fakeCodexBin(root),
    },
    xdg,
  });

  expect(report.state).toBe("failed");
  expect(report.trials).toHaveLength(4);
  expect(report.trials.map(({ owner, target }) => ({ owner, target }))).toEqual([
    { owner: { kind: "plugin", plugin: "acme" }, target: "claude" },
    { owner: { kind: "plugin", plugin: "acme" }, target: "codex" },
    { owner: { kind: "standalone" }, target: "claude" },
    { owner: { kind: "standalone" }, target: "codex" },
  ]);
  expect(report.trials.filter((trial) => trial.classification === "completed")).toHaveLength(3);
  expect(report.trials.find((trial) =>
    trial.owner.kind === "plugin" && trial.target === "codex"
  )).toMatchObject({
    classification: "unavailable",
    command: [],
    failureClass: "setup",
  });
  expect(report.trials.every((trial) => !("ok" in trial))).toBe(true);
  expect(report.trials.filter((trial) => trial.owner.kind === "standalone").every((trial) => trial.expectations.length === 1)).toBe(true);
  expect(report.trials.find((trial) =>
    trial.owner.kind === "standalone" && trial.target === "codex"
  )).toMatchObject({
    model: "fake-codex",
    tokens: { total_tokens: 7 },
    toolCallCount: 0,
  });
  for (const trial of report.trials) {
    if (trial.owner.kind === "standalone") {
      const staged = cachePath(root, xdg, join(trial.workspacePath, "evals/files/brief.txt"));
      expect(await readFile(staged, "utf8")).toBe("Eval brief\n");
    }
    const trialWorkspace = cachePath(root, xdg, trial.workspacePath);
    if (trial.target === "claude") {
      expect(await Bun.file(join(trialWorkspace, ".agents/skills/demo/SKILL.md")).exists()).toBe(false);
    } else {
      expect(await Bun.file(join(trialWorkspace, ".claude/skills/demo/SKILL.md")).exists()).toBe(false);
    }
  }
  expect(new Set(report.trials.map((trial) => trial.workspacePath)).size).toBe(4);
  const status = await readSkillsetEvalStatus(root, report.runId, { xdg });
  expect(status.state).toBe("failed");
  const tail = await tailSkillsetEvalRun(root, report.runId, 20, { xdg });
  expect(JSON.stringify(tail)).toContain("running standalone/skill/demo/case/1/target/codex");
  const retainedReport = await readFile(cachePath(root, xdg, report.reportPath), "utf8");
  expect(retainedReport).toContain("deliberately ungraded expectation");
  expect(JSON.parse(retainedReport)).not.toHaveProperty("ok");
});

test("SET-387: nested trial artifacts keep hyphen-colliding plugin owners distinct", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: eval-collisions\ncompile:\n  targets: [codex]\n",
    ".skillset/plugins/foo-bar/skillset.yaml": "skillset:\n  name: foo-bar\n  title: Foo Bar\n  summary: Collision fixture.\n",
    ".skillset/plugins/foo-bar/skills/baz/SKILL.md": "---\nname: baz\ndescription: First collision skill.\n---\n\nUse this skill.\n",
    ".skillset/plugins/foo-bar/skills/baz/evals/evals.json": JSON.stringify({
      skill_name: "baz",
      evals: [{ expected_output: "Ungraded.", id: 1, prompt: "first collision prompt" }],
    }),
    ".skillset/plugins/foo/skillset.yaml": "skillset:\n  name: foo\n  title: Foo\n  summary: Collision fixture.\n",
    ".skillset/plugins/foo/skills/bar-baz/SKILL.md": "---\nname: bar-baz\ndescription: Second collision skill.\n---\n\nUse this skill.\n",
    ".skillset/plugins/foo/skills/bar-baz/evals/evals.json": JSON.stringify({
      skill_name: "bar-baz",
      evals: [{ expected_output: "Ungraded.", id: 1, prompt: "second collision prompt" }],
    }),
  });
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };
  const report = await runSkillsetEvals(root, {
    env: { ...process.env, SKILLSET_TEST_CODEX_BIN: await capturingCodexBin(root) },
    xdg,
  });

  expect(report).toMatchObject({ state: "failed" });
  expect(report.trials).toHaveLength(2);
  expect(new Set(report.trials.map((trial) => trial.promptPath)).size).toBe(2);
  expect(new Set(report.trials.map((trial) => trial.workspacePath)).size).toBe(2);
  expect(report.trials.every((trial) =>
    trial.classification === "unavailable" &&
    trial.failureClass === "setup" &&
    trial.command.length === 0
  )).toBe(true);

  const expectedPrompts = new Map([
    ["foo-bar/baz", "first collision prompt"],
    ["foo/bar-baz", "second collision prompt"],
  ]);
  for (const trial of report.trials) {
    const owner = trial.owner.kind === "plugin" ? `${trial.owner.plugin}/${trial.skill}` : trial.skill;
    const prompt = expectedPrompts.get(owner);
    if (prompt === undefined) throw new Error(`unexpected collision fixture trial ${owner}`);
    expect(trial.workspacePath).toContain(`/trials/plugin/${trial.owner.kind === "plugin" ? trial.owner.plugin : "standalone"}/skill/${trial.skill}/case/1/target/codex/workspace`);
    expect(await readFile(cachePath(root, xdg, trial.promptPath), "utf8")).toBe(prompt);
    expect(trial.stdoutPath).toBeUndefined();
    expect(trial.finalMessagePath).toBeUndefined();
  }
});

test("SET-387: provider infrastructure failures and cancellation stay distinct from completed trials", async () => {
  const root = await evalFixture();
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };
  const missing = await runSkillsetEvals(root, {
    env: { ...process.env, SKILLSET_TEST_CODEX_BIN: join(root, "bin", "missing") },
    xdg,
  });
  expect(missing.trials[0]).toMatchObject({
    classification: "infrastructure_failure",
    failureClass: "binary",
  });

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  const cancelled = await runSkillsetEvals(root, {
    env: { ...process.env, SKILLSET_TEST_CODEX_BIN: await sleepingCodexBin(root) },
    signal: controller.signal,
    xdg,
  });
  expect(cancelled.trials[0]).toMatchObject({
    classification: "infrastructure_failure",
    failureClass: "cancelled",
  });
});

test("SET-387: concurrent eval stdout and stderr retain unique monotonic event sequences", async () => {
  const root = await evalFixture();
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };
  const report = await runSkillsetEvals(root, {
    env: { ...process.env, SKILLSET_TEST_CODEX_BIN: await interleavedCodexBin(root) },
    xdg,
  });
  const events = (await readFile(cachePath(root, xdg, report.tailPath), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { data: { stream: string }; sequence: number });
  const sequences = events.map((event) => event.sequence);

  expect(events.some((event) => event.data.stream === "stdout")).toBe(true);
  expect(events.some((event) => event.data.stream === "stderr")).toBe(true);
  expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
  expect(new Set(sequences).size).toBe(sequences.length);
});

test("SET-387: cancellation between trials preserves completed evidence and fails the run", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: eval-runtime\ncompile:\n  targets: [codex]\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo eval skill.\n---\n\nUse this skill.\n",
    ".skillset/skills/demo/evals/evals.json": JSON.stringify({
      skill_name: "demo",
      evals: [
        { expected_output: "Ungraded first.", id: 1, prompt: "first" },
        { expected_output: "Ungraded second.", id: 2, prompt: "second" },
      ],
    }),
  });
  const marker = join(root, "first-complete");
  const controller = new AbortController();
  const run = runSkillsetEvals(root, {
    env: { ...process.env, EVAL_MARKER: marker, SKILLSET_TEST_CODEX_BIN: await betweenTrialCodexBin(root) },
    signal: controller.signal,
    xdg: { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } },
  });
  const markerDeadline = Date.now() + 1_000;
  while (!await Bun.file(marker).exists() && Date.now() < markerDeadline) await Bun.sleep(5);
  expect(await Bun.file(marker).exists()).toBe(true);
  await Bun.sleep(30);
  controller.abort();
  const report = await run;
  expect(report).toMatchObject({ state: "failed" });
  expect(report.trials[0]).toMatchObject({ classification: "completed", evalId: 1 });
  if (report.trials[1] !== undefined) {
    expect(report.trials[1]).toMatchObject({ classification: "infrastructure_failure", failureClass: "cancelled" });
  } else {
    expect(await readFile(cachePath(root, { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } }, report.reportPath), "utf8")).toContain('"failureClass":"cancelled"');
  }
});

test("SET-387: an empty eval matrix fails instead of completing vacuously", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: empty-eval-runtime\ncompile:\n  targets: [codex]\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Skill without eval declarations.\n---\n\nUse this skill.\n",
  });
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };

  const report = await runSkillsetEvals(root, { xdg });

  expect(report).toMatchObject({ state: "failed", trials: [] });
  expect(await readSkillsetEvalStatus(root, report.runId, { xdg })).toMatchObject({
    state: "failed",
  });
});

test("SET-387: a later setup failure preserves completed trial evidence", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: retained-eval-failure\ncompile:\n  targets: [codex]\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Retained failure fixture.\n---\n\nUse this skill.\n",
    ".skillset/skills/demo/evals/evals.json": JSON.stringify({
      skill_name: "demo",
      evals: [
        { expected_output: "Ungraded first.", id: 1, prompt: "first" },
        { expected_output: "Ungraded second.", id: 2, prompt: "second" },
      ],
    }),
  });
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };
  const report = await runSkillsetEvals(root, {
    env: {
      ...process.env,
      SKILLSET_TEST_CODEX_BIN: await laterTrialSetupFailureBin(root),
    },
    xdg,
  });

  expect(report).toMatchObject({
    state: "failed",
    trials: [expect.objectContaining({ classification: "completed", evalId: 1 })],
  });
  const retained = JSON.parse(
    await readFile(cachePath(root, xdg, report.reportPath), "utf8")
  ) as { trials: readonly { evalId: number }[] };
  expect(retained.trials.map((trial) => trial.evalId)).toEqual([1]);
});

test("SET-387: target rendering failures are retained as render infrastructure evidence", async () => {
  const root = await fixture({
    "skillset.yaml": "skillset:\n  name: eval-render-failure\ncodex: true\n",
    ".skillset/plugins/demo/skillset.yaml": "skillset:\n  name: demo\nbin: true\n",
    ".skillset/plugins/demo/skills/helper/SKILL.md": "---\nname: helper\ndescription: Render failure fixture.\n---\n\nBody.\n",
    ".skillset/plugins/demo/skills/helper/evals/evals.json": JSON.stringify({
      skill_name: "helper",
      evals: [{ expected_output: "Ungraded.", id: 1, prompt: "Never run." }],
    }),
    ".skillset/plugins/demo/bin/tool": "#!/bin/sh\n",
  });
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };
  const report = await runSkillsetEvals(root, {
    env: { ...process.env, SKILLSET_TEST_CODEX_BIN: join(root, "must-not-run") },
    xdg,
  });
  expect(report).toMatchObject({ state: "failed", trials: [] });
  expect(
    (JSON.parse(await readFile(cachePath(root, xdg, report.reportPath), "utf8")) as { failureClass?: string }).failureClass,
  ).toBe("render");
});

test("SET-387: retained eval lookups reject traversal-shaped run ids", async () => {
  const root = await evalFixture();
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };

  await expect(readSkillsetEvalStatus(root, "../outside", { xdg })).rejects.toThrow("single portable path segment");
  await expect(tailSkillsetEvalRun(root, "../outside", 10, { xdg })).rejects.toThrow("single portable path segment");
});

test("SET-387: retained eval status rejects malformed records", async () => {
  const root = await evalFixture();
  const xdg = { env: { XDG_CACHE_HOME: join(root, "xdg-cache") } };
  const report = await runSkillsetEvals(root, {
    env: { ...process.env, SKILLSET_TEST_CODEX_BIN: await fakeCodexBin(root) },
    xdg,
  });
  await writeFile(cachePath(root, xdg, report.statusPath), JSON.stringify({ kind: "eval", state: "completed" }), "utf8");

  await expect(readSkillsetEvalStatus(root, report.runId, { xdg })).rejects.toThrow("eval status is malformed");
});

async function evalFixture(): Promise<string> {
  return fixture({
    "skillset.yaml": "skillset:\n  name: eval-runtime\ncompile:\n  targets: [codex]\n",
    ".skillset/skills/demo/SKILL.md": "---\nname: demo\ndescription: Demo eval skill.\n---\n\nUse this skill.\n",
    ".skillset/skills/demo/evals/evals.json": JSON.stringify({
      skill_name: "demo",
      evals: [{ expected_output: "Ungraded.", id: 1, prompt: "Run the eval." }],
    }),
  });
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-eval-runner-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return root;
}

async function fakeCodexBin(root: string): Promise<string> {
  return executable(root, "fake-codex", "#!/bin/sh\nlast=\"\"\nprev=\"\"\nfor arg in \"$@\"; do\n  if [ \"$prev\" = \"--output-last-message\" ]; then last=\"$arg\"; fi\n  prev=\"$arg\"\ndone\ncat >/dev/null\nprintf 'fake final\\n' > \"$last\"\nprintf '{\"model\":\"fake-codex\",\"usage\":{\"total_tokens\":7},\"tool_calls\":[]}\\n'\n");
}

async function fakeClaudeBin(root: string): Promise<string> {
  return executable(root, "fake-claude", "#!/bin/sh\nprintf '{\"model\":\"fake-claude\",\"usage\":{\"total_tokens\":5}}\\n'\n");
}

async function capturingCodexBin(root: string): Promise<string> {
  return executable(root, "capturing-codex", "#!/bin/sh\nlast=\"\"\nprev=\"\"\nfor arg in \"$@\"; do\n  if [ \"$prev\" = \"--output-last-message\" ]; then last=\"$arg\"; fi\n  prev=\"$arg\"\ndone\ninput=\"$(cat)\"\nprintf '%s\\n' \"$input\" > \"$last\"\nprintf '%s\\n' \"$input\"\n");
}

async function sleepingCodexBin(root: string): Promise<string> {
  return executable(root, "sleeping-codex", "#!/bin/sh\nsleep 1\n");
}

async function interleavedCodexBin(root: string): Promise<string> {
  return executable(root, "interleaved-codex", "#!/bin/sh\nprintf 'stdout one\\n'\nprintf 'stderr one\\n' >&2\nprintf 'stdout two\\n'\nprintf 'stderr two\\n' >&2\n");
}

async function betweenTrialCodexBin(root: string): Promise<string> {
  return executable(root, "between-trial-codex", "#!/bin/sh\ninput=\"$(cat)\"\nif [ \"$input\" = first ]; then\n  touch \"$EVAL_MARKER\"\n  exit 0\nfi\nsleep 1\n");
}

async function laterTrialSetupFailureBin(root: string): Promise<string> {
  return executable(
    root,
    "later-trial-setup-failure",
    "#!/bin/sh\ninput=\"$(cat)\"\nif [ \"$input\" = first ]; then\n  collision=\"../../../../2/target/codex/workspace\"\n  mkdir -p \"$(dirname \"$collision\")\"\n  touch \"$collision\"\nfi\n"
  );
}

async function executable(root: string, name: string, content: string): Promise<string> {
  const path = join(root, "bin", name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
  return path;
}

function cachePath(root: string, xdg: { readonly env: { readonly XDG_CACHE_HOME: string } }, logicalPath: string): string {
  return resolveOperationalPath(createOperationalPathContext(root, { env: xdg.env }), logicalPath);
}
