import { describe, expect, test } from "bun:test";

import {
  expandPackageOutputPath,
  plannedPackageOutputPath,
  validatePackageOutputConfig,
} from "../package-output-path";
import type { PackageOutputConfig } from "../types";

describe("plugin package output paths", () => {
  test.each([
    ["plugins/", "plugins/toolbox/"],
    ["plugins/[name]", "plugins/toolbox/"],
    ["plugins/[name]/dist", "plugins/toolbox/dist/"],
    ["[name]", "toolbox/"],
    [".", "."],
  ])("expands %s", (path, expected) => {
    expect(expandPackageOutputPath(path, "toolbox")).toBe(expected);
  });

  test("keeps the current default plan and rejects parsed future behavior", () => {
    const defaults: PackageOutputConfig = {
      path: "plugins/[name]",
      targets: { claude: {}, codex: {}, cursor: {} },
    };
    expect(plannedPackageOutputPath(defaults, "codex", "toolbox")).toBe(
      "plugins/toolbox/"
    );
    expect(() =>
      plannedPackageOutputPath(
        { ...defaults, path: "dist/[name]" },
        "codex",
        "toolbox"
      )
    ).toThrow("SET-561");
    expect(() =>
      plannedPackageOutputPath({ ...defaults, path: "." }, "codex", "toolbox")
    ).toThrow("SET-581");
    expect(() =>
      plannedPackageOutputPath(
        {
          ...defaults,
          targets: { ...defaults.targets, codex: { combine: true } },
        },
        "codex",
        "toolbox"
      )
    ).toThrow("plugins.output.codex.combine");
    expect(() => validatePackageOutputConfig(defaults)).not.toThrow();
    expect(() =>
      validatePackageOutputConfig({ ...defaults, path: "plugins/" })
    ).not.toThrow();
    expect(() =>
      validatePackageOutputConfig({ ...defaults, path: "dist/[name]" })
    ).toThrow("SET-561");
  });
});
