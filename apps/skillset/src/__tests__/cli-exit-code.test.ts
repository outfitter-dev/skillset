import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  cliExitCode,
  CliOutputError,
  CliUsageError,
  createCliEventStream,
} from "../cli-output";
import { PromptCancelledError } from "../prompt-cancelled-error";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

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
    error: new CliOutputError("skillset: structured output failed"),
    name: "CliOutputError without an explicit code",
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
    name: "report invalid reference",
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
      ["test", "--prompt", "hi"],
      ["test", "--target", "claude"],
      ["test", "--target", "claude", "--prompt", "a", "--prompt-file", "b"],
      ["test", "--target", "claude", "--prompt", "a", "--yes"],
      ["test", "list", "--target", "claude"],
      ["test", "status", "--lines", "3"],
      ["new", "skill", "demo", "--preset", "bogus"],
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

  test("execution-time invocation checks use the usage class", async () => {
    const root = await createTestFixtureRoot("skillset-exit-usage-");
    const cases = [
      {
        args: ["reconcile", "--root", root],
        message: "expected a managed path to reconcile",
      },
      { args: ["import", "--root", root], message: "expected import path" },
      {
        args: ["change", "show", "@zz", "--root", root],
        message: "expected change ref to look like @<hex-prefix>",
      },
      {
        args: ["change", "show", "@ab", "--root", root],
        message: "expected change ref @ab to use at least 6 hex characters",
      },
      {
        args: ["new", "skill", "--root", root],
        message: "new skill requires a name or --id",
      },
      { args: ["new", "--root", root], message: "expected new kind" },
      {
        args: ["create", "--root", root],
        message: "create requires a name outside an interactive terminal",
      },
      {
        args: ["new", "skill", "--id", "Bad_Id", "--root", root],
        message: 'expected skill id to be a lowercase slug, received "Bad_Id"',
      },
      {
        args: [
          "release",
          "amend",
          "@ab",
          "--reason",
          "Probe a release ref that is too short.",
          "--root",
          root,
        ],
        message: "release ref @ab must include at least 6 characters",
      },
    ] as const;
    for (const { args, message } of cases) {
      const [human, json] = await Promise.all([
        runCliResult(args),
        runCliResult([...args, "--json"]),
      ]);
      expect({
        args,
        human: human.exitCode,
        json: json.exitCode,
        message: human.stderr.includes(message),
      }).toEqual({ args, human: 2, json: 2, message: true });
    }
  });

  test("hooks print invocation checks use the usage class (human only; no --json route)", async () => {
    const result = await runCliResult(["hooks", "print"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("hooks print requires --runner or --agent-runtime");
  });

  test("execution-time data failures keep the failure class", async () => {
    const root = await createTestFixtureRoot("skillset-exit-failure-");
    const result = await runCliResult(["change", "show", "@abcdef", "--root", root]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("@abcdef");
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
