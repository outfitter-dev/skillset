import { describe, expect, test } from "bun:test";

import {
  isProcessGoneGuardPath,
  scanImmediateProcessGoneAssertions,
} from "../process-gone-guard";

function goneAssertion(pidExpr: string): string {
  return `expect(() => process.kill(${pidExpr}, 0))` + ".toThrow();";
}

describe("process-gone assertion guard", () => {
  test("SET-633: flags one-shot process.kill(pid, 0) gone assertions", () => {
    const pidGone = goneAssertion("pid");
    expect(
      scanImmediateProcessGoneAssertions(
        "apps/skillset/src/__tests__/example.test.ts",
        pidGone
      )
    ).toEqual([
      {
        file: "apps/skillset/src/__tests__/example.test.ts",
        line: 1,
        text: pidGone,
      },
    ]);
    expect(
      scanImmediateProcessGoneAssertions(
        "apps/skillset/src/__tests__/example.test.ts",
        goneAssertion("childPid!")
      )
    ).toHaveLength(1);
  });

  test("SET-633: allows expectProcessGone and non-gone kill uses", () => {
    expect(
      scanImmediateProcessGoneAssertions(
        "apps/skillset/src/__tests__/example.test.ts",
        "await expectProcessGone(pid);"
      )
    ).toEqual([]);
    expect(
      scanImmediateProcessGoneAssertions(
        "apps/skillset/src/__tests__/example.test.ts",
        'process.kill(proc.pid, "SIGTERM");'
      )
    ).toEqual([]);
    expect(
      scanImmediateProcessGoneAssertions(
        "apps/skillset/src/provider-command.ts",
        "process.kill(target, 0);"
      )
    ).toEqual([]);
  });

  test("SET-633: scans TypeScript under apps, packages, and scripts", () => {
    expect(isProcessGoneGuardPath("apps/skillset/src/__tests__/runtime-probe.test.ts")).toBe(
      true
    );
    expect(isProcessGoneGuardPath("packages/core/src/__tests__/demo.test.ts")).toBe(true);
    expect(isProcessGoneGuardPath("scripts/__tests__/process.test.ts")).toBe(true);
    expect(isProcessGoneGuardPath("scripts/process-gone-guard.ts")).toBe(false);
    expect(isProcessGoneGuardPath("scripts/__tests__/process-gone-guard.test.ts")).toBe(
      false
    );
    expect(isProcessGoneGuardPath("docs/development/testing.md")).toBe(false);
  });
});
