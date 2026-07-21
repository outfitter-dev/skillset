import { describe, expect, test } from "bun:test";

import { runFiniteCommand } from "../cli-finite-command";

describe("SET-332 finite command presentation", () => {
  test("executes synchronous operations and uses writer-based human rendering", async () => {
    let stdout = "";
    let stderr = "";
    let jsonCalls = 0;

    await runFiniteCommand({
      execute: () => ({ ok: true, value: "ready" }),
      exitCode: () => 0,
      json: () => {
        jsonCalls += 1;
        return { command: "sync", data: {} };
      },
      jsonOutput: false,
      renderHuman: (result, writer) => {
        writer.stdout.write(`${result.value}\n`);
        writer.stderr.write("advisory\n");
      },
      writer: {
        stderr: {
          write: (chunk) => {
            stderr += String(chunk);
            return true;
          },
        },
        stdout: {
          write: (chunk) => {
            stdout += String(chunk);
            return true;
          },
        },
      },
    });

    expect({ jsonCalls, stderr, stdout }).toEqual({
      jsonCalls: 0,
      stderr: "advisory\n",
      stdout: "ready\n",
    });
  });

  test("executes asynchronous operations and writes one finite JSON result", async () => {
    let humanCalls = 0;
    const writes: string[] = [];
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await runFiniteCommand({
        execute: () => Promise.resolve({ ok: false, value: "blocked" }),
        exitCode: (result) => (result.ok ? 0 : 1),
        json: (result) => ({
          command: "async",
          data: { value: result.value },
          diagnostics: [
            { code: "async.blocked", message: "blocked", severity: "error" },
          ],
          kind: "diagnostics",
        }),
        jsonOutput: true,
        renderHuman: () => {
          humanCalls += 1;
        },
        writer: {
          stderr: { write: () => true },
          stdout: {
            write: (chunk) => {
              writes.push(String(chunk));
              return true;
            },
          },
        },
      });

      expect(humanCalls).toBe(0);
      expect(writes).toHaveLength(1);
      expect(writes[0]?.endsWith("\n")).toBe(true);
      expect(JSON.parse(writes[0] ?? "")).toMatchObject({
        command: "async",
        data: { value: "blocked" },
        diagnostics: [{ code: "async.blocked", severity: "error" }],
        exitCode: 1,
        kind: "diagnostics",
        ok: false,
      });
      expect(process.exitCode as number | undefined).toBe(1);
    } finally {
      process.exitCode = previousExitCode ?? 0;
    }
  });
});
