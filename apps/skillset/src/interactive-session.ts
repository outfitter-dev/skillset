import packageJson from "../package.json";
import {
  InquirerPromptAdapter,
  type PromptAdapter,
  type PromptContext,
} from "./prompt-adapter";

interface TtyReadable extends NodeJS.ReadableStream {
  readonly isTTY?: boolean;
}

interface TtyWritable extends NodeJS.WritableStream {
  readonly isTTY?: boolean;
}

export interface InteractiveSessionOptions {
  readonly adapter?: PromptAdapter;
  readonly clearPromptOnDone?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly input?: TtyReadable;
  readonly machineMode?: boolean;
  readonly output?: TtyWritable;
  readonly rawProtocol?: boolean;
  readonly signal?: AbortSignal;
}

export interface InteractiveSession {
  readonly prompts: PromptAdapter;
  readonly signal: AbortSignal | undefined;
  banner(): void;
  write(message: string): void;
}

export function interactiveSessionEligible({
  env = process.env,
  input = process.stdin,
  machineMode = false,
  output = process.stdout,
  rawProtocol = false,
}: InteractiveSessionOptions = {}): boolean {
  return (
    !machineMode &&
    !rawProtocol &&
    !ciEnabled(env.CI) &&
    input.isTTY === true &&
    output.isTTY === true
  );
}

export function createInteractiveSession(
  options: InteractiveSessionOptions = {}
): InteractiveSession | undefined {
  if (!interactiveSessionEligible(options)) return undefined;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const context: PromptContext = {
    ...(options.clearPromptOnDone === undefined
      ? {}
      : { clearPromptOnDone: options.clearPromptOnDone }),
    input,
    output,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  const prompts = options.adapter ?? new InquirerPromptAdapter(context);
  return {
    prompts,
    signal: options.signal,
    banner: () => output.write(`Skillset v${packageJson.version}\n\n`),
    write: (message) => output.write(message),
  };
}

function ciEnabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}
