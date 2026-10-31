import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// These are the filesystem readers audited on the status graph/render/ledger
// paths. This prevents new native-read bypasses in those owners; it is not a
// proof of call-graph closure or of subprocess isolation.
const coreReaders = [
  "authoring", "build", "fs-existence", "generated-file-mode", "licenses", "lint",
  "migration-state", "native-island-preprocess", "native-root-rules", "on-disk-json",
  "openai-marketplace", "output-safety", "path", "pending-ledger-events", "portable-mcp",
  "preprocess", "release-state", "render", "render-agent-plugins-standard", "render-agent-skills",
  "render-codex-skill-sidecars", "render-hooks", "render-plugin-manifest", "render-project-hooks",
  "render-result-collector", "render-support", "repository-mutation", "resolver", "resources",
  "skill-eval", "supports", "test-declaration",
];
const writeImports: Readonly<Record<string, readonly string[]>> = {
  "apps/skillset/src/change-entries.ts": ["rm"],
  "packages/core/src/authoring.ts": ["writeFile"],
  "packages/core/src/build.ts": ["mkdir", "rm", "writeFile"],
  "packages/core/src/generated-file-mode.ts": ["chmod"],
  "packages/core/src/output-safety.ts": ["chmod", "mkdtemp", "rm", "rmdir", "writeFile"],
  "packages/core/src/repository-mutation.ts": ["mkdir"],
};
const root = new URL("../../../../", import.meta.url);
const nativeFs = /^(?:node:)?fs(?:\/promises)?$/u;

test("audited status filesystem readers use the scoped read facade", async () => {
  const failures: string[] = [];
  for (const file of [...coreReaders.map(name => `packages/core/src/${name}.ts`), "apps/skillset/src/change-entries.ts"]) {
    const text = await readFile(fileURLToPath(new URL(file, root)), "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node): void {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && nativeFs.test(node.moduleSpecifier.text)) {
        const clause = node.importClause;
        if (clause?.isTypeOnly) return;
        const bindings = clause?.namedBindings;
        if (clause?.name || !bindings || !ts.isNamedImports(bindings)) failures.push(`${file}: namespace/default native filesystem import`);
        else for (const item of bindings.elements) {
          if (item.isTypeOnly) continue;
          const name = (item.propertyName ?? item.name).text;
          if (name !== "constants" && !writeImports[file]?.includes(name)) failures.push(`${file}: native ${name}`);
        }
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && nativeFs.test(node.moduleSpecifier.text) && !node.isTypeOnly) {
        failures.push(`${file}: native filesystem re-export`);
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteral(argument) && nativeFs.test(argument.text)) failures.push(`${file}: dynamic native filesystem import`);
      }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Bun" && ["file", "Glob"].includes(node.name.text)) {
        failures.push(`${file}: unguarded Bun.${node.name.text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(failures).toEqual([]);
});
