import { readdirSync, readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { compareStrings, resolveInside } from "./path";
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
  readonly variables?: Readonly<Record<string, string>>;
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

async function expandPartials(content: string, context: PreprocessContext): Promise<string> {
  const partialPattern = /\{\{\s*(?:>\s*([^}\s]+)|([^}\s]+))\s*\}\}/g;
  let expanded = "";
  let cursor = 0;

  for (const match of content.matchAll(partialPattern)) {
    const [token, namedSpecifier, specifier] = match;
    expanded += content.slice(cursor, match.index);
    if (namedSpecifier !== undefined) {
      expanded += await readPartial(namedSpecifier, context, "named");
    } else if (specifier !== undefined && isPartialSpecifier(specifier)) {
      expanded += await readPartial(specifier, context, "path");
    } else {
      expanded += token;
    }
    cursor = match.index + token.length;
  }

  return `${expanded}${content.slice(cursor)}`;
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
    assertNoPartialCycle(resolved, specifier, context);
    const content = normalizeText(await readFile(resolved, "utf8"));
    return await expandPartials(content, {
      ...context,
      partialBasePath: resolved,
      partialStack: [...(context.partialStack ?? []), resolved],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`skillset: failed to read partial ${specifier} in ${source}: ${message}`);
  }
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
  }

  if (key.startsWith("parent.")) {
    const value = await parentVariable(key, context);
    if (value !== undefined) return value;
  }

  if (key.startsWith("$ARGUMENTS")) {
    return promptArgumentsVariable(token, key, context);
  }

  throw new Error(
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

function isPartialSpecifier(specifier: string): boolean {
  if (
    specifier.startsWith("this.") ||
    specifier.startsWith("skillset.") ||
    specifier.startsWith("parent.")
  ) {
    return false;
  }
  if (
    specifier.startsWith("shared:") ||
    specifier.startsWith("root:") ||
    specifier.startsWith("plugin:")
  ) {
    return true;
  }
  return specifier.includes("/") || /^[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+$/.test(specifier);
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
  if (scheme === "shared" || scheme === "root") {
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
  validateNamedPartialSpecifier(specifier, context);
  const pluginPath = context.pluginPath;
  const separator = specifier.indexOf(".");

  if (pluginPath !== undefined && separator > 0 && specifier.slice(0, separator) === basename(pluginPath)) {
    return resolveNamedPartialFromRoot(
      join(pluginPath, "partials"),
      specifier.slice(separator + 1),
      specifier,
      context,
      "plugin"
    );
  }

  const workspaceRoot = resolveInside(context.rootPath, join(context.sourceRoot, "partials"));
  const workspacePartial = await maybeResolveNamedPartialFromRoot(
    workspaceRoot,
    specifier,
    specifier,
    context,
    "workspace"
  );
  if (workspacePartial !== undefined) return workspacePartial;

  if (pluginPath !== undefined) {
    if (separator > 0) {
      const foreignPlugin = specifier.slice(0, separator);
      if (await isDirectory(join(resolveInside(context.rootPath, context.sourceRoot), "plugins", foreignPlugin))) {
        throw new Error(
          `skillset: named partial ${specifier} in ${relative(context.rootPath, context.sourcePath)} cannot reference another plugin`
        );
      }
    }
    return resolveNamedPartialFromRoot(
      join(pluginPath, "partials"),
      specifier,
      specifier,
      context,
      "plugin"
    );
  }

  throw new Error(
    `skillset: named partial ${specifier} in ${relative(context.rootPath, context.sourcePath)} was not found`
  );
}

async function resolveNamedPartialFromRoot(
  root: string,
  name: string,
  specifier: string,
  context: PreprocessContext,
  scope: "plugin" | "workspace"
): Promise<string> {
  const resolved = await maybeResolveNamedPartialFromRoot(root, name, specifier, context, scope);
  if (resolved !== undefined) return resolved;
  throw new Error(
    `skillset: ${scope} named partial ${specifier} in ${relative(context.rootPath, context.sourcePath)} was not found`
  );
}

async function maybeResolveNamedPartialFromRoot(
  root: string,
  name: string,
  specifier: string,
  context: PreprocessContext,
  scope: "plugin" | "workspace"
): Promise<string | undefined> {
  const direct = resolveInsideScoped(root, `${name}.md`, specifier, context);
  if (await isFile(direct)) {
    context.preprocessDependencies?.add(direct);
    return direct;
  }

  const matches = await findNamedPartialMatches(root, `${name}.md`);
  if (matches.length === 0) return undefined;
  if (matches.length === 1) {
    const [match] = matches;
    if (match === undefined) return undefined;
    context.preprocessDependencies?.add(match);
    return match;
  }

  throw new Error(
    `skillset: ${scope} named partial ${specifier} in ${relative(context.rootPath, context.sourcePath)} is ambiguous: ${matches
      .map((match) => normalizePath(relative(root, match)))
      .sort()
      .join(", ")}`
  );
}

async function findNamedPartialMatches(root: string, filename: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }

  const matches: string[] = [];
  for (const entry of entries
    .filter((item) => item.name !== ".DS_Store")
    .sort((left, right) => compareStrings(left.name, right.name))) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await findNamedPartialMatches(entryPath, filename));
    } else if (entry.isFile() && entry.name === filename) {
      matches.push(entryPath);
    }
  }
  return matches;
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

function isInsideFencedCodeBlock(content: string, index: number): boolean {
  const before = content.slice(0, index);
  let fence: { readonly char: "`" | "~"; readonly length: number } | undefined;
  for (const line of before.split("\n")) {
    const match = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
    if (match === null) continue;
    const marker = match[2];
    if (marker === undefined) continue;
    const char = marker[0] as "`" | "~";
    const length = marker.length;
    if (fence === undefined) {
      fence = { char, length };
      continue;
    }
    const trailing = match[3] ?? "";
    if (char === fence.char && length >= fence.length && /^[ \t]*$/.test(trailing)) fence = undefined;
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
  const relativePath = relative(resolvedRoot, resolved);
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    relativePath.includes(`..${sep}`)
  ) {
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
  specifier: string,
  context: PreprocessContext
): void {
  const source = relative(context.rootPath, context.sourcePath);
  if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/u.test(specifier)) {
    throw new Error(
      `skillset: named partial ${specifier} in ${source} must use dot-separated name segments`
    );
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
