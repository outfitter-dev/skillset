import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { cliErrorExitCode } from "../cli-core";
import { runInitCommand } from "../init-cli";
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

const waitForOutput = async (
  output: PassThrough,
  pattern: RegExp
): Promise<string> =>
  new Promise((resolve, reject) => {
    let rendered = "";
    const onData = (chunk: Buffer): void => {
      rendered += chunk.toString();
      if (pattern.test(rendered)) {
        cleanup();
        resolve(rendered);
      }
    };
    const onEnd = (): void => {
      cleanup();
      reject(new Error(`output ended before ${pattern.source} rendered`));
    };
    const cleanup = (): void => {
      output.off("data", onData);
      output.off("end", onEnd);
    };
    output.on("data", onData);
    output.on("end", onEnd);
  });

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
      { kind: "search-checkbox", value: ["two"] },
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
      adapter.searchCheckbox({
        choices: [
          { name: "One", value: "one" },
          { name: "Two", value: "two" },
        ],
        message: "Find and include:",
        source: (term, choices) =>
          choices.filter((choice) => choice.name.includes(term ?? "")),
      })
    ).resolves.toEqual(["two"]);
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
    expect(adapter.prompts).toHaveLength(6);
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
    await expect(
      adapter.searchCheckbox({
        choices: [{ name: "One", value: "one" }],
        message: "Include:",
        source: (_term, choices) => choices,
      })
    ).rejects.toThrow(PromptCancelledError);
  });

  test("the real searchable checkbox filters, persists selections, and skips disabled choices", async () => {
    const input = ttyInput();
    const output = ttyOutput();
    let transcript = "";
    output.on("data", (chunk: Buffer) => {
      transcript += chunk.toString();
    });
    const adapter = new InquirerPromptAdapter({ input, output });
    const choices = [
      { checked: true, name: "All", value: "all" },
      { name: "Alpha", value: "alpha" },
      { disabled: "unavailable", name: "Disabled", value: "disabled" },
      { name: "Beta", value: "beta" },
    ] as const;
    const result = adapter.searchCheckbox({
      choices,
      message: "Include:",
      source: (term, available) => {
        const query = term?.toLowerCase().split("/").at(-1) ?? "";
        return available.filter(
          (choice) =>
            choice.value === "all" || choice.name.toLowerCase().includes(query)
        );
      },
    });

    await waitForOutput(output, /Include:/u);
    const disabledRendered = waitForOutput(output, /Disabled unavailable/u);
    input.write("disabled");
    expect(await disabledRendered).toContain("Disabled unavailable");
    const writeText = async (text: string): Promise<void> => {
      for (const key of text) {
        input.write(key);
        await Bun.sleep(1);
      }
    };
    const pressKey = async (name: string, sequence: string): Promise<void> => {
      input.emit("keypress", sequence, {
        ctrl: false,
        meta: false,
        name,
        sequence,
        shift: false,
      });
      await Bun.sleep(1);
    };
    await pressKey("down", "\u001b[B");
    await pressKey("space", " ");
    await writeText("/alpha");
    await pressKey("down", "\u001b[B");
    await pressKey("space", " ");
    await writeText("/beta");
    await pressKey("down", "\u001b[B");
    await pressKey("space", " ");
    input.write("\r");

    const selected = await result;
    expect(selected).toEqual(["alpha", "beta"]);
    expect(Bun.stripANSI(transcript)).toContain("Disabled unavailable");
  });

  test("the real searchable checkbox normalizes cancellation after rendering", async () => {
    const input = ttyInput();
    const output = ttyOutput();
    const adapter = new InquirerPromptAdapter({ input, output });
    const result = adapter.searchCheckbox({
      choices: [{ name: "One", value: "one" }],
      message: "Include:",
      source: (_term, choices) => choices,
    });

    await waitForOutput(output, /Include:/u);
    input.write("\u0003");

    await expect(result).rejects.toThrow(PromptCancelledError);
  });

  test("the CLI reports controlled cancellation with exit 130", () => {
    const error = new PromptCancelledError();
    expect(cliErrorExitCode(error)).toBe(130);
    expect(error.message).toBe("skillset: interactive prompt cancelled");
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

  test("the init orchestration boundary previews then leaves default-No repositories untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-interactive-init-"));
    await writeFile(join(root, "AGENTS.md"), "# Existing instructions\n");
    const adapter = new ScriptedPromptAdapter([
      { kind: "checkbox", value: ["all"] },
      { kind: "checkbox", value: ["claude", "codex", "cursor"] },
      { kind: "checkbox", value: ["ci"] },
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
      "checkbox",
      "checkbox",
      "checkbox",
      "confirm",
    ]);
    expect(await readdir(root)).toEqual(["AGENTS.md"]);
  });

  test("explicit adoption skips the matching prompt but collects missing choices", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-explicit-init-"));
    await writeFile(join(root, "AGENTS.md"), "# Existing instructions\n");
    const adapter = new ScriptedPromptAdapter([
      { kind: "checkbox", value: ["claude", "codex"] },
      { kind: "checkbox", value: [] },
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
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual([
      "checkbox",
      "checkbox",
      "confirm",
    ]);
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
