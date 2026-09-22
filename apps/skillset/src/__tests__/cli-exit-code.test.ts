import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { cliExitCode, CliOutputError, CliUsageError } from "../cli-output";
import { PromptCancelledError } from "../prompt-adapter";

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

const runCli = async (args: readonly string[]): Promise<number> => {
  const proc = Bun.spawn([process.execPath, cli, ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const exitCode = await proc.exited;
  return exitCode;
};

describe("SET-635 shared CLI exit classes", () => {
  test.each(classifierCases)(
    "classifies $name as $expected in every mode",
    ({ error, expected }) => {
      expect(cliExitCode(error)).toBe(expected);
    }
  );

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
});
