/**
 * Path-containment guard (SET-634).
 *
 * OS-path writes must go through `packages/core/src/path.ts`. This rejects
 * new `isAbsolute(relative…)` checks, `relative(…).startsWith("..")` tests,
 * and realpath slash-prefix comparisons outside that helper.
 */

import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

export interface PathContainmentViolation {
  readonly file: string;
  readonly label: string;
  readonly line: number;
  readonly text: string;
}

const OWNED_HELPER = "packages/core/src/path.ts";
const ABSOLUTE_RELATIVE_PATTERN = /\bisAbsolute\(\s*relative/u;

export function isScannablePathContainmentPath(path: string): boolean {
  if (path === OWNED_HELPER) return false;
  if (path.includes("/__tests__/")) return false;
  if (path.endsWith(".test.ts")) return false;
  if (!path.endsWith(".ts")) return false;
  return path.startsWith("apps/") || path.startsWith("packages/");
}

export function scanPathContainmentContent(
  file: string,
  content: string
): readonly PathContainmentViolation[] {
  const violations: PathContainmentViolation[] = [];
  const lines = content.split(/\r?\n/u);
  for (const [index, text] of lines.entries()) {
    if (ABSOLUTE_RELATIVE_PATTERN.test(text)) {
      violations.push({
        file,
        label: "isAbsolute(relative) belongs in path.ts",
        line: index + 1,
        text: text.trim(),
      });
    }
  }

  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const report = (node: ts.Node, label: string): void => {
    const start = source.getLineAndCharacterOfPosition(node.getStart(source));
    const text = lines[start.line]?.trim() ?? "";
    if (violations.some((violation) => violation.line === start.line + 1 && violation.label === label)) {
      return;
    }
    violations.push({ file, label, line: start.line + 1, text });
  };

  const relativeNames = new Set<string>();
  const realPathNames = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined && ts.isIdentifier(node.name)) {
      const initializer = unwrapExpression(node.initializer);
      if (isNamedCall(initializer, "relative")) relativeNames.add(node.name.text);
      if (isNamedCall(initializer, "realpath")) realPathNames.add(node.name.text);
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.name.text === "startsWith" && node.arguments[0] !== undefined) {
        const receiver = unwrapExpression(node.expression.expression);
        const argument = node.arguments[0];
        if (isNamedCall(receiver, "relative") && isParentPrefixLiteral(argument)) {
          report(node, "relative(...).startsWith('..') belongs in path.ts");
        }
        if (ts.isIdentifier(receiver) && relativeNames.has(receiver.text) && isParentPrefixLiteral(argument)) {
          report(node, "relative(...).startsWith('..') belongs in path.ts");
        }
        if (ts.isIdentifier(receiver) && realPathNames.has(receiver.text) && isSlashPrefixTemplate(argument)) {
          report(node, "realpath slash-prefix comparison belongs in path.ts");
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (true) {
    if (
      ts.isAwaitExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isParenthesizedExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      (current.expression.name.text === "replaceAll" || current.expression.name.text === "replace")
    ) {
      current = current.expression.expression;
      continue;
    }
    return current;
  }
}

function isNamedCall(node: ts.Expression, name: string): boolean {
  if (!ts.isCallExpression(node)) return false;
  const expression = node.expression;
  if (ts.isIdentifier(expression)) return expression.text === name;
  return ts.isPropertyAccessExpression(expression) && expression.name.text === name;
}

function isParentPrefixLiteral(node: ts.Expression): boolean {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text === ".." || node.text.startsWith("..");
  }
  if (ts.isTemplateExpression(node) && node.head.text === "..") return true;
  return false;
}

function isSlashPrefixTemplate(node: ts.Expression): boolean {
  return ts.isTemplateExpression(node) && node.templateSpans.some((span) => span.literal.text.startsWith("/"));
}

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

async function runText(command: readonly string[]): Promise<string> {
  const subprocess = Bun.spawn([...command], { cwd: rootDir, stderr: "pipe", stdout: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${stderr.trim()}`);
  return stdout;
}

async function main(): Promise<void> {
  const files = (await runText(["git", "ls-files", "--cached", "--others", "--exclude-standard"]))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const scannable = files.filter(isScannablePathContainmentPath);
  const violations: PathContainmentViolation[] = [];

  for (const file of scannable) {
    const path = `${rootDir}/${file}`;
    if (!existsSync(path)) continue;
    violations.push(...scanPathContainmentContent(file, await Bun.file(path).text()));
  }

  if (violations.length === 0) {
    console.error(
      `skillset: path containment guard scanned ${scannable.length} source files; OS-path checks stay in path.ts`
    );
    return;
  }

  console.error(`skillset: path containment guard found ${violations.length} inline OS-path check(s):`);
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}: ${violation.label}`);
    console.error(`    ${violation.text}`);
  }
  console.error("skillset: use isPathInside, resolveInside, or assertRealPathInside from packages/core/src/path.ts.");
  process.exit(1);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
