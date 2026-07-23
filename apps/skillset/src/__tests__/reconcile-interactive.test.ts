import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";

import {
  createInteractiveSession,
  type InteractiveSession,
} from "../interactive-session";
import {
  runReconcileCommand,
  type ReconcileCommandContext,
  type ReconcileCommandRequest,
} from "../recovery-cli";
import {
  reconcileChoiceAvailable,
  reconcileDirectionChoices,
} from "../reconcile-interactive";
import type {
  ReconcileChoice,
  ReconcileReport,
} from "../reconcile";
import {
  PromptCancelledError,
  type PromptAdapter,
} from "../prompt-adapter";
import { ScriptedPromptAdapter } from "../prompt-adapter";

const GENERATED_PATH = "plugins/demo/codex/skills/demo/SKILL.md";
const SOURCE_PATH = ".skillset/plugins/demo/skills/demo/SKILL.md";

const ttyInput = (): PassThrough & { isTTY: true } =>
  Object.assign(new PassThrough(), { isTTY: true as const });
const ttyOutput = (): PassThrough & { isTTY: true } =>
  Object.assign(new PassThrough(), { isTTY: true as const });

function request(
  overrides: Partial<ReconcileCommandRequest> = {}
): ReconcileCommandRequest {
  return {
    jsonOutput: false,
    managedPath: GENERATED_PATH,
    options: {},
    reconcileChoice: undefined,
    rootPath: "/workspace",
    yes: false,
    ...overrides,
  };
}

function report({
  output = true,
  source = true,
}: {
  readonly output?: boolean;
  readonly source?: boolean;
} = {}): ReconcileReport {
  return {
    applied: false,
    generatedPath: GENERATED_PATH,
    outputResolution: {
      entries: [],
      generatedPath: GENERATED_PATH,
      message: output
        ? "Generated body can replace source."
        : "Generated output cannot safely replace source.",
      nextSteps: [],
      sourcePath: SOURCE_PATH,
      status: output ? "suggestible" : "refused",
      wouldWrite: output,
      wrote: false,
    },
    sourcePath: SOURCE_PATH,
    sourceResolutionAvailable: source,
    writtenPaths: [],
  };
}

function scriptedSession(
  answers: ConstructorParameters<typeof ScriptedPromptAdapter>[0]
): {
  readonly adapter: ScriptedPromptAdapter;
  readonly session: InteractiveSession;
} {
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

function operation(initial: ReconcileReport): {
  readonly calls: Array<{
    readonly choice: ReconcileChoice | undefined;
    readonly path: string;
    readonly write: boolean | undefined;
  }>;
  readonly reconcile: NonNullable<ReconcileCommandContext["reconcile"]>;
} {
  const calls: Array<{
    choice: ReconcileChoice | undefined;
    path: string;
    write: boolean | undefined;
  }> = [];
  return {
    calls,
    reconcile: async (_rootPath, path, options = {}) => {
      calls.push({
        choice: options.choice,
        path,
        write: options.write,
      });
      return options.write === true && options.choice !== undefined
        ? {
            ...initial,
            applied: true,
            choice: options.choice,
            writtenPaths: [GENERATED_PATH],
          }
        : options.choice === undefined
          ? initial
          : { ...initial, choice: options.choice };
    },
  };
}

describe("SET-295 report-driven interactive reconcile", () => {
  test("derives both, source-only, output-only, and unavailable directions from the report", () => {
    for (const [input, availability] of [
      [report(), [true, true]],
      [report({ output: false }), [true, false]],
      [report({ source: false }), [false, true]],
      [report({ output: false, source: false }), [false, false]],
    ] as const) {
      const choices = reconcileDirectionChoices(input);
      expect(
        choices.map((choice) => choice.disabled === undefined)
      ).toEqual([...availability]);
      expect(reconcileChoiceAvailable(input, "source")).toBe(
        availability[0]
      );
      expect(reconcileChoiceAvailable(input, "output")).toBe(
        availability[1]
      );
    }
  });

  test("preserves the canonical ambiguous-ownership reason on the disabled output direction", () => {
    const message = "Generated path has multiple source owners.";
    const ambiguous = report({ output: false });
    const choices = reconcileDirectionChoices({
      ...ambiguous,
      outputResolution: {
        ...ambiguous.outputResolution,
        message,
      },
    });

    expect(choices).toContainEqual({
      disabled: message,
      name: "Output wins",
      value: "output",
    });
    expect(reconcileChoiceAvailable(ambiguous, "source")).toBe(true);
  });

  test("prompts for a path, renders the canonical preview, and default-No leaves bytes unwritten", async () => {
    const { adapter, session } = scriptedSession([
      { kind: "input", value: GENERATED_PATH },
      { kind: "select", value: "output" },
      { kind: "confirm", value: false },
    ]);
    const fake = operation(report());
    let output = "";

    await runReconcileCommand(request({ managedPath: undefined }), {
      interactiveSession: session,
      reconcile: fake.reconcile,
      write: (value) => {
        output += value;
      },
    });

    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual([
      "input",
      "select",
      "confirm",
    ]);
    expect(fake.calls).toEqual([
      { choice: undefined, path: GENERATED_PATH, write: false },
      { choice: "output", path: GENERATED_PATH, write: false },
    ]);
    expect(output.match(/^skillset: reconcile /gmu)).toHaveLength(2);
    expect(output).toContain("source wins: available");
    expect(output).toContain("output wins: available");
    expect(output).toContain(
      "skillset: preview only; rerun with --use output --yes to apply"
    );
  });

  test("an explicit direction bypasses selection but confirms and applies through the same operation", async () => {
    const { adapter, session } = scriptedSession([
      { kind: "confirm", value: true },
    ]);
    const fake = operation(report());
    let output = "";

    await runReconcileCommand(
      request({ reconcileChoice: "source" }),
      {
        interactiveSession: session,
        reconcile: fake.reconcile,
        write: (value) => {
          output += value;
        },
      }
    );

    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual([
      "confirm",
    ]);
    expect(fake.calls).toEqual([
      { choice: undefined, path: GENERATED_PATH, write: false },
      { choice: "source", path: GENERATED_PATH, write: false },
      { choice: "source", path: GENERATED_PATH, write: true },
    ]);
    expect(output.match(/^skillset: reconcile /gmu)).toHaveLength(3);
    expect(output).toContain(
      "skillset: preview only; rerun with --use source --yes to apply"
    );
    expect(output).toContain("skillset: reconciled using source");
  });

  test("renders a no-safe-direction report without opening a dead selector", async () => {
    const { adapter, session } = scriptedSession([]);
    const fake = operation(report({ output: false, source: false }));
    let output = "";

    await runReconcileCommand(request(), {
      interactiveSession: session,
      reconcile: fake.reconcile,
      write: (value) => {
        output += value;
      },
    });

    adapter.assertComplete();
    expect(adapter.prompts).toEqual([]);
    expect(fake.calls).toHaveLength(1);
    expect(output).toContain("source wins: refused");
    expect(output).toContain("output wins: refused");
  });

  test("does not confirm when the selected canonical preview becomes refused", async () => {
    const { adapter, session } = scriptedSession([
      { kind: "select", value: "output" },
    ]);
    const available = report();
    const refused = report({ output: false });
    const calls: Array<{
      readonly choice: ReconcileChoice | undefined;
      readonly write: boolean | undefined;
    }> = [];
    let output = "";

    await runReconcileCommand(request(), {
      interactiveSession: session,
      reconcile: async (_rootPath, _path, options = {}) => {
        calls.push({ choice: options.choice, write: options.write });
        return options.choice === "output" ? refused : available;
      },
      write: (value) => {
        output += value;
      },
    });

    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual(["select"]);
    expect(calls).toEqual([
      { choice: undefined, write: false },
      { choice: "output", write: false },
    ]);
    expect(output).toContain("output wins: refused");
  });

  test("cancellation propagates exit 130 before analysis or writes", async () => {
    const prompts = new ScriptedPromptAdapter([]);
    const cancelled: PromptAdapter = {
      checkbox: prompts.checkbox.bind(prompts),
      confirm: prompts.confirm.bind(prompts),
      groupedCheckbox: prompts.groupedCheckbox.bind(prompts),
      input: async () => {
        throw new PromptCancelledError();
      },
      search: prompts.search.bind(prompts),
      searchCheckbox: prompts.searchCheckbox.bind(prompts),
      select: prompts.select.bind(prompts),
    };
    const session = createInteractiveSession({
      adapter: cancelled,
      env: { CI: "false" },
      input: ttyInput(),
      output: ttyOutput(),
    });
    if (session === undefined) throw new Error("expected interactive session");
    const fake = operation(report());

    const result = runReconcileCommand(
      request({ managedPath: undefined }),
      {
        interactiveSession: session,
        reconcile: fake.reconcile,
      }
    );
    await expect(result).rejects.toMatchObject({ exitCode: 130 });
    expect(fake.calls).toEqual([]);
  });

  test("machine confirmation bypasses every prompt and calls the operation once", async () => {
    const { adapter, session } = scriptedSession([]);
    const fake = operation(report());

    await runReconcileCommand(
      request({
        jsonOutput: true,
        reconcileChoice: "output",
        yes: true,
      }),
      {
        interactiveSession: session,
        reconcile: fake.reconcile,
      }
    );

    adapter.assertComplete();
    expect(adapter.prompts).toEqual([]);
    expect(fake.calls).toEqual([
      { choice: "output", path: GENERATED_PATH, write: true },
    ]);
  });
});
