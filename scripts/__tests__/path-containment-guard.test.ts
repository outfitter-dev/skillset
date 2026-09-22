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

  test("allows POSIX logical prefix checks that are not OS-path relative() results", () => {
    expect(
      scanPathContainmentContent(
        "packages/core/src/authoring.ts",
        'if (sourcePath === target || sourcePath.startsWith(`${target}/`)) return true;'
      )
    ).toEqual([]);
  });
});
