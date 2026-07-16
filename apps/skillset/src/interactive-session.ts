import type { Readable, Writable } from "node:stream";

import { intro, note } from "@clack/prompts";

import packageJson from "../package.json";
import {
  ClackPromptAdapter,
  type PromptAdapter,
  type PromptContext,
} from "./prompt-adapter";

interface TtyReadable extends Readable {
  readonly isTTY?: boolean;
}

interface TtyWritable extends Writable {
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
  note(message: string, title?: string): void;
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
  const prompts = options.adapter ?? new ClackPromptAdapter(context);
  return {
    prompts,
    signal: options.signal,
    banner: () => intro(`Skillset v${packageJson.version}`, { output }),
    note: (message, title) => note(message.trimEnd(), title, { output }),
    write: (message) => output.write(message),
  };
}

function ciEnabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}
