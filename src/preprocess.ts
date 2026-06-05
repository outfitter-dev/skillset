import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { readString } from "./config";
import { resolveInside } from "./path";
import type { JsonRecord } from "./types";

export interface PreprocessContext {
  readonly frontmatter: JsonRecord;
  readonly pluginPath?: string;
  readonly preprocessDependencies?: Set<string>;
  readonly rootPath: string;
  readonly sourcePath: string;
  readonly sourceRoot: string;
  readonly variables?: Readonly<Record<string, string>>;
}

export async function preprocessText(
  content: string,
  context: PreprocessContext
): Promise<string> {
  if (isPreprocessDisabled(context.frontmatter)) {
    return normalizeText(content);
  }

  let expanded = normalizeText(content);
  expanded = await expandPartials(expanded, context);
  expanded = expandVariables(expanded, context);
  return expanded;
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
  const partialPattern = /\{\{\s*>\s*([^}\s]+)\s*\}\}/g;
  let expanded = "";
  let cursor = 0;

  for (const match of content.matchAll(partialPattern)) {
    const [token, specifier] = match;
    if (specifier === undefined) continue;
    expanded += content.slice(cursor, match.index);
    expanded += normalizeText(await readPartial(specifier, context));
    cursor = match.index + token.length;
  }

  return `${expanded}${content.slice(cursor)}`;
}

async function readPartial(specifier: string, context: PreprocessContext): Promise<string> {
  const source = relative(context.rootPath, context.sourcePath);
  try {
    return await readFile(resolvePartial(specifier, context), "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`skillset: failed to read partial ${specifier} in ${source}: ${message}`);
  }
}

function expandVariables(content: string, context: PreprocessContext): string {
  return content.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (token, key: string) => {
    if (key.startsWith("this.")) {
      const field = key.slice("this.".length);
      const value = readString(context.frontmatter, field);
      if (value === undefined) {
        throw new Error(
          `skillset: missing this.${field} reference in ${relative(context.rootPath, context.sourcePath)}`
        );
      }
      return value;
    }

    const value = context.variables?.[key];
    if (value !== undefined) return value;

    throw new Error(
      `skillset: unknown preprocess variable ${token} in ${relative(context.rootPath, context.sourcePath)}`
    );
  });
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

  const resolved = resolveInsideScoped(dirname(context.sourcePath), specifier, specifier, context);
  context.preprocessDependencies?.add(resolved);
  return resolved;
}

function splitSpecifier(specifier: string): readonly [string | undefined, string] {
  const index = specifier.indexOf(":");
  if (index === -1) return [undefined, specifier];
  return [specifier.slice(0, index), specifier.slice(index + 1)];
}

function normalizeText(content: string): string {
  return content.replaceAll(/\r\n?/g, "\n");
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
