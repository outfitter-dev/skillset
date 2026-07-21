import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import type {
  AppliedTransform,
  RenderedFile,
  SourceOrigin,
  TargetName,
} from "./types";

const textEncoder = new TextEncoder();
const COMPILER_ID = "skillset";
const COMPILER_VERSION = "0.1.0";

export const GENERATED_BY = `${COMPILER_ID}@${COMPILER_VERSION}`;
export const WORKSPACE_LOCK_ROOT = ".";

export interface LockItem {
  readonly feature?: string;
  readonly files: readonly string[];
  readonly dependencies?: readonly string[];
  readonly includedSkills?: readonly string[];
  readonly kind:
    | "changelog"
    | "island"
    | "plugin"
    | "plugin-feature"
    | "plugin-skill"
    | "project-agent"
    | "rule"
    | "standalone-skill";
  readonly name: string;
  readonly origin?: string;
  readonly outputHash: string;
  readonly outputPath: string;
  readonly plugin?: string;
  readonly preprocessDependencies?: readonly string[];
  readonly renderInputsHash?: string;
  readonly skippedSkills?: readonly string[];
  readonly sourceHash: string;
  readonly sourceOrigin?: SourceOrigin;
  readonly sourcePath: string;
  readonly sourcePointer?: string;
  readonly targetState?: string;
  readonly transforms?: readonly AppliedTransform[];
  readonly validation?: "opaque-copy" | "structured";
  readonly version?: string;
}

export interface LockRoot {
  readonly items: LockItem[];
  readonly target: TargetName | "workspace";
}

export async function copyPath(
  sourcePath: string,
  targetPath: string
): Promise<readonly RenderedFile[]> {
  const stats = await stat(sourcePath);
  if (stats.isFile()) {
    return [{ path: targetPath, content: await readFile(sourcePath) }];
  }

  const files: RenderedFile[] = [];
  for (const file of await collectFiles(sourcePath)) {
    files.push({
      path: join(targetPath, relative(sourcePath, file)),
      content: await readFile(file),
    });
  }
  return files;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

export function lockRootsFor(
  lockRoots: Map<string, LockRoot>,
  outputRoot: string,
  target: TargetName | "workspace"
): LockRoot {
  const existing = lockRoots.get(outputRoot);
  if (existing !== undefined) {
    if (existing.target === target) return existing;
    const merged: LockRoot = {
      items: [...existing.items],
      target: "workspace",
    };
    lockRoots.set(outputRoot, merged);
    return merged;
  }
  const created: LockRoot = { items: [], target };
  lockRoots.set(outputRoot, created);
  return created;
}

export function textFile(
  path: string,
  content: string,
  sourcePath?: string
): RenderedFile {
  return sourcePath === undefined
    ? { path, content: textEncoder.encode(content) }
    : { path, content: textEncoder.encode(content), sourcePath };
}

async function collectFiles(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  )) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile() && !entry.name.endsWith(".DS_Store")) {
      files.push(path);
    }
  }
  return files;
}
