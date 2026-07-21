import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";

import { lowerTransform, recognizeTransforms } from "@skillset/transforms";

import { readString } from "./config";
import { compareStrings } from "./path";
import {
  formatPreprocessDependency,
  preprocessText,
  readPreprocessDependencySync,
} from "./preprocess";
import {
  GENERATED_BY,
  lockRootsFor,
  textFile,
  WORKSPACE_LOCK_ROOT,
  type LockItem,
  type LockRoot,
} from "./render-support";
import { renderValidatedMarkdown } from "./structured-output";
import { targetDescriptor } from "./targets";
import type {
  AppliedTransform,
  BuildGraph,
  JsonRecord,
  RenderedFile,
  SourceOrigin,
  SourceRule,
  TargetName,
} from "./types";
import { rootVersion } from "./versioning";
import { stringifyJson } from "./yaml";

const CLAUDE_RULES_OUTPUT_ROOT = ".claude/rules";

export async function renderRules(
  graph: BuildGraph,
  lockRoots: Map<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  rendered.push(...(await renderClaudeRules(graph, lockRoots)));
  rendered.push(...(await renderCodexAgentsFiles(graph, lockRoots)));
  rendered.push(...(await renderCursorRules(graph, lockRoots)));
  return rendered;
}

async function renderClaudeRules(
  graph: BuildGraph,
  lockRoots: Map<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];

  for (const rule of graph.rules.filter(
    (sourceRule) => sourceRule.targets.claude.enabled
  )) {
    const targetFile = join(CLAUDE_RULES_OUTPUT_ROOT, rule.relativePath);
    const markdown = await renderClaudeRuleMarkdown(graph, rule, targetFile);
    const file = textFile(
      targetFile,
      markdown.content,
      relative(graph.rootPath, rule.sourcePath)
    );
    rendered.push(file);
    lockRootsFor(lockRoots, CLAUDE_RULES_OUTPUT_ROOT, "claude").items.push(
      lockItemForRule({
        files: [file],
        graph,
        name: rule.id,
        outputRoot: CLAUDE_RULES_OUTPUT_ROOT,
        outputPath: targetFile,
        preprocessDependencies: markdown.preprocessDependencies,
        sourceHash: hashTextRule(
          rule,
          markdown.preprocessDependencies,
          graph.rootPath
        ),
        ...(rule.sourceOrigin === undefined
          ? {}
          : { sourceOrigin: rule.sourceOrigin }),
        sourcePath: relative(graph.rootPath, rule.sourcePath),
      })
    );
  }

  return rendered;
}

async function renderCodexAgentsFiles(
  graph: BuildGraph,
  lockRoots: Map<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  const destinations = new Map<string, SourceRule[]>();

  for (const rule of graph.rules.filter(
    (sourceRule) => sourceRule.targets.codex.enabled
  )) {
    for (const destination of await codexRuleDestinations(graph, rule)) {
      const existing = destinations.get(destination) ?? [];
      destinations.set(destination, [...existing, rule]);
    }
  }

  const rendered: RenderedFile[] = [];
  for (const [destination, rules] of [...destinations.entries()].sort(
    ([left], [right]) => compareStrings(left, right)
  )) {
    const markdown = await renderCodexAgentsMarkdown(graph, rules, destination);
    const sourcePath = workspaceRelativeSourcePath(
      graph,
      graph.instructionsDir
    );
    const file = textFile(destination, markdown.content, sourcePath);
    rendered.push(file);
    lockRootsFor(lockRoots, WORKSPACE_LOCK_ROOT, "workspace").items.push(
      lockItemForRule({
        files: [file],
        graph,
        name: destination,
        outputRoot: WORKSPACE_LOCK_ROOT,
        outputPath: destination,
        preprocessDependencies: markdown.preprocessDependencies,
        sourceHash: hashRules(
          rules,
          markdown.preprocessDependencies,
          graph.rootPath
        ),
        sourcePath,
        ...(markdown.transforms === undefined
          ? {}
          : { transforms: markdown.transforms }),
      })
    );
  }

  return rendered;
}

async function renderCursorRules(
  graph: BuildGraph,
  lockRoots: Map<string, LockRoot>
): Promise<readonly RenderedFile[]> {
  const rendered: RenderedFile[] = [];
  const outputRoot = join(targetProjectRoot(graph, "cursor"), "rules");

  for (const rule of graph.rules.filter(
    (sourceRule) => sourceRule.targets.cursor.enabled
  )) {
    const targetFile = join(
      outputRoot,
      cursorRuleRelativePath(rule.relativePath)
    );
    const markdown = await renderCursorRuleMarkdown(graph, rule, targetFile);
    const file = textFile(
      targetFile,
      markdown.content,
      relative(graph.rootPath, rule.sourcePath)
    );
    rendered.push(file);
    lockRootsFor(lockRoots, WORKSPACE_LOCK_ROOT, "workspace").items.push(
      lockItemForRule({
        files: [file],
        graph,
        name: rule.id,
        outputRoot: WORKSPACE_LOCK_ROOT,
        outputPath: targetFile,
        preprocessDependencies: markdown.preprocessDependencies,
        sourceHash: hashTextRule(
          rule,
          markdown.preprocessDependencies,
          graph.rootPath
        ),
        ...(rule.sourceOrigin === undefined
          ? {}
          : { sourceOrigin: rule.sourceOrigin }),
        sourcePath: relative(graph.rootPath, rule.sourcePath),
      })
    );
  }

  return rendered;
}

function cursorRuleRelativePath(path: string): string {
  return path.replace(/\.md$/u, ".mdc");
}

async function renderClaudeRuleMarkdown(
  graph: BuildGraph,
  rule: SourceRule,
  outputPath: string
): Promise<RenderedRuleMarkdown> {
  const paths = readRulePaths(rule);
  const frontmatter: JsonRecord =
    paths.length === 0 ? {} : { paths: [...paths] };
  const preprocessDependencies = new Set<string>();
  const body = await renderRuleBody(
    graph,
    rule,
    outputPath,
    preprocessDependencies
  );
  return {
    content: stringifyOptionalMarkdown(frontmatter, body),
    preprocessDependencies: formattedPreprocessDependencies(
      graph,
      preprocessDependencies
    ),
  };
}

async function renderCursorRuleMarkdown(
  graph: BuildGraph,
  rule: SourceRule,
  outputPath: string
): Promise<RenderedRuleMarkdown> {
  const paths = readRulePaths(rule);
  const description =
    readString(rule.frontmatter, "description") ??
    readString(rule.frontmatter, "summary") ??
    readString(rule.frontmatter, "title") ??
    rule.id;
  const frontmatter: JsonRecord = {
    description,
    alwaysApply: paths.length === 0,
    ...(paths.length === 0 ? {} : { globs: [...paths] }),
  };
  const preprocessDependencies = new Set<string>();
  const body = await renderRuleBody(
    graph,
    rule,
    outputPath,
    preprocessDependencies
  );
  return {
    content: renderValidatedMarkdown(
      frontmatter,
      normalizeRuleBody(body),
      `${relative(graph.rootPath, rule.sourcePath)} -> ${outputPath}`
    ),
    preprocessDependencies: formattedPreprocessDependencies(
      graph,
      preprocessDependencies
    ),
  };
}

async function renderCodexAgentsMarkdown(
  graph: BuildGraph,
  rules: readonly SourceRule[],
  outputPath: string
): Promise<RenderedRuleMarkdown> {
  // Each concatenated source gets a deterministic boundary comment naming its
  // source instruction path. Comments carry the path only — source-only
  // frontmatter never reaches the generated AGENTS.md. Ordering follows the
  // already-sorted rule list, so concatenation is stable. Claude-dialect
  // sources lower through the transform engine for this codex projection;
  // the .claude/rules projection of the same sources stays untouched.
  const counts = new Map<string, number>();
  const preprocessDependencies = new Set<string>();
  const sections = rules.map(async (rule) => {
    const body = await renderRuleBody(
      graph,
      rule,
      outputPath,
      preprocessDependencies
    );
    if (rule.dialect !== "claude") return { rule, body };
    const translated = translateClaudeDialect(body);
    for (const transform of translated.transforms) {
      counts.set(
        transform.intent,
        (counts.get(transform.intent) ?? 0) + transform.count
      );
    }
    return { rule, body: translated.text };
  });
  const resolvedSections = await Promise.all(sections);
  const renderedSections = resolvedSections
    .filter((section) => section.body.length > 0)
    .map(
      (section) =>
        `<!-- source: ${relative(graph.rootPath, section.rule.sourcePath)} -->\n${section.body}`
    );
  const content = [
    `<!-- Generated by ${GENERATED_BY} from ${workspaceRelativeSourcePath(graph, graph.instructionsDir)}. Do not edit directly. -->`,
    "",
    renderedSections.join("\n\n"),
    "",
  ].join("\n");
  const transforms = [...counts.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([intent, count]) => ({ count, intent }));
  return {
    content,
    preprocessDependencies: formattedPreprocessDependencies(
      graph,
      preprocessDependencies
    ),
    transforms,
  };
}

async function codexRuleDestinations(
  graph: BuildGraph,
  rule: SourceRule
): Promise<readonly string[]> {
  const paths = readRulePaths(rule);
  if (paths.length === 0) return ["AGENTS.md"];

  const destinations = new Set<string>();
  for (const pattern of paths) {
    const base = await codexBaseForPattern(graph, pattern);
    destinations.add(base.length === 0 ? "AGENTS.md" : join(base, "AGENTS.md"));
  }
  return [...destinations].sort();
}

async function codexBaseForPattern(
  graph: BuildGraph,
  pattern: string
): Promise<string> {
  const normalized = normalizePattern(pattern);
  if (!hasGlobSyntax(normalized)) return dirnameOrRoot(normalized);

  const staticBase = staticGlobBase(normalized);
  if (staticBase.length > 0) return staticBase;

  const matches = await matchingRepoFiles(graph, normalized);
  if (matches.length === 0) return "";
  return commonDirectory(matches.map((match) => dirnameOrRoot(match)));
}

async function matchingRepoFiles(
  graph: BuildGraph,
  pattern: string
): Promise<readonly string[]> {
  const matches: string[] = [];
  const glob = new Bun.Glob(pattern);
  for await (const match of glob.scan({
    cwd: graph.rootPath,
    onlyFiles: true,
  })) {
    const normalized = normalizePattern(match);
    if (isIgnoredRuleMatch(graph, normalized)) continue;
    matches.push(normalized);
  }
  return matches.sort();
}

function isIgnoredRuleMatch(graph: BuildGraph, path: string): boolean {
  if (path.startsWith(".git/") || path.startsWith("node_modules/")) return true;
  if (
    graph.sourceDir !== "." &&
    (path === graph.sourceDir || path.startsWith(`${graph.sourceDir}/`))
  ) {
    return true;
  }
  if (path === graph.sourceRoot || path.startsWith(`${graph.sourceRoot}/`))
    return true;
  return graph.outputRoots.some(
    (outputRoot) => path === outputRoot || path.startsWith(`${outputRoot}/`)
  );
}

function workspaceRelativeSourcePath(
  graph: BuildGraph,
  sourcePath: string
): string {
  return graph.sourceDir === "."
    ? sourcePath
    : join(graph.sourceDir, sourcePath);
}

function readRulePaths(rule: SourceRule): readonly string[] {
  const value = rule.frontmatter.paths;
  if (value === undefined) return [];
  if (typeof value === "string")
    return [readNonEmptyRuleString(value, `${rule.sourcePath}.paths`)];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((item) =>
      readNonEmptyRuleString(item, `${rule.sourcePath}.paths`)
    );
  }
  throw new Error(
    `skillset: expected ${rule.sourcePath}.paths to be a string or string array`
  );
}

function readNonEmptyRuleString(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(
      `skillset: expected ${label} entries to be non-empty strings`
    );
  }
  return trimmed;
}

function stringifyOptionalMarkdown(
  frontmatter: JsonRecord,
  body: string
): string {
  const normalizedBody = normalizeRuleBody(body);
  if (Object.keys(frontmatter).length === 0) return `${normalizedBody}\n`;
  return renderValidatedMarkdown(
    frontmatter,
    normalizedBody,
    "generated instruction markdown"
  );
}

async function renderRuleBody(
  graph: BuildGraph,
  rule: SourceRule,
  outputPath: string,
  preprocessDependencies: Set<string>
): Promise<string> {
  return preprocessText(normalizeRuleBody(rule.body), {
    frontmatter: rule.frontmatter,
    preprocessDependencies,
    rootPath: graph.rootPath,
    sourcePath: rule.sourcePath,
    sourceRoot: graph.sourceRoot,
    variables: ruleVariables(graph, rule, outputPath),
  });
}

function ruleVariables(
  graph: BuildGraph,
  rule: SourceRule,
  outputPath: string
): Readonly<Record<string, string>> {
  const outputDir = outputDirectory(outputPath);
  const sourceRule = relative(graph.rootPath, rule.sourcePath).replaceAll(
    "\\",
    "/"
  );
  return {
    "skillset.output_dir": outputDir,
    "skillset.repo_root": relativeOutputPath(outputDir, ""),
    "skillset.source_rule": sourceRule,
  };
}

function normalizeRuleBody(body: string): string {
  return body.replaceAll(/\r\n?/g, "\n").replace(/^\n+/, "").trimEnd();
}

function outputDirectory(outputPath: string): string {
  const directory = normalizeWorkspacePath(dirname(outputPath));
  if (directory.length === 0 || directory === ".") return ".";
  return directory;
}

function relativeOutputPath(from: string, to: string): string {
  const normalizedFrom = from === "." ? "" : from;
  const normalizedTo = to === "." ? "" : to;
  const path = normalizeWorkspacePath(relative(normalizedFrom, normalizedTo));
  return path.length === 0 ? "." : path;
}

function normalizeWorkspacePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function normalizePattern(pattern: string): string {
  return pattern.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

function hasGlobSyntax(value: string): boolean {
  return /[*?[\]{}]/.test(value);
}

function staticGlobBase(pattern: string): string {
  const segments = pattern.split("/");
  const baseSegments: string[] = [];
  for (const segment of segments) {
    if (segment.length === 0) continue;
    if (hasGlobSyntax(segment)) break;
    baseSegments.push(segment);
  }
  return baseSegments.join("/");
}

function dirnameOrRoot(path: string): string {
  const normalized = normalizePattern(path);
  if (normalized.length === 0 || normalized === ".") return "";
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex === -1) {
    return normalized.includes(".") ? "" : normalized;
  }
  return normalized.slice(0, slashIndex);
}

function commonDirectory(directories: readonly string[]): string {
  if (directories.length === 0) return "";
  const [first = [], ...rest] = directories.map((directory) =>
    directory.length === 0 ? [] : directory.split("/")
  );
  const common = [...first];

  for (const directory of rest) {
    while (
      common.length > 0 &&
      directory.slice(0, common.length).join("/") !== common.join("/")
    ) {
      common.pop();
    }
  }

  return common.join("/");
}

function lockItemForRule(args: {
  readonly files: readonly RenderedFile[];
  readonly graph: BuildGraph;
  readonly name: string;
  readonly outputPath: string;
  readonly outputRoot: string;
  readonly preprocessDependencies: readonly string[];
  readonly sourceHash: string;
  readonly sourceOrigin?: SourceOrigin;
  readonly sourcePath: string;
  readonly transforms?: readonly AppliedTransform[];
}): LockItem {
  return {
    files: args.files
      .map((file) => relative(args.outputRoot, file.path))
      .sort(),
    kind: "rule",
    name: args.name,
    outputHash: hashRenderedFiles(args.outputRoot, args.files),
    outputPath: relative(args.outputRoot, args.outputPath),
    ...(args.preprocessDependencies.length === 0
      ? {}
      : { preprocessDependencies: args.preprocessDependencies }),
    sourceHash: args.sourceHash,
    ...(args.sourceOrigin === undefined
      ? {}
      : { sourceOrigin: args.sourceOrigin }),
    sourcePath: args.sourcePath,
    ...(args.transforms === undefined || args.transforms.length === 0
      ? {}
      : { transforms: args.transforms }),
    version: rootVersion(args.graph),
  };
}

function hashTextRule(
  rule: SourceRule,
  preprocessDependencies: readonly string[],
  rootPath: string
): string {
  return hashRules([rule], preprocessDependencies, rootPath);
}

function hashRules(
  rules: readonly SourceRule[],
  preprocessDependencies: readonly string[],
  rootPath: string
): string {
  const hash = createHash("sha256");
  hash.update("skillset-rule-source-v1\0");
  for (const rule of [...rules].sort((left, right) =>
    compareStrings(left.sourcePath, right.sourcePath)
  )) {
    hash.update(rule.relativePath);
    hash.update("\0");
    hash.update(stringifyJson(rule.frontmatter));
    hash.update("\0");
    hash.update(rule.body);
    hash.update("\0");
  }
  for (const dependency of preprocessDependencies) {
    hash.update("preprocess-dependency\0");
    hash.update(dependency);
    hash.update("\0");
    hash.update(readPreprocessDependencySync(rootPath, dependency));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

interface TranslatedBody {
  readonly text: string;
  readonly transforms: readonly AppliedTransform[];
}

interface RenderedRuleMarkdown {
  readonly content: string;
  readonly preprocessDependencies: readonly string[];
  readonly transforms?: readonly AppliedTransform[];
}

function translateClaudeDialect(body: string): TranslatedBody {
  const matches = recognizeTransforms(body, "claude");
  const counts = new Map<string, number>();
  let text = body;
  for (const match of [...matches].reverse()) {
    const rendered = lowerTransform(match, "codex");
    if (rendered === undefined) continue;
    text = `${text.slice(0, match.index)}${rendered}${text.slice(match.index + match.text.length)}`;
    counts.set(match.intent, (counts.get(match.intent) ?? 0) + 1);
  }
  const transforms = [...counts.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([intent, count]) => ({ count, intent }));
  return { text, transforms };
}

function formattedPreprocessDependencies(
  graph: BuildGraph,
  dependencies: ReadonlySet<string>
): readonly string[] {
  return [...dependencies]
    .map((dependency) => formatPreprocessDependency(graph.rootPath, dependency))
    .sort(compareStrings);
}

function targetProjectRoot(graph: BuildGraph, target: TargetName): string {
  const configured = readString(
    graph.root.targets[target].options,
    "projectRoot"
  );
  if (configured !== undefined) return configured;
  return targetDescriptor(target).projectRoot;
}

function hashRenderedFiles(
  outputRoot: string,
  files: readonly RenderedFile[]
): string {
  const hash = createHash("sha256");
  hash.update("skillset-output-v1\0");
  for (const file of [...files].sort((left, right) =>
    compareStrings(left.path, right.path)
  )) {
    hash.update(relative(outputRoot, file.path));
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}
