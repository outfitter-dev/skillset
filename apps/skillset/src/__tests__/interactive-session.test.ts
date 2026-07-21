import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { cliErrorExitCode } from "../cli-core";
import { runInitCommand } from "../init-cli";
import {
  confirmProceed,
  createInteractiveSession,
  interactiveSessionEligible,
} from "../interactive-session";
import {
  ClackPromptAdapter,
  normalizePromptError,
  PromptCancelledError,
  ScriptedPromptAdapter,
} from "../prompt-adapter";
import { runRealPromptProcess } from "./real-prompt-process";

const ttyInput = (): PassThrough & { isTTY: true } =>
  Object.assign(new PassThrough(), { isTTY: true as const });
const ttyOutput = (
  columns = 80
): PassThrough & { columns: number; isTTY: true; rows: number } =>
  Object.assign(new PassThrough(), {
    columns,
    isTTY: true as const,
    rows: 24,
  });
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
  test("SET-341 shared confirmation is exact and defaults to no", async () => {
    const adapter = new ScriptedPromptAdapter([
      { kind: "confirm", value: false },
    ]);
    const session = createInteractiveSession({
      adapter,
      env: interactiveEnv,
      input: ttyInput(),
      output: ttyOutput(),
    });

    expect(session).toBeDefined();
    if (session === undefined) {
      throw new Error("expected interactive session");
    }
    await expect(confirmProceed(session)).resolves.toBe(false);
    expect(adapter.prompts).toEqual([
      {
        kind: "confirm",
        prompt: { default: false, message: "Proceed?" },
      },
    ]);
  });

  test("scripted prompts are deterministic and record display contracts", async () => {
    const adapter = new ScriptedPromptAdapter([
      { kind: "input", value: "demo" },
      { kind: "confirm", value: false },
      { kind: "select", value: "one" },
      { kind: "search", value: "two" },
      { kind: "search-multiselect", value: ["two"] },
      { kind: "checkbox", value: ["one", "two"] },
      { kind: "group-checkbox", value: ["two"] },
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
    await expect(
      adapter.groupedCheckbox({
        groups: [{ choices: [{ name: "Two", value: "two" }], name: "Group" }],
        message: "Include by group:",
      })
    ).resolves.toEqual(["two"]);
    adapter.assertComplete();
    expect(adapter.prompts).toHaveLength(7);
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

  test("unrecognized prompt errors retain their original details", () => {
    const error = new Error("internal details");
    expect(() => normalizePromptError(error)).toThrow(error);
  });

  test("the real adapter normalizes an aborted prompt", async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = new ClackPromptAdapter({
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

  test("the real adapter maps defaults and initial choices for every prompt kind", async () => {
    const submit = async <Value>(
      run: (adapter: ClackPromptAdapter) => Promise<Value>
    ): Promise<Value> => {
      const input = ttyInput();
      const result = run(
        new ClackPromptAdapter({ input, output: ttyOutput() })
      );
      input.write("\r");
      return result;
    };
    const choices = [
      { name: "One", value: "one" },
      { checked: true, name: "Two", value: "two" },
    ] as const;

    await expect(
      submit((adapter) => adapter.input({ default: "demo", message: "Name:" }))
    ).resolves.toBe("demo");
    await expect(
      submit((adapter) =>
        adapter.confirm({ default: false, message: "Proceed?" })
      )
    ).resolves.toBe(false);
    await expect(
      submit((adapter) =>
        adapter.select({ choices, default: "two", message: "Choose:" })
      )
    ).resolves.toBe("two");
    await expect(
      submit((adapter) => adapter.checkbox({ choices, message: "Include:" }))
    ).resolves.toEqual(["two"]);
    await expect(
      submit((adapter) =>
        adapter.groupedCheckbox({
          groups: [{ choices, name: "Examples" }],
          message: "Include by group:",
        })
      )
    ).resolves.toEqual(["two"]);
    await expect(
      submit((adapter) =>
        adapter.search({
          default: "two",
          message: "Find:",
          source: () => choices,
        })
      )
    ).resolves.toBe("two");
    await expect(
      submit((adapter) =>
        adapter.searchCheckbox({
          choices,
          message: "Find and include:",
          source: (_term, available) => available,
        })
      )
    ).resolves.toEqual(["two"]);
  });

  test("the real adapter renders choice hints and disabled reasons", async () => {
    const child = await runRealPromptProcess("choice-hints");

    expect(child).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    expect(child.evidence?.globalStdout).toEqual({
      columns: null,
      columnsDefined: false,
      isTTY: false,
    });
    expect(child.evidence?.result).toBe("one");
    const transcript = child.evidence?.transcript ?? "";
    expect(Bun.stripANSI(transcript)).toContain("One (recommended)");
    expect(Bun.stripANSI(transcript)).toContain("Two (unavailable)");
    expect(transcript).toContain("\u001B[9mTwo\u001B[29m");
  });

  test("the real adapter preserves async validation and term-aware search", async () => {
    const validationInput = ttyInput();
    const validationOutput = ttyOutput();
    const validationAdapter = new ClackPromptAdapter({
      input: validationInput,
      output: validationOutput,
    });
    const validated = validationAdapter.input({
      default: "good",
      message: "Name:",
      validate: async (value) => value === "good",
    });
    validationInput.write("\r");
    await expect(validated).resolves.toBe("good");

    const searchInput = ttyInput();
    const searchAdapter = new ClackPromptAdapter({
      input: searchInput,
      output: ttyOutput(),
    });
    const terms: Array<string | undefined> = [];
    const searched = searchAdapter.search({
      default: "two",
      message: "Find:",
      source: (term) => {
        terms.push(term);
        const choices = [
          { name: "One", value: "one" },
          { name: "Two", value: "two" },
        ];
        return term === undefined
          ? choices
          : choices.filter((choice) =>
              choice.name.toLowerCase().includes(term.toLowerCase())
            );
      },
    });
    searchInput.write("two");
    searchInput.write("\r");
    await expect(searched).resolves.toBe("two");
    expect(terms).toContain("two");
  });

  test("the real adapter uses injected width and clears completed prompts on request", async () => {
    const input = ttyInput();
    const output = ttyOutput(24);
    let transcript = "";
    output.on("data", (chunk: Buffer) => {
      transcript += chunk.toString();
    });
    const adapter = new ClackPromptAdapter({
      clearPromptOnDone: true,
      input,
      output,
    });
    const result = adapter.confirm({
      default: false,
      message: "Keep this deliberately long prompt within the injected width?",
    });

    input.write("\r");

    await expect(result).resolves.toBe(false);
    const rendered = Bun.stripANSI(transcript);
    expect(
      rendered.split("\n").every((line) => Bun.stringWidth(line) <= 24)
    ).toBe(true);
    expect(transcript).toContain("\u001B[s");
    expect(transcript).toContain("\u001B[u\u001B[0J");
  });

  test("the real searchable checkbox filters, persists selections, and skips disabled choices", async () => {
    const child = await runRealPromptProcess("searchable-checkbox");

    expect(child).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
    expect(child.evidence?.globalStdout).toEqual({
      columns: null,
      columnsDefined: false,
      isTTY: false,
    });
    expect(child.evidence?.result).toEqual(["all"]);
    const transcript = Bun.stripANSI(child.evidence?.transcript ?? "");
    expect(transcript).toContain("Include:");
    expect(transcript).toContain("Disabled (unavailable)");
  });

  test("the real searchable checkbox selects across filters and rejects a disabled row", async () => {
    const input = ttyInput();
    const adapter = new ClackPromptAdapter({ input, output: ttyOutput() });
    const choices = [
      { name: "Alpha", value: "alpha" },
      { disabled: "unavailable", name: "Disabled", value: "disabled" },
      { name: "Beta", value: "beta" },
    ] as const;
    const result = adapter.searchCheckbox({
      choices,
      message: "Include:",
      source: (term, available) => {
        const query = term?.toLowerCase().split("/").at(-1) ?? "";
        return available.filter((choice) =>
          choice.name.toLowerCase().includes(query)
        );
      },
    });
    const type = async (value: string): Promise<void> => {
      for (const character of value) {
        input.write(character);
        await Bun.sleep(1);
      }
    };
    const selectFocused = (): void => {
      input.emit("keypress", undefined, {
        ctrl: false,
        meta: false,
        name: "tab",
        sequence: "\t",
        shift: false,
      });
    };

    await type("disabled");
    selectFocused();
    await type("/alpha");
    selectFocused();
    await type("/beta");
    selectFocused();
    input.write("\r");

    await expect(result).resolves.toEqual(["alpha", "beta"]);
  });

  test("the real searchable checkbox normalizes cancellation after rendering", async () => {
    const input = ttyInput();
    const output = ttyOutput();
    const adapter = new ClackPromptAdapter({ input, output });
    const result = adapter.searchCheckbox({
      choices: [{ name: "One", value: "one" }],
      message: "Include:",
      source: (_term, choices) => choices,
    });

    input.write("\u0003");

    await expect(result).rejects.toThrow(PromptCancelledError);
  });

  test("the CLI reports controlled cancellation with exit 130", () => {
    const error = new PromptCancelledError();
    expect(cliErrorExitCode(error)).toBe(130);
    expect(error.message).toBe("skillset: interactive prompt cancelled");
  });

  test("sessions render a lowercase intro with a dimmed version", () => {
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
    const rendered = output.read()?.toString() ?? "";
    expect(rendered).toContain("\u001b[2m");
    expect(Bun.stripANSI(rendered)).toMatch(
      /skillset v\d+\.\d+\.\d+\nPlan\n$/u
    );
  });

  test("sessions keep the intro version plain when color is disabled", () => {
    const output = ttyOutput();
    const session = createInteractiveSession({
      adapter: new ScriptedPromptAdapter([]),
      env: { ...interactiveEnv, NO_COLOR: "1" },
      input: ttyInput(),
      output,
    });

    session?.banner();
    const rendered = output.read()?.toString() ?? "";
    expect(rendered).not.toContain("\u001b[2m");
    expect(Bun.stripANSI(rendered)).toMatch(/skillset v\d+\.\d+\.\d+\n$/u);
  });

  test("the init orchestration boundary previews then leaves default-No repositories untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-interactive-init-"));
    await writeFile(join(root, "AGENTS.md"), "# Existing instructions\n");
    const adapter = new ScriptedPromptAdapter([
      { kind: "select", value: "all" },
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
        directory: undefined,
        initAdopt: undefined,
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
      "select",
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
        directory: undefined,
        initAdopt: ["instructions:AGENTS.md"],
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
        directory: undefined,
        initAdopt: undefined,
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
