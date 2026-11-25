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

  test("checks overloaded local functions through their implementation", () => {
    const file = "scripts/example.test.ts";
    const assertion = "expect(() => probe()).toThrow();";
    const content = [
      "function probe(): void;",
      "function probe(target: number): void;",
      "function probe(target = pid) { process.kill(target, 0); }",
      assertion,
    ].join("\n");
    expect(scanImmediateProcessGoneAssertions(file, content)).toEqual([
      { file, line: 4, text: assertion },
    ]);
  });

  test("does not flag an overloaded implementation without a probe", () => {
    const content = [
      "function probe(): void;",
      "function probe(target: number): void;",
      'function probe(target = pid) { process.kill(target, "SIGTERM"); }',
      "expect(() => probe()).toThrow();",
    ].join("\n");
    expect(scanImmediateProcessGoneAssertions("scripts/example.test.ts", content)).toEqual([]);
  });

  test.each([
    'const callback = () => { const probe = () => process.kill(pid, 0); throw new Error("unrelated"); }; expect(callback).toThrow();',
    'const callback = () => () => process.kill(pid, 0); expect(callback).toThrow();',
  ])("does not count deferred probes: %s", (content) => {
    expect(scanImmediateProcessGoneAssertions("scripts/example.test.ts", content)).toEqual([]);
  });

  test("still detects an immediately invoked nested probe", () => {
    const content = 'const callback = () => (() => process.kill(pid, 0))(); expect(callback).toThrow();';
    expect(scanImmediateProcessGoneAssertions("scripts/example.test.ts", content)).toHaveLength(1);
  });

  test.each([
    'expect(() => { const probe = () => process.kill(pid, 0); probe(); }).toThrow();',
    'expect(() => { function probe() { process.kill(pid, 0); } probe(); }).toThrow();',
    'const probe = () => process.kill(pid, 0); const alias = probe; const callback = () => alias(); expect(callback).toThrow();',
    'expect(() => ((value = process.kill(pid, 0)) => value)()).toThrow();',
    'const probe = (value = process.kill(pid, 0)) => value; expect(() => probe()).toThrow();',
    'const probe = (value = process.kill(pid, 0)) => value; expect(probe).toThrow();',
  ])("detects directly executed local probes: %s", (content) => {
    expect(scanImmediateProcessGoneAssertions("scripts/example.test.ts", content)).toHaveLength(1);
  });

  test.each([
    'const probe = (value = process.kill(pid, 0)) => value; expect(() => probe(1)).toThrow();',
    'expect(() => ((value = process.kill(pid, 0)) => value)(1)).toThrow();',
    'expect(() => ((value = process.kill(pid, 0)) => value)(...[1])).toThrow();',
    'const probe = () => process.kill(pid, 0); function test(probe: () => void) { expect(() => probe()).toThrow(); }',
    'const first = () => second(); const second = () => first(); expect(first).toThrow();',
    'expect(() => (function* () { process.kill(pid, 0); })()).toThrow();',
  ])("does not count unproven local probes: %s", (content) => {
    expect(scanImmediateProcessGoneAssertions("scripts/example.test.ts", content)).toEqual([]);
  });

  test.each([
    'const gone = (() => process.kill(pid, 0)) satisfies () => void; expect(gone).toThrow();',
    'const gone = () => process.kill(pid, 0); const alias = gone as () => void; expect(alias).toThrow();',
    'const gone = () => process.kill(pid, 0); expect(<() => void>gone).toThrow();',
    'const gone = () => process.kill(pid, 0); expect((gone!) satisfies () => void).toThrow();',
  ])("detects callbacks behind type-only wrappers: %s", (content) => {
    expect(scanImmediateProcessGoneAssertions("scripts/example.test.ts", content)).toHaveLength(1);
  });
});
