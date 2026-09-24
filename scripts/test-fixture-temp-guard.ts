import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { gitSafeEnv } from "../apps/skillset/src/git-env";

export interface TempCall {
  readonly file: string;
  readonly line: number;
  readonly owner: string;
  readonly usage: "readdir" | "other";
}

export interface TempObservation {
  readonly file: string;
  readonly owner: string;
  readonly count: number;
  readonly reason: string;
  readonly usage: "readdir";
}

export interface TempGuardResult {
  readonly violations: readonly TempCall[];
  readonly stale: readonly TempObservation[];
  readonly mismatches: readonly { observation: TempObservation; observed: number }[];
}

// These read the real OS temp directory to prove production cleanup. They do
// not allocate test fixtures there. Exact owner/count/usage matching prevents a new
// fixture allocation from quietly inheriting an observation exception.
export const TEMP_OBSERVATIONS: readonly TempObservation[] = [
  { file: "apps/skillset/src/__tests__/adopt.test.ts", owner: "temporaryRoots", count: 1, reason: "Observe remote clone cleanup.", usage: "readdir" },
  { file: "apps/skillset/src/__tests__/change-scope-history.test.ts", owner: "snapshotRootNames", count: 1, reason: "Observe snapshot cleanup.", usage: "readdir" },
  { file: "scripts/conformance/standards/__tests__/agent-instructions.test.ts", owner: "probeDirectories", count: 1, reason: "Observe operational probe cleanup.", usage: "readdir" },
] as const;

export function isTestSourcePath(path: string): boolean {
  if (!/^(?:apps|packages|scripts)\//u.test(path)) return false;
  if (!/\.tsx?$/u.test(path)) return false;
  return /\.test\.tsx?$/u.test(path) || path.includes("/__tests__/");
}

function isOsModule(node: ts.Expression): boolean {
  return ts.isStringLiteral(node) && (node.text === "node:os" || node.text === "os");
}

function isOsRequire(node: ts.Node, checker: ts.TypeChecker): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && checker.getSymbolAtLocation(node.expression) === undefined && node.arguments.length === 1 && isOsModule(node.arguments[0]!);
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current) || ts.isAwaitExpression(current)) {
    current = current.expression;
  }
  return current;
}

function isOsDynamicImport(node: ts.Node): boolean {
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && isOsModule(node.arguments[0]!);
}

function usageOf(node: ts.CallExpression, checker: ts.TypeChecker): TempCall["usage"] {
  let expression: ts.Node = node;
  while (expression.parent && ts.isParenthesizedExpression(expression.parent)) expression = expression.parent;
  const parent = expression.parent;
  if (!parent || !ts.isCallExpression(parent) || !ts.isIdentifier(parent.expression) || !parent.arguments.some((argument) => argument === expression)) return "other";
  const declarations = checker.getSymbolAtLocation(parent.expression)?.declarations ?? [];
  return declarations.some((declaration) => {
    if (!ts.isImportSpecifier(declaration) || (declaration.propertyName ?? declaration.name).text !== "readdir") return false;
    const imported = declaration.parent.parent.parent;
    return ts.isImportDeclaration(imported) && ts.isStringLiteral(imported.moduleSpecifier) && imported.moduleSpecifier.text === "node:fs/promises";
  }) ? "readdir" : "other";
}

function ownerOf(node: ts.Node): string {
  let variableOwner: string | undefined;
  for (let parent: ts.Node | undefined = node; parent !== undefined; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) && parent.name) return parent.name.text;
    if (ts.isMethodDeclaration(parent) && parent.name) return parent.name.getText();
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) variableOwner ??= parent.name.text;
  }
  return variableOwner ?? "<module>";
}

export function scanTempCalls(file: string, content: string): readonly TempCall[] {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const options: ts.CompilerOptions = { noLib: true, noResolve: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => name === file ? source : undefined;
  host.fileExists = (name) => name === file;
  host.readFile = (name) => name === file ? content : undefined;
  const checker = ts.createProgram([file], options, host).getTypeChecker();

  const importedFromOs = (declaration: ts.Declaration): boolean => {
    if (ts.isImportEqualsDeclaration(declaration)) {
      return ts.isExternalModuleReference(declaration.moduleReference) && declaration.moduleReference.expression !== undefined && isOsModule(declaration.moduleReference.expression);
    }
    for (let parent: ts.Node | undefined = declaration; parent; parent = parent.parent) {
      if (ts.isImportDeclaration(parent)) return isOsModule(parent.moduleSpecifier);
    }
    return false;
  };
  const declarationsOf = (node: ts.Identifier): readonly ts.Declaration[] =>
    checker.getSymbolAtLocation(node)?.declarations ?? [];
  const isOsObject = (expression: ts.Expression, seen = new Set<ts.Declaration>()): boolean => {
    const node = unwrap(expression);
    if (isOsRequire(node, checker) || isOsDynamicImport(node)) return true;
    if (!ts.isIdentifier(node)) return false;
    return declarationsOf(node).some((declaration) => {
      if (seen.has(declaration)) return false;
      seen.add(declaration);
      if (ts.isImportClause(declaration) || ts.isNamespaceImport(declaration) || ts.isImportEqualsDeclaration(declaration)) return importedFromOs(declaration);
      return ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined && isOsObject(declaration.initializer, seen);
    });
  };
  const isTempReference = (expression: ts.Expression, seen = new Set<ts.Declaration>()): boolean => {
    const node = unwrap(expression);
    if (ts.isPropertyAccessExpression(node)) return node.name.text === "tmpdir" && isOsObject(node.expression);
    if (ts.isElementAccessExpression(node)) return node.argumentExpression !== undefined && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === "tmpdir" && isOsObject(node.expression);
    if (!ts.isIdentifier(node)) return false;
    return declarationsOf(node).some((declaration) => {
      if (seen.has(declaration)) return false;
      seen.add(declaration);
      if (ts.isImportSpecifier(declaration)) return (declaration.propertyName ?? declaration.name).text === "tmpdir" && importedFromOs(declaration);
      if (ts.isBindingElement(declaration)) {
        const key = declaration.propertyName ?? declaration.name;
        const variable = declaration.parent.parent;
        return ts.isIdentifier(key) && key.text === "tmpdir" && ts.isVariableDeclaration(variable) && variable.initializer !== undefined && isOsObject(variable.initializer);
      }
      return ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined && isTempReference(declaration.initializer, seen);
    });
  };

  const calls: TempCall[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTempReference(node.expression)) {
      calls.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, owner: ownerOf(node), usage: usageOf(node, checker) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

export function auditTempCalls(
  sources: readonly { file: string; content: string }[],
  observations: readonly TempObservation[] = TEMP_OBSERVATIONS
): TempGuardResult {
  const calls = sources.flatMap(({ file, content }) => scanTempCalls(file, content));
  const matches = (call: TempCall, entry: TempObservation): boolean => call.file === entry.file && call.owner === entry.owner && call.usage === entry.usage;
  const countFor = (entry: TempObservation): number => calls.filter((call) => matches(call, entry)).length;
  return {
    violations: calls.filter((call) => !observations.some((entry) => matches(call, entry))),
    stale: observations.filter((entry) => countFor(entry) === 0),
    mismatches: observations.filter((entry) => countFor(entry) > 0 && countFor(entry) !== entry.count).map((observation) => ({ observation, observed: countFor(observation) })),
  };
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

async function main(): Promise<void> {
  const proc = Bun.spawn(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: rootDir,
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (exitCode !== 0) throw new Error(`git ls-files failed: ${stderr.trim()}`);
  const files = stdout.split("\0").filter(isTestSourcePath).filter((file) => existsSync(join(rootDir, file)));
  const sources = await Promise.all(files.map(async (file) => ({ file, content: await Bun.file(join(rootDir, file)).text() })));
  const result = auditTempCalls(sources);
  const failures = [
    ...result.violations.map((call) => `${call.file}:${call.line}: ${call.owner} calls OS tmpdir() in a test`),
    ...result.stale.map((entry) => `${entry.file}: ${entry.owner} has a stale OS-temp observation exception (${entry.reason})`),
    ...result.mismatches.map(({ observation, observed }) => `${observation.file}: ${observation.owner} uses OS tmpdir() ${observed} times; allowed ${observation.count}`),
  ];
  if (failures.length > 0) {
    console.error(`skillset: test fixture temp guard found ${failures.length} failure(s):`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.error(`skillset: test fixture temp guard scanned ${files.length} test sources; OS temp observations are exact`);
}

if (import.meta.main) main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
