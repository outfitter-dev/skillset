import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { ClackPromptAdapter } from "../prompt-adapter";

type RealPromptScenario = "choice-hints" | "searchable-checkbox";

export interface RealPromptProcessEvidence {
  readonly globalStdout: {
    readonly columns: number | null;
    readonly columnsDefined: boolean;
    readonly isTTY: boolean;
  };
  readonly result: unknown;
  readonly transcript: string;
}

export interface RealPromptProcessResult {
  readonly evidence: RealPromptProcessEvidence | undefined;
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export const runRealPromptProcess = async (
  scenario: RealPromptScenario
): Promise<RealPromptProcessResult> => {
  const evidenceRoot = await mkdtemp(
    path.join(tmpdir(), "skillset-real-prompt-")
  );
  const evidencePath = path.join(evidenceRoot, "evidence.json");
  try {
    const proc = Bun.spawn(
      [process.execPath, import.meta.filename, scenario, evidencePath],
      {
        cwd: process.cwd(),
        env: process.env,
        stderr: "pipe",
        stdout: "pipe",
      }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const evidence =
      exitCode === 0
        ? (JSON.parse(
            await readFile(evidencePath, "utf8")
          ) as RealPromptProcessEvidence)
        : undefined;
    return { evidence, exitCode, stderr, stdout };
  } finally {
    await rm(evidenceRoot, { force: true, recursive: true });
  }
};

const ttyInput = (): PassThrough & { isTTY: true } =>
  Object.assign(new PassThrough(), { isTTY: true as const });

const ttyOutput = (): PassThrough & {
  columns: number;
  isTTY: true;
  rows: number;
} =>
  Object.assign(new PassThrough(), {
    columns: 80,
    isTTY: true as const,
    rows: 24,
  });

const captureTranscript = (output: PassThrough): (() => string) => {
  let transcript = "";
  output.on("data", (chunk: Buffer) => {
    transcript += chunk.toString();
  });
  return () => transcript;
};

const waitForOutput = async (
  output: PassThrough,
  pattern: RegExp
): Promise<string> =>
  new Promise((resolve, reject) => {
    let rendered = "";
    const onData = (chunk: Buffer): void => {
      rendered += chunk.toString();
      if (pattern.test(Bun.stripANSI(rendered))) {
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

const withTimeout = async <Value>(
  operation: Promise<Value>,
  milliseconds: number,
  fallback: () => Value
): Promise<Value> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Value>((resolve, reject) => {
    timer = setTimeout(() => {
      try {
        resolve(fallback());
      } catch (error) {
        reject(error);
      }
    }, milliseconds);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const choiceHintsEvidence = async (): Promise<
  Omit<RealPromptProcessEvidence, "globalStdout">
> => {
  const input = ttyInput();
  const output = ttyOutput();
  const transcript = captureTranscript(output);
  const result = new ClackPromptAdapter({
    color: true,
    input,
    output,
  }).select({
    choices: [
      { description: "recommended", name: "One", value: "one" },
      { disabled: "unavailable", name: "Two", value: "two" },
    ],
    default: "one",
    message: "Choose:",
  });

  input.write("\r");
  return { result: await result, transcript: transcript() };
};

const searchableCheckboxEvidence = async (): Promise<
  Omit<RealPromptProcessEvidence, "globalStdout">
> => {
  const input = ttyInput();
  const output = ttyOutput();
  const transcript = captureTranscript(output);
  const choices = [
    { checked: true, name: "All", value: "all" },
    { name: "Alpha", value: "alpha" },
    { disabled: "unavailable", name: "Disabled", value: "disabled" },
    { name: "Beta", value: "beta" },
  ] as const;
  const result = new ClackPromptAdapter({ input, output }).searchCheckbox({
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
  const writeText = async (text: string): Promise<void> => {
    for (const key of text) {
      input.write(key);
      await Bun.sleep(1);
    }
  };

  const disabledRendered = waitForOutput(output, /Disabled \(unavailable\)/u);
  await writeText("disabled");
  const disabledTranscript = await withTimeout(
    disabledRendered,
    500,
    transcript
  );
  if (!Bun.stripANSI(disabledTranscript).includes("Disabled (unavailable)")) {
    throw new Error("disabled choice did not render within 500ms");
  }
  await writeText("/alpha");
  await writeText("/beta");
  input.write("\r");

  const selected = await withTimeout(result, 1000, () => {
    throw new Error(`prompt did not submit:\n${Bun.stripANSI(transcript())}`);
  });
  return { result: selected, transcript: transcript() };
};

const runChild = async (
  scenario: RealPromptScenario,
  evidencePath: string
): Promise<void> => {
  const evidence =
    scenario === "choice-hints"
      ? await choiceHintsEvidence()
      : await searchableCheckboxEvidence();
  await Bun.write(
    evidencePath,
    JSON.stringify({
      ...evidence,
      globalStdout: {
        columns: process.stdout.columns ?? null,
        columnsDefined: process.stdout.columns !== undefined,
        isTTY: process.stdout.isTTY === true,
      },
    } satisfies RealPromptProcessEvidence)
  );
};

if (import.meta.main) {
  const [scenario, evidencePath] = process.argv.slice(2);
  if (
    (scenario !== "choice-hints" && scenario !== "searchable-checkbox") ||
    evidencePath === undefined
  ) {
    throw new Error(
      "skillset: expected real prompt scenario and evidence path"
    );
  }
  await runChild(scenario, evidencePath);
}
