import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import type { SetupImportCandidate } from "./setup";

export interface PreparedPluginAdoptionSource {
  readonly originByFile: ReadonlyMap<string, string>;
  readonly sourcePath: string;
  readonly temporaryRoot: string;
}

/**
 * Builds an isolated source tree only when adoption must combine equivalent
 * provider roots or exclude nested plugin candidates from a root plugin.
 */
export async function preparePluginAdoptionSource(
  rootPath: string,
  candidate: SetupImportCandidate,
  allCandidates: readonly SetupImportCandidate[]
): Promise<PreparedPluginAdoptionSource | undefined> {
  if (candidate.kind !== "plugin") return undefined;

  const sourcePaths = candidate.plugin?.paths ?? [candidate.path];
  const otherPluginPaths = allCandidates.flatMap((item) => {
    if (item.kind !== "plugin" || item === candidate) return [];
    return item.plugin?.paths ?? [item.path];
  });
  const needsPreparedSource =
    candidate.plugin?.relation === "equivalent" ||
    sourcePaths.some((sourcePath) => hasNestedCandidatePath(sourcePath, otherPluginPaths));
  if (!needsPreparedSource) return undefined;

  return mergePluginSources(rootPath, candidate, sourcePaths, otherPluginPaths);
}

export function preparedPluginOriginPath(
  prepared: PreparedPluginAdoptionSource,
  candidate: SetupImportCandidate,
  copiedFile: string | undefined
): string {
  if (copiedFile === undefined) return candidate.path;
  return prepared.originByFile.get(copiedFile) ?? `${candidate.path}/${copiedFile}`;
}

export async function removePreparedPluginAdoptionSource(
  prepared: PreparedPluginAdoptionSource
): Promise<void> {
  await rm(prepared.temporaryRoot, { force: true, recursive: true });
}

async function mergePluginSources(
  rootPath: string,
  candidate: SetupImportCandidate,
  sourcePaths: readonly string[],
  otherPluginPaths: readonly string[]
): Promise<PreparedPluginAdoptionSource> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "skillset-adopt-plugin-"));
  const sourcePath = join(temporaryRoot, candidate.plugin?.identity ?? "plugin");
  const originByFile = new Map<string, string>();
  try {
    for (const path of sourcePaths) {
      const excludedRoots = new Set(
        [...sourcePaths.filter((sourcePath) => sourcePath !== path), ...otherPluginPaths]
          .filter((otherPath) => isNestedCandidatePath(path, otherPath))
          .map((otherPath) => resolve(rootPath, otherPath))
      );
      await mergePluginTree(
        join(rootPath, path),
        sourcePath,
        path,
        originByFile,
        excludedRoots
      );
    }
    return { originByFile, sourcePath, temporaryRoot };
  } catch (error) {
    await rm(temporaryRoot, { force: true, recursive: true });
    throw error;
  }
}

async function mergePluginTree(
  sourceRoot: string,
  targetRoot: string,
  originRoot: string,
  originByFile: Map<string, string>,
  excludedRoots: ReadonlySet<string>,
  currentSource = sourceRoot
): Promise<void> {
  for (const entry of (await readdir(currentSource, { withFileTypes: true })).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  )) {
    if (entry.name === ".DS_Store" || entry.name === ".git") continue;
    const sourcePath = join(currentSource, entry.name);
    const relativePath = relative(sourceRoot, sourcePath).replaceAll("\\", "/");
    if (isRootAdoptionScaffold(originRoot, relativePath)) continue;
    if (entry.isDirectory() && excludedRoots.has(resolve(sourcePath))) continue;
    const targetPath = join(targetRoot, relativePath);
    if (entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await mergePluginTree(
        sourceRoot,
        targetRoot,
        originRoot,
        originByFile,
        excludedRoots,
        sourcePath
      );
      continue;
    }
    if (!entry.isFile()) continue;

    const content = await readFile(sourcePath);
    if (await exists(targetPath)) {
      const existing = await readFile(targetPath);
      if (!existing.equals(content)) {
        throw new Error(
          `skillset: equivalent plugin candidates disagree at ${relativePath}; rerun the survey and resolve the competing sources`
        );
      }
      continue;
    }
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content);
    originByFile.set(relativePath, `${originRoot}/${relativePath}`.replace(/^\.\//, ""));
  }
}

function hasNestedCandidatePath(sourcePath: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => isNestedCandidatePath(sourcePath, candidate));
}

function isNestedCandidatePath(parentPath: string, candidatePath: string): boolean {
  const parent = resolve("/", parentPath);
  const candidate = resolve("/", candidatePath);
  const prefix = parent === "/" ? "/" : `${parent}/`;
  return candidate !== parent && candidate.startsWith(prefix);
}

function isRootAdoptionScaffold(originRoot: string, relativePath: string): boolean {
  if (originRoot !== ".") return false;
  return (
    relativePath === ".skillset" ||
    relativePath.startsWith(".skillset/") ||
    relativePath === "skillset.yaml" ||
    relativePath === "skillset.lock"
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
