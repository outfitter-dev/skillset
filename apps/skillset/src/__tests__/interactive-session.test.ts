import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";

import { promptForInitAdoption, runInitCommand } from "../init-cli";
import {
  createInteractiveSession,
  interactiveSessionEligible,
} from "../interactive-session";
import {
  InquirerPromptAdapter,
  normalizePromptError,
  PromptCancelledError,
  ScriptedPromptAdapter,
} from "../prompt-adapter";

const ttyInput = (): PassThrough & { isTTY: true } =>
  Object.assign(new PassThrough(), { isTTY: true as const });
const ttyOutput = (): PassThrough & { isTTY: true } =>
  Object.assign(new PassThrough(), { isTTY: true as const });
const interactiveEnv = { CI: "false" } as const;

describe("SET-291 interactive session eligibility", () => {
  test("requires interactive input and output", () => {
    expect(
      interactiveSessionEligible({
        env: interactiveEnv,
        input: ttyInput(),
        output: ttyOutput(),
      })
    ).toBe(true);
    expect(
      interactiveSessionEligible({
        input: new PassThrough(),
        output: ttyOutput(),
      })
    ).toBe(false);
    expect(
      interactiveSessionEligible({
        input: ttyInput(),
        output: new PassThrough(),
      })
    ).toBe(false);
  });

  test("excludes machine, CI, and raw protocol execution", () => {
    const streams = { input: ttyInput(), output: ttyOutput() };
    expect(interactiveSessionEligible({ ...streams, machineMode: true })).toBe(
      false
    );
    expect(interactiveSessionEligible({ ...streams, rawProtocol: true })).toBe(
      false
    );
    expect(
      interactiveSessionEligible({ ...streams, env: { CI: "true" } })
    ).toBe(false);
    expect(
      interactiveSessionEligible({ ...streams, env: { CI: "false" } })
    ).toBe(true);
  });
});

describe("SET-291 prompt adapters", () => {
  test("scripted prompts are deterministic and record display contracts", async () => {
    const adapter = new ScriptedPromptAdapter([
      { kind: "input", value: "demo" },
      { kind: "confirm", value: false },
      { kind: "select", value: "one" },
      { kind: "search", value: "two" },
      { kind: "checkbox", value: ["one", "two"] },
    ]);

    await expect(adapter.input({ message: "Name:" })).resolves.toBe("demo");
    await expect(
      adapter.confirm({ default: false, message: "Proceed?" })
    ).resolves.toBe(false);
    await expect(
      adapter.select({
        choices: [{ name: "One", value: "one" }],
        message: "Choose:",
      })
    ).resolves.toBe("one");
    await expect(
      adapter.search({
        message: "Find:",
        source: () => [{ name: "Two", value: "two" }],
      })
    ).resolves.toBe("two");
    await expect(
      adapter.checkbox({
        choices: [
          { name: "One", value: "one" },
          { name: "Two", value: "two" },
        ],
        message: "Include:",
      })
    ).resolves.toEqual(["one", "two"]);
    adapter.assertComplete();
    expect(adapter.prompts).toHaveLength(5);
    expect(adapter.prompts[1]).toEqual({
      kind: "confirm",
      prompt: { default: false, message: "Proceed?" },
    });
  });

  test("scripted prompts fail loudly on order and unused-answer drift", async () => {
    const wrongOrder = new ScriptedPromptAdapter([
      { kind: "confirm", value: false },
    ]);
    await expect(wrongOrder.input({ message: "Name:" })).rejects.toThrow(
      "expected confirm, received input"
    );

    const unused = new ScriptedPromptAdapter([
      { kind: "input", value: "demo" },
    ]);
    expect(() => unused.assertComplete()).toThrow("1 unused answer");
  });

  test("Inquirer cancellation and abort errors become one controlled error", () => {
    for (const name of [
      "AbortPromptError",
      "CancelPromptError",
      "ExitPromptError",
    ]) {
      const error = new Error("internal details");
      error.name = name;
      expect(() => normalizePromptError(error)).toThrow(PromptCancelledError);
      expect(() => normalizePromptError(error)).toThrow(
        "skillset: interactive prompt cancelled"
      );
    }
  });

  test("the real adapter normalizes an aborted prompt", async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = new InquirerPromptAdapter({
      input: ttyInput(),
      output: ttyOutput(),
      signal: controller.signal,
    });

    await expect(adapter.input({ message: "Name:" })).rejects.toThrow(
      PromptCancelledError
    );
  });

  test("the CLI reports controlled cancellation with exit 130", async () => {
    const cliCoreUrl = pathToFileURL(join(import.meta.dir, "../cli-core.ts")).href;
    const promptAdapterUrl = pathToFileURL(
      join(import.meta.dir, "../prompt-adapter.ts")
    ).href;
    const proc = Bun.spawn([
      process.execPath,
      "-e",
      `import { reportCliError } from ${JSON.stringify(cliCoreUrl)}; import { PromptCancelledError } from ${JSON.stringify(promptAdapterUrl)}; reportCliError(new PromptCancelledError());`,
    ], {
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(await proc.exited).toBe(130);
    expect(await new Response(proc.stderr).text()).toBe(
      "skillset: interactive prompt cancelled\n"
    );
  });

  test("sessions route banner and prompts through injected streams", () => {
    const input = ttyInput();
    const output = ttyOutput();
    const adapter = new ScriptedPromptAdapter([]);
    const session = createInteractiveSession({
      adapter,
      env: interactiveEnv,
      input,
      output,
    });

    expect(session).toBeDefined();
    session?.banner();
    session?.write("Plan\n");
    expect(output.read()?.toString()).toMatch(
      /^Skillset v\d+\.\d+\.\d+\n\nPlan\n$/u
    );
  });

  test("the migrated init adoption flow preserves selection and default-No confirmation", async () => {
    const input = ttyInput();
    const output = ttyOutput();
    const adapter = new ScriptedPromptAdapter([
      { kind: "input", value: "all" },
      { kind: "confirm", value: false },
    ]);
    const session = createInteractiveSession({
      adapter,
      env: interactiveEnv,
      input,
      output,
    });
    if (session === undefined) throw new Error("expected interactive session");

    await expect(
      promptForInitAdoption(
        [
          { kind: "instructions", path: "AGENTS.md" },
          { kind: "skill", path: ".agents/skills/review" },
        ],
        session
      )
    ).resolves.toEqual({
      candidates: ["instructions:AGENTS.md", "skill:.agents/skills/review"],
      confirmed: false,
    });
    adapter.assertComplete();
    expect(adapter.prompts).toHaveLength(2);
    expect(adapter.prompts[0]).toEqual({
      kind: "input",
      prompt: expect.objectContaining({
        default: "none",
        message: "Adopt all, comma-separated candidate ids, or none:",
      }),
    });
    const inputPrompt = adapter.prompts[0];
    if (
      inputPrompt?.kind !== "input" ||
      inputPrompt.prompt.validate === undefined
    ) {
      throw new Error("expected init input validation");
    }
    expect(await inputPrompt.prompt.validate("missing:path")).toBe(
      "skillset: unknown adoption candidate missing:path"
    );
    expect(await inputPrompt.prompt.validate("all")).toBe(true);
    expect(adapter.prompts[1]).toEqual({
      kind: "confirm",
      prompt: {
        default: false,
        message: "Write init plan (2 adoption candidate(s))?",
      },
    });
    expect(output.read()?.toString()).toContain(
      "skillset: detected adoptable sources\n  instructions:AGENTS.md\n"
    );
  });

  test("the init orchestration boundary previews then leaves default-No repositories untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-interactive-init-"));
    await writeFile(join(root, "AGENTS.md"), "# Existing instructions\n");
    const adapter = new ScriptedPromptAdapter([
      { kind: "input", value: "all" },
      { kind: "confirm", value: false },
    ]);
    const session = createInteractiveSession({
      adapter,
      env: interactiveEnv,
      input: ttyInput(),
      output: ttyOutput(),
    });
    if (session === undefined) throw new Error("expected interactive session");

    await runInitCommand(
      {
        destination: undefined,
        importName: undefined,
        initAdopt: undefined,
        initFrom: undefined,
        jsonOutput: false,
        options: {},
        rootExplicit: true,
        rootPath: root,
        setupIncludes: undefined,
        setupTargets: undefined,
        yes: false,
      },
      { interactiveSession: session }
    );

    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual([
      "input",
      "confirm",
    ]);
    expect(await readdir(root)).toEqual(["AGENTS.md"]);
  });

  test("explicit init adoption bypasses an injected interactive session", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-explicit-init-"));
    await writeFile(join(root, "AGENTS.md"), "# Existing instructions\n");
    const adapter = new ScriptedPromptAdapter([]);
    const session = createInteractiveSession({
      adapter,
      env: interactiveEnv,
      input: ttyInput(),
      output: ttyOutput(),
    });
    if (session === undefined) throw new Error("expected interactive session");

    await runInitCommand(
      {
        destination: undefined,
        importName: undefined,
        initAdopt: ["instructions:AGENTS.md"],
        initFrom: undefined,
        jsonOutput: false,
        options: {},
        rootExplicit: true,
        rootPath: root,
        setupIncludes: undefined,
        setupTargets: undefined,
        yes: false,
      },
      { interactiveSession: session }
    );

    adapter.assertComplete();
    expect(adapter.prompts).toEqual([]);
    expect(await readdir(root)).toEqual(["AGENTS.md"]);
  });

  test("machine init bypasses an injected interactive session", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-machine-init-"));
    await writeFile(join(root, "AGENTS.md"), "# Existing instructions\n");
    const adapter = new ScriptedPromptAdapter([]);
    const session = createInteractiveSession({
      adapter,
      env: interactiveEnv,
      input: ttyInput(),
      output: ttyOutput(),
    });
    if (session === undefined) throw new Error("expected interactive session");

    await runInitCommand(
      {
        destination: undefined,
        importName: undefined,
        initAdopt: undefined,
        initFrom: undefined,
        jsonOutput: true,
        options: {},
        rootExplicit: true,
        rootPath: root,
        setupIncludes: undefined,
        setupTargets: undefined,
        yes: false,
      },
      { interactiveSession: session }
    );

    adapter.assertComplete();
    expect(adapter.prompts).toEqual([]);
    expect(await readdir(root)).toEqual(["AGENTS.md"]);
  });
});
