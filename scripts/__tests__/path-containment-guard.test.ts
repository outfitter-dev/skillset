import { describe, expect, test } from "bun:test";

import {
  isScannablePathContainmentPath,
  scanPathContainmentContent,
} from "../path-containment-guard";

describe("path containment guard", () => {
  test("scans product source and skips the owned helper and tests", () => {
    expect(isScannablePathContainmentPath("packages/core/src/resolver.ts")).toBe(true);
    expect(isScannablePathContainmentPath("apps/skillset/src/setup.ts")).toBe(true);
    expect(isScannablePathContainmentPath("packages/core/src/path.ts")).toBe(false);
    expect(isScannablePathContainmentPath("packages/core/src/__tests__/path.test.ts")).toBe(
      false
    );
    expect(isScannablePathContainmentPath("scripts/test-sandbox.ts")).toBe(false);
  });

  test("flags isAbsolute(relative) copies and relative parent-prefix checks", () => {
    const file = "packages/core/src/resolver.ts";
    const violations = scanPathContainmentContent(
      file,
      [
        'import { isAbsolute, relative } from "node:path";',
        "const relativePath = relative(root, path);",
        "if (relativePath.startsWith(\"..\") || isAbsolute(relativePath)) return false;",
        "if (relative(root, path).startsWith(`..${sep}`)) return false;",
      ].join("\n")
    );

    expect(violations.map((violation) => violation.label)).toEqual([
      "isAbsolute(relative) belongs in path.ts",
      "relative(...).startsWith('..') belongs in path.ts",
      "relative(...).startsWith('..') belongs in path.ts",
    ]);
  });

  test("flags realpath slash-prefix comparisons", () => {
    const violations = scanPathContainmentContent(
      "apps/skillset/src/setup.ts",
      [
        'const realRoot = await realpath(rootPath);',
        'const realSource = await realpath(absolutePath);',
        "if (!realSource.startsWith(`${realRoot}/`)) continue;",
      ].join("\n")
    );

    expect(violations).toEqual([
      {
        file: "apps/skillset/src/setup.ts",
        label: "realpath slash-prefix comparison belongs in path.ts",
        line: 3,
        text: "if (!realSource.startsWith(`${realRoot}/`)) continue;",
      },
    ]);
  });

  test("sees relative() through a local normalizer (pre-fix render-agent-skills and reconcile)", () => {
    const labels = (file: string, lines: readonly string[]): readonly string[] =>
      scanPathContainmentContent(file, lines.join("\n")).map((violation) => violation.label);

    expect(
      labels("packages/core/src/render-agent-skills.ts", [
        "const relativeFile = normalizePath(path.relative(targetSkillDir, file.path));",
        'if (relativeFile.length === 0 || relativeFile.startsWith("../")) throw new Error("x");',
      ])
    ).toEqual(["relative(...).startsWith('..') belongs in path.ts"]);
    expect(
      labels("apps/skillset/src/reconcile.ts", [
        "const normalized = normalizeReconcilePath(relative(resolve(rootPath), resolve(rootPath, path)));",
        'if (normalized === "" || normalized.startsWith("../") || isAbsolute(normalized)) throw new Error("x");',
      ])
    ).toEqual(["relative(...).startsWith('..') belongs in path.ts"]);
  });

  test("flags an exact '..' comparison on a relative() result", () => {
    const violations = scanPathContainmentContent(
      "apps/skillset/src/example.ts",
      [
        "const rel = toPosix(relative(root, path));",
        'if (rel === ".." || ".." === rel) return false;',
        'if (relative(root, path) !== "..") return true;',
      ].join("\n")
    );

    expect(violations.map((violation) => [violation.line, violation.label])).toEqual([
      [2, "relative(...) === '..' belongs in path.ts"],
      [3, "relative(...) === '..' belongs in path.ts"],
    ]);
  });

  test("flags a resolve-derived slash-prefix comparison", () => {
    const violations = scanPathContainmentContent(
      "apps/skillset/src/example.ts",
      [
        "const target = resolve(root, candidate);",
        "if (!target.startsWith(`${root}/`)) throw new Error(\"x\");",
        "if (!resolve(root, other).startsWith(`${root}/`)) throw new Error(\"x\");",
      ].join("\n")
    );

    expect(violations.map((violation) => [violation.line, violation.label])).toEqual([
      [2, "resolve slash-prefix comparison belongs in path.ts"],
      [3, "resolve slash-prefix comparison belongs in path.ts"],
    ]);
  });

  test("allows POSIX logical prefix checks that are not OS-path relative() results", () => {
    expect(
      scanPathContainmentContent(
        "packages/core/src/authoring.ts",
        'if (sourcePath === target || sourcePath.startsWith(`${target}/`)) return true;'
      )
    ).toEqual([]);
  });
});
