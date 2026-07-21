import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { gitSafeEnv } from "../apps/skillset/src/git-env";
import { TARGET_NAMES } from "../packages/schema/src";

export type TargetTopologyRule = "R1" | "R2" | "R3";

export interface TargetTopologyViolation {
  readonly column: number;
  readonly file: string;
  readonly line: number;
  readonly owner: string;
  readonly rule: TargetTopologyRule;
  readonly text: string;
}

export interface TargetTopologyAllowlistEntry extends TargetTopologyViolation {
  readonly rationale: string;
}

export interface TargetTopologySource {
  readonly content: string;
  readonly file: string;
}

export interface TargetTopologyScanResult {
  readonly duplicateAllowlist: readonly TargetTopologyDuplicateAllowlist[];
  readonly unmatchedAllowlist: readonly TargetTopologyAllowlistEntry[];
  readonly violations: readonly TargetTopologyViolation[];
}

export interface TargetTopologyDuplicateAllowlist extends TargetTopologyViolation {
  readonly count: number;
  readonly rationales: readonly string[];
}

export const TARGET_TOPOLOGY_ALLOWLIST: readonly TargetTopologyAllowlistEntry[] = [
  allow("packages/schema/src/contracts.ts", 10, 29, "TARGET_NAMES", "R1", '["claude", "codex", "cursor"]', "Canonical target registry declaration."),
  allow("packages/schema/src/examples.ts", 47, 18, "skillsetSchemaExamples", "R1", '["claude", "codex", "cursor"]', "Schema example demonstrates the complete targets field."),
  allow("packages/schema/src/examples.ts", 93, 20, "skillsetSchemaExamples", "R1", '["claude", "codex", "cursor"]', "Schema example demonstrates the complete marketplace targets field."),
  allow("packages/schema/src/examples.ts", 214, 24, "skillsetSchemaExamples", "R1", '["claude", "codex"]', "Schema example documents an intentionally provider-scoped hook."),
  allow("packages/schema/src/examples.ts", 368, 18, "skillsetSchemaExamples", "R1", '["claude", "codex"]', "Schema example documents an intentionally provider-scoped hook."),
  allow("packages/schema/src/examples.ts", 429, 16, "skillsetSchemaExamples", "R1", '["claude", "codex", "cursor"]', "Schema example demonstrates the complete activation targets field."),
  allow("packages/registry/src/index.ts", 9, 52, "PROVIDER_DESTINATION_FORMAT_TARGETS", "R1", '["claude", "codex", "cursor"]', "Provider-native format registry declaration."),
  allow("packages/registry/src/schema-snapshots.ts", 5, 40, "PROVIDER_SCHEMA_TARGETS", "R1", '["claude", "codex", "cursor"]', "Provider-native schema registry declaration."),
  allow("scripts/source-layout-migration.ts", 72, 24, "readLegacyOutputGroup", "R1", '["claude", "codex"]', "Historical migration reads the two targets supported by that legacy shape."),
  allow("scripts/bootstrap/main.ts", 59, 15, "parseBootstrapArgs", "R2", 'command === "claude" || command === "codex"', "Bootstrap exposes provider-specific setup commands only for the two supported runtimes."),
  allow("packages/core/src/render-result-collector.ts", 731, 10, "companionForPath", "R2", 'target === "claude" || target === "cursor"', "Commands are provider-native companion formats for Claude and Cursor."),
  allow("packages/core/src/render-result-collector.ts", 737, 10, "companionForPath", "R2", 'target === "claude" || target === "cursor"', "Agents are provider-native companion formats for Claude and Cursor."),
  allow("packages/core/src/render.ts", 1255, 7, "copyPluginCompanionFiles", "R2", 'target === "codex" || target === "cursor"', "Codex and Cursor hooks require normalized provider-native output."),
  allow("packages/core/src/render.ts", 1275, 10, "copyPluginCompanionFiles", "R2", 'target === "codex" || target === "cursor"', "Codex and Cursor skip copying Claude-native hook files."),
  allow("apps/skillset/src/provider-format-updates.ts", 195, 10, "displayProvider", "R3", 'provider === "codex" -> provider === "claude" -> else', "Provider display labels preserve unknown registry values."),
  allow("packages/core/src/provider-format-conformance.ts", 465, 5, "checkSkillMarkdown", "R3", 'target === "codex" -> target === "cursor" -> else', "Provider-native skill formats use distinct registry references."),
  allow("packages/core/src/render-plugin-manifest.ts", 66, 5, "renderPluginManifest", "R3", 'target === "claude" -> target === "codex" -> else', "Provider-native plugin manifests have distinct formats."),
  allow("packages/core/src/render-plugin-manifest.ts", 239, 3, "withOptionalSurfacePaths", "R3", 'target === "claude" -> target === "codex" -> else', "Provider-native plugin surfaces have distinct destination fields."),
  allow("packages/core/src/render.ts", 1237, 5, "copyPluginCompanionFiles", "R3", 'target === "claude" -> target === "codex" -> else', "Provider-native companion file sets are intentionally distinct."),
  allow("packages/core/src/render.ts", 265, 3, "marketplaceReadmeLines", "R3", 'target === "claude" -> target === "cursor" -> else', "Provider-native marketplace README guidance has distinct destination formats."),
] as const;

function allow(
  file: string,
  line: number,
  column: number,
  owner: string,
  rule: TargetTopologyRule,
  text: string,
  rationale: string
): TargetTopologyAllowlistEntry {
  return { column, file, line, owner, rationale, rule, text };
}

export function isTargetTopologySourcePath(path: string): boolean {
  if (!/^(?:apps|packages|scripts)\//u.test(path) || !path.endsWith(".ts")) return false;
  if (path.includes("/__tests__/") || path.endsWith(".test.ts")) return false;
  if (path.includes("/fixtures/") || path.startsWith("scripts/fixtures/")) return false;
  return true;
}

export function scanTargetTopologySource(
  file: string,
  content: string,
  registeredTargets: readonly string[] = TARGET_NAMES,
  allowlist: readonly TargetTopologyAllowlistEntry[] = TARGET_TOPOLOGY_ALLOWLIST
): readonly TargetTopologyViolation[] {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const targets = new Set(registeredTargets);
  const violations: TargetTopologyViolation[] = [];

  const report = (node: ts.Node, rule: TargetTopologyRule, text: string) => {
    const start = source.getLineAndCharacterOfPosition(node.getStart(source));
    const violation = {
      column: start.character + 1,
      file,
      line: start.line + 1,
      owner: ownerOf(node, source),
      rule,
      text,
    } as const;
    if (!allowlist.some((entry) =>
      entry.column === violation.column &&
      entry.file === violation.file &&
      entry.line === violation.line &&
      entry.owner === violation.owner &&
      entry.rule === violation.rule &&
      entry.text === violation.text
    )) violations.push(violation);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isBlock(node) || ts.isSourceFile(node)) {
      for (const dispatch of sequentialDispatches(node.statements, source, targets)) {
        report(dispatch.node, "R3", dispatch.text);
      }
    }

    if (ts.isArrayLiteralExpression(node)) {
      const values = node.elements.map((element) => stringValue(element));
      if (values.length >= 2 && values.every((value) => value !== undefined && targets.has(value)) && new Set(values).size >= 2) {
        report(node, "R1", normalizedText(node, source));
      }
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken && !hasParentOr(node)) {
      const equalities = flattenOr(node).map((operand) => targetEquality(operand, source, targets));
      const matched = equalities.filter((value): value is TargetEquality => value !== undefined);
      if (matched.length === equalities.length && matched.length >= 2 && matched.every(({ subject }) => subject === matched[0]?.subject) && new Set(matched.map(({ target }) => target)).size >= 2) {
        report(node, "R2", normalizedText(node, source));
      }
    }

    if (ts.isConditionalExpression(node) && !isFalseBranchConditional(node)) {
      const chain = conditionalChain(node, source, targets);
      if (chain !== undefined) report(node, "R3", chain);
    }

    if (ts.isIfStatement(node) && !isElseIf(node)) {
      const chain = ifChain(node, source, targets);
      if (chain !== undefined) report(node, "R3", chain);
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

export function scanTargetTopologySources(
  sources: readonly TargetTopologySource[],
  registeredTargets: readonly string[] = TARGET_NAMES,
  allowlist: readonly TargetTopologyAllowlistEntry[] = TARGET_TOPOLOGY_ALLOWLIST
): TargetTopologyScanResult {
  const rawViolations = sources.flatMap(({ content, file }) =>
    scanTargetTopologySource(file, content, registeredTargets, [])
  );
  const observedIdentities = new Set(rawViolations.map(targetTopologyIdentity));
  const allowlistIdentities = new Set(allowlist.map(targetTopologyIdentity));
  const allowlistGroups = new Map<string, TargetTopologyAllowlistEntry[]>();
  for (const entry of allowlist) {
    const identity = targetTopologyIdentity(entry);
    const group = allowlistGroups.get(identity);
    if (group === undefined) allowlistGroups.set(identity, [entry]);
    else group.push(entry);
  }
  return {
    duplicateAllowlist: [...allowlistGroups.values()]
      .filter((entries) => entries.length > 1)
      .map((entries): TargetTopologyDuplicateAllowlist => ({
        column: entries[0]!.column,
        count: entries.length,
        file: entries[0]!.file,
        line: entries[0]!.line,
        owner: entries[0]!.owner,
        rationales: entries.map(({ rationale }) => rationale).toSorted(),
        rule: entries[0]!.rule,
        text: entries[0]!.text,
      }))
      .toSorted(compareTargetTopologyMatch),
    unmatchedAllowlist: allowlist
      .filter((entry) => !observedIdentities.has(targetTopologyIdentity(entry)))
      .toSorted(compareTargetTopologyAllowlistEntry),
    violations: rawViolations
      .filter((violation) => !allowlistIdentities.has(targetTopologyIdentity(violation)))
      .toSorted(compareTargetTopologyMatch),
  };
}

export function formatTargetTopologyFailures(result: TargetTopologyScanResult): readonly string[] {
  return [
    ...result.violations.map((violation) =>
      `${violation.file}:${violation.line}:${violation.column}: [${violation.rule}] ${violation.owner}: ${violation.text}`
    ),
    ...result.unmatchedAllowlist.map((entry) =>
      `${entry.file}:${entry.line}:${entry.column}: [ALLOWLIST ${entry.rule}] ${entry.owner}: ${entry.text} (unmatched exemption: ${entry.rationale})`
    ),
    ...result.duplicateAllowlist.map((entry) =>
      `${entry.file}:${entry.line}:${entry.column}: [DUPLICATE ALLOWLIST ${entry.rule}] ${entry.owner}: ${entry.text} (${entry.count} exemptions; rationales: ${JSON.stringify(entry.rationales)})`
    ),
  ];
}

function targetTopologyIdentity(match: TargetTopologyViolation): string {
  return JSON.stringify([
    match.file,
    match.line,
    match.column,
    match.rule,
    match.owner,
    match.text,
  ]);
}

function compareTargetTopologyMatch(left: TargetTopologyViolation, right: TargetTopologyViolation): number {
  return left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.column - right.column ||
    left.rule.localeCompare(right.rule) ||
    left.owner.localeCompare(right.owner) ||
    left.text.localeCompare(right.text);
}

function compareTargetTopologyAllowlistEntry(
  left: TargetTopologyAllowlistEntry,
  right: TargetTopologyAllowlistEntry
): number {
  return compareTargetTopologyMatch(left, right) || left.rationale.localeCompare(right.rationale);
}

interface TargetEquality {
  readonly subject: string;
  readonly target: string;
}

function targetEquality(node: ts.Node, source: ts.SourceFile, targets: ReadonlySet<string>): TargetEquality | undefined {
  const equality = stringEquality(node, source);
  return equality !== undefined && targets.has(equality.value)
    ? { subject: equality.subject, target: equality.value }
    : undefined;
}

function stringEquality(node: ts.Node, source: ts.SourceFile): { readonly subject: string; readonly value: string } | undefined {
  node = unwrap(node);
  if (!ts.isBinaryExpression(node) || (node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken && node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken)) return undefined;
  const left = unwrap(node.left);
  const right = unwrap(node.right);
  const leftValue = stringValue(left);
  const rightValue = stringValue(right);
  if (leftValue !== undefined && rightValue === undefined) return { subject: normalizedText(right, source), value: leftValue };
  if (rightValue !== undefined && leftValue === undefined) return { subject: normalizedText(left, source), value: rightValue };
  return undefined;
}

function conditionalChain(node: ts.ConditionalExpression, source: ts.SourceFile, targets: ReadonlySet<string>): string | undefined {
  return dispatchSignature(conditionalParts(node).conditions, source, targets);
}

interface SequentialDispatch {
  readonly node: ts.IfStatement;
  readonly text: string;
}

function sequentialDispatches(
  statements: readonly ts.Statement[],
  source: ts.SourceFile,
  targets: ReadonlySet<string>
): readonly SequentialDispatch[] {
  const dispatches: SequentialDispatch[] = [];
  for (let index = 0; index < statements.length; index += 1) {
    const first = statements[index];
    if (first === undefined || !isTerminalTargetGuard(first, source, targets)) continue;
    const firstEquality = targetEquality(first.expression, source, targets)!;
    if (hasPrecedingMixedGuard(statements, index, firstEquality.subject, source, targets)) continue;
    const guards: ts.IfStatement[] = [];
    let cursor = index;
    while (cursor < statements.length) {
      const statement = statements[cursor];
      if (statement === undefined || !isTerminalTargetGuard(statement, source, targets)) break;
      guards.push(statement);
      cursor += 1;
    }

    const fallback = statements[cursor];
    if (fallback === undefined || !ts.isReturnStatement(fallback) || fallback.expression === undefined) continue;
    const returned = unwrapExpression(fallback.expression);
    let finalFallback = returned;
    let returnedConditions: readonly ts.Expression[] = [];
    if (ts.isConditionalExpression(returned)) {
      const parts = conditionalParts(returned);
      if (parts.conditions.length >= 2 || containsTargetEquality(parts.fallback, source, targets)) continue;
      finalFallback = parts.fallback;
      returnedConditions = parts.conditions;
    } else if (containsTargetEquality(returned, source, targets)) {
      continue;
    }

    const conditions = guards
      .filter((guard) => !terminalReturnMatchesFallback(guard.thenStatement, finalFallback))
      .map((guard) => guard.expression);
    conditions.push(...returnedConditions);
    const text = dispatchSignature(conditions, source, targets);
    if (text === undefined) continue;
    dispatches.push({ node: guards[0]!, text });
    index = cursor;
  }
  return dispatches;
}

function terminalReturnMatchesFallback(
  statement: ts.Statement,
  fallback: ts.Expression
): boolean {
  const terminal = ts.isBlock(statement) ? statement.statements[0] : statement;
  return terminal !== undefined &&
    ts.isReturnStatement(terminal) &&
    terminal.expression !== undefined &&
    structurallyEquivalentFallback(terminal.expression, fallback);
}

// This proves bounded source-topology equivalence; it is not runtime semantic proof.
function structurallyEquivalentFallback(left: ts.Expression, right: ts.Expression): boolean {
  const unwrappedLeft = unwrapExpression(left);
  const unwrappedRight = unwrapExpression(right);
  if (ts.isIdentifier(unwrappedLeft) && ts.isIdentifier(unwrappedRight)) {
    return unwrappedLeft.text === unwrappedRight.text;
  }
  if (isCookedStringLiteral(unwrappedLeft) && isCookedStringLiteral(unwrappedRight)) {
    return unwrappedLeft.text === unwrappedRight.text;
  }
  if (ts.isPropertyAccessExpression(unwrappedLeft) && ts.isPropertyAccessExpression(unwrappedRight)) {
    return unwrappedLeft.questionDotToken === undefined &&
      unwrappedRight.questionDotToken === undefined &&
      ts.isIdentifier(unwrappedLeft.name) &&
      ts.isIdentifier(unwrappedRight.name) &&
      unwrappedLeft.name.text === unwrappedRight.name.text &&
      structurallyEquivalentFallback(unwrappedLeft.expression, unwrappedRight.expression);
  }
  return false;
}

function isCookedStringLiteral(node: ts.Expression): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function hasPrecedingMixedGuard(
  statements: readonly ts.Statement[],
  index: number,
  subject: string,
  source: ts.SourceFile,
  targets: ReadonlySet<string>
): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const statement = statements[cursor];
    if (statement === undefined || !isTerminalStringGuard(statement, source)) return false;
    const equality = stringEquality(statement.expression, source)!;
    if (equality.subject !== subject) return false;
    if (!targets.has(equality.value)) return true;
  }
  return false;
}

function isTerminalTargetGuard(
  statement: ts.Statement,
  source: ts.SourceFile,
  targets: ReadonlySet<string>
): statement is ts.IfStatement {
  return ts.isIfStatement(statement) &&
    statement.elseStatement === undefined &&
    targetEquality(statement.expression, source, targets) !== undefined &&
    isTerminalStatement(statement.thenStatement);
}

function isTerminalStringGuard(
  statement: ts.Statement,
  source: ts.SourceFile
): statement is ts.IfStatement {
  return ts.isIfStatement(statement) &&
    statement.elseStatement === undefined &&
    stringEquality(statement.expression, source) !== undefined &&
    isTerminalStatement(statement.thenStatement);
}

function isTerminalStatement(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  return ts.isBlock(statement) && statement.statements.length === 1 &&
    (ts.isReturnStatement(statement.statements[0]!) || ts.isThrowStatement(statement.statements[0]!));
}

function conditionalParts(node: ts.ConditionalExpression): {
  readonly conditions: readonly ts.Expression[];
  readonly fallback: ts.Expression;
} {
  const conditions: ts.Expression[] = [];
  let current = node;
  while (true) {
    conditions.push(current.condition);
    const next = unwrapExpression(current.whenFalse);
    if (!ts.isConditionalExpression(next)) return { conditions, fallback: next };
    current = next;
  }
}

function containsTargetEquality(node: ts.Node, source: ts.SourceFile, targets: ReadonlySet<string>): boolean {
  if (targetEquality(node, source, targets) !== undefined) return true;
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && containsTargetEquality(child, source, targets)) found = true;
  });
  return found;
}

function ifChain(node: ts.IfStatement, source: ts.SourceFile, targets: ReadonlySet<string>): string | undefined {
  const conditions: ts.Expression[] = [];
  let current: ts.IfStatement | undefined = node;
  while (current !== undefined) {
    conditions.push(current.expression);
    const next: ts.Statement | undefined = current.elseStatement;
    if (next === undefined) return undefined;
    current = ts.isIfStatement(next) ? next : undefined;
  }
  return dispatchSignature(conditions, source, targets);
}

function dispatchSignature(conditions: readonly ts.Expression[], source: ts.SourceFile, targets: ReadonlySet<string>): string | undefined {
  const equalities = conditions.map((condition) => targetEquality(condition, source, targets));
  if (equalities.length < 2 || equalities.some((value) => value === undefined)) return undefined;
  const matched = equalities as readonly TargetEquality[];
  if (!matched.every(({ subject }) => subject === matched[0]?.subject) || new Set(matched.map(({ target }) => target)).size < 2) return undefined;
  return `${conditions.map((condition) => normalizedText(condition, source)).join(" -> ")} -> else`;
}

function flattenOr(node: ts.Expression): readonly ts.Expression[] {
  const unwrapped = unwrap(node);
  if (!ts.isBinaryExpression(unwrapped) || unwrapped.operatorToken.kind !== ts.SyntaxKind.BarBarToken) return [unwrapped as ts.Expression];
  return [...flattenOr(unwrapped.left), ...flattenOr(unwrapped.right)];
}

function hasParentOr(node: ts.BinaryExpression): boolean {
  let current: ts.Node = node;
  let parent: ts.Node = current.parent;
  while (isTransparentExpressionWrapper(parent, current)) {
    current = parent;
    parent = current.parent;
  }
  return ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.BarBarToken;
}

function isTransparentExpressionWrapper(parent: ts.Node, expression: ts.Node): boolean {
  return (ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isTypeAssertionExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isNonNullExpression(parent)) &&
    parent.expression === expression;
}

function isFalseBranchConditional(node: ts.ConditionalExpression): boolean {
  let parent: ts.Node = node.parent;
  while (ts.isParenthesizedExpression(parent)) parent = parent.parent;
  return ts.isConditionalExpression(parent) && unwrap(parent.whenFalse) === node;
}

function isElseIf(node: ts.IfStatement): boolean {
  return ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
}

function stringValue(node: ts.Node): string | undefined {
  const value = unwrap(node);
  return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) ? value.text : undefined;
}

function unwrap<T extends ts.Node>(node: T): ts.Node {
  let current: ts.Node = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current)) current = current.expression;
  return current;
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  return unwrap(node) as ts.Expression;
}

function normalizedText(node: ts.Node, source: ts.SourceFile): string {
  return node.getText(source).replace(/\s+/gu, " ").trim();
}

function ownerOf(node: ts.Node, source: ts.SourceFile): string {
  let variableOwner: string | undefined;
  for (let current: ts.Node | undefined = node; current !== undefined; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name !== undefined) return current.name.text;
    if (ts.isMethodDeclaration(current) && current.name !== undefined) return current.name.getText(source);
    if (ts.isVariableDeclaration(current)) variableOwner ??= current.name.getText(source);
  }
  return variableOwner ?? "<module>";
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
  const files = (await gitFiles()).filter(isTargetTopologySourcePath);
  const sources: TargetTopologySource[] = [];
  for (const file of files) {
    const path = `${rootDir}/${file}`;
    if (existsSync(path)) sources.push({ content: await Bun.file(path).text(), file });
  }
  const result = scanTargetTopologySources(sources);
  const failures = formatTargetTopologyFailures(result);
  if (failures.length > 0) {
    console.error(`skillset: target topology guard found ${result.violations.length} violation(s), ${result.unmatchedAllowlist.length} unmatched allowlist entry(s), and ${result.duplicateAllowlist.length} duplicate allowlist identity(s):`);
    for (const failure of failures) {
      console.error(`  ${failure}`);
    }
    process.exit(1);
  }
  console.error(`skillset: target topology guard scanned ${files.length} TypeScript source files; topology is canonical`);
}

if (import.meta.main) main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
