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
    expect(
      scanImmediateProcessGoneAssertions(
        "apps/skillset/src/__tests__/example.test.ts",
        `expect(() =>\n  process.kill(childPid, 0)\n).toThrowError();`
      )
    ).toEqual([
      {
        file: "apps/skillset/src/__tests__/example.test.ts",
        line: 1,
        text: "expect(() => process.kill(childPid, 0) ).toThrowError();",
      },
    ]);
    expect(
      scanImmediateProcessGoneAssertions(
        "apps/skillset/src/__tests__/example.test.ts",
        `expect(function () {\n  process.kill(childPid, 0);\n}).toThrow();`
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
    expect(
      isProcessGoneGuardPath(
        "apps/skillset/src/__tests__/runtime-probe.test.ts"
      )
    ).toBe(true);
    expect(
      isProcessGoneGuardPath("packages/core/src/__tests__/demo.test.ts")
    ).toBe(true);
    expect(isProcessGoneGuardPath("scripts/__tests__/process.test.ts")).toBe(
      true
    );
    expect(isProcessGoneGuardPath("scripts/process-gone-guard.ts")).toBe(false);
    expect(
      isProcessGoneGuardPath("scripts/__tests__/process-gone-guard.test.ts")
    ).toBe(false);
    expect(isProcessGoneGuardPath("docs/development/testing.md")).toBe(false);
  });
});

describe("named process-gone callbacks", () => {
  test.each([
    'const gone = () => process.kill(pid, 0); expect(gone).toThrow();',
    'const gone = function () { process.kill(pid, 0); }; expect(gone).toThrowError();',
    'const gone = () => process.kill(pid, 0); const alias = gone; expect(alias).toThrow();',
    'const gone = (() => process.kill(pid, 0)); expect((gone)).toThrow();',
    'const gone = () => process.kill(pid, 0); function check() { expect(gone).toThrow(); }',
  ])("detects immutable local callbacks: %s", (content) => {
    expect(scanImmediateProcessGoneAssertions("scripts/example.test.ts", content)).toHaveLength(1);
  });

  test.each([
    'const gone = () => process.kill(pid, 0); function check(gone: () => void) { expect(gone).toThrow(); }',
    'const gone = () => process.kill(pid, 0); { const gone = () => fail(); expect(gone).toThrow(); }',
    '{ const gone = () => process.kill(pid, 0); } { const gone = () => fail(); expect(gone).toThrow(); }',
    'let gone = () => process.kill(pid, 0); gone = () => fail(); expect(gone).toThrow();',
    'const gone = () => process.kill(pid, "SIGTERM"); expect(gone).toThrow();',
    'const gone = () => expectProcessGone(pid); expect(gone).toThrow();',
    'const first = second; const second = first; expect(first).toThrow();',
  ])("does not confuse other bindings or callbacks: %s", (content) => {
    expect(scanImmediateProcessGoneAssertions("scripts/example.test.ts", content)).toEqual([]);
  });

  test("reports the assertion location instead of the alias declaration", () => {
    const content = 'const gone = () => process.kill(pid, 0);\n\nexpect(gone).toThrow();';
    expect(scanImmediateProcessGoneAssertions("scripts/example.test.ts", content)).toEqual([
      { file: "scripts/example.test.ts", line: 3, text: "expect(gone).toThrow();" },
    ]);
  });
});
