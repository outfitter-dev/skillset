import { describe, expect, test } from "bun:test";

import { parseReportCommandRequest } from "../report-args";

describe("SET-453 report arguments", () => {
  test("accepts the show leaf without workspace options", () => {
    expect(
      parseReportCommandRequest(
        ["report", "show", "reports/example/report.md", "--json"],
        { cwd: "/tmp/invocation" }
      )
    ).toEqual({
      cwd: "/tmp/invocation",
      jsonOutput: true,
      reference: "reports/example/report.md",
      reportSubcommand: "show",
    });
  });

  test("accepts the bare domain for focused help", () => {
    expect(parseReportCommandRequest(["report"], { cwd: "/tmp" })).toEqual({
      cwd: "/tmp",
      jsonOutput: false,
      reference: undefined,
      reportSubcommand: undefined,
    });
  });

  test("scopes leaf parser failures to report.show", () => {
    for (const args of [
      ["report", "unknown"],
      ["report", "show"],
      ["report", "show", "id", "extra"],
      ["report", "show", "id", "--root", "."],
      ["report", "show", "id", "--json=yes"],
      ["report", "show", "id", "--jsonl"],
    ]) {
      try {
        parseReportCommandRequest(args, { cwd: "/tmp" });
        throw new Error("expected report parsing to fail");
      } catch (error) {
        expect(error).toMatchObject({ command: "report.show", exitCode: 2 });
      }
    }
  });
});
