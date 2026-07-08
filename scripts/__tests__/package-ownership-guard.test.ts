import { describe, expect, test } from "bun:test";

import {
  isScannablePackageOwnershipPath,
  scanPackageOwnershipContent,
} from "../package-ownership-guard";

describe("package ownership guard", () => {
  test("flags app-level package internal facades", () => {
    const violations = scanPackageOwnershipContent(
      "apps/skillset/src/build.ts",
      'export * from "@skillset/core/internal/build";'
    );

    expect(violations).toEqual([
      {
        file: "apps/skillset/src/build.ts",
        line: 1,
        text: 'export * from "@skillset/core/internal/build";',
      },
    ]);
  });

  test("allows direct imports from package internals", () => {
    expect(
      scanPackageOwnershipContent(
        "apps/skillset/src/ci.ts",
        'import { loadBuildGraph } from "@skillset/core/internal/resolver";'
      )
    ).toEqual([]);
  });

  test("allows ordinary app exports", () => {
    expect(
      scanPackageOwnershipContent(
        "apps/skillset/src/runtime-hooks/index.ts",
        'export { dispatchHookRun } from "./run";'
      )
    ).toEqual([]);
  });

  test("scans app source but not app tests or other packages", () => {
    expect(isScannablePackageOwnershipPath("apps/skillset/src/ci.ts")).toBe(true);
    expect(isScannablePackageOwnershipPath("apps/skillset/src/__tests__/ci.test.ts")).toBe(false);
    expect(isScannablePackageOwnershipPath("packages/core/src/index.ts")).toBe(false);
  });
});
