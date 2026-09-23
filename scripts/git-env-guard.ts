/**
 * Git subprocess environment guard (SET-632).
 *
 * Hook-exported `GIT_DIR` (and related repository-targeting variables) override
 * `git -C` and cwd discovery. Direct spawn calls whose executable is a `"git"`
 * literal or a locally initialized argv alias must use the shared sanitized
 * environment (`gitSafeEnv`, `gitReadOnlyEnv`, or the test helper `testGitEnv`).
 * Command wrappers must sanitize at their spawn site; this syntax guard does not
 * attempt interprocedural data flow through wrapper parameters.
 */

import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import {
  gitRepositoryTargetingKeys,
  gitSafeEnv,
} from "../apps/skillset/src/git-env";

export interface GitEnvViolation {
  readonly column: number;
  readonly file: string;
  readonly line: number;
  readonly owner: string;
  readonly text: string;
}

const SANITIZER_NAMES = new Set(["gitReadOnlyEnv", "gitSafeEnv", "testGitEnv"]);
const SPAWN_CALLEES = new Set([
  "exec",
  "execFile",
  "execFileAsync",
  "execFileSync",
  "execSync",
  "spawn",
  "spawnSync",
]);

export function isGitEnvSourcePath(path: string): boolean {
  return /^(?:apps|packages|scripts)\//u.test(path) && path.endsWith(".ts");
}

export function scanGitEnvSource(file: string, content: string): readonly GitEnvViolation[] {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: GitEnvViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isGitSpawn(node)) {
      if (!envIsSanitized(node)) {
        const start = source.getLineAndCharacterOfPosition(node.getStart(source));
        violations.push({
          column: start.character + 1,
          file,
          line: start.line + 1,
          owner: ownerOf(node, source),
          text: normalizedText(node, source),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

function isGitSpawn(node: ts.CallExpression): boolean {
  const name = calleeName(node);
  if (name === undefined || !SPAWN_CALLEES.has(name)) return false;
  const first = node.arguments[0];
  if (first === undefined) return false;
  return expressionStartsWithGit(first);
}

function envIsSanitized(node: ts.CallExpression): boolean {
  const options = optionsObject(node);
  if (options === undefined) return false;
  const envProp = findProperty(options, "env");
  if (envProp === undefined) return false;
  if (ts.isShorthandPropertyAssignment(envProp)) {
    return identifierIsSanitized(envProp.name);
  }
  if (ts.isPropertyAssignment(envProp)) {
    return expressionIsSanitized(envProp.initializer);
  }
  return false;
}

function optionsObject(node: ts.CallExpression): ts.ObjectLiteralExpression | undefined {
  const first = node.arguments[0];
  if (first !== undefined && ts.isObjectLiteralExpression(first) && objectCmdStartsWithGit(first)) {
    return first;
  }
  for (let index = node.arguments.length - 1; index >= 0; index -= 1) {
    const argument = node.arguments[index];
    if (argument !== undefined && ts.isObjectLiteralExpression(argument)) return argument;
  }
  return undefined;
}

function expressionIsSanitized(
  node: ts.Expression,
  seen: ReadonlySet<ts.Node> = new Set()
): boolean {
  const expression = unwrapExpression(node);
  if (seen.has(expression)) return false;
  const nextSeen = new Set(seen).add(expression);
  if (ts.isCallExpression(expression)) {
    return sanitizerCallName(expression) !== undefined;
  }
  if (ts.isIdentifier(expression)) {
    const initializer = localInitializer(expression);
    return initializer !== undefined && expressionIsSanitized(initializer, nextSeen);
  }
  if (ts.isObjectLiteralExpression(expression)) {
    let includesSanitizedEnv = false;
    for (const property of expression.properties) {
      if (ts.isSpreadAssignment(property)) {
        if (expressionIsAmbientProcessEnv(property.expression, nextSeen)) return false;
        includesSanitizedEnv ||= expressionIsSanitized(property.expression, nextSeen);
        continue;
      }
      const name = staticPropertyName(property);
      if (
        name !== undefined &&
        gitRepositoryTargetingKeys({ [name]: "guard-probe" }).length > 0
      ) {
        return false;
      }
    }
    return includesSanitizedEnv;
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      expressionIsSanitized(expression.whenTrue, nextSeen) &&
      expressionIsSanitized(expression.whenFalse, nextSeen)
    );
  }
  return false;
}

function sanitizerCallName(node: ts.CallExpression): string | undefined {
  const name = calleeName(node);
  return name !== undefined && SANITIZER_NAMES.has(name) ? name : undefined;
}

function identifierIsSanitized(id: ts.Identifier): boolean {
  const initializer = localInitializer(id);
  return initializer !== undefined && expressionIsSanitized(initializer);
}

function enclosingFunction(node: ts.Node): ts.Node | undefined {
  for (let current: ts.Node | undefined = node.parent; current !== undefined; current = current.parent) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isConstructorDeclaration(current)
    ) {
      return current;
    }
  }
  return undefined;
}

function calleeName(node: ts.CallExpression): string | undefined {
  const expr = node.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return undefined;
}

function expressionStartsWithGit(
  node: ts.Expression,
  seen: ReadonlySet<ts.Node> = new Set()
): boolean {
  const expression = unwrapExpression(node);
  if (seen.has(expression)) return false;
  const nextSeen = new Set(seen).add(expression);
  if (isGitString(expression)) return true;
  if (ts.isArrayLiteralExpression(expression)) return arrayStartsWithGit(expression, nextSeen);
  if (ts.isObjectLiteralExpression(expression)) return objectCmdStartsWithGit(expression, nextSeen);
  if (ts.isIdentifier(expression)) {
    const initializer = localInitializer(expression);
    return initializer !== undefined && expressionStartsWithGit(initializer, nextSeen);
  }
  return false;
}

function isGitString(node: ts.Expression): boolean {
  return ts.isStringLiteral(node) && node.text === "git";
}

function arrayStartsWithGit(
  node: ts.ArrayLiteralExpression,
  seen: ReadonlySet<ts.Node> = new Set()
): boolean {
  const first = node.elements[0];
  if (first === undefined) return false;
  return ts.isSpreadElement(first)
    ? expressionStartsWithGit(first.expression, seen)
    : expressionStartsWithGit(first, seen);
}

function objectCmdStartsWithGit(
  node: ts.ObjectLiteralExpression,
  seen: ReadonlySet<ts.Node> = new Set()
): boolean {
  const cmd = findProperty(node, "cmd") ?? findProperty(node, "command");
  if (cmd === undefined) return false;
  if (ts.isPropertyAssignment(cmd)) return expressionStartsWithGit(cmd.initializer, seen);
  if (ts.isShorthandPropertyAssignment(cmd)) return expressionStartsWithGit(cmd.name, seen);
  return false;
}

function expressionIsAmbientProcessEnv(
  node: ts.Expression,
  seen: ReadonlySet<ts.Node> = new Set()
): boolean {
  const expression = unwrapExpression(node);
  if (seen.has(expression)) return false;
  const nextSeen = new Set(seen).add(expression);
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "process" &&
    expression.name.text === "env"
  ) {
    return true;
  }
  if (ts.isIdentifier(expression)) {
    const initializer = localInitializer(expression);
    return initializer !== undefined && expressionIsAmbientProcessEnv(initializer, nextSeen);
  }
  return false;
}

function localInitializer(id: ts.Identifier): ts.Expression | undefined {
  let match: ts.VariableDeclaration | undefined;
  const source = id.getSourceFile();
  const owner = enclosingFunction(id) ?? source;
  const usePosition = id.getStart(source);
  const visit = (node: ts.Node): void => {
    if (node.getStart(source) >= usePosition) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === id.text &&
      node.initializer !== undefined &&
      (match === undefined || node.getStart(source) > match.getStart(source))
    ) {
      match = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(owner);
  return match?.initializer;
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function findProperty(
  node: ts.ObjectLiteralExpression,
  name: string
): ts.ObjectLiteralElementLike | undefined {
  return node.properties.find((property) => {
    if (ts.isShorthandPropertyAssignment(property)) return property.name.text === name;
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
      return property.name.text === name;
    }
    return false;
  });
}

function staticPropertyName(node: ts.ObjectLiteralElementLike): string | undefined {
  if (
    ts.isPropertyAssignment(node) ||
    ts.isShorthandPropertyAssignment(node) ||
    ts.isMethodDeclaration(node)
  ) {
    if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text;
  }
  return undefined;
}

function ownerOf(node: ts.Node, source: ts.SourceFile): string {
  let variableOwner: string | undefined;
  for (let current: ts.Node | undefined = node; current !== undefined; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name !== undefined) return current.name.text;
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      variableOwner ??= current.name.text;
    }
  }
  return variableOwner ?? "<module>";
}

function normalizedText(node: ts.Node, source: ts.SourceFile): string {
  return node.getText(source).replace(/\s+/gu, " ").trim();
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

async function gitFiles(): Promise<readonly string[]> {
  const proc = Bun.spawn(["git", "ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: rootDir,
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`git ls-files failed: ${stderr.trim()}`);
  return stdout.split("\n").filter(Boolean);
}

async function main(): Promise<void> {
  const files = (await gitFiles()).filter((file) => isGitEnvSourcePath(file) && existsSync(`${rootDir}/${file}`));
  const violations: GitEnvViolation[] = [];
  for (const file of files) {
    violations.push(...scanGitEnvSource(file, await Bun.file(`${rootDir}/${file}`).text()));
  }

  if (violations.length === 0) {
    console.error(
      `skillset: git env guard scanned ${files.length} files; no unsanitized git spawns found`
    );
    return;
  }

  console.error(`skillset: git env guard found ${violations.length} unsanitized git spawn(s):`);
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}:${violation.column} ${violation.owner}`);
    console.error(`    ${violation.text}`);
  }
  console.error(
    "skillset: pass env: gitSafeEnv() (or gitReadOnlyEnv() / testGitEnv()) to every git spawn."
  );
  process.exit(1);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
