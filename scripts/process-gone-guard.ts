/**
 * Process-gone assertion guard (SET-633).
 *
 * After a process group is killed, Linux can briefly report a descendant as
 * still running. A test that asserts "this process is gone" must poll
 * `process.kill(pid, 0)` until ESRCH or a deadline — never observe once.
 *
 * This guard rejects a one-shot `process.kill(pid, 0)` existence check
 * wrapped in `expect(...).toThrow()`. Use `expectProcessGone` from
 * `scripts/test-helpers/process.ts` instead.
 *
 * Run it with `bun run process-gone:guard`.
 */

import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { gitSafeEnv } from "../apps/skillset/src/git-env";

export interface ProcessGoneViolation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

const GUARD_OWN_PATHS = new Set([
  "scripts/process-gone-guard.ts",
  "scripts/__tests__/process-gone-guard.test.ts",
]);

export function isProcessGoneGuardPath(path: string): boolean {
  if (GUARD_OWN_PATHS.has(path)) return false;
  if (!path.endsWith(".ts")) return false;
  return (
    path.startsWith("apps/") ||
    path.startsWith("packages/") ||
    path.startsWith("scripts/")
  );
}

export function scanImmediateProcessGoneAssertions(
  file: string,
  content: string
): readonly ProcessGoneViolation[] {
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const violations: ProcessGoneViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (isImmediateProcessGoneAssertion(node)) {
      const reportedNode = ts.isExpressionStatement(node.parent)
        ? node.parent
        : node;
      const start = source.getLineAndCharacterOfPosition(
        reportedNode.getStart(source)
      );
      violations.push({
        file,
        line: start.line + 1,
        text: reportedNode.getText(source).replace(/\s+/gu, " "),
      });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

function isImmediateProcessGoneAssertion(
  node: ts.Node
): node is ts.CallExpression {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression)
  ) {
    return false;
  }
  if (
    node.expression.name.text !== "toThrow" &&
    node.expression.name.text !== "toThrowError"
  ) {
    return false;
  }
  const expectCall = node.expression.expression;
  if (
    !ts.isCallExpression(expectCall) ||
    !ts.isIdentifier(expectCall.expression) ||
    expectCall.expression.text !== "expect" ||
    expectCall.arguments.length !== 1
  ) {
    return false;
  }
  const callback = expectCall.arguments[0];
  return (
    callback !== undefined &&
    (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
    containsProcessKillZero(callback.body)
  );
}

function containsProcessKillZero(node: ts.Node): boolean {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "process" &&
    node.expression.name.text === "kill" &&
    node.arguments.length === 2 &&
    node.arguments[1]?.kind === ts.SyntaxKind.NumericLiteral &&
    (node.arguments[1] as ts.NumericLiteral).text === "0"
  ) {
    return true;
  }
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && containsProcessKillZero(child)) found = true;
  });
  return found;
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

async function runText(command: readonly string[]): Promise<string> {
  const subprocess = Bun.spawn([...command], {
    cwd: rootDir,
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0)
    throw new Error(`${command.join(" ")} failed: ${stderr.trim()}`);
  return stdout;
}

async function main(): Promise<void> {
  const files = (
    await runText([
      "git",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
    ])
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const scannable = files.filter(isProcessGoneGuardPath);
  const violations: ProcessGoneViolation[] = [];

  for (const file of scannable) {
    const path = `${rootDir}/${file}`;
    if (!existsSync(path)) continue;
    violations.push(
      ...scanImmediateProcessGoneAssertions(file, await Bun.file(path).text())
    );
  }

  if (violations.length === 0) {
    console.error(
      `skillset: process-gone guard scanned ${scannable.length} files; no one-shot process-gone assertions found`
    );
    return;
  }

  console.error(
    `skillset: process-gone guard found ${violations.length} one-shot process-gone assertion(s):`
  );
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}`);
    console.error(`    ${violation.text}`);
  }
  console.error(
    "skillset: await expectProcessGone(pid) from scripts/test-helpers/process.ts instead of observing process.kill(pid, 0) once."
  );
  process.exit(1);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
