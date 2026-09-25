import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  cliExitCode,
  CliOutputError,
  CliUsageError,
  createCliEventStream,
} from "../cli-output";
import { PromptCancelledError } from "../prompt-cancelled-error";

const cli = join(import.meta.dir, "..", "cli.ts");

const classifierCases = [
  {
    expected: 2,
    error: new CliUsageError("skillset: unknown option --dry-run"),
    name: "unknown option",
  },
  {
    expected: 2,
    error: new CliUsageError("skillset: expected value after --root"),
    name: "missing required argument",
  },
  {
    expected: 3,
    error: new CliOutputError("skillset: owned bundle cannot be read", 3, "report.show"),
    name: "CliOutputError with an explicit code",
  },
  {
    expected: 1,
    error: new Error(
      "skillset: expected backup id to be a lowercase hex ref, received \"NOT-A-HEX\""
    ),
    name: "core validation error",
  },
  {
    expected: 1,
    error: new Error("watch setup failed"),
    name: "unexpected throw",
  },
  {
    expected: 130,
    error: new PromptCancelledError(),
    name: "prompt cancellation",
  },
] as const;

const spawnedCases = [
  {
    expected: 2,
    human: ["build", "--dry-run"],
    json: ["build", "--dry-run", "--json"],
    name: "unknown option",
  },
  {
    expected: 2,
    human: ["build", "--root"],
    json: ["build", "--json", "--root"],
    name: "missing required argument",
  },
  {
    expected: 2,
    human: ["report", "show", "../outside"],
    json: ["report", "show", "../outside", "--json"],
    name: "explicit command-specific report failure",
  },
  {
    expected: 1,
    human: ["restore", "NOT-A-HEX"],
    json: ["restore", "NOT-A-HEX", "--json"],
    name: "core validation error",
  },
] as const;

const runCliResult = async (args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> => {
  const proc = Bun.spawn([process.execPath, cli, ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stderr, stdout, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
};

const runCli = async (args: readonly string[]): Promise<number> =>
  (await runCliResult(args)).exitCode;

describe("SET-635 shared CLI exit classes", () => {
  test("classifies representative failures the same in every mode", () => {
    for (const { error, expected, name } of classifierCases) {
      expect({ name, exitCode: cliExitCode(error) }).toEqual({
        name,
        exitCode: expected,
      });
    }
  });

  test("human and --json modes share one classifier for representative failures", async () => {
    for (const { expected, human, json, name } of spawnedCases) {
      const [humanCode, jsonCode] = await Promise.all([
        runCli(human),
        runCli(json),
      ]);
      expect({ name, human: humanCode, json: jsonCode }).toEqual({
        name,
        human: expected,
        json: expected,
      });
    }
  });

  test("message prefixes do not decide usage", () => {
    expect(
      cliExitCode(new Error("skillset: expected ledger.jsonl:1 to contain a JSON object"))
    ).toBe(1);
    expect(cliExitCode(new Error("skillset: --json is not a usage failure here"))).toBe(1);
    expect(cliExitCode(new Error("skillset: unknown option leaked from core"))).toBe(1);
  });

  test("delegated argument validators retain the usage class", async () => {
    const cases = [
      ["lookup", "not-a-subject"],
      ["lookup", "hooks", "--field", "one", "--field", "two"],
      ["hooks", "context", "--event", "Stop", "--format", "yaml"],
      ["hooks", "context", "--event", "Stop", "--context-fields", "not-a-field"],
    ] as const;
    for (const args of cases) {
      const [human, json] = await Promise.all([
        runCliResult(args),
        runCliResult([...args, "--json"]),
      ]);
      expect({ args, human: human.exitCode, json: json.exitCode }).toEqual({
        args,
        human: 2,
        json: 2,
      });
    }
  });

  test("structured diagnostics match the selected exit class", async () => {
    const [usage, failure] = await Promise.all([
      runCliResult(["build", "--dry-run", "--json"]),
      runCliResult(["restore", "NOT-A-HEX", "--json"]),
    ]);
    expect(JSON.parse(usage.stdout)).toMatchObject({
      diagnostics: [{ code: "cli.usage" }],
      exitCode: 2,
      ok: false,
    });
    expect(JSON.parse(failure.stdout)).toMatchObject({
      diagnostics: [{ code: "cli.failure" }],
      exitCode: 1,
      ok: false,
    });
  });

  test("structured-output invariants retain explicit exit class 4", () => {
    const stream = createCliEventStream("test", { write: () => true });
    stream.emit("completed", {});
    try {
      stream.emit("operation", {});
      throw new Error("expected a terminal-stream invariant failure");
    } catch (error) {
      expect(error).toBeInstanceOf(CliOutputError);
      expect(cliExitCode(error)).toBe(4);
    }
  });
});
