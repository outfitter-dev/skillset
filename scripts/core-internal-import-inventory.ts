import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { gitSafeEnv } from "../apps/skillset/src/git-env";

const APP_SOURCE_ROOT = "apps/skillset/src";
const CORE_INTERNAL_PREFIX = "@skillset/core/internal/";
const INVENTORY_SCHEMA = "skillset-core-internal-import-inventory@1";

export type CoreInternalImportKind = "mixed" | "type" | "value";

export interface CoreInternalImportDeclaration {
  readonly column: number;
  readonly file: string;
  readonly kind: CoreInternalImportKind;
  readonly line: number;
  readonly subpath: string;
  readonly symbols: readonly string[];
}

export interface CoreInternalImportSubpath {
  readonly declarationCount: number;
  readonly files: readonly string[];
  readonly name: string;
}

export interface CoreInternalImportInventory {
  readonly commit: string;
  readonly declarations: readonly CoreInternalImportDeclaration[];
  readonly ref: string;
  readonly schema: typeof INVENTORY_SCHEMA;
  readonly scope: {
    readonly includeTests: boolean;
    readonly root: typeof APP_SOURCE_ROOT;
  };
  readonly subpaths: readonly CoreInternalImportSubpath[];
  readonly totals: {
    readonly distinctSubpaths: number;
    readonly importDeclarations: number;
    readonly importingFiles: number;
  };
}

export interface CoreInternalImportInventoryOptions {
  readonly includeTests?: boolean;
  readonly ref?: string;
}

export interface ParsedCoreInternalImportInventoryArgs {
  readonly includeTests: boolean;
  readonly ref: string;
}

export function isCoreInternalImportInventoryPath(
  path: string,
  includeTests = false
): boolean {
  if (!path.startsWith(`${APP_SOURCE_ROOT}/`) || !path.endsWith(".ts")) {
    return false;
  }
  return (
    includeTests ||
    (!path.includes("/__tests__/") && !path.endsWith(".test.ts"))
  );
}

export function scanCoreInternalImportSource(
  file: string,
  content: string
): readonly CoreInternalImportDeclaration[] {
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const parseDiagnostics = (
    source as ts.SourceFile & {
      readonly parseDiagnostics: readonly ts.Diagnostic[];
    }
  ).parseDiagnostics;
  if (parseDiagnostics.length > 0) {
    const diagnostic = parseDiagnostics[0];
    throw new Error(
      `${file}: ${ts.flattenDiagnosticMessageText(
        diagnostic?.messageText ?? "TypeScript parse failed",
        "\n"
      )}`
    );
  }

  const declarations: CoreInternalImportDeclaration[] = [];
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith(CORE_INTERNAL_PREFIX)
    ) {
      continue;
    }
    const start = source.getLineAndCharacterOfPosition(
      statement.getStart(source)
    );
    declarations.push({
      column: start.character + 1,
      file,
      kind: importKind(statement.importClause),
      line: start.line + 1,
      subpath: statement.moduleSpecifier.text.slice(
        CORE_INTERNAL_PREFIX.length
      ),
      symbols: importedSymbols(statement.importClause),
    });
  }
  return declarations;
}

export function summarizeCoreInternalImports(
  ref: string,
  commit: string,
  declarations: readonly CoreInternalImportDeclaration[],
  includeTests = false
): CoreInternalImportInventory {
  const sortedDeclarations = [...declarations].sort(compareDeclarations);
  const subpathNames = [
    ...new Set(sortedDeclarations.map(({ subpath }) => subpath)),
  ].sort(compareStrings);
  const subpaths = subpathNames.map((name): CoreInternalImportSubpath => {
    const matches = sortedDeclarations.filter(
      ({ subpath }) => subpath === name
    );
    return {
      declarationCount: matches.length,
      files: [...new Set(matches.map(({ file }) => file))].sort(compareStrings),
      name,
    };
  });
  return {
    commit,
    declarations: sortedDeclarations,
    ref,
    schema: INVENTORY_SCHEMA,
    scope: { includeTests, root: APP_SOURCE_ROOT },
    subpaths,
    totals: {
      distinctSubpaths: subpaths.length,
      importDeclarations: sortedDeclarations.length,
      importingFiles: new Set(sortedDeclarations.map(({ file }) => file)).size,
    },
  };
}

export function parseCoreInternalImportInventoryArgs(
  args: readonly string[]
): ParsedCoreInternalImportInventoryArgs {
  let includeTests = false;
  let ref = "HEAD";
  let sawIncludeTests = false;
  let sawRef = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--include-tests") {
      if (sawIncludeTests) {
        throw new Error("--include-tests may be passed only once");
      }
      includeTests = true;
      sawIncludeTests = true;
      continue;
    }
    if (arg === "--ref") {
      if (sawRef) throw new Error("--ref may be passed only once");
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--ref requires a git ref");
      }
      ref = value;
      sawRef = true;
      index += 1;
      continue;
    }
    throw new Error(`unexpected argument: ${arg}`);
  }
  return { includeTests, ref };
}

export async function collectCoreInternalImportInventory(
  rootPath: string,
  options: CoreInternalImportInventoryOptions = {}
): Promise<CoreInternalImportInventory> {
  const includeTests = options.includeTests ?? false;
  const ref = options.ref ?? "HEAD";
  const commit = (
    await runGitText(rootPath, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${ref}^{commit}`,
    ])
  ).trim();
  const tree = await runGitBytes(rootPath, [
    "ls-tree",
    "-r",
    "-z",
    "--name-only",
    commit,
    "--",
    APP_SOURCE_ROOT,
  ]);
  const files = decode(tree)
    .split("\0")
    .filter(Boolean)
    .filter((path) => isCoreInternalImportInventoryPath(path, includeTests))
    .sort(compareStrings);
  const declarations: CoreInternalImportDeclaration[] = [];
  for (const file of files) {
    const content = await runGitText(rootPath, ["show", `${commit}:${file}`]);
    declarations.push(...scanCoreInternalImportSource(file, content));
  }
  return summarizeCoreInternalImports(ref, commit, declarations, includeTests);
}

export function renderCoreInternalImportInventory(
  inventory: CoreInternalImportInventory
): string {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

function importKind(
  clause: ts.ImportClause | undefined
): CoreInternalImportKind {
  if (clause?.isTypeOnly === true) return "type";
  if (clause === undefined) return "value";
  const bindings = clause.namedBindings;
  if (bindings === undefined || ts.isNamespaceImport(bindings)) return "value";
  const hasType = bindings.elements.some(({ isTypeOnly }) => isTypeOnly);
  const hasValue =
    clause.name !== undefined ||
    bindings.elements.some(({ isTypeOnly }) => !isTypeOnly);
  if (hasType && hasValue) return "mixed";
  return hasType ? "type" : "value";
}

function importedSymbols(
  clause: ts.ImportClause | undefined
): readonly string[] {
  if (clause === undefined) return [];
  const symbols: string[] = [];
  if (clause.name !== undefined) symbols.push("default");
  const bindings = clause.namedBindings;
  if (bindings !== undefined) {
    if (ts.isNamespaceImport(bindings)) symbols.push("*");
    else {
      for (const element of bindings.elements) {
        symbols.push((element.propertyName ?? element.name).text);
      }
    }
  }
  return [...new Set(symbols)].sort(compareStrings);
}

function compareDeclarations(
  left: CoreInternalImportDeclaration,
  right: CoreInternalImportDeclaration
): number {
  return (
    compareStrings(left.file, right.file) ||
    left.line - right.line ||
    left.column - right.column ||
    compareStrings(left.subpath, right.subpath) ||
    compareStrings(left.kind, right.kind)
  );
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function runGitText(
  rootPath: string,
  args: readonly string[]
): Promise<string> {
  return decode(await runGitBytes(rootPath, args));
}

async function runGitBytes(
  rootPath: string,
  args: readonly string[]
): Promise<Uint8Array> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", rootPath, ...args],
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).bytes(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args[0] ?? "command"} failed: ${stderr.trim()}`);
  }
  return stdout;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

async function main(): Promise<void> {
  const options = parseCoreInternalImportInventoryArgs(Bun.argv.slice(2));
  process.stdout.write(
    renderCoreInternalImportInventory(
      await collectCoreInternalImportInventory(rootDir, options)
    )
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
