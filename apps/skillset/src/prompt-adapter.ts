import {
  checkbox as inquirerCheckbox,
  confirm as inquirerConfirm,
  input as inquirerInput,
  search as inquirerSearch,
  select as inquirerSelect,
} from "@inquirer/prompts";

import { runSearchCheckbox } from "./search-checkbox";

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

export interface SearchPrompt<Value> {
  readonly default?: Value;
  readonly message: string;
  readonly pageSize?: number;
  readonly source: (
    term: string | undefined,
    options: { readonly signal: AbortSignal }
  ) => readonly PromptChoice<Value>[] | Promise<readonly PromptChoice<Value>[]>;
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
  input(prompt: InputPrompt): Promise<string>;
  search<Value>(prompt: SearchPrompt<Value>): Promise<Value>;
  searchCheckbox<Value>(
    prompt: SearchCheckboxPrompt<Value>
  ): Promise<readonly Value[]>;
  select<Value>(prompt: ChoicePrompt<Value>): Promise<Value>;
}

export interface PromptContext {
  readonly clearPromptOnDone?: boolean;
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
  readonly signal?: AbortSignal;
}

export class PromptCancelledError extends Error {
  readonly exitCode = 130;

  constructor() {
    super("skillset: interactive prompt cancelled");
    this.name = "PromptCancelledError";
  }
}

const CANCELLATION_ERROR_NAMES = new Set([
  "AbortPromptError",
  "CancelPromptError",
  "ExitPromptError",
]);

export function normalizePromptError(error: unknown): never {
  if (
    error instanceof PromptCancelledError ||
    (error instanceof Error && CANCELLATION_ERROR_NAMES.has(error.name))
  ) {
    throw new PromptCancelledError();
  }
  throw error;
}

export class InquirerPromptAdapter implements PromptAdapter {
  readonly #context: PromptContext;

  constructor(context: PromptContext = {}) {
    this.#context = context;
  }

  async checkbox<Value>(
    prompt: CheckboxPrompt<Value>
  ): Promise<readonly Value[]> {
    try {
      return await inquirerCheckbox(prompt, this.#context);
    } catch (error) {
      return normalizePromptError(error);
    }
  }

  async confirm(prompt: ConfirmPrompt): Promise<boolean> {
    try {
      return await inquirerConfirm(prompt, this.#context);
    } catch (error) {
      return normalizePromptError(error);
    }
  }

  async input(prompt: InputPrompt): Promise<string> {
    try {
      return await inquirerInput(prompt, this.#context);
    } catch (error) {
      return normalizePromptError(error);
    }
  }

  async search<Value>(prompt: SearchPrompt<Value>): Promise<Value> {
    try {
      return await inquirerSearch(prompt, this.#context);
    } catch (error) {
      return normalizePromptError(error);
    }
  }

  async searchCheckbox<Value>(
    prompt: SearchCheckboxPrompt<Value>
  ): Promise<readonly Value[]> {
    try {
      return await runSearchCheckbox(prompt, this.#context);
    } catch (error) {
      return normalizePromptError(error);
    }
  }

  async select<Value>(prompt: ChoicePrompt<Value>): Promise<Value> {
    try {
      return await inquirerSelect(prompt, this.#context);
    } catch (error) {
      return normalizePromptError(error);
    }
  }
}

export type ScriptedPromptAnswer =
  | { readonly kind: "checkbox"; readonly value: readonly unknown[] }
  | { readonly kind: "confirm"; readonly value: boolean }
  | { readonly kind: "input"; readonly value: string }
  | { readonly kind: "search"; readonly value: unknown }
  | { readonly kind: "search-checkbox"; readonly value: readonly unknown[] }
  | { readonly kind: "select"; readonly value: unknown };

export type RecordedPrompt =
  | { readonly kind: "checkbox"; readonly prompt: CheckboxPrompt<unknown> }
  | { readonly kind: "confirm"; readonly prompt: ConfirmPrompt }
  | { readonly kind: "input"; readonly prompt: InputPrompt }
  | { readonly kind: "search"; readonly prompt: SearchPrompt<unknown> }
  | {
      readonly kind: "search-checkbox";
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
    this.prompts.push({ kind: "search-checkbox", prompt: recorded });
    return this.#read("search-checkbox") as readonly Value[];
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
