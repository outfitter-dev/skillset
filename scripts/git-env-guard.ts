/**
 * Git subprocess environment guard (SET-632).
 *
 * Hook-exported `GIT_DIR` (and related repository-targeting variables) override
 * `git -C` and cwd discovery. Every production or test spawn that passes `"git"`
 * in argv must use the shared sanitized environment (`gitSafeEnv`,
 * `gitReadOnlyEnv`, or the test helper `testGitEnv`). A newly introduced bare
 * git spawn fails this guard.
 */

import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { gitSafeEnv } from "../apps/skillset/src/git-env";

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
  return isGitString(first) || arrayStartsWithGit(first) || objectCmdStartsWithGit(first);
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

function expressionIsSanitized(node: ts.Expression): boolean {
  if (expressionMentionsSanitizer(node)) return true;
  return ts.isIdentifier(node) && identifierIsSanitized(node);
}

function expressionMentionsSanitizer(node: ts.Node): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (ts.isIdentifier(current) && SANITIZER_NAMES.has(current.text)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function identifierIsSanitized(id: ts.Identifier): boolean {
  if (SANITIZER_NAMES.has(id.text)) return true;
  const owner = enclosingFunction(id);
  if (owner === undefined) return false;
  let sanitized = false;
  const visit = (current: ts.Node): void => {
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.name.text === id.text &&
      current.initializer !== undefined &&
      expressionMentionsSanitizer(current.initializer)
    ) {
      sanitized = true;
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(owner);
  return sanitized;
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

function isGitString(node: ts.Expression): boolean {
  return ts.isStringLiteral(node) && node.text === "git";
}

function arrayStartsWithGit(node: ts.Expression): boolean {
  if (!ts.isArrayLiteralExpression(node)) return false;
  const first = node.elements[0];
  return first !== undefined && isGitString(first);
}

function objectCmdStartsWithGit(node: ts.Expression): boolean {
  if (!ts.isObjectLiteralExpression(node)) return false;
  const cmd = findProperty(node, "cmd") ?? findProperty(node, "command");
  return (
    cmd !== undefined &&
    ts.isPropertyAssignment(cmd) &&
    arrayStartsWithGit(cmd.initializer)
  );
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
