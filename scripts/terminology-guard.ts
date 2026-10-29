/**
 * Terminology guard for the derive/render/destination cutover (SET-126).
 *
 * Blocks retired compiler vocabulary (the `lowering`/`lowering outcome` family,
 * the old `compile.unsupported` config key, and friends) from drifting back into
 * active source, docs, generated Skillset guidance, CLI output, schema names, and
 * tests. The active vocabulary uses build/compile/adapt/transform/write,
 * provider vs destination, render result(s), compile.unsupportedDestination,
 * and unsupported destination policy. Some internal schema names still use
 * `target` where the code is modeling the Claude/Codex provider enum; new
 * adopter-facing language should prefer provider/destination.
 *
 * It also blocks the retired rule spellings from ADR-0039 (`instruction-frontmatter`,
 * `instruction:<id>`, `skillset new instruction`, `defaults.instructions`, and
 * friends) while leaving Agent Instructions and provider "instruction" words alone.
 *
 * It also rejects `update` used to mean upgrading Skillset itself (ADR-0044).
 *
 * Allowlists are deliberately small and explicit; see ALLOWLIST_PATHS and
 * ALLOWLIST_LINE below and the "Updating the allowlist" note at the bottom.
 */

import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { gitSafeEnv } from "../apps/skillset/src/git-env";

export type TerminologyViolation = {
  readonly file: string;
  readonly label: string;
  readonly line: number;
  readonly text: string;
};

type ForbiddenTerm = { readonly label: string; readonly pattern: RegExp };

const RETIRED_AD_HOC_TEST_PATHS = new Set([
  "apps/skillset/src/try.ts",
  "apps/skillset/src/try-cli.ts",
  "apps/skillset/src/__tests__/try.test.ts",
]);

const RETIRED_AD_HOC_TEST_MODULE_BASENAMES = new Set(["try", "try-cli"]);

const AD_HOC_TEST_IDENTIFIER_ALLOWLIST = new Set([
  "apps/skillset/src/change-workflow.ts:tryResolvePending",
]);

/** Retired terms that must not reappear in active surfaces. */
export const FORBIDDEN_TERMS: readonly ForbiddenTerm[] = [
  { label: "lowering outcome -> render result", pattern: /lowering[\s-]outcome/i },
  { label: "loweringOutcomes -> renderResults", pattern: /loweringOutcomes?\b/ },
  { label: "LOWERING_OUTCOME -> RENDER_RESULT", pattern: /LOWERING_OUTCOME/ },
  { label: "SkillsetLowering* -> SkillsetRenderResult*", pattern: /SkillsetLowering/ },
  { label: "skillset-lowering-outcome@1 -> skillset-render-result@1", pattern: /skillset-lowering-outcome/ },
  { label: "loweringOwner -> renderOwner", pattern: /loweringOwner/ },
  { label: "lowering policy -> unsupported destination policy", pattern: /lowering policy/i },
  { label: "loss ledger -> render report", pattern: /loss ledger/i },
  { label: "compile.unsupported -> compile.unsupportedDestination", pattern: /compile\.unsupported(?!Destination)/ },
  { label: "lowering -> render/derive", pattern: /\blowering\b/i },
  { label: "lowered -> rendered/derived", pattern: /\blowered\b/i },
  // ADR-0039: authored guidance source is a "rule". These patterns name the
  // retired Skillset spellings, not the English word: Agent Instructions,
  // `compile.agents.instructions`, `compile.instruction_front_page`, Codex
  // `developer_instructions`, and provider "instruction file" prose keep their
  // owners' words. The `project-instructions` feature ID is renamed with fresh
  // Agent Instructions evidence in SET-658 and is not banned yet.
  { label: "instruction-frontmatter -> rule-frontmatter", pattern: /instruction-frontmatter/ },
  { label: "InstructionFrontmatter -> RuleFrontmatter", pattern: /[Ii]nstructionFrontmatter|INSTRUCTION_FRONTMATTER/ },
  { label: "instruction frontmatter -> rule frontmatter", pattern: /\binstruction frontmatter\b/i },
  { label: "selectorForInstruction -> selectorForRule", pattern: /selectorForInstruction/ },
  { label: "instruction:<id> -> rule:<id>", pattern: /\binstruction:(?=[A-Za-z0-9._[(/$-])/ },
  { label: "\"instruction\" kind -> \"rule\"", pattern: /(?:^|[=:|(,[])\s*["']instruction["']/ },
  // Anchored to the CLI so provider prose ("Codex discovers a new instruction
  // file") stays legal.
  { label: "new/lookup instruction -> new/lookup rule", pattern: /\b(?:skillset|cli\.ts)\s+(?:new|lookup)\s+instruction\b/ },
  { label: "source-instruction -> source-rule", pattern: /\bsource-instruction\b/ },
  { label: "defaults.instructions -> defaults.rules", pattern: /\bdefaults\.instructions\b/ },
  { label: "instructions import kind -> rules", pattern: /\bkind:\s*["']instructions["']|["']instructions:[^"'\s]/ },
  { label: "instructions.md reference page -> rules.md", pattern: /\b(?:features|source)\/instructions\.md\b/ },
  { label: "instructionsDir/loadInstructions -> rulesDir/loadRules", pattern: /\b(?:instructionsDir|loadInstructions)\b/ },
  // ADR-0044: `upgrade` brings Skillset and its tooling current; `update` is
  // only for the objects a workspace manages. These catch the self-upgrade
  // spellings, not `skillset update` itself, and not edits to the CLI's
  // documentation or help ("update the Skillset CLI docs").
  {
    label: "update for self-upgrade -> skillset upgrade (ADR-0044)",
    pattern:
      /\bskillset\s+(?:self-update|update\s+(?:--)?self)\b|\b(?:update|updating|updates)\s+(?:the\s+)?skillset\s+(?:itself|cli|binary|executable)\b(?!\s+(?:docs?|documentation|help|reference|flags?|commands?|output|tests?|guide|page|examples?)\b)/i,
  },
];

/**
 * Path prefixes excluded from scanning. Each is historical, generated (validated
 * from `.skillset/` source elsewhere), a deferred-concept owner, or this guard's
 * own files.
 */
export const ALLOWLIST_PATHS: readonly string[] = [
  // Historical decision records keep their original vocabulary.
  "docs/adrs/",
  // The docs migration map records moved pages under their historical paths.
  "docs/migration-map.json",
  // Plan packets describe the old vocabulary they are cutting over, and the
  // archive under it keeps historical records verbatim (including the
  // 2026-07-18 drift audit's evidence for finding 03.5).
  ".agents/plans/",
  // Generated output trees are validated against `.skillset/` source by check --only outputs.
  ".agents/skills/",
  ".claude/",
  "plugins/",
  ".skillset/cache/",
  ".skillset/snapshots/",
  // Changesets and change-provenance notes describe the cutover / prior changes.
  ".changeset/",
  ".skillset/changes/",
  // Package changelogs are generated release history and may quote old terms from
  // prior public changes.
  "apps/skillset/CHANGELOG.md",
  // Deferred follow-up: the transform-dialect `lowering` capability is a distinct
  // concept (see RETRO); renaming it is a separate behavioral change.
  "packages/transforms/",
  "packages/core/src/render.ts",
  // The `deterministic-projection` conformance concept is intentionally not renamed.
  "packages/core/src/deterministic-projection.ts",
  "packages/core/src/__tests__/deterministic-projection.test.ts",
  // ADR-0039: the one module that must quote retired rule spellings, for the
  // cutover errors that name each rewrite and for change-history translation.
  "packages/schema/src/retired-vocabulary.ts",
  // This guard and its test necessarily contain the retired terms as patterns.
  "scripts/terminology-guard.ts",
  "scripts/__tests__/terminology-guard.test.ts",
];

/**
 * Per-line exceptions: a matched line is allowed when it contains one of these
 * substrings. Kept tiny and specific.
 */
export const ALLOWLIST_LINE: readonly string[] = [
  // Links/titles that name the historical, un-renamed ADR file. A forbidden match
  // is exempt only when it sits ENTIRELY inside one of these substrings (see
  // allowlistedSpans), so these cannot mask a regression elsewhere on the line.
  "lowering-outcomes-and-loss-ledger",
  "Lowering Outcomes and Loss Ledger",
  "[Lowering Outcomes]",
  // Deferred follow-up: the transform-dialect `lowering` capability and the
  // version-`lowering` concept are distinct from the render-result cutover and
  // are renamed separately. These markers carve out their specific usages of the
  // bare `lowering`/`lowered` verb.
  "match.lowering",
  "lowering: match",
  'lowering: TransformMatch["lowering"]',
  'lowering: "none"',
  "Codex lowering",
  "no-lowering",
  "skill-local lowering",
  "version lowering",
  "constructs lowered",
  "spans it lowered",
  "no lowering for",
  "portable lowering",
];

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".md", ".json", ".yaml", ".yml"]);

export function isScannablePath(path: string): boolean {
  if (ALLOWLIST_PATHS.some((prefix) => path === prefix || path.startsWith(prefix))) return false;
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return SCANNED_EXTENSIONS.has(path.slice(dot));
}

/**
 * Character spans of every allowlist substring occurrence on a line. A forbidden
 * match is exempt only when it falls ENTIRELY inside one of these spans, so an
 * allowlisted phrase cannot mask an unrelated regression elsewhere on the line.
 */
function allowlistedSpans(text: string): readonly (readonly [number, number])[] {
  const spans: (readonly [number, number])[] = [];
  for (const allowed of ALLOWLIST_LINE) {
    let index = text.indexOf(allowed);
    while (index >= 0) {
      spans.push([index, index + allowed.length]);
      index = text.indexOf(allowed, index + 1);
    }
  }
  return spans;
}

function globalize(pattern: RegExp): RegExp {
  return pattern.flags.includes("g") ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
}

/** Scan one file's content and return any violations. Pure; used by tests. */
export function scanContent(file: string, content: string): readonly TerminologyViolation[] {
  const violations: TerminologyViolation[] = [];
  const lines = content.split(/\r?\n/u);
  for (const [index, text] of lines.entries()) {
    // SET-433/SET-442: these collision fixtures use the existing TransformEntry API,
    // whose capability field is deferred separately from compiler terminology.
    const explicitTransformFixture =
      (file === "apps/skillset/src/__tests__/dialect.test.ts" ||
        file === "apps/skillset/src/__tests__/adopt-transform-ambiguity.test.ts") &&
      text.trim() === 'lowering: "to-codex",';
    const allowed = explicitTransformFixture ? [[0, text.length] as const] : allowlistedSpans(text);
    for (const term of FORBIDDEN_TERMS) {
      for (const match of text.matchAll(globalize(term.pattern))) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        const exempt = allowed.some(([spanStart, spanEnd]) => spanStart <= start && end <= spanEnd);
        if (!exempt) {
          violations.push({ file, label: term.label, line: index + 1, text: text.trim() });
          break;
        }
      }
    }
  }
  return violations;
}

/**
 * Scan syntax-bearing source for the retired internal ad hoc-test vocabulary.
 * This deliberately inspects identifiers and module specifiers rather than
 * prose so ordinary JavaScript `try` statements and historical string evidence
 * remain valid.
 */
export function scanInternalAdHocTestTerminology(
  file: string,
  content: string
): readonly TerminologyViolation[] {
  const violations: TerminologyViolation[] = [];
  if (RETIRED_AD_HOC_TEST_PATHS.has(file)) {
    violations.push({
      file,
      label: "retired ad hoc-test path",
      line: 1,
      text: file,
    });
  }
  if (!/\.(?:js|ts|tsx)$/u.test(file)) return violations;

  const scriptKind = file.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : file.endsWith(".js")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );
  const sourceLines = content.split(/\r?\n/u);
  const report = (node: ts.Node, label: string): void => {
    const start = source.getLineAndCharacterOfPosition(node.getStart(source));
    const text = sourceLines[start.line]?.trim() ?? "";
    violations.push({ file, label, line: start.line + 1, text });
  };
  const checkModuleSpecifier = (node: ts.StringLiteralLike): void => {
    const basename = node.text.split("/").at(-1);
    if (
      basename !== undefined &&
      RETIRED_AD_HOC_TEST_MODULE_BASENAMES.has(basename)
    ) {
      report(node, "retired ad hoc-test module specifier");
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const name = node.text;
      const retired = /(?:^|[a-z0-9_])Try(?=$|[A-Z0-9_])/u.test(name) ||
        /^try[A-Z0-9_]/u.test(name) ||
        /(?:^|_)TRY_/u.test(name);
      if (retired && !AD_HOC_TEST_IDENTIFIER_ALLOWLIST.has(`${file}:${name}`)) {
        report(node, "retired ad hoc-test identifier");
      }
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      checkModuleSpecifier(node.moduleSpecifier);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteralLike(argument)) {
        checkModuleSpecifier(argument);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

const RETIRED_RULE_KIND_LITERALS: ReadonlySet<string> = new Set(["instruction", "instructions"]);
const RETIRED_RULE_SELECTOR_PREFIX = /^instructions?:/u;
const RETIRED_RULE_KIND_LABEL = 'retired "instruction(s)" kind literal -> "rule(s)"';
const RETIRED_RULE_SELECTOR_LABEL = "concatenated instruction:<id> selector -> rule:<id>";
const RETIRED_RULE_DEFAULTS_LABEL = "nested codex.defaults.instructions -> codex.defaults.rules";

/**
 * Files whose `"instruction(s)"` literals are not the retired rule kind. Each
 * entry is a whole file because the literal there names a different concept.
 */
export const RETIRED_RULE_LITERAL_ALLOWLIST: ReadonlyMap<string, string> = new Map([
  // Legacy `.skillset/instructions` directory moves, kept so old layouts migrate.
  ["apps/skillset/src/change-status.ts", "legacy source-layout move table"],
  ["scripts/migrate-source-layout.ts", "legacy source-layout migration"],
  // The Agent Instructions standard's projection family, which is not retired.
  ["packages/core/src/standard-projections.ts", "Agent Instructions projection family"],
]);

function isRetiredKindLiteral(node: ts.Node | undefined): boolean {
  return (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    RETIRED_RULE_KIND_LITERALS.has(node.text)
  );
}

function isRetiredSelectorPrefix(node: ts.Node): boolean {
  return (
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    RETIRED_RULE_SELECTOR_PREFIX.test(node.text)
  );
}

function propertyNameText(name: ts.PropertyName | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/** Property-name chain from the outermost object literal down to `node`. */
function objectKeyPath(node: ts.PropertyAssignment | ts.ShorthandPropertyAssignment): readonly string[] {
  const path: string[] = [];
  let current: ts.Node = node;
  while (ts.isPropertyAssignment(current) || ts.isShorthandPropertyAssignment(current)) {
    const name = propertyNameText(current.name);
    if (name === undefined) break;
    path.unshift(name);
    const parent: ts.Node = current.parent;
    if (!ts.isObjectLiteralExpression(parent)) break;
    current = parent.parent;
  }
  return path;
}

function endsWithRetiredDefaultsPath(path: readonly string[]): boolean {
  return path.length >= 3 && path.at(-1) === "instructions" && path.at(-2) === "defaults" && path.at(-3) === "codex";
}

/**
 * Syntax-aware check for the retired rule kind and selectors in TypeScript and
 * JavaScript (SET-681). The line regexes in FORBIDDEN_TERMS miss comparisons,
 * unions, `case` labels, tuple entries, returned and ternary literals,
 * concatenated selectors, and nested `codex.defaults.instructions` objects.
 */
export function scanRetiredRuleSyntax(file: string, content: string): readonly TerminologyViolation[] {
  if (!/\.(?:js|ts|tsx)$/u.test(file) || RETIRED_RULE_LITERAL_ALLOWLIST.has(file)) return [];
  const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
  const sourceLines = content.split(/\r?\n/u);
  const violations: TerminologyViolation[] = [];
  const report = (node: ts.Node, label: string): void => {
    const start = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.push({ file, label, line: start.line + 1, text: sourceLines[start.line]?.trim() ?? "" });
  };
  const equality = new Set([
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
  ]);
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node)) {
      if (equality.has(node.operatorToken.kind) && (isRetiredKindLiteral(node.left) || isRetiredKindLiteral(node.right))) {
        report(node, RETIRED_RULE_KIND_LABEL);
      }
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken && isRetiredSelectorPrefix(node.left)) {
        report(node, RETIRED_RULE_SELECTOR_LABEL);
      }
    }
    if (ts.isLiteralTypeNode(node) && isRetiredKindLiteral(node.literal)) report(node, RETIRED_RULE_KIND_LABEL);
    if (ts.isCaseClause(node) && isRetiredKindLiteral(node.expression)) report(node, RETIRED_RULE_KIND_LABEL);
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) if (isRetiredKindLiteral(element)) report(element, RETIRED_RULE_KIND_LABEL);
    }
    if (ts.isReturnStatement(node) && isRetiredKindLiteral(node.expression)) report(node, RETIRED_RULE_KIND_LABEL);
    if (ts.isArrowFunction(node) && isRetiredKindLiteral(node.body)) report(node.body, RETIRED_RULE_KIND_LABEL);
    if (ts.isConditionalExpression(node) && (isRetiredKindLiteral(node.whenTrue) || isRetiredKindLiteral(node.whenFalse))) {
      report(node, RETIRED_RULE_KIND_LABEL);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "concat" &&
      isRetiredSelectorPrefix(node.expression.expression)
    ) {
      report(node, RETIRED_RULE_SELECTOR_LABEL);
    }
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      endsWithRetiredDefaultsPath(objectKeyPath(node))
    ) {
      report(node, RETIRED_RULE_DEFAULTS_LABEL);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

/**
 * Indentation-aware check for a nested `instructions:` key under
 * `codex:` > `defaults:` in YAML, including YAML embedded in Markdown fences
 * and template strings. The dotted `defaults.instructions` spelling is caught
 * by FORBIDDEN_TERMS; this catches the block shape that never spells it.
 */
export function scanNestedRetiredDefaults(file: string, content: string): readonly TerminologyViolation[] {
  const violations: TerminologyViolation[] = [];
  const stack: { readonly indent: number; readonly key: string }[] = [];
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const match = /^(?<indent>\s*)["']?(?<key>[A-Za-z_][\w-]*)["']?\s*:(?<rest>.*)$/u.exec(line);
    if (!match?.groups) continue;
    const indent = match.groups.indent?.length ?? 0;
    const key = match.groups.key ?? "";
    while (stack.length > 0 && (stack.at(-1)?.indent ?? 0) >= indent) stack.pop();
    if (key === "instructions" && stack.at(-1)?.key === "defaults" && stack.at(-2)?.key === "codex") {
      violations.push({ file, label: RETIRED_RULE_DEFAULTS_LABEL, line: index + 1, text: line.trim() });
    }
    const rest = (match.groups.rest ?? "").replace(/#.*$/u, "").trim();
    if (rest === "" || rest === "{") stack.push({ indent, key });
  }
  return violations;
}

function scanJsonRetiredDefaults(file: string, content: string): readonly TerminologyViolation[] {
  if (!file.endsWith(".json")) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const found: string[] = [];
  const visit = (value: unknown, path: readonly string[]): void => {
    if (typeof value !== "object" || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      const next = [...path, key];
      if (endsWithRetiredDefaultsPath(next)) found.push(next.join("."));
      visit(child, next);
    }
  };
  visit(parsed, []);
  return found.map((path) => ({ file, label: RETIRED_RULE_DEFAULTS_LABEL, line: 1, text: path }));
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
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${stderr.trim()}`);
  return stdout;
}

async function main(): Promise<void> {
  const tracked = (await runText(["git", "ls-files"])).split("\n").map((line) => line.trim()).filter(Boolean);
  const scannable = tracked.filter(isScannablePath);
  const violations: TerminologyViolation[] = [];
  for (const file of scannable) {
    if (!existsSync(`${rootDir}/${file}`)) continue;
    const content = await Bun.file(`${rootDir}/${file}`).text();
    violations.push(...scanContent(file, content));
    violations.push(...scanInternalAdHocTestTerminology(file, content));
    violations.push(...scanRetiredRuleSyntax(file, content));
    violations.push(...scanNestedRetiredDefaults(file, content));
    violations.push(...scanJsonRetiredDefaults(file, content));
  }

  if (violations.length === 0) {
    console.error(`skillset: terminology guard scanned ${scannable.length} files; no retired vocabulary found`);
    return;
  }

  console.error(`skillset: terminology guard found ${violations.length} retired-vocabulary use(s):`);
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}: ${violation.label}`);
    console.error(`    ${violation.text}`);
  }
  console.error(
    "skillset: replace retired terminology with the build/provider/destination vocabulary, " +
      "or extend the allowlist in scripts/terminology-guard.ts for deliberate historical/deferred context."
  );
  process.exit(1);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

/*
 * Updating the allowlist
 * ----------------------
 * The guard runs in `bun run check`. When it fails:
 *
 * 1. Prefer fixing the source: replace the retired term with the
 *    build/provider/destination vocabulary. This is correct ~99% of the time.
 * 2. Only allowlist for DELIBERATE historical or deferred context:
 *    - A whole file/tree that is historical (ADRs), generated (validated from
 *      `.skillset/` source elsewhere), or owns a deferred concept (the
 *      transform-dialect `lowering` capability, the deterministic-projection
 *      conformance concept): add a prefix to ALLOWLIST_PATHS with a comment.
 *    - A single legitimate line (a link naming the un-renamed ADR file, a
 *      deferred-concept usage): add a distinctive substring to ALLOWLIST_LINE
 *      with a comment. Keep substrings specific enough that they cannot mask a
 *      render-result regression (those match the symbol patterns above).
 *
 * Keep both lists explicit and small. A growing allowlist is a signal that a
 * deferred rename (e.g. the transforms `lowering` field) should finally land.
 */
