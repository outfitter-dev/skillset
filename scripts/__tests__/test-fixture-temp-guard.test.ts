import { describe, expect, test } from "bun:test";

import {
  auditTempCalls,
  isTestSourcePath,
  scanTempCalls,
  type TempObservation,
} from "../test-fixture-temp-guard";

describe("test fixture temp guard", () => {
  test("scans only test sources", () => {
    expect(isTestSourcePath("apps/skillset/src/__tests__/helper.ts")).toBe(true);
    expect(isTestSourcePath("packages/core/src/render.test.ts")).toBe(true);
    expect(isTestSourcePath("scripts/__tests__/fixture.test.tsx")).toBe(true);
    expect(isTestSourcePath("apps/skillset/src/cli.ts")).toBe(false);
    expect(isTestSourcePath("scripts/fixtures/example.ts")).toBe(false);
  });

  test("finds direct and aliased OS temp calls, not comments or unrelated helpers", () => {
    const cases = [
      'import { tmpdir } from "node:os"; tmpdir();',
      'import { tmpdir as temp } from "os"; temp();',
      'import * as os from "node:os"; os.tmpdir();',
      'import os from "node:os"; os["tmpdir"]();',
      'import os = require("node:os"); os.tmpdir();',
      'const { tmpdir: temp } = require("node:os"); temp();',
      'require("node:os").tmpdir();',
      'import * as os from "node:os"; const { tmpdir: temp } = os; temp();',
      'import { tmpdir } from "node:os"; const temp = tmpdir; temp();',
      'const os = require("node:os"); const alias = os; alias.tmpdir();',
      'import * as os from "node:os"; const temp = os.tmpdir; temp();',
      'const os = await import("node:os"); os.tmpdir();',
      'const { tmpdir: temp } = await import("node:os"); temp();',
      'import { tmpdir } from "node:os"; (tmpdir)();',
      'import * as os from "node:os"; (os.tmpdir)();',
    ];
    for (const content of cases) {
      expect(scanTempCalls("scripts/__tests__/example.test.ts", content)).toHaveLength(1);
    }
    expect(scanTempCalls("scripts/__tests__/example.test.ts", 'import { tmpdir } from "other"; tmpdir(); // os.tmpdir()')).toEqual([]);
    expect(scanTempCalls("scripts/__tests__/example.test.ts", 'import { tmpdir } from "node:os"; function unrelated(tmpdir: () => string) { tmpdir(); }')).toEqual([]);
    expect(scanTempCalls("scripts/__tests__/example.test.ts", 'import * as os from "node:os"; function unrelated(os: { tmpdir(): string }) { os.tmpdir(); }')).toEqual([]);
    expect(scanTempCalls("scripts/__tests__/example.test.ts", 'import { tmpdir } from "node:os"; function unrelated() { const tmpdir = () => "safe"; tmpdir(); }')).toEqual([]);
    expect(scanTempCalls("scripts/__tests__/example.test.ts", 'function unrelated(require: (name: string) => { tmpdir(): string }) { require("node:os").tmpdir(); }')).toEqual([]);
  });

  test("keys observation exceptions by file, owner, and exact count", () => {
    const observation: TempObservation = {
      file: "scripts/__tests__/observation.test.ts",
      owner: "observe",
      count: 1,
      reason: "Inspect cleanup without allocating a fixture.",
      usage: "readdir",
    };
    const source = {
      file: observation.file,
      content: 'import { readdir } from "node:fs/promises"; import { tmpdir } from "node:os"; function observe() { return readdir(tmpdir()); }',
    };
    expect(auditTempCalls([source], [observation])).toEqual({ violations: [], stale: [], mismatches: [] });
    expect(auditTempCalls([{ ...source, content: source.content.replace("readdir(tmpdir())", "readdir(tmpdir()) + readdir(tmpdir())") }], [observation]).mismatches).toHaveLength(1);
    expect(auditTempCalls([], [observation]).stale).toHaveLength(1);
    expect(auditTempCalls([{ ...source, file: "scripts/__tests__/other.test.ts" }], [observation]).violations).toHaveLength(1);
    const allocation = { ...source, content: source.content.replace("readdir(tmpdir())", "mkdtemp(join(tmpdir(), 'fixture-'))") };
    expect(auditTempCalls([allocation], [observation]).violations).toHaveLength(1);
    expect(auditTempCalls([allocation], [observation]).stale).toHaveLength(1);
    const fakeReaddir = { ...source, content: source.content.replace('import { readdir } from "node:fs/promises";', 'function readdir(path: string) { return mkdtemp(join(path, "fixture-")); }') };
    expect(auditTempCalls([fakeReaddir], [observation]).violations).toHaveLength(1);
  });
});
