import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  collectCoreInternalImportInventory,
  isCoreInternalImportInventoryPath,
  parseCoreInternalImportInventoryArgs,
  renderCoreInternalImportInventory,
  scanCoreInternalImportSource,
  summarizeCoreInternalImports,
} from "../core-internal-import-inventory";
import { runTestGit } from "../test-helpers/git-remote";

describe("core internal import inventory", () => {
  test("selects production app TypeScript and excludes tests by default", () => {
    expect(isCoreInternalImportInventoryPath("apps/skillset/src/ci.ts")).toBe(
      true
    );
    expect(
      isCoreInternalImportInventoryPath(
        "apps/skillset/src/runtime-hooks/print.ts"
      )
    ).toBe(true);
    expect(
      isCoreInternalImportInventoryPath(
        "apps/skillset/src/__tests__/ci.test.ts"
      )
    ).toBe(false);
    expect(
      isCoreInternalImportInventoryPath("apps/skillset/src/runtime.test.ts")
    ).toBe(false);
    expect(isCoreInternalImportInventoryPath("apps/skillset/src/ci.tsx")).toBe(
      false
    );
    expect(
      isCoreInternalImportInventoryPath("packages/core/src/build.ts")
    ).toBe(false);
    expect(
      isCoreInternalImportInventoryPath(
        "apps/skillset/src/__tests__/ci.test.ts",
        true
      )
    ).toBe(true);
  });

  test("counts multiline declarations once and classifies import kinds", () => {
    const declarations = scanCoreInternalImportSource(
      "apps/skillset/src/example.ts",
      `
import type {
  BuildGraph,
  SkillsetOptions,
} from "@skillset/core/internal/types";
import {
  runProbe,
  type ProbeResult,
} from "@skillset/core/internal/test-evaluation";
import "@skillset/core/internal/setup";
`
    );

    expect(declarations).toHaveLength(3);
    expect(
      declarations.map(({ kind, subpath, symbols }) => ({
        kind,
        subpath,
        symbols,
      }))
    ).toEqual([
      {
        kind: "type",
        subpath: "types",
        symbols: ["BuildGraph", "SkillsetOptions"],
      },
      {
        kind: "mixed",
        subpath: "test-evaluation",
        symbols: ["ProbeResult", "runProbe"],
      },
      { kind: "value", subpath: "setup", symbols: [] },
    ]);
  });

  test("ignores dynamic imports, import type queries, and re-exports", () => {
    const declarations = scanCoreInternalImportSource(
      "apps/skillset/src/example.ts",
      `
export { loadBuildGraph } from "@skillset/core/internal/resolver";
type Graph = import("@skillset/core/internal/types").BuildGraph;
const resolver = import("@skillset/core/internal/resolver");
import { parseYamlRecord } from "@skillset/core/internal/yaml";
`
    );

    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toMatchObject({
      kind: "value",
      subpath: "yaml",
      symbols: ["parseYamlRecord"],
    });
  });

  test("summarizes files, declarations, and subpaths deterministically", () => {
    const declarations = [
      ...scanCoreInternalImportSource(
        "apps/skillset/src/z.ts",
        `
import { second } from "@skillset/core/internal/path";
import { first } from "@skillset/core/internal/path";
`
      ),
      ...scanCoreInternalImportSource(
        "apps/skillset/src/a.ts",
        'import type { BuildGraph } from "@skillset/core/internal/types";\n'
      ),
    ];
    const inventory = summarizeCoreInternalImports(
      "main",
      "abc123",
      declarations
    );

    expect(inventory.totals).toEqual({
      distinctSubpaths: 2,
      importDeclarations: 3,
      importingFiles: 2,
    });
    expect(inventory.subpaths).toEqual([
      {
        declarationCount: 2,
        files: ["apps/skillset/src/z.ts"],
        name: "path",
      },
      {
        declarationCount: 1,
        files: ["apps/skillset/src/a.ts"],
        name: "types",
      },
    ]);
    expect(
      inventory.declarations.map(({ file, line }) => ({ file, line }))
    ).toEqual([
      { file: "apps/skillset/src/a.ts", line: 1 },
      { file: "apps/skillset/src/z.ts", line: 2 },
      { file: "apps/skillset/src/z.ts", line: 3 },
    ]);
    const rendered = renderCoreInternalImportInventory(inventory);
    expect(rendered.endsWith("\n")).toBe(true);
    expect(JSON.parse(rendered)).toMatchObject({
      commit: "abc123",
      ref: "main",
      schema: "skillset-core-internal-import-inventory@1",
      scope: { includeTests: false, root: "apps/skillset/src" },
    });
  });

  test("orders inventory strings by code unit across punctuation, case, and Unicode", () => {
    const orderedNames = [
      "-punctuation",
      "A-upper",
      "a-lower",
      "é-latin",
      "Ω-greek",
      "😀-emoji",
    ];
    const declarations = [...orderedNames].reverse().map((name) => ({
      column: 1,
      file: `apps/skillset/src/${name}.ts`,
      kind: "value" as const,
      line: 1,
      subpath: name,
      symbols: [],
    }));

    const inventory = summarizeCoreInternalImports(
      "main",
      "abc123",
      declarations
    );

    expect(inventory.subpaths.map(({ name }) => name)).toEqual(orderedNames);
    expect(inventory.declarations.map(({ file }) => file)).toEqual(
      orderedNames.map((name) => `apps/skillset/src/${name}.ts`)
    );

    const [symbols] = scanCoreInternalImportSource(
      "apps/skillset/src/symbols.ts",
      'import { Ω, é, a, A, "-punctuation" as punctuation } from "@skillset/core/internal/types";\n'
    );
    expect(symbols?.symbols).toEqual(["-punctuation", "A", "a", "é", "Ω"]);
  });

  test("parses the bounded command arguments", () => {
    expect(parseCoreInternalImportInventoryArgs([])).toEqual({
      includeTests: false,
      ref: "HEAD",
    });
    expect(
      parseCoreInternalImportInventoryArgs([
        "--include-tests",
        "--ref",
        "origin/main",
      ])
    ).toEqual({ includeTests: true, ref: "origin/main" });
    expect(() => parseCoreInternalImportInventoryArgs(["--ref"])).toThrow(
      "--ref requires a git ref"
    );
    expect(() =>
      parseCoreInternalImportInventoryArgs(["--ref", "main", "--ref", "HEAD"])
    ).toThrow("--ref may be passed only once");
    expect(() =>
      parseCoreInternalImportInventoryArgs([
        "--include-tests",
        "--include-tests",
      ])
    ).toThrow("--include-tests may be passed only once");
    expect(() => parseCoreInternalImportInventoryArgs(["--unknown"])).toThrow(
      "unexpected argument: --unknown"
    );
  });

  test("reads committed Git blobs without observing or changing dirty files", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-core-imports-"));
    const sourcePath = join(root, "apps/skillset/src/example.ts");
    try {
      await mkdir(join(root, "apps/skillset/src/__tests__"), {
        recursive: true,
      });
      const committed =
        'import { parseYamlRecord } from "@skillset/core/internal/yaml";\n';
      const dirty =
        'import { compareStrings } from "@skillset/core/internal/path";\n';
      await writeFile(sourcePath, committed);
      await writeFile(
        join(root, "apps/skillset/src/__tests__/example.test.ts"),
        'import type { BuildGraph } from "@skillset/core/internal/types";\n'
      );
      await runTestGit(root, "init", "--initial-branch=main");
      await runTestGit(root, "config", "user.email", "skillset@example.test");
      await runTestGit(root, "config", "user.name", "Skillset Tests");
      await runTestGit(root, "add", "--all");
      await runTestGit(root, "commit", "-m", "fixture");
      const commit = await runTestGit(root, "rev-parse", "HEAD");
      await writeFile(sourcePath, dirty);

      const inventory = await collectCoreInternalImportInventory(root);

      expect(inventory.commit).toBe(commit);
      expect(inventory.ref).toBe("HEAD");
      expect(inventory.totals).toEqual({
        distinctSubpaths: 1,
        importDeclarations: 1,
        importingFiles: 1,
      });
      expect(inventory.subpaths.map(({ name }) => name)).toEqual(["yaml"]);
      expect(await readFile(sourcePath, "utf8")).toBe(dirty);
      await expect(
        collectCoreInternalImportInventory(root, { ref: "missing-ref" })
      ).rejects.toThrow("git rev-parse failed");
      expect(await readFile(sourcePath, "utf8")).toBe(dirty);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
