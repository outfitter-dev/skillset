import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createSourceFile,
  forEachChild,
  getModifiers,
  isFunctionDeclaration,
  isImportDeclaration,
  isStringLiteral,
  ScriptTarget,
  SyntaxKind,
  type SourceFile,
} from "typescript";

import {
  hasAdaptivePluginHookOutput,
  hasAdaptivePluginHookSources,
  renderAdaptiveFrontmatterHooks,
  renderAdaptivePluginHookFiles,
  renderNormalizedPluginHookFile,
  skillScope,
  validateHookJson,
} from "../render-hooks";
import {
  marketplaceLockProvenance,
  readExistingMarketplaceState,
  renderClaudeMarketplace,
  renderClaudeMarketplaceDocument,
  renderCursorMarketplace,
} from "../render-marketplaces";
import {
  renderCodexInterface,
  renderPluginManifest,
  withOptionalSurfacePaths,
} from "../render-plugin-manifest";
import { renderRules } from "../render-rules";
import {
  copyPath,
  exists,
  GENERATED_BY,
  lockRootsFor,
  textFile,
  WORKSPACE_LOCK_ROOT,
  type LockRoot,
} from "../render-support";

const OWNER_MODULES = [
  "render-hooks",
  "render-marketplaces",
  "render-plugin-manifest",
  "render-rules",
  "render-support",
] as const;

const OWNED_FUNCTIONS = {
  "render-hooks": [
    "renderAdaptivePluginHookFiles",
    "hasAdaptivePluginHookOutput",
    "hasAdaptivePluginHookSources",
    "renderAdaptiveFrontmatterHooks",
    "skillScope",
    "renderNormalizedPluginHookFile",
    "validateHookJson",
  ],
  "render-marketplaces": [
    "renderClaudeMarketplace",
    "renderClaudeMarketplaceDocument",
    "renderCursorMarketplace",
    "marketplaceLockProvenance",
    "readExistingMarketplaceState",
  ],
  "render-plugin-manifest": [
    "renderPluginManifest",
    "renderCodexInterface",
    "withOptionalSurfacePaths",
  ],
  "render-rules": ["renderRules"],
  "render-support": ["copyPath", "exists", "lockRootsFor", "textFile"],
} as const;

describe("render owner boundaries", () => {
  it("keeps private render leaves acyclic and out of the orchestrator", async () => {
    const sources = new Map(
      await Promise.all(
        OWNER_MODULES.map(
          async (module) =>
            [
              module,
              parseSource(
                `${module}.ts`,
                await Bun.file(join(import.meta.dir, `../${module}.ts`)).text()
              ),
            ] as const
        )
      )
    );
    const leafEdges = OWNER_MODULES.flatMap((module) => {
      const source = sources.get(module);
      if (source === undefined) return [];
      return source.statements
        .filter(isImportDeclaration)
        .map((declaration) => declaration.moduleSpecifier)
        .filter(isStringLiteral)
        .map((specifier) => specifier.text)
        .filter(
          (specifier) =>
            specifier === "./render" || specifier.startsWith("./render-")
        )
        .map((specifier) => `${module}->${specifier.slice(2)}`);
    }).sort();

    expect(leafEdges).toEqual([
      "render-hooks->render-support",
      "render-marketplaces->render-support",
      "render-plugin-manifest->render-hooks",
      "render-rules->render-support",
    ]);
    expect(leafEdges.some((edge) => edge.endsWith("->render"))).toBe(false);
    expect(leafEdges).not.toContain("render-hooks->render-plugin-manifest");

    const orchestrator = parseSource(
      "render.ts",
      await Bun.file(join(import.meta.dir, "../render.ts")).text()
    );
    const orchestratorFunctions = declaredFunctionNames(orchestrator);
    for (const [module, functions] of Object.entries(OWNED_FUNCTIONS)) {
      const owner = sources.get(module as (typeof OWNER_MODULES)[number]);
      expect(owner).toBeDefined();
      expect(exportedFunctionNames(owner as SourceFile)).toEqual(
        [...functions].sort()
      );
      expect(
        functions.filter((functionName) =>
          orchestratorFunctions.has(functionName)
        )
      ).toEqual([]);
    }
  });

  it("keeps each owner directly importable through its private module", () => {
    expect(
      [
        renderClaudeMarketplace,
        renderClaudeMarketplaceDocument,
        renderCursorMarketplace,
        marketplaceLockProvenance,
        readExistingMarketplaceState,
        renderPluginManifest,
        renderCodexInterface,
        withOptionalSurfacePaths,
        renderRules,
        renderAdaptivePluginHookFiles,
        hasAdaptivePluginHookOutput,
        hasAdaptivePluginHookSources,
        renderAdaptiveFrontmatterHooks,
        skillScope,
        renderNormalizedPluginHookFile,
        validateHookJson,
      ].every((owner) => typeof owner === "function")
    ).toBe(true);
  });

  it("provides deterministic text, lock-root, existence, and recursive-copy primitives", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-render-owners-"));
    try {
      const source = join(root, "source");
      await mkdir(join(source, "nested"), { recursive: true });
      await writeFile(join(source, "z.txt"), "z\n");
      await writeFile(join(source, "a.txt"), "a\n");
      await writeFile(join(source, "nested", "b.txt"), "b\n");
      await writeFile(join(source, ".DS_Store"), "ignored\n");
      await symlink(join(source, "a.txt"), join(source, "ignored-link"));

      const copied = await copyPath(source, "generated");
      expect(copied.map((file) => file.path)).toEqual([
        join("generated", "a.txt"),
        join("generated", "nested", "b.txt"),
        join("generated", "z.txt"),
      ]);
      expect(
        await Promise.all(
          copied.map((file) => new Response(file.content).text())
        )
      ).toEqual(["a\n", "b\n", "z\n"]);
      expect(await copyPath(join(source, "a.txt"), "single.txt")).toEqual([
        {
          content: new TextEncoder().encode("a\n"),
          path: "single.txt",
        },
      ]);

      expect(await exists(source)).toBe(true);
      expect(await exists(join(root, "missing"))).toBe(false);
      expect(textFile("generated.txt", "body\n", "source.md")).toEqual({
        content: new TextEncoder().encode("body\n"),
        path: "generated.txt",
        sourcePath: "source.md",
      });
      expect(textFile("generated.txt", "body\n")).not.toHaveProperty(
        "sourcePath"
      );
      expect(GENERATED_BY).toMatch(/^skillset@/);
      expect(WORKSPACE_LOCK_ROOT).toBe(".");

      const roots = new Map<string, LockRoot>();
      const claude = lockRootsFor(roots, "plugins/demo", "claude");
      claude.items.push(lockItem("claude"));
      expect(lockRootsFor(roots, "plugins/demo", "claude")).toBe(claude);

      const workspace = lockRootsFor(roots, "plugins/demo", "codex");
      expect(workspace).toEqual({
        items: [lockItem("claude")],
        target: "workspace",
      });
      expect(roots.get("plugins/demo")).toBe(workspace);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function lockItem(name: string) {
  return {
    files: [],
    kind: "plugin" as const,
    name,
    outputHash: "output",
    outputPath: `plugins/${name}`,
    sourceHash: "source",
    sourcePath: `.skillset/plugins/${name}`,
  };
}

function parseSource(fileName: string, source: string): SourceFile {
  return createSourceFile(fileName, source, ScriptTarget.Latest, true);
}

function exportedFunctionNames(source: SourceFile): string[] {
  return source.statements
    .filter(isFunctionDeclaration)
    .filter((declaration) =>
      getModifiers(declaration)?.some(
        (modifier) => modifier.kind === SyntaxKind.ExportKeyword
      )
    )
    .flatMap((declaration) =>
      declaration.name === undefined ? [] : [declaration.name.text]
    )
    .sort();
}

function declaredFunctionNames(source: SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: Parameters<typeof forEachChild>[0]): void => {
    if (isFunctionDeclaration(node) && node.name !== undefined) {
      names.add(node.name.text);
    }
    forEachChild(node, visit);
  };
  visit(source);
  return names;
}
