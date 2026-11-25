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

  test("flags type-only app-level package internal facades", () => {
    expect(
      scanPackageOwnershipContent(
        "apps/skillset/src/types.ts",
        'export type { BuildGraph } from "@skillset/core/internal/types";'
      )
    ).toEqual([
      {
        file: "apps/skillset/src/types.ts",
        line: 1,
        text: 'export type { BuildGraph } from "@skillset/core/internal/types";',
      },
    ]);

    expect(
      scanPackageOwnershipContent(
        "apps/skillset/src/types.ts",
        'export type * from "@skillset/core/internal/types";'
      )
    ).toEqual([
      {
        file: "apps/skillset/src/types.ts",
        line: 1,
        text: 'export type * from "@skillset/core/internal/types";',
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


describe("package facade declaration syntax", () => {
  test.each([
    'export {\n build,\n type BuildGraph\n} from "@skillset/core/internal/build";',
    'export type {\n BuildGraph\n} from "@skillset/core/internal/types";',
    'export * as build from "@skillset/core/internal/build";',
    'export /* bridge */ * from "@skillset/core/internal/build"; // facade',
  ])("flags complete declarations: %s", (declaration) => {
    const result = scanPackageOwnershipContent("apps/skillset/src/bridge.ts", `// header\n${declaration}`);
    expect(result).toHaveLength(1);
    expect(result[0]?.line).toBe(2);
    expect(result[0]?.file).toBe("apps/skillset/src/bridge.ts");
  });

  test("ignores declaration-shaped comments and strings", () => {
    const content = [
      '/*',
      'export * from "@skillset/core/internal/build";',
      '*/',
      'const example = `',
      'export * from "@skillset/core/internal/build";',
      '`;',
      'export { build } from "@skillset/core";',
      'import { build } from "@skillset/core/internal/build";',
      'export { build };',
    ].join("\n");
    expect(scanPackageOwnershipContent("apps/skillset/src/example.ts", content)).toEqual([]);
  });
});
