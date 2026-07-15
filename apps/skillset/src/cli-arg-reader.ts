export interface CliOptionToken {
  readonly flag: string;
  readonly inlineValue?: string;
  readonly raw: string;
}

export const splitCliOption = (raw: string): CliOptionToken => {
  const equalsIndex = raw.indexOf("=");
  if (equalsIndex === -1) {
    return { flag: raw, raw };
  }
  return {
    flag: raw.slice(0, equalsIndex),
    inlineValue: raw.slice(equalsIndex + 1),
    raw,
  };
};

export class CliArgReader {
  readonly #args: readonly string[];
  #index: number;

  constructor(args: readonly string[], index = 0) {
    this.#args = args;
    this.#index = index;
  }

  get done(): boolean {
    return this.#index >= this.#args.length;
  }

  get index(): number {
    return this.#index;
  }

  peek(offset = 0): string | undefined {
    return this.#args[this.#index + offset];
  }

  read(): string | undefined {
    const value = this.peek();
    if (value !== undefined) {
      this.#index += 1;
    }
    return value;
  }

  readOptionalPositional(): string | undefined {
    const value = this.peek();
    if (value === undefined || value.startsWith("--")) {
      return undefined;
    }
    this.#index += 1;
    return value;
  }

  readOption(): CliOptionToken | undefined {
    const raw = this.read();
    return raw === undefined ? undefined : splitCliOption(raw);
  }

  readRequiredOptionValue(option: CliOptionToken): string {
    if (option.inlineValue !== undefined) {
      return option.inlineValue;
    }
    const value = this.peek();
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`skillset: expected value after ${option.flag}`);
    }
    this.#index += 1;
    return value;
  }

  readOptionalOptionValues(option: CliOptionToken): readonly string[] {
    if (option.inlineValue !== undefined) {
      return [option.inlineValue];
    }
    const values: string[] = [];
    while (true) {
      const value = this.readOptionalPositional();
      if (value === undefined) {
        return values;
      }
      values.push(value);
    }
  }
}

export const assertBooleanOption = (option: CliOptionToken): void => {
  if (option.inlineValue !== undefined) {
    throw new Error(`skillset: ${option.flag} does not take a value`);
  }
};
