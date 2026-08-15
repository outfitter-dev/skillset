import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createOperationReport } from "@skillset/core/internal/report";
import { createReportBundle } from "@skillset/core/internal/report-store";
import {
  validateCliResult,
  validateSkillsetReport,
  type SkillsetCliResult,
} from "@skillset/schema";

import { reportStoreExitCode } from "../report-cli";

const CLI = join(import.meta.dir, "..", "cli.ts");
const REPORT_ID = "6ba7b810-9dad-4c8e-8a46-7e8dd6f4e6d5";

afterEach(() => {
  process.exitCode = 0;
});

describe("SET-453 report CLI", () => {
  test("accepts UUID, bundle, JSON, and Markdown references", async () => {
    const fixture = await createFixture();
    const human = await runCli(
      fixture.stateBase,
      fixture.cwd,
      "report",
      "show",
      REPORT_ID
    );
    expect(human).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: fixture.markdown,
    });

    const relativeMarkdown = join(
      "skillset",
      "reports",
      REPORT_ID,
      "report.md"
    );
    const machines = await Promise.all(
      [
        fixture.resolvedPath,
        join(fixture.resolvedPath, "report.json"),
        relativeMarkdown,
      ].map((reference) =>
        runCli(
          fixture.stateBase,
          fixture.cwd,
          "report",
          "show",
          reference,
          "--json"
        )
      )
    );
    for (const machine of machines) {
      expect(machine.exitCode, machine.stdout || machine.stderr).toBe(0);
      expect(machine.stderr).toBe("");
      expect(machine.stdout.trim().split("\n")).toHaveLength(1);
      const result = JSON.parse(machine.stdout) as SkillsetCliResult & {
        readonly data: {
          readonly report: unknown;
          readonly resolvedPath: string;
        };
      };
      expect(validateCliResult(result)).toEqual({ diagnostics: [], ok: true });
      expect(validateSkillsetReport(result.data.report)).toEqual({
        diagnostics: [],
        ok: true,
      });
      expect(result).toMatchObject({
        command: "report.show",
        data: {
          report: { id: REPORT_ID, schemaVersion: "skillset.report@1" },
          resolvedPath: fixture.resolvedPath,
        },
        exitCode: 0,
        kind: "data",
        ok: true,
      });
    }
  });

  test("prints domain help when no leaf is selected", async () => {
    const fixture = await createFixture();
    const result = await runCli(fixture.stateBase, fixture.cwd, "report");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("skillset report");
    expect(result.stdout).toContain("show");
    expect(result.stdout).toContain("skillset report <command>");
  });

  test("maps controlled store failures to pure report diagnostics", async () => {
    const fixture = await createFixture();
    const cases = [
      {
        code: "report.not_found",
        exitCode: 1,
        reference: "00000000-0000-4000-8000-000000000000",
      },
      {
        code: "report.invalid_reference",
        exitCode: 2,
        reference: "../outside-report",
      },
    ] as const;

    for (const item of cases) {
      const result = await runCli(
        fixture.stateBase,
        fixture.cwd,
        "report",
        "show",
        item.reference,
        "--json"
      );
      expect(result.exitCode).toBe(item.exitCode);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        command: "report.show",
        data: {},
        diagnostics: [{ code: item.code, severity: "error" }],
        exitCode: item.exitCode,
        kind: "diagnostics",
        ok: false,
      });
    }

    const human = await runCli(
      fixture.stateBase,
      fixture.cwd,
      "report",
      "show",
      cases[0].reference
    );
    expect(human.exitCode).toBe(cases[0].exitCode);
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("was not found");
  });

  test("rejects an edited Markdown view as an invalid bundle", async () => {
    const fixture = await createFixture();
    await writeFile(join(fixture.resolvedPath, "report.md"), "# Edited\n");
    const result = await runCli(
      fixture.stateBase,
      fixture.cwd,
      "report",
      "show",
      REPORT_ID,
      "--json"
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: "report.show",
      data: {},
      diagnostics: [{ code: "report.invalid_bundle" }],
      exitCode: 2,
      kind: "diagnostics",
    });
  });

  test("uses the dotted leaf identity for structured parser failures", async () => {
    const fixture = await createFixture();
    const result = await runCli(
      fixture.stateBase,
      fixture.cwd,
      "report",
      "show",
      REPORT_ID,
      "--root",
      ".",
      "--json"
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: "report.show",
      data: {},
      exitCode: 2,
      kind: "diagnostics",
    });
  });

  test("pins every report-store exit class", () => {
    expect({
      invalid_bundle: reportStoreExitCode("invalid_bundle"),
      invalid_reference: reportStoreExitCode("invalid_reference"),
      invariant: reportStoreExitCode("invariant"),
      not_found: reportStoreExitCode("not_found"),
      read_failed: reportStoreExitCode("read_failed"),
    }).toEqual({
      invalid_bundle: 2,
      invalid_reference: 2,
      invariant: 4,
      not_found: 1,
      read_failed: 3,
    });
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "skillset-report-cli-"));
  const statePath = join(root, "state");
  await mkdir(statePath, { recursive: true });
  const stateBase = await realpath(statePath);
  const report = createOperationReport(
    {
      command: "check",
      exitCode: 0,
      skillsetVersion: "0.1.1",
      workspace: { id: "skillset--local-report-cli" },
    },
    {
      testHooks: {
        createdAt: "2026-08-14T21:30:00.000Z",
        id: REPORT_ID,
      },
    }
  );
  const bundle = await createReportBundle(report, {
    env: { XDG_STATE_HOME: stateBase },
  });
  return {
    cwd: stateBase,
    markdown: bundle.markdown,
    resolvedPath: bundle.resolvedPath,
    stateBase,
  };
}

async function runCli(
  stateBase: string,
  cwd: string,
  ...args: readonly string[]
): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const proc = Bun.spawn([process.execPath, CLI, ...args], {
    cwd: resolve(cwd),
    env: { ...process.env, XDG_STATE_HOME: stateBase },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}
