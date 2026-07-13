import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  CliOutputError,
  createCliEvent,
  createCliResult,
  readCliMachineMode,
  renderCliEvent,
  renderCliResult,
} from "../cli-output";
import { CLI_COMMANDS, CLI_LEAF_SUBCOMMANDS } from "../cli-commands";

describe("SET-286 CLI output kernel", () => {
  test("pre-scans mutually exclusive machine modes", () => {
    expect(readCliMachineMode(["check", "--json"])).toBe("json");
    expect(readCliMachineMode(["dev", "--jsonl"])).toBe("jsonl");
    expect(readCliMachineMode(["check"])).toBeUndefined();
    expect(() => readCliMachineMode(["check", "--json", "--jsonl"])).toThrow(
      CliOutputError
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
    ]) {
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

  test("returns a structured JSONL failure for invalid early stream usage", async () => {
    const cli = join(import.meta.dir, "..", "cli.ts");
    const proc = Bun.spawn(
      [process.execPath, cli, "not-a-command", "--jsonl"],
      { stderr: "pipe", stdout: "pipe" }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(2);
    expect(stderr).toBe("");
    const event = JSON.parse(stdout) as Record<string, unknown>;
    expect(event).toMatchObject({
      command: "cli",
      event: "failed",
      schemaVersion: "skillset.cli.event@1",
      sequence: 1,
    });
  });
});
