import { readdirSync, readFileSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import { isMissingPathError, MISSING_PATH_ENOENT } from "./fs-existence";
import { isPathInside, resolveInside } from "./path";
import type { JsonRecord, JsonValue, TargetName } from "./types";

export interface PreprocessContext {
  readonly frontmatter: JsonRecord;
  readonly partialBasePath?: string;
  readonly partialStack?: readonly string[];
  readonly pluginPath?: string;
  readonly preprocessDependencies?: Set<string>;
  readonly rootPath: string;
  readonly sourcePath: string;
  readonly sourceRoot: string;
  readonly target?: TargetName;
  readonly promptArguments?: boolean;
  readonly renderPathReference?: (
    reference: ResolvedPreprocessPathReference
  ) => Promise<string> | string;
  readonly variables?: Readonly<Record<string, string>>;
}

export interface ResolvedPreprocessPathReference {
  readonly resolvedPath: string;
  readonly scheme?: "plugin" | "shared";
  readonly specifier: string;
}

export interface PreprocessReferenceToken {
  readonly kind: "inline-named" | "inline-path" | "link";
  readonly specifier: string;
  readonly token: string;
}

export async function preprocessText(
  content: string,
  context: PreprocessContext
): Promise<string> {
  if (isPreprocessDisabled(context.frontmatter)) {
    return normalizeText(content);
  }

  const escapedTokens: string[] = [];
  let expanded = escapeTripleBraceTokens(normalizeText(content), escapedTokens);
  expanded = await expandPartials(expanded, context);
  expanded = escapeTripleBraceTokens(expanded, escapedTokens);
  expanded = await expandVariables(expanded, context);
  return restoreTripleBraceTokens(expanded, escapedTokens);
}

export async function resolveMarkedPathReferences(
  content: string,
  context: PreprocessContext
): Promise<string> {
  if (isPreprocessDisabled(context.frontmatter)) {
    return normalizeText(content);
  }

  const escapedTokens: string[] = [];
  const normalized = escapeTripleBraceTokens(
    normalizeText(content),
    escapedTokens
  );
  const expanded = await expandPartials(normalized, context, "references-only");
  return restoreTripleBraceTokens(expanded, escapedTokens);
}

export async function rewritePreprocessReferences(
  content: string,
  context: PreprocessContext,
  rewrite: (
    reference: PreprocessReferenceToken
  ) => Promise<string> | string
): Promise<string> {
  if (isPreprocessDisabled(context.frontmatter)) {
    return normalizeText(content);
  }

  const escapedTokens: string[] = [];
  const normalized = escapeTripleBraceTokens(
    normalizeText(content),
    escapedTokens
  );
  const rewritten = await transformPreprocessReferences(
    normalized,
    context,
    rewrite
  );
  return restoreTripleBraceTokens(rewritten, escapedTokens);
}

export function formatPreprocessDependency(rootPath: string, dependency: string): string {
  if (isTreePreprocessDependency(dependency)) return dependency;
  return normalizePath(relative(rootPath, dependency));
}

export function readPreprocessDependencySync(rootPath: string, dependency: string): Buffer | string {
  const tree = parseTreePreprocessDependency(dependency);
  if (tree !== undefined) {
    return renderDirectoryTreeSync(join(rootPath, tree.path), tree.depth);
  }
  return readFileSync(join(rootPath, dependency));
}

export function isTreePreprocessDependency(dependency: string): boolean {
  return parseTreePreprocessDependency(dependency) !== undefined;
}

function parseTreePreprocessDependency(
  dependency: string
): { readonly depth: number; readonly path: string } | undefined {
  if (!dependency.startsWith("tree:")) return undefined;
  const separator = dependency.lastIndexOf(":");
  if (separator <= "tree:".length) return undefined;
  const path = dependency.slice("tree:".length, separator);
  const depth = Number(dependency.slice(separator + 1));
  if (!Number.isInteger(depth) || depth < 0 || depth > 8) return undefined;
  return { depth, path };
}

export function isPreprocessDisabled(frontmatter: JsonRecord): boolean {
  const skillset = frontmatter.skillset;
  return (
    typeof skillset === "object" &&
    skillset !== null &&
    !Array.isArray(skillset) &&
    skillset.preprocess === false
  );
}

async function expandPartials(
  content: string,
  context: PreprocessContext,
  mode: "all" | "references-only" = "all"
): Promise<string> {
  return transformPreprocessReferences(content, context, async (reference) => {
    if (reference.kind === "link") {
      return `@${await renderPathReference(reference.specifier, context)}`;
    }
    if (mode === "references-only") {
      return reference.token;
    }
    return readPartial(
      reference.specifier,
      context,
      reference.kind === "inline-named" ? "named" : "path"
    );
  });
}

async function transformPreprocessReferences(
  content: string,
  context: PreprocessContext,
  rewrite: (
    reference: PreprocessReferenceToken
  ) => Promise<string> | string
): Promise<string> {
  const partialPattern =
    /@\{\{\s*([^}\s]+)\s*\}\}|\{\{\s*>\s*([^}\s]+)\s*\}\}|\{\{\s*([^}\s]+)\s*\}\}/g;
  const codeRanges = isMarkdownSource(context.sourcePath)
    ? markdownCodeRanges(content)
    : [];
  let expanded = "";
  let cursor = 0;

  for (const match of content.matchAll(partialPattern)) {
    const [token, linkSpecifier, inlineSpecifier, bareSpecifier] = match;
    expanded += content.slice(cursor, match.index);
    if (isInsideMarkdownCode(codeRanges, match.index)) {
      expanded += token;
    } else if (linkSpecifier !== undefined) {
      assertCurrentLinkSpecifier(token, linkSpecifier, context);
      expanded += await rewrite({
        kind: "link",
        specifier: linkSpecifier,
        token,
      });
    } else if (inlineSpecifier !== undefined) {
      assertCurrentInlineSpecifier(token, inlineSpecifier, context);
      expanded += await rewrite({
        kind: isInlineNamedPartialSpecifier(inlineSpecifier)
          ? "inline-named"
          : "inline-path",
        specifier: inlineSpecifier,
        token,
      });
    } else if (
      bareSpecifier !== undefined &&
      (await isRetiredBareReferenceSpecifier(bareSpecifier, context))
    ) {
      throw unsupportedReferenceSyntax(token, context);
    } else {
      expanded += token;
    }
    cursor = match.index + token.length;
  }

  return `${expanded}${content.slice(cursor)}`;
}

function assertCurrentLinkSpecifier(
  token: string,
  specifier: string,
  context: PreprocessContext
): void {
  if (!isScopedPartialSpecifier(specifier)) {
    throw unsupportedReferenceSyntax(token, context);
  }
}

function assertCurrentInlineSpecifier(
  token: string,
  specifier: string,
  context: PreprocessContext
): void {
  if (specifier.startsWith("root:")) {
    throw unsupportedReferenceSyntax(token, context);
  }
  if (
    context.pluginPath !== undefined &&
    specifier.startsWith(`${basename(context.pluginPath)}.`)
  ) {
    throw unsupportedReferenceSyntax(token, context);
  }
}

function isScopedPartialSpecifier(specifier: string): boolean {
  return specifier.startsWith("shared:") || specifier.startsWith("plugin:");
}

function isInlineNamedPartialSpecifier(specifier: string): boolean {
  if (!specifier.startsWith("plugin:")) {
    return !specifier.startsWith("shared:");
  }
  const pluginSpecifier = specifier.slice("plugin:".length);
  const [firstSegment] = pluginSpecifier.split("/");
  if (
    firstSegment === "assets" ||
    firstSegment === "partials" ||
    firstSegment === "references" ||
    firstSegment === "scripts" ||
    firstSegment === "templates"
  ) {
    return false;
  }
  return !pluginSpecifier.includes(".");
}

async function isRetiredBareReferenceSpecifier(
  specifier: string,
  context: PreprocessContext
): Promise<boolean> {
  if (
    specifier.startsWith("shared:") ||
    specifier.startsWith("plugin:") ||
    specifier.startsWith("root:") ||
    specifier.startsWith("@") ||
    specifier.includes("/") ||
    specifier.includes("\\")
  ) {
    return true;
  }
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+$/u.test(specifier)) {
    return false;
  }

  const basePath = dirname(context.partialBasePath ?? context.sourcePath);
  return isFile(resolveInsideScoped(basePath, specifier, specifier, context));
}

function unsupportedReferenceSyntax(
  token: string,
  context: PreprocessContext
): Error {
  return new Error(
    `skillset: unsupported reference syntax ${token} in ${relative(context.rootPath, context.sourcePath)}; use {{> X}} to inline or @{{X}} to link`
  );
}

async function renderPathReference(
  specifier: string,
  context: PreprocessContext
): Promise<string> {
  const source = relative(context.rootPath, context.sourcePath);
  try {
    const resolvedPath = resolvePreprocessPathReference(
      specifier,
      context
    );
    if (!(await isFile(resolvedPath))) {
      throw missingScopedPathReference(specifier, resolvedPath, context);
    }
    await assertCanonicalPartialContainment(resolvedPath, specifier, context, "path");
    const [rawScheme] = splitSpecifier(specifier);
    const scheme =
      rawScheme === "root"
        ? "shared"
        : rawScheme === "plugin" || rawScheme === "shared"
          ? rawScheme
          : undefined;
    const reference: ResolvedPreprocessPathReference = {
      resolvedPath,
      ...(scheme === undefined ? {} : { scheme }),
      specifier,
    };
    return await (context.renderPathReference?.(reference) ?? specifier);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `skillset: failed to resolve path reference ${specifier} in ${source}: ${message}`
    );
  }
}

export function resolvePreprocessPathReference(
  specifier: string,
  context: PreprocessContext
): string {
  return resolvePartial(specifier, context);
}

export async function resolvePreprocessNamedPartialReference(
  specifier: string,
  context: PreprocessContext
): Promise<string> {
  return resolveNamedPartial(specifier, context);
}

async function readPartial(
  specifier: string,
  context: PreprocessContext,
  kind: "named" | "path"
): Promise<string> {
  const source = relative(context.rootPath, context.sourcePath);
  try {
    const resolved =
      kind === "named"
        ? await resolveNamedPartial(specifier, context)
        : resolvePartial(specifier, context);
    if (kind === "path" && !(await isFile(resolved))) {
      throw missingScopedPathReference(specifier, resolved, context);
    }
    const canonical = await assertCanonicalPartialContainment(
      resolved,
      specifier,
      context,
      kind
    );
    assertNoPartialCycle(canonical, specifier, context);
    const content = normalizeText(await readFile(canonical, "utf8"));
    return await expandPartials(content, {
      ...context,
      partialBasePath: canonical,
      partialStack: [...(context.partialStack ?? []), canonical],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`skillset: failed to read partial ${specifier} in ${source}: ${message}`);
  }
}

async function assertCanonicalPartialContainment(
  resolved: string,
  specifier: string,
  context: PreprocessContext,
  kind: "named" | "path"
): Promise<string> {
  const [scheme] = splitSpecifier(specifier);
  let sharedRoot = join(context.rootPath, context.sourceRoot, "shared");
  if (scheme === "plugin") {
    if (context.pluginPath === undefined) {
      throw new Error(`skillset: partial ${specifier} requires a plugin-bound source`);
    }
    sharedRoot = join(context.pluginPath, "shared");
  }
  const partialRoot = kind === "named" ? join(sharedRoot, "partials") : sharedRoot;
  const [sourceRoot, ownerRoot, canonicalSharedRoot, canonicalRoot, canonical] = await Promise.all([
    realpath(join(context.rootPath, context.sourceRoot)),
    scheme === "plugin" && context.pluginPath !== undefined
      ? realpath(context.pluginPath)
      : realpath(join(context.rootPath, context.sourceRoot)),
    realpath(sharedRoot),
    realpath(partialRoot),
    realpath(resolved),
  ]);
  try {
    if (scheme === "plugin") resolveInside(sourceRoot, ownerRoot);
    if (canonicalSharedRoot !== join(ownerRoot, "shared")) {
      throw new Error("shared root crosses its source owner");
    }
    if (kind === "named" && canonicalRoot !== join(canonicalSharedRoot, "partials")) {
      throw new Error("partial root crosses its shared scope");
    }
    resolveInside(canonicalRoot, canonical);
  } catch {
    throw new Error(
      `skillset: partial ${specifier} in ${relative(context.rootPath, context.sourcePath)} resolves outside its partial root`
    );
  }
  return canonical;
}

function missingScopedPathReference(
  specifier: string,
  resolved: string,
  context: PreprocessContext
): Error {
  const [scheme] = splitSpecifier(specifier);
  const scope = scheme === "plugin" ? "plugin" : "workspace";
  return new Error(
    `skillset: ${scope} path reference ${specifier} in ${relative(context.rootPath, context.sourcePath)} was not found at ${normalizePath(relative(context.rootPath, resolved))}`
  );
}

async function expandVariables(content: string, context: PreprocessContext): Promise<string> {
  const variablePattern = /\{\{\s*([^{}]*?)\s*\}\}/g;
  let expanded = "";
  let cursor = 0;

  for (const match of content.matchAll(variablePattern)) {
    const [token, key] = match;
    if (key === undefined) continue;
    expanded += content.slice(cursor, match.index);
    expanded += await resolveVariable(token, key.trim(), context, {
      inMarkdownCodeBlock: isMarkdownSource(context.sourcePath) && isInsideFencedCodeBlock(content, match.index),
      markdown: isMarkdownSource(context.sourcePath),
    });
    cursor = match.index + token.length;
  }

  return `${expanded}${content.slice(cursor)}`;
}

interface VariableRenderContext {
  readonly inMarkdownCodeBlock: boolean;
  readonly markdown: boolean;
}

async function resolveVariable(
  token: string,
  key: string,
  context: PreprocessContext,
  renderContext: VariableRenderContext
): Promise<string> {
  if (key.startsWith("this.")) {
    const field = key.slice("this.".length);
    const value = readPathValue(context.frontmatter, field);
    if (value === undefined) {
      throw new Error(
        `skillset: missing this.${field} reference in ${relative(context.rootPath, context.sourcePath)}`
      );
    }
    return stringifyPreprocessValue(value, `this.${field}`, context, renderContext);
  }

  const explicitValue = context.variables?.[key];
  if (explicitValue !== undefined) return explicitValue;

  if (key.startsWith("skillset.")) {
    const value = skillsetVariable(key, context);
    if (value !== undefined) return value;
    throw unknownPreprocessVariable(token, context);
  }

  if (key.startsWith("parent.")) {
    const value = await parentVariable(key, context);
    if (value !== undefined) return value;
    throw unknownPreprocessVariable(token, context);
  }

  if (key.startsWith("$ARGUMENTS")) {
    return promptArgumentsVariable(token, key, context);
  }

  // Markdown commonly embeds other double-brace syntaxes, including JSX
  // object literals. Only Skillset's reserved variable namespaces are strict;
  // unrelated expressions remain author-owned prose.
  if (renderContext.markdown) return token;

  throw unknownPreprocessVariable(token, context);
}

function unknownPreprocessVariable(
  token: string,
  context: PreprocessContext
): Error {
  return new Error(
    `skillset: unknown preprocess variable ${token} in ${relative(context.rootPath, context.sourcePath)}`
  );
}

function promptArgumentsVariable(
  token: string,
  key: string,
  context: PreprocessContext
): string {
  if (!isPromptArgumentsVariable(key)) {
    throw new Error(
      `skillset: invalid prompt arguments variable ${token} in ${relative(context.rootPath, context.sourcePath)}`
    );
  }
  if (context.promptArguments === false) {
    throw new Error(
      `skillset: prompt arguments variable ${token} in ${relative(context.rootPath, context.sourcePath)} requires compile.features.promptArguments`
    );
  }
  if (context.target === "claude") return key;
  return `{{${key}}}`;
}

function isPromptArgumentsVariable(key: string): boolean {
  return /^\$ARGUMENTS(?:\b|\[[0-9]+\]|\.[A-Za-z_][A-Za-z0-9_-]*)$/u.test(key);
}

function readPathValue(record: JsonRecord, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = record;
  for (const segment of path.split(".")) {
    if (segment.length === 0) return undefined;
    if (!isJsonRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function stringifyPreprocessValue(
  value: JsonValue,
  key: string,
  context: PreprocessContext,
  renderContext: VariableRenderContext
): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  try {
    const json = JSON.stringify(value);
    if (isJsonRecord(value) || Array.isArray(value)) {
      return renderJsonValue(json, JSON.stringify(value, null, 2), renderContext);
    }
    return json;
  } catch {
    throw new Error(
      `skillset: cannot stringify ${key} reference in ${relative(context.rootPath, context.sourcePath)}`
    );
  }
}

function renderJsonValue(
  compactJson: string,
  prettyJson: string,
  renderContext: VariableRenderContext
): string {
  if (!renderContext.markdown) return compactJson;
  if (renderContext.inMarkdownCodeBlock) return prettyJson;
  return `\`\`\`json\n${prettyJson}\n\`\`\``;
}

function skillsetVariable(key: string, context: PreprocessContext): string | undefined {
  if (key === "skillset.source_path") {
    return normalizePath(relative(context.rootPath, context.sourcePath));
  }
  if (key === "skillset.source_dir") {
    return normalizePath(relative(context.rootPath, dirname(context.sourcePath)));
  }
  if (key === "skillset.source_root") return normalizePath(context.sourceRoot);
  return undefined;
}

async function parentVariable(key: string, context: PreprocessContext): Promise<string | undefined> {
  const parentDir = dirname(context.sourcePath);
  if (key === "parent.dir") return normalizePath(relative(context.rootPath, parentDir));
  if (key === "parent.name") return basename(parentDir);
  if (key === "parent.tree") return renderParentTree(parentDir, 2, context);
  const parsed = parsePreprocessInvocation(key);
  if (parsed.name === "parent.tree") {
    return renderParentTree(parentDir, parseParentTreeDepth(parsed, context), context);
  }
  return undefined;
}

interface PreprocessInvocation {
  readonly args: ReadonlyMap<string, string>;
  readonly duplicateArgs: ReadonlySet<string>;
  readonly name: string;
}

function parsePreprocessInvocation(key: string): PreprocessInvocation {
  const [name = "", ...rawArgs] = key.trim().split(/\s+/);
  const args = new Map<string, string>();
  const duplicateArgs = new Set<string>();
  for (const rawArg of rawArgs) {
    const separator = rawArg.indexOf(":");
    if (separator <= 0) {
      args.set(rawArg, "");
      continue;
    }
    const argName = rawArg.slice(0, separator);
    if (args.has(argName)) duplicateArgs.add(argName);
    args.set(argName, rawArg.slice(separator + 1));
  }
  return { args, duplicateArgs, name };
}

function parseParentTreeDepth(
  invocation: PreprocessInvocation,
  context: PreprocessContext
): number {
  const depth = invocation.args.get("depth");
  if (
    invocation.args.size !== 1 ||
    invocation.duplicateArgs.size > 0 ||
    depth === undefined ||
    depth.length === 0
  ) {
    throw new Error(
      `skillset: parent.tree in ${relative(context.rootPath, context.sourcePath)} supports only depth:<0-8>`
    );
  }
  const rawDepth = Number(depth);
  if (!Number.isInteger(rawDepth) || rawDepth < 0 || rawDepth > 8) {
    throw new Error(
      `skillset: parent.tree depth in ${relative(context.rootPath, context.sourcePath)} must be between 0 and 8`
    );
  }
  return rawDepth;
}

async function renderParentTree(
  parentDir: string,
  depth: number,
  context: PreprocessContext
): Promise<string> {
  context.preprocessDependencies?.add(
    `tree:${normalizePath(relative(context.rootPath, parentDir))}:${depth}`
  );
  return renderDirectoryTree(parentDir, depth);
}

async function renderDirectoryTree(root: string, depth: number): Promise<string> {
  const lines = ["."];
  if (depth > 0) {
    lines.push(...await directoryTreeLines(root, depth, ""));
  }
  return lines.join("\n");
}

async function directoryTreeLines(root: string, depth: number, indent: string): Promise<string[]> {
  if (depth <= 0) return [];
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.name !== ".DS_Store")
    .sort((left, right) => {
      if (left.name < right.name) return -1;
      if (left.name > right.name) return 1;
      return 0;
    });
  const lines: string[] = [];
  for (const entry of entries) {
    const isDirectory = entry.isDirectory();
    lines.push(`${indent}- ${entry.name}${isDirectory ? "/" : ""}`);
    if (isDirectory) {
      lines.push(
        ...(await directoryTreeLines(join(root, entry.name), depth - 1, `${indent}  `))
      );
    }
  }
  return lines;
}

function renderDirectoryTreeSync(root: string, depth: number): string {
  const lines = ["."];
  if (depth > 0) {
    lines.push(...directoryTreeLinesSync(root, depth, ""));
  }
  return lines.join("\n");
}

function directoryTreeLinesSync(root: string, depth: number, indent: string): string[] {
  if (depth <= 0) return [];
  const entries = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.name !== ".DS_Store")
    .sort((left, right) => {
      if (left.name < right.name) return -1;
      if (left.name > right.name) return 1;
      return 0;
    });
  const lines: string[] = [];
  for (const entry of entries) {
    const isDirectory = entry.isDirectory();
    lines.push(`${indent}- ${entry.name}${isDirectory ? "/" : ""}`);
    if (isDirectory) {
      lines.push(...directoryTreeLinesSync(join(root, entry.name), depth - 1, `${indent}  `));
    }
  }
  return lines;
}

function isJsonRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeTripleBraceTokens(content: string, escapedTokens: string[]): string {
  return content.replace(/\{\{\{\s*([^{}]+?)\s*\}\}\}/g, (_token, key: string) => {
    const marker = `\u0000skillset-escaped-${escapedTokens.length}\u0000`;
    escapedTokens.push(`{{${key.trim()}}}`);
    return marker;
  });
}

function restoreTripleBraceTokens(content: string, escapedTokens: readonly string[]): string {
  let restored = content;
  for (const [index, value] of escapedTokens.entries()) {
    restored = restored.replaceAll(`\u0000skillset-escaped-${index}\u0000`, value);
  }
  return restored;
}

function resolvePartial(specifier: string, context: PreprocessContext): string {
  const [scheme, path] = splitSpecifier(specifier);
  validatePartialPath(path, specifier, context);
  if (scheme === "root") {
    throw new Error(
      `skillset: ${specifier} in ${relative(context.rootPath, context.sourcePath)} uses retired root: reference syntax; use shared:${path}`
    );
  }
  if (scheme === "shared") {
    const resolved = resolveInsideScoped(
      resolveInside(context.rootPath, join(context.sourceRoot, "shared")),
      path,
      specifier,
      context
    );
    context.preprocessDependencies?.add(resolved);
    return resolved;
  }
  if (scheme === "plugin") {
    if (context.pluginPath === undefined) {
      throw new Error(
        `skillset: ${specifier} partial in ${relative(context.rootPath, context.sourcePath)} requires a plugin-bound source`
      );
    }
    const resolved = resolveInsideScoped(join(context.pluginPath, "shared"), path, specifier, context);
    context.preprocessDependencies?.add(resolved);
    return resolved;
  }

  const resolved = resolveInsideScoped(
    dirname(context.partialBasePath ?? context.sourcePath),
    specifier,
    specifier,
    context
  );
  context.preprocessDependencies?.add(resolved);
  return resolved;
}

async function resolveNamedPartial(
  specifier: string,
  context: PreprocessContext
): Promise<string> {
  const pluginScoped = specifier.startsWith("plugin:");
  const name = pluginScoped ? specifier.slice("plugin:".length) : specifier;
  validateNamedPartialSpecifier(name, specifier, context);

  const scope = pluginScoped ? "plugin" : "workspace";
  let root: string;
  if (pluginScoped) {
    const pluginPath = context.pluginPath;
    if (pluginPath === undefined) {
      throw new Error(
        `skillset: plugin named partial ${specifier} in ${relative(context.rootPath, context.sourcePath)} requires a plugin-bound source`
      );
    }
    root = join(pluginPath, "shared", "partials");
  } else {
    root = resolveInside(
      context.rootPath,
      join(context.sourceRoot, "shared", "partials")
    );
  }
  const resolved = resolveInsideScoped(root, `${name}.md`, specifier, context);
  if (!(await isFile(resolved))) {
    throw new Error(
      `skillset: ${scope} named partial ${specifier} in ${relative(context.rootPath, context.sourcePath)} was not found at ${normalizePath(relative(context.rootPath, resolved))}`
    );
  }
  context.preprocessDependencies?.add(resolved);
  return resolved;
}

function assertNoPartialCycle(
  resolved: string,
  specifier: string,
  context: PreprocessContext
): void {
  const stack = context.partialStack ?? [];
  if (!stack.includes(resolved)) return;
  const cycle = [...stack.slice(stack.indexOf(resolved)), resolved]
    .map((path) => normalizePath(relative(context.rootPath, path)))
    .join(" -> ");
  throw new Error(
    `skillset: partial ${specifier} in ${relative(context.rootPath, context.sourcePath)} creates a cycle: ${cycle}`
  );
}

function splitSpecifier(specifier: string): readonly [string | undefined, string] {
  const index = specifier.indexOf(":");
  if (index === -1) return [undefined, specifier];
  return [specifier.slice(0, index), specifier.slice(index + 1)];
}

function normalizeText(content: string): string {
  return content.replaceAll(/\r\n?/g, "\n");
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/") || ".";
}

function isMarkdownSource(path: string): boolean {
  return path.endsWith(".md");
}

type CodeRange = readonly [start: number, end: number];

interface BacktickRun {
  readonly escaped: boolean;
  readonly length: number;
  readonly start: number;
}

/** How a non-fence line affects pending code-span delimiters. */
type MarkdownLineBlock = "blank" | "continuation" | "single" | "start";

interface MarkdownFence {
  readonly char: string;
  readonly length: number;
}

function isInsideMarkdownCode(ranges: readonly CodeRange[], index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/**
 * Fenced blocks and inline code spans, computed once per document. A span opens
 * at a backtick run and closes at the next run of exactly the same length in the
 * same block, so spans may cross line breaks within a paragraph or list item but
 * never a blank line, fence, heading, list-item start, table row, thematic break,
 * or indented-code line; unmatched runs stay literal.
 */
function markdownCodeRanges(content: string): CodeRange[] {
  const ranges: CodeRange[] = [];
  let runs: BacktickRun[] = [];
  const flush = (): void => {
    pushCodeSpans(runs, ranges);
    runs = [];
  };
  let fence: MarkdownFence | undefined;
  let fenceStart = 0;
  let inParagraph = false;
  let lineStart = 0;
  for (const line of content.split("\n")) {
    const lineEnd = lineStart + line.length + 1;
    const next = nextFence(line, fence);
    if (fence === undefined && next !== undefined) {
      flush();
      fenceStart = lineStart;
    } else if (fence !== undefined && next === undefined) {
      ranges.push([fenceStart, lineEnd]);
    }
    if (fence !== undefined || next !== undefined) {
      inParagraph = false;
    } else {
      const block = markdownLineBlock(line, inParagraph);
      if (block !== "continuation") flush();
      if (block !== "blank") runs.push(...backtickRuns(line, lineStart));
      if (block === "single") flush();
      inParagraph = block === "continuation" || block === "start";
    }
    fence = next;
    lineStart = lineEnd;
  }
  if (fence !== undefined) ranges.push([fenceStart, content.length]);
  flush();
  return ranges;
}

/**
 * Single-line blocks (ATX headings, thematic breaks, table rows, and indented
 * code outside a paragraph) keep spans on their own line; list items start a
 * new block that later lines may continue.
 */
function markdownLineBlock(line: string, inParagraph: boolean): MarkdownLineBlock {
  if (/^[ \t]*$/.test(line)) return "blank";
  if (
    /^ {0,3}(?:#{1,6}(?:[ \t]|$)|\||([-*_])(?:[ \t]*\1){2,}[ \t]*$)/.test(line) ||
    (!inParagraph && /^(?: {4}|\t)/.test(line))
  ) {
    return "single";
  }
  if (/^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/.test(line)) return "start";
  return "continuation";
}

function backtickRuns(line: string, lineStart: number): BacktickRun[] {
  return Array.from(line.matchAll(/`+/g), (run) => {
    let backslashes = 0;
    while (line[run.index - backslashes - 1] === "\\") backslashes += 1;
    return {
      escaped: backslashes % 2 === 1,
      length: run[0].length,
      start: lineStart + run.index,
    };
  });
}

/**
 * Pairs runs into spans. A backslash escapes only the first backtick of an
 * opening run; closing runs match at full length because backslashes are
 * literal inside a code span.
 */
function pushCodeSpans(runs: readonly BacktickRun[], ranges: CodeRange[]): void {
  let resumeAt = 0;
  for (const [index, run] of runs.entries()) {
    if (index < resumeAt) continue;
    const openLength = run.escaped ? run.length - 1 : run.length;
    if (openLength === 0) continue;
    let close = index + 1;
    while (close < runs.length && runs[close]?.length !== openLength) close += 1;
    const closer = runs[close];
    if (closer === undefined) continue;
    ranges.push([run.start + run.length - openLength, closer.start + closer.length]);
    resumeAt = close + 1;
  }
}

/** Returns the fence state after `line`: opened, closed, or unchanged. */
function nextFence(line: string, fence: MarkdownFence | undefined): MarkdownFence | undefined {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  const marker = match?.[1];
  if (marker === undefined) return fence;
  if (fence === undefined) return { char: marker.charAt(0), length: marker.length };
  const closes =
    marker.charAt(0) === fence.char &&
    marker.length >= fence.length &&
    /^[ \t]*$/.test(match?.[2] ?? "");
  return closes ? undefined : fence;
}

function isInsideFencedCodeBlock(content: string, index: number): boolean {
  let fence: MarkdownFence | undefined;
  for (const line of content.slice(0, index).split("\n")) {
    fence = nextFence(line, fence);
  }
  return fence !== undefined;
}

function resolveInsideScoped(
  root: string,
  candidate: string,
  specifier: string,
  context: PreprocessContext
): string {
  const resolvedRoot = resolve(root);
  const resolved = resolve(resolvedRoot, candidate);
  if (!isPathInside(resolvedRoot, resolved)) {
    throw new Error(
      `skillset: partial ${specifier} in ${relative(context.rootPath, context.sourcePath)} must stay inside its partial root`
    );
  }
  return resolved;
}

function validatePartialPath(
  path: string,
  specifier: string,
  context: PreprocessContext
): void {
  const source = relative(context.rootPath, context.sourcePath);
  if (path.length === 0 || isAbsolute(path)) {
    throw new Error(`skillset: partial ${specifier} in ${source} must be a relative path`);
  }
  for (const segment of path.replaceAll("\\", "/").split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(
        `skillset: partial ${specifier} in ${source} must not contain empty, dot, or parent segments`
      );
    }
  }
}

function validateNamedPartialSpecifier(
  name: string,
  specifier: string,
  context: PreprocessContext
): void {
  const source = relative(context.rootPath, context.sourcePath);
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u.test(name)) {
    throw new Error(
      `skillset: named partial ${specifier} in ${source} must use slash-separated name segments`
    );
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    // ENOTDIR is not absence here: a partial path through a file is invalid
    // source, not a missing include.
    if (isMissingPathError(error, MISSING_PATH_ENOENT)) return false;
    throw error;
  }
}
