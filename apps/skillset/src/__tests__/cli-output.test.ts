import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  CliOutputError,
  createCliEvent,
  createCliEventStream,
  createCliResult,
  readCliCommand,
  readCliMachineMode,
  parseCliEventStream,
  renderCliEvent,
  renderCliResult,
} from "../cli-output";
import { CLI_COMMANDS, CLI_LEAF_SUBCOMMANDS } from "../cli-commands";

describe("SET-286 CLI output kernel", () => {
  test("keeps structured command identity aligned with the parser roster", () => {
    for (const command of CLI_COMMANDS) {
      expect(readCliCommand([command, "--bad", "--json"])).toBe(command);
      for (const subcommand of CLI_LEAF_SUBCOMMANDS[command] ?? []) {
        expect(readCliCommand([command, subcommand, "--json"])).toBe(`${command} ${subcommand}`);
      }
    }
    expect(readCliCommand(["not-a-command", "--json"])).toBe("cli");
  });
  test("pre-scans requested machine modes before route parsing", () => {
    expect(readCliMachineMode(["check", "--json"])).toBe("json");
    expect(readCliMachineMode(["dev", "--jsonl"])).toBe("jsonl");
    expect(readCliMachineMode(["check"])).toBeUndefined();
    expect(() => readCliMachineMode(["check", "--json", "--jsonl"])).toThrow(
      "skillset: --json and --jsonl are mutually exclusive"
    );
  });

  test("renders validated finite results with one trailing newline", () => {
    const result = createCliResult({
      command: "check",
      data: {},
      kind: "diagnostics",
    });
    expect(result).toMatchObject({
      command: "check",
      exitCode: 0,
      ok: true,
      schemaVersion: "skillset.cli.result@1",
    });
    expect(renderCliResult(result)).toBe(`${JSON.stringify(result)}\n`);
  });

  test("renders validated monotonically sequenced events", () => {
    const event = createCliEvent({
      command: "dev",
      data: {},
      event: "started",
      sequence: 1,
    });
    expect(renderCliEvent(event)).toBe(`${JSON.stringify(event)}\n`);
    expect(() =>
      createCliEvent({
        command: "dev",
        data: {},
        event: "started",
        sequence: 0,
      })
    ).toThrow(CliOutputError);
  });

  test("returns structured usage failures before normal command parsing", async () => {
    const cli = join(import.meta.dir, "..", "cli.ts");
    const proc = Bun.spawn([process.execPath, cli, "not-a-command", "--json"], {
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(2);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout) as Record<string, unknown>;
    expect(result).toMatchObject({
      command: "cli",
      exitCode: 2,
      kind: "diagnostics",
      ok: false,
      schemaVersion: "skillset.cli.result@1",
    });
  });

  test("classifies route option validation as structured usage failures", async () => {
    const cli = join(import.meta.dir, "..", "cli.ts");
    for (const [command, args] of [
      ["update", ["update", "--yes", "--dry-run", "--json"]],
      ["check", ["check", "--scope", "repo", "--json"]],
      ["change add", ["change", "add", "--json"]],
      ["change reason", ["change", "reason", "--reason", "why", "--json"]],
      ["change amend", ["change", "amend", "--reason", "why", "--json"]],
      ["change show", ["change", "show", "--json"]],
      ["release amend", ["release", "amend", "--reason", "why", "--json"]],
    ] as const) {
      const proc = Bun.spawn([process.execPath, cli, ...args], {
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(exitCode).toBe(2);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toMatchObject({
        command,
        exitCode: 2,
        kind: "diagnostics",
        ok: false,
      });
    }
  });

  test("keeps human help out of machine output", async () => {
    const cli = join(import.meta.dir, "..", "cli.ts");
    const proc = Bun.spawn([process.execPath, cli, "--help", "--json"], {
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(2);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({ command: "cli", exitCode: 2, ok: false });
  });

  test("enforces monotonic streams with exactly one terminal event", () => {
    let output = "";
    const stream = createCliEventStream("dev", { write: (chunk) => { output += String(chunk); return true; } });
    stream.emit("started", {});
    stream.emit("operation", { ok: true });
    stream.emit("completed", { reason: "signal" });
    expect(parseCliEventStream(output).map((event) => [event.sequence, event.event])).toEqual([
      [1, "started"],
      [2, "operation"],
      [3, "completed"],
    ]);
    expect(() => stream.emit("operation", {})).toThrow(CliOutputError);
    expect(() => parseCliEventStream(output.split("\n").slice(0, 2).join("\n"))).toThrow(
      "ended without exactly one terminal event"
    );
  });

  test("rejects unsupported finite and streaming machine routes", async () => {
    const cli = join(import.meta.dir, "..", "cli.ts");
    const cases = [
      ["hooks", "print", "--json"],
      ["hooks", "run", "post-tool-use", "--jsonl"],
      ["check", "--jsonl"],
    ];
    for (const args of cases) {
      const proc = Bun.spawn([process.execPath, cli, ...args], { stderr: "pipe", stdout: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(exitCode).toBe(2);
      expect(stderr).toBe("");
      expect(stdout).toContain("skillset.cli.");
    }
  });
});
