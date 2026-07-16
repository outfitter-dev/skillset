import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { createInteractiveSession } from "../interactive-session";
import { PromptCancelledError, ScriptedPromptAdapter } from "../prompt-adapter";
import { initSkillset } from "../setup";
import { runTestCommand, type TestCommandRequest } from "../test-cli";
import { resolveInteractiveTestSelection } from "../test-interactive";
import {
  listSkillsetTests,
  runAllSkillsetTests,
  runSkillsetTest,
} from "../test-runner";

const ttyInput = (): PassThrough & { isTTY: true } =>
  Object.assign(new PassThrough(), { isTTY: true as const });
const ttyOutput = (): PassThrough & { isTTY: true } =>
  Object.assign(new PassThrough(), { isTTY: true as const });

function scriptedSession(
  answers: ConstructorParameters<typeof ScriptedPromptAdapter>[0]
) {
  const adapter = new ScriptedPromptAdapter(answers);
  const session = createInteractiveSession({
    adapter,
    env: { CI: "false" },
    input: ttyInput(),
    output: ttyOutput(),
  });
  if (session === undefined) throw new Error("expected interactive session");
  return { adapter, session };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-test-interactive-"));
  await initSkillset({ cwd: root, rootPath: root, write: true });
  await mkdir(join(root, ".skillset/skills/demo"), { recursive: true });
  await writeFile(
    join(root, ".skillset/skills/demo/SKILL.md"),
    `---
name: demo
description: Demo test skill.
---

# Demo
`
  );
  return root;
}

async function writeDeclarations(
  root: string,
  names: readonly string[],
  failing: ReadonlySet<string> = new Set()
): Promise<void> {
  const content = names
    .map(
      (name) => `${name}:
  select:
    skills:
      primary: ["demo"]
  checks:
${
  failing.has(name)
    ? "    files:\n      - path: .claude/skills/demo/MISSING.md"
    : "    projection: true"
}
`
    )
    .join("");
  await writeFile(join(root, ".skillset/tests.yaml"), content);
}

function request(
  rootPath: string,
  overrides: Partial<TestCommandRequest> = {}
): TestCommandRequest {
  return {
    jsonOutput: false,
    options: {},
    rootPath,
    testName: undefined,
    tryBackground: false,
    tryClaudeSettingSources: undefined,
    tryLines: undefined,
    tryName: undefined,
    tryPlugins: [],
    tryPrompt: undefined,
    tryPromptFile: undefined,
    tryRunId: undefined,
    trySubcommand: undefined,
    tryTarget: undefined,
    tryTimeoutMs: undefined,
    ...overrides,
  };
}

describe("SET-294 canonical declared test inventory", () => {
  test("zero declarations list cleanly for the ad hoc-only chooser", async () => {
    const root = await workspace();
    expect(await listSkillsetTests(root)).toEqual([]);
    await expect(runSkillsetTest(root, undefined)).rejects.toThrow(
      "must include tests.yaml or tests/*.yaml for skillset test"
    );
  });

  test("aggregate and split declarations share canonical parsing and order", async () => {
    const root = await workspace();
    await writeDeclarations(root, ["zeta"]);
    await mkdir(join(root, ".skillset/tests"), { recursive: true });
    await writeFile(
      join(root, ".skillset/tests/alpha.yaml"),
      `select:
  skills:
    primary: ["demo"]
targets: [codex, claude]
checks:
  projection: true
`
    );

    expect(await listSkillsetTests(root)).toEqual([
      { name: "alpha", targets: ["codex", "claude"] },
      { name: "zeta", targets: ["claude", "codex", "cursor"] },
    ]);
  });

  test("listing and execution reject duplicate and reserved declarations identically", async () => {
    const duplicate = await workspace();
    await writeDeclarations(duplicate, ["alpha"]);
    await mkdir(join(duplicate, ".skillset/tests"), { recursive: true });
    await writeFile(
      join(duplicate, ".skillset/tests/alpha.yaml"),
      "checks:\n  projection: true\n"
    );
    for (const operation of [
      () => listSkillsetTests(duplicate),
      () => runSkillsetTest(duplicate, "alpha"),
    ]) {
      await expect(operation()).rejects.toThrow("duplicate test alpha");
    }

    const reserved = await workspace();
    await writeDeclarations(reserved, ["list"]);
    for (const operation of [
      () => listSkillsetTests(reserved),
      () => runSkillsetTest(reserved, "list"),
    ]) {
      await expect(operation()).rejects.toThrow(
        "test name list is reserved for the retained-run lifecycle"
      );
    }
  });

  test("explicit execution preserves its named-declaration validation boundary", async () => {
    const root = await workspace();
    await writeFile(
      join(root, ".skillset/tests.yaml"),
      `alpha:
  select:
    skills:
      primary: ["demo"]
  checks:
    projection: true
zeta:
  unexpected: true
`
    );

    await expect(runSkillsetTest(root, "alpha")).resolves.toMatchObject({
      name: "alpha",
      ok: true,
    });
    await expect(listSkillsetTests(root)).rejects.toThrow("unexpected");
  });

  test("run all keeps canonical order and continues after an ordinary failed report", async () => {
    const root = await workspace();
    await writeDeclarations(root, ["zeta", "alpha"], new Set(["alpha"]));

    const suite = await runAllSkillsetTests(root);

    expect(suite.ok).toBe(false);
    expect(suite.reports.map((report) => [report.name, report.ok])).toEqual([
      ["alpha", false],
      ["zeta", true],
    ]);
    expect(
      suite.reports.every((report) => report.runPath.includes("runs/"))
    ).toBe(true);
  });
});

describe("SET-294 unified interactive test chooser", () => {
  test("zero declarations offer only ad hoc and construct current single-target runtime inputs", async () => {
    const root = await workspace();
    const { adapter, session } = scriptedSession([
      { kind: "select", value: { kind: "ad-hoc" } },
      { kind: "input", value: "Inspect the available guidance." },
      { kind: "select", value: "codex" },
      { kind: "select", value: false },
    ]);

    await expect(
      resolveInteractiveTestSelection({ options: {}, rootPath: root }, session)
    ).resolves.toEqual({
      background: false,
      kind: "ad-hoc",
      prompt: "Inspect the available guidance.",
      target: "codex",
    });
    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual([
      "select",
      "input",
      "select",
      "select",
    ]);
    const chooser = adapter.prompts[0];
    if (chooser?.kind !== "select") throw new Error("expected test chooser");
    expect(chooser.prompt.choices.map((choice) => choice.name)).toEqual([
      "Ad hoc test",
    ]);
  });

  test("one chooser contains all, each declaration, and ad hoc without redundant target prompts", async () => {
    const root = await workspace();
    await writeDeclarations(root, ["alpha"]);
    const { adapter, session } = scriptedSession([
      { kind: "select", value: { kind: "declared", name: "alpha" } },
    ]);

    await expect(
      resolveInteractiveTestSelection({ options: {}, rootPath: root }, session)
    ).resolves.toEqual({ kind: "declared", name: "alpha" });
    adapter.assertComplete();
    expect(adapter.prompts).toHaveLength(1);
    const chooser = adapter.prompts[0];
    if (chooser?.kind !== "select") throw new Error("expected test chooser");
    expect(chooser.prompt.choices.map((choice) => choice.name)).toEqual([
      "All tests",
      "alpha",
      "Ad hoc test",
    ]);
    expect(chooser.prompt.choices[1]?.description).toBe(
      "Targets: claude, codex, cursor"
    );
  });

  test("many declarations use search while retaining both actions during filtering", async () => {
    const root = await workspace();
    const names = Array.from({ length: 8 }, (_, index) => `test-${index}`);
    await writeDeclarations(root, names);
    const { adapter, session } = scriptedSession([
      { kind: "search", value: { kind: "declared", name: "test-7" } },
    ]);

    await expect(
      resolveInteractiveTestSelection({ options: {}, rootPath: root }, session)
    ).resolves.toEqual({ kind: "declared", name: "test-7" });
    adapter.assertComplete();
    const chooser = adapter.prompts[0];
    if (chooser?.kind !== "search") throw new Error("expected search chooser");
    const filtered = await chooser.prompt.source("test-7", {
      signal: new AbortController().signal,
    });
    expect(filtered.map((choice) => choice.name)).toEqual([
      "All tests",
      "test-7",
      "Ad hoc test",
    ]);
  });

  test("cancellation remains controlled before any retained run starts", async () => {
    const root = await workspace();
    const controller = new AbortController();
    controller.abort();
    const session = createInteractiveSession({
      env: { CI: "false" },
      input: ttyInput(),
      output: ttyOutput(),
      signal: controller.signal,
    });
    if (session === undefined) throw new Error("expected interactive session");

    await expect(
      resolveInteractiveTestSelection({ options: {}, rootPath: root }, session)
    ).rejects.toThrow(PromptCancelledError);
  });

  test("the bare command runs the all selection through canonical retained executions", async () => {
    const root = await workspace();
    await writeDeclarations(root, ["zeta", "alpha"]);
    const { adapter, session } = scriptedSession([
      { kind: "select", value: { kind: "all" } },
    ]);

    await runTestCommand(request(root), { interactiveSession: session });

    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual(["select"]);
  });

  test("explicit, machine, lifecycle, and worker requests bypass an injected session", async () => {
    const root = await workspace();
    await writeDeclarations(root, ["alpha", "zeta"]);
    const { adapter, session } = scriptedSession([]);

    await runTestCommand(request(root, { testName: "alpha" }), {
      interactiveSession: session,
    });
    await runTestCommand(request(root, { trySubcommand: "list" }), {
      interactiveSession: session,
    });
    await expect(
      runTestCommand(request(root, { tryTarget: "codex" }), {
        interactiveSession: session,
      })
    ).rejects.toThrow("ad hoc test requires --prompt or --prompt-file");
    await expect(
      runTestCommand(request(root, { jsonOutput: true }), {
        interactiveSession: session,
      })
    ).rejects.toThrow("multiple tests configured");
    await expect(
      runTestCommand(request(root, { trySubcommand: "worker" }), {
        interactiveSession: session,
      })
    ).rejects.toThrow("test worker requires run id");

    adapter.assertComplete();
    expect(adapter.prompts).toEqual([]);
  });

  test("CI and non-TTY bare CLI requests keep the non-interactive contract", async () => {
    const root = await workspace();
    await writeDeclarations(root, ["alpha", "zeta"]);

    for (const env of [process.env, { ...process.env, CI: "true" }]) {
      const result = await runCli(["test", "--root", root], env);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("multiple tests configured");
      expect(result.stdout).not.toContain("Run tests:");
    }
  });
});

async function runCli(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const process = Bun.spawn(
    ["bun", join(import.meta.dir, "..", "cli.ts"), ...args],
    {
      env,
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);
  return { exitCode, stderr, stdout };
}
