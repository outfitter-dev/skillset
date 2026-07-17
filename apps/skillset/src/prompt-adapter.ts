import type { Readable, Writable } from "node:stream";

import {
  autocomplete,
  autocompleteMultiselect,
  confirm,
  groupMultiselect,
  isCancel,
  log,
  multiselect,
  select,
  text,
  type Option,
} from "@clack/prompts";

import {
  createTerminalRenderer,
  terminalColorEnabled,
  type TerminalRenderer,
} from "./terminal-renderer";

export interface PromptChoice<Value> {
  readonly checked?: boolean;
  readonly description?: string;
  readonly disabled?: boolean | string;
  readonly name: string;
  readonly value: Value;
}

export interface InputPrompt {
  readonly default?: string;
  readonly message: string;
  readonly validate?: (
    value: string
  ) => boolean | string | Promise<boolean | string>;
}

export interface ConfirmPrompt {
  readonly default?: boolean;
  readonly message: string;
}

export interface ChoicePrompt<Value> {
  readonly choices: readonly PromptChoice<Value>[];
  readonly default?: Value;
  readonly message: string;
  readonly pageSize?: number;
}

export interface CheckboxPrompt<Value> extends Omit<
  ChoicePrompt<Value>,
  "default"
> {
  readonly required?: boolean;
}

export interface GroupedCheckboxPrompt<Value> {
  readonly groups: readonly {
    readonly choices: readonly PromptChoice<Value>[];
    readonly name: string;
  }[];
  readonly message: string;
  readonly pageSize?: number;
  readonly required?: boolean;
}

export interface SearchPrompt<Value> {
  readonly default?: Value;
  readonly message: string;
  readonly pageSize?: number;
  readonly source: (
    term: string | undefined,
    options: { readonly signal: AbortSignal }
  ) => readonly PromptChoice<Value>[];
}

export interface SearchCheckboxPrompt<Value> extends CheckboxPrompt<Value> {
  readonly source: (
    term: string | undefined,
    choices: readonly PromptChoice<Value>[]
  ) => readonly PromptChoice<Value>[];
}

export interface PromptAdapter {
  checkbox<Value>(prompt: CheckboxPrompt<Value>): Promise<readonly Value[]>;
  confirm(prompt: ConfirmPrompt): Promise<boolean>;
  groupedCheckbox<Value>(
    prompt: GroupedCheckboxPrompt<Value>
  ): Promise<readonly Value[]>;
  input(prompt: InputPrompt): Promise<string>;
  search<Value>(prompt: SearchPrompt<Value>): Promise<Value>;
  searchCheckbox<Value>(
    prompt: SearchCheckboxPrompt<Value>
  ): Promise<readonly Value[]>;
  select<Value>(prompt: ChoicePrompt<Value>): Promise<Value>;
}

export interface PromptContext {
  readonly clearPromptOnDone?: boolean;
  readonly color?: boolean;
  readonly input?: Readable;
  readonly output?: Writable;
  readonly signal?: AbortSignal;
}

export class PromptCancelledError extends Error {
  readonly exitCode = 130;

  constructor() {
    super("skillset: interactive prompt cancelled");
    this.name = "PromptCancelledError";
  }
}

export function normalizePromptError(error: unknown): never {
  if (error instanceof PromptCancelledError || isCancel(error)) {
    throw new PromptCancelledError();
  }
  throw error;
}

const SAVE_CURSOR = "\u001B[s";
const RESTORE_CURSOR_AND_CLEAR = "\u001B[u\u001B[0J";

export class ClackPromptAdapter implements PromptAdapter {
  readonly #context: PromptContext;
  readonly #renderer: TerminalRenderer;
  readonly #sourceSignal: AbortSignal;

  constructor(context: PromptContext = {}) {
    this.#context = context;
    this.#sourceSignal = context.signal ?? new AbortController().signal;
    const outputIsTTY = (
      context.output as { readonly isTTY?: boolean } | undefined
    )?.isTTY;
    this.#renderer = createTerminalRenderer({
      color:
        context.color ??
        terminalColorEnabled({
          ...(outputIsTTY === undefined ? {} : { isTTY: outputIsTTY }),
          ...(process.env.NO_COLOR === undefined
            ? {}
            : { noColor: process.env.NO_COLOR }),
          ...(process.env.TERM === undefined
            ? {}
            : { term: process.env.TERM }),
        }),
    });
  }

  async checkbox<Value>(
    prompt: CheckboxPrompt<Value>
  ): Promise<readonly Value[]> {
    return this.#run<readonly Value[]>(() =>
      multiselect<unknown>({
        ...this.#clackContext(),
        initialValues: initialValues(prompt.choices),
        ...(prompt.pageSize === undefined ? {} : { maxItems: prompt.pageSize }),
        message: prompt.message,
        options: prompt.choices.map((choice) =>
          toClackOption(choice, this.#renderer)
        ),
        required: prompt.required ?? false,
      })
    );
  }

  async confirm(prompt: ConfirmPrompt): Promise<boolean> {
    return this.#run<boolean>(() =>
      confirm({
        ...this.#clackContext(),
        ...(prompt.default === undefined
          ? {}
          : { initialValue: prompt.default }),
        message: prompt.message,
      })
    );
  }

  async groupedCheckbox<Value>(
    prompt: GroupedCheckboxPrompt<Value>
  ): Promise<readonly Value[]> {
    const choices = prompt.groups.flatMap((group) => group.choices);
    return this.#run<readonly Value[]>(() =>
      groupMultiselect<unknown>({
        ...this.#clackContext(),
        initialValues: initialValues(choices),
        ...(prompt.pageSize === undefined ? {} : { maxItems: prompt.pageSize }),
        message: prompt.message,
        options: Object.fromEntries(
          prompt.groups.map((group) => [
            group.name,
            group.choices.map((choice) =>
              toClackOption(choice, this.#renderer)
            ),
          ])
        ),
        required: prompt.required ?? false,
      })
    );
  }

  async input(prompt: InputPrompt): Promise<string> {
    return this.#run<string>(async () => {
      let initialValue = prompt.default;
      while (true) {
        const result = await text({
          ...this.#clackContext(),
          ...(prompt.default === undefined
            ? {}
            : { defaultValue: prompt.default }),
          ...(initialValue === undefined ? {} : { initialValue }),
          message: prompt.message,
        });
        if (isCancel(result) || prompt.validate === undefined) return result;
        const validation = await prompt.validate(result);
        if (validation === true) return result;
        log.warn(
          typeof validation === "string"
            ? validation
            : "Please enter a valid value.",
          this.#context.output === undefined
            ? undefined
            : { output: this.#context.output }
        );
        initialValue = result;
      }
    });
  }

  async search<Value>(prompt: SearchPrompt<Value>): Promise<Value> {
    const source = prompt.source;
    const signal = this.#sourceSignal;
    const renderer = this.#renderer;
    return this.#run<Value>(() =>
      autocomplete<unknown>({
        ...this.#clackContext(),
        filter: () => true,
        ...(prompt.default === undefined
          ? {}
          : { initialValue: prompt.default }),
        ...(prompt.pageSize === undefined ? {} : { maxItems: prompt.pageSize }),
        message: prompt.message,
        options: function () {
          return source(this.userInput || undefined, { signal }).map((choice) =>
            toClackOption(choice, renderer)
          );
        },
      })
    );
  }

  async searchCheckbox<Value>(
    prompt: SearchCheckboxPrompt<Value>
  ): Promise<readonly Value[]> {
    const source = prompt.source;
    const renderer = this.#renderer;
    return this.#run<readonly Value[]>(() =>
      autocompleteMultiselect<unknown>({
        ...this.#clackContext(),
        filter: () => true,
        initialValues: initialValues(prompt.choices),
        ...(prompt.pageSize === undefined ? {} : { maxItems: prompt.pageSize }),
        message: prompt.message,
        options: function () {
          return source(this.userInput || undefined, prompt.choices).map(
            (choice) => toClackOption(choice, renderer)
          );
        },
        ...(prompt.required === undefined ? {} : { required: prompt.required }),
      })
    );
  }

  async select<Value>(prompt: ChoicePrompt<Value>): Promise<Value> {
    return this.#run<Value>(() =>
      select<unknown>({
        ...this.#clackContext(),
        ...(prompt.default === undefined
          ? {}
          : { initialValue: prompt.default }),
        ...(prompt.pageSize === undefined ? {} : { maxItems: prompt.pageSize }),
        message: prompt.message,
        options: prompt.choices.map((choice) =>
          toClackOption(choice, this.#renderer)
        ),
      })
    );
  }

  #clackContext(): Pick<PromptContext, "input" | "output" | "signal"> {
    const { input, output, signal } = this.#context;
    return {
      ...(input === undefined ? {} : { input: ensureRawMode(input) }),
      ...(output === undefined ? {} : { output }),
      ...(signal === undefined ? {} : { signal }),
    };
  }

  async #run<Value>(
    operation: () => Promise<unknown | symbol>
  ): Promise<Value> {
    const clear = this.#context.clearPromptOnDone === true;
    if (clear) this.#context.output?.write(SAVE_CURSOR);
    try {
      const result = await operation();
      if (isCancel(result)) throw new PromptCancelledError();
      // Every Clack call is supplied from the corresponding typed adapter
      // request, so a non-cancel result has that request's value type.
      return result as Value;
    } catch (error) {
      return normalizePromptError(error);
    } finally {
      if (clear) this.#context.output?.write(RESTORE_CURSOR_AND_CLEAR);
    }
  }
}

interface RawModeReadable extends Readable {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
}

function ensureRawMode(input: Readable): Readable {
  const ttyInput = input as RawModeReadable;
  if (ttyInput.isTTY === true && ttyInput.setRawMode === undefined) {
    // Clack correctly treats TTY streams as raw-capable terminals. Lightweight
    // injected streams used by embedders and tests can signal TTY eligibility
    // without implementing ReadStream#setRawMode, so give only that instance a
    // no-op compatibility method instead of touching process-global streams.
    ttyInput.setRawMode = () => input;
  }
  return input;
}

function toClackOption<Value>(
  choice: PromptChoice<Value>,
  renderer: TerminalRenderer
): Option<unknown> {
  const disabledReason =
    typeof choice.disabled === "string" ? choice.disabled : undefined;
  return {
    ...(choice.disabled === undefined
      ? {}
      : { disabled: Boolean(choice.disabled) }),
    ...(choice.disabled || choice.description === undefined
      ? {}
      : { hint: choice.description }),
    label: choice.disabled
      ? `${renderer.strikethrough(choice.name)}${
          disabledReason === undefined ? "" : ` (${disabledReason})`
        }`
      : choice.name,
    value: choice.value,
  };
}

function initialValues<Value>(
  choices: readonly PromptChoice<Value>[]
): Value[] {
  return choices
    .filter((choice) => choice.checked === true && !choice.disabled)
    .map((choice) => choice.value);
}

export type ScriptedPromptAnswer =
  | { readonly kind: "checkbox"; readonly value: readonly unknown[] }
  | { readonly kind: "confirm"; readonly value: boolean }
  | { readonly kind: "group-checkbox"; readonly value: readonly unknown[] }
  | { readonly kind: "input"; readonly value: string }
  | { readonly kind: "search"; readonly value: unknown }
  | { readonly kind: "search-multiselect"; readonly value: readonly unknown[] }
  | { readonly kind: "select"; readonly value: unknown };

export type RecordedPrompt =
  | { readonly kind: "checkbox"; readonly prompt: CheckboxPrompt<unknown> }
  | { readonly kind: "confirm"; readonly prompt: ConfirmPrompt }
  | {
      readonly kind: "group-checkbox";
      readonly prompt: GroupedCheckboxPrompt<unknown>;
    }
  | { readonly kind: "input"; readonly prompt: InputPrompt }
  | { readonly kind: "search"; readonly prompt: SearchPrompt<unknown> }
  | {
      readonly kind: "search-multiselect";
      readonly prompt: SearchCheckboxPrompt<unknown>;
    }
  | { readonly kind: "select"; readonly prompt: ChoicePrompt<unknown> };

export class ScriptedPromptAdapter implements PromptAdapter {
  readonly prompts: RecordedPrompt[] = [];
  readonly #answers: ScriptedPromptAnswer[];

  constructor(answers: readonly ScriptedPromptAnswer[]) {
    this.#answers = [...answers];
  }

  async checkbox<Value>(
    prompt: CheckboxPrompt<Value>
  ): Promise<readonly Value[]> {
    this.prompts.push({ kind: "checkbox", prompt });
    return this.#read("checkbox") as readonly Value[];
  }

  async confirm(prompt: ConfirmPrompt): Promise<boolean> {
    this.prompts.push({ kind: "confirm", prompt });
    return this.#read("confirm") as boolean;
  }

  async groupedCheckbox<Value>(
    prompt: GroupedCheckboxPrompt<Value>
  ): Promise<readonly Value[]> {
    const recorded = prompt as unknown as GroupedCheckboxPrompt<unknown>;
    this.prompts.push({ kind: "group-checkbox", prompt: recorded });
    return this.#read("group-checkbox") as readonly Value[];
  }

  async input(prompt: InputPrompt): Promise<string> {
    this.prompts.push({ kind: "input", prompt });
    return this.#read("input") as string;
  }

  async search<Value>(prompt: SearchPrompt<Value>): Promise<Value> {
    this.prompts.push({ kind: "search", prompt });
    return this.#read("search") as Value;
  }

  async searchCheckbox<Value>(
    prompt: SearchCheckboxPrompt<Value>
  ): Promise<readonly Value[]> {
    // The recorder erases generic values while preserving the callable prompt.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const recorded = prompt as unknown as SearchCheckboxPrompt<unknown>;
    this.prompts.push({ kind: "search-multiselect", prompt: recorded });
    return this.#read("search-multiselect") as readonly Value[];
  }

  async select<Value>(prompt: ChoicePrompt<Value>): Promise<Value> {
    this.prompts.push({ kind: "select", prompt });
    return this.#read("select") as Value;
  }

  assertComplete(): void {
    if (this.#answers.length > 0) {
      throw new Error(
        `skillset: scripted prompt adapter has ${this.#answers.length} unused answer(s)`
      );
    }
  }

  #read(kind: ScriptedPromptAnswer["kind"]): unknown {
    const answer = this.#answers.shift();
    if (answer === undefined) {
      throw new Error(`skillset: scripted prompt adapter is missing ${kind}`);
    }
    if (answer.kind !== kind) {
      throw new Error(
        `skillset: scripted prompt adapter expected ${answer.kind}, received ${kind}`
      );
    }
    return answer.value;
  }
}
