import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { CacheSchema, Skill } from "@skillset/types";
import treeify from "object-treeify";
import { headingsToTreeObject, parseMarkdownHeadings } from "./markdown";

// biome-ignore lint/performance/noBarrelFile: tree helpers re-export markdown utilities
export { headingsToTreeObject, parseMarkdownHeadings } from "./markdown";

interface TreeOptions {
  /** Include markdown heading structure for SKILL.md files */
  includeMarkdown?: boolean;
  /** Maximum depth to recurse */
  maxDepth?: number;
}

interface DirectoryTreeOptions {
  maxDepth?: number;
  maxLines?: number;
  includeHidden?: boolean;
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function beginVisit(
  path: string,
  visited: Set<string>
): { allowed: boolean; token?: string } {
  const resolved = safeRealpath(path);
  if (!resolved) {
    return { allowed: true };
  }
  if (visited.has(resolved)) {
    return { allowed: false };
  }
  visited.add(resolved);
  return { allowed: true, token: resolved };
}

function endVisit(token: string | undefined, visited: Set<string>): void {
  if (token) {
    visited.delete(token);
  }
}

function isDirectoryPath(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function resolveDirectoryEntry(entryPath: string): {
  isDir: boolean;
  resolvedPath: string;
} {
  try {
    const stat = lstatSync(entryPath);
    if (stat.isSymbolicLink()) {
      const resolved = safeRealpath(entryPath);
      if (resolved && isDirectoryPath(resolved)) {
        return { isDir: true, resolvedPath: resolved };
      }
      return { isDir: false, resolvedPath: entryPath };
    }
    return { isDir: stat.isDirectory(), resolvedPath: entryPath };
  } catch {
    return { isDir: false, resolvedPath: entryPath };
  }
}

/**
 * Build a full directory tree for a path, including all files.
 */
export function buildDirectoryTreeLines(
  path: string,
  options: DirectoryTreeOptions = {}
): string[] {
  const lines: string[] = [];
  const maxDepth = options.maxDepth ?? 6;
  const maxLines = options.maxLines ?? Number.POSITIVE_INFINITY;
  const includeHidden = options.includeHidden ?? false;
  const visited = new Set<string>();
  walkDirectoryTreeLines(
    path,
    "",
    0,
    maxDepth,
    maxLines,
    includeHidden,
    lines,
    visited
  );
  return lines;
}

/**
 * Build a tree for a single skill, showing its directory + SKILL.md headings.
 */
export async function buildSkillTree(
  skill: Skill,
  options: TreeOptions = {}
): Promise<string> {
  const { includeMarkdown = true } = options;
  const skillDir = dirname(skill.path);
  const dirName = basename(skillDir);

  const treeObj = await buildDirectoryTree(
    skillDir,
    includeMarkdown,
    0,
    options.maxDepth ?? 5,
    new Set()
  );

  return treeify({ [dirName]: treeObj });
}

/**
 * Build a tree for a namespace, showing all skills in that namespace.
 */
export async function buildNamespaceTree(
  namespace: string,
  cache: CacheSchema,
  options: TreeOptions = {}
): Promise<string> {
  const { includeMarkdown = true, maxDepth = 5 } = options;

  // Find all skills in this namespace
  const skills = Object.values(cache.skills).filter(
    (skill) =>
      skill.skillRef.startsWith(`${namespace}:`) ||
      skill.skillRef.startsWith(`${namespace}/`)
  );

  if (skills.length === 0) {
    return `${namespace}/\n  (no skills found)`;
  }

  // Group skills by their base directory
  const treeObj: Record<string, unknown> = {};

  for (const skill of skills) {
    const skillDir = dirname(skill.path);
    const skillDirName = basename(skillDir);
    const dirTree = await buildDirectoryTree(
      skillDir,
      includeMarkdown,
      0,
      maxDepth,
      new Set()
    );
    treeObj[skillDirName] = dirTree;
  }

  return treeify({ [`${namespace}/`]: treeObj });
}

/**
 * Build a tree from a direct path (directory or SKILL.md file).
 */
export async function buildPathTree(
  path: string,
  options: TreeOptions = {}
): Promise<string> {
  const { includeMarkdown = true, maxDepth = 5 } = options;

  const stat = statSync(path);

  if (stat.isFile()) {
    // It's a SKILL.md file
    const dir = dirname(path);
    const dirName = basename(dir);
    const treeObj = await buildDirectoryTree(
      dir,
      includeMarkdown,
      0,
      maxDepth,
      new Set()
    );
    return treeify({ [dirName]: treeObj });
  }

  // It's a directory - check for SKILL.md
  const dirName = basename(path);
  const treeObj = await buildDirectoryTree(
    path,
    includeMarkdown,
    0,
    maxDepth,
    new Set()
  );
  return treeify({ [dirName]: treeObj });
}

function walkDirectoryTreeLines(
  dirPath: string,
  prefix: string,
  depth: number,
  maxDepth: number,
  maxLines: number,
  includeHidden: boolean,
  lines: string[],
  visited: Set<string>
): void {
  if (depth >= maxDepth || lines.length >= maxLines) {
    return;
  }
  const visit = beginVisit(dirPath, visited);
  if (!visit.allowed) {
    return;
  }
  try {
    let entries: string[];
    try {
      entries = readdirSync(dirPath);
    } catch {
      return;
    }
    const sorted = entries
      .filter((entry) => includeHidden || !entry.startsWith("."))
      .sort((a, b) => {
        const aPath = join(dirPath, a);
        const bPath = join(dirPath, b);
        const aIsDir = resolveDirectoryEntry(aPath).isDir;
        const bIsDir = resolveDirectoryEntry(bPath).isDir;
        if (aIsDir && !bIsDir) {
          return -1;
        }
        if (!aIsDir && bIsDir) {
          return 1;
        }
        return a.localeCompare(b);
      });

    sorted.forEach((entry, index) => {
      if (lines.length >= maxLines) {
        return;
      }
      const entryPath = join(dirPath, entry);
      const { isDir, resolvedPath } = resolveDirectoryEntry(entryPath);
      const isLast = index === sorted.length - 1;
      const branch = isLast ? "└──" : "├──";
      lines.push(`${prefix}${branch} ${entry}${isDir ? "/" : ""}`);
      if (lines.length >= maxLines) {
        return;
      }
      if (isDir) {
        const nextPrefix = `${prefix}${isLast ? "    " : "│   "}`;
        walkDirectoryTreeLines(
          resolvedPath,
          nextPrefix,
          depth + 1,
          maxDepth,
          maxLines,
          includeHidden,
          lines,
          visited
        );
      }
    });
  } finally {
    endVisit(visit.token, visited);
  }
}

/**
 * Recursively build directory tree, only including dirs that contain SKILL.md
 * somewhere in their subtree (for namespace view) or all files (for skill view).
 */
async function buildDirectoryTree(
  dirPath: string,
  includeMarkdown: boolean,
  depth: number,
  maxDepth: number,
  visited: Set<string>
): Promise<Record<string, unknown>> {
  if (depth >= maxDepth) {
    return { "...": null };
  }
  const visit = beginVisit(dirPath, visited);
  if (!visit.allowed) {
    return { "...": null };
  }

  const result: Record<string, unknown> = {};
  try {
    const entries = readDirectoryEntries(dirPath);
    if (!entries) {
      return result;
    }

    const sorted = sortEntries(entries, dirPath);

    for (const entry of sorted) {
      const entryPath = join(dirPath, entry);
      const { isDir, resolvedPath } = resolveDirectoryEntry(entryPath);

      if (isDir) {
        await addDirectoryEntry(
          result,
          entry,
          resolvedPath,
          includeMarkdown,
          depth,
          maxDepth,
          visited
        );
        continue;
      }
      if (entry === "SKILL.md" && includeMarkdown) {
        await addSkillFileEntry(result, entryPath);
        continue;
      }

      // Regular file
      result[entry] = null;
    }

    return result;
  } finally {
    endVisit(visit.token, visited);
  }
}

function readDirectoryEntries(dirPath: string): string[] | null {
  try {
    return readdirSync(dirPath);
  } catch {
    return null;
  }
}

function sortEntries(entries: string[], dirPath: string): string[] {
  return entries
    .filter((entry) => !entry.startsWith("."))
    .sort((a, b) => {
      // SKILL.md always first
      if (a === "SKILL.md") {
        return -1;
      }
      if (b === "SKILL.md") {
        return 1;
      }

      const aPath = join(dirPath, a);
      const bPath = join(dirPath, b);
      const aIsDir = statSync(aPath).isDirectory();
      const bIsDir = statSync(bPath).isDirectory();
      if (aIsDir && !bIsDir) {
        return -1;
      }
      if (!aIsDir && bIsDir) {
        return 1;
      }
      return a.localeCompare(b);
    });
}

async function addDirectoryEntry(
  result: Record<string, unknown>,
  entry: string,
  entryPath: string,
  includeMarkdown: boolean,
  depth: number,
  maxDepth: number,
  visited: Set<string>
): Promise<void> {
  // Check if this directory or its children contain SKILL.md
  if (await hasSkillMdInSubtree(entryPath, visited)) {
    result[`${entry}/`] = await buildDirectoryTree(
      entryPath,
      includeMarkdown,
      depth + 1,
      maxDepth,
      visited
    );
    return;
  }
  // Just show directory name without recursing deep
  result[`${entry}/`] = null;
}

async function addSkillFileEntry(
  result: Record<string, unknown>,
  entryPath: string
): Promise<void> {
  // This is a SKILL.md - inline its headings
  try {
    const content = await Bun.file(entryPath).text();
    const headings = parseMarkdownHeadings(content);
    if (headings.length > 0) {
      result["SKILL.md"] = headingsToTreeObject(headings);
    } else {
      result["SKILL.md"] = null;
    }
  } catch {
    result["SKILL.md"] = null;
  }
}

/**
 * Check if a directory or any of its subdirectories contains a SKILL.md file.
 */
async function hasSkillMdInSubtree(
  dirPath: string,
  visited = new Set<string>()
): Promise<boolean> {
  const visit = beginVisit(dirPath, visited);
  if (!visit.allowed) {
    return false;
  }
  try {
    const entries = readdirSync(dirPath);

    for (const entry of entries) {
      if (entry === "SKILL.md") {
        return true;
      }

      const entryPath = join(dirPath, entry);
      const { isDir, resolvedPath } = resolveDirectoryEntry(entryPath);

      if (
        isDir &&
        !entry.startsWith(".") &&
        (await hasSkillMdInSubtree(resolvedPath, visited))
      ) {
        return true;
      }
    }
  } catch {
    // Ignore errors
  } finally {
    endVisit(visit.token, visited);
  }

  return false;
}

/**
 * Determine if input is a namespace reference.
 */
export function isNamespaceRef(input: string): boolean {
  // Namespace refs look like: project, user, plugin:name
  // They don't contain path separators and match known patterns
  return input === "project" || input === "user" || input.startsWith("plugin:");
}
