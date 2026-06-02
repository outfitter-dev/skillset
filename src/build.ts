import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { resolveInside } from "./path";
import { renderBuildGraph } from "./render";
import { loadBuildGraph } from "./resolver";
import type { CheckResult, RenderedFile, SkillsetOptions } from "./types";

const WORKSPACE_LOCK_FILE = ".skillset.lock";

export async function buildSkillset(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<readonly RenderedFile[]> {
  const graph = await loadBuildGraph(rootPath, options);
  const rendered = await renderBuildGraph(graph);
  const expectedPaths = new Set(rendered.map((file) => file.path));
  const previousWorkspaceManagedPaths = await readWorkspaceManagedPaths(rootPath);

  await assertNoUnmanagedWorkspaceOverwrites(
    rootPath,
    graph.outputRoots,
    previousWorkspaceManagedPaths,
    rendered
  );

  for (const outputRoot of graph.outputRoots) {
    await rm(resolveInside(rootPath, outputRoot), { force: true, recursive: true });
  }

  await removeStaleWorkspaceManagedFiles(
    rootPath,
    graph.outputRoots,
    previousWorkspaceManagedPaths,
    expectedPaths
  );

  for (const file of rendered) {
    const outputPath = resolveInside(rootPath, file.path);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, file.content);
  }

  return rendered;
}

export async function checkSkillset(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<CheckResult> {
  const graph = await loadBuildGraph(rootPath, options);
  const rendered = await renderBuildGraph(graph);
  const expected = new Map(rendered.map((file) => [file.path, file.content]));
  const actualPaths = await listGeneratedFiles(rootPath, graph.outputRoots, rendered);
  const actual = new Set(actualPaths);
  const failures: string[] = [];

  for (const file of rendered) {
    if (!actual.has(file.path)) {
      failures.push(`missing generated file: ${file.path}`);
      continue;
    }

    const outputPath = resolveInside(rootPath, file.path);
    const current = await readFile(outputPath);
    if (!bytesEqual(current, file.content)) {
      failures.push(`stale generated file: ${file.path}`);
    }
  }

  for (const path of actualPaths) {
    if (!expected.has(path)) {
      failures.push(`stale generated file: ${path}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`skillset: generated output is not current\n${failures.join("\n")}`);
  }

  return { checkedFiles: rendered.length };
}

async function listOutputFiles(
  rootPath: string,
  outputRoots: readonly string[]
): Promise<readonly string[]> {
  const paths: string[] = [];
  for (const outputRoot of outputRoots) {
    const absoluteTarget = resolveInside(rootPath, outputRoot);
    if (!(await exists(absoluteTarget))) continue;
    for (const file of await collectFiles(absoluteTarget)) {
      paths.push(relative(rootPath, file));
    }
  }
  return paths.sort();
}

async function listGeneratedFiles(
  rootPath: string,
  outputRoots: readonly string[],
  rendered: readonly RenderedFile[]
): Promise<readonly string[]> {
  const paths = new Set(await listOutputFiles(rootPath, outputRoots));
  const previousWorkspaceManagedPaths = await readWorkspaceManagedPaths(rootPath);

  for (const path of previousWorkspaceManagedPaths) {
    if (isInsideAnyOutputRoot(path, outputRoots)) continue;
    if (await exists(resolveInside(rootPath, path))) paths.add(path);
  }

  for (const file of rendered) {
    if (isInsideAnyOutputRoot(file.path, outputRoots)) continue;
    if (await exists(resolveInside(rootPath, file.path))) paths.add(file.path);
  }

  return [...paths].sort();
}

async function collectFiles(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function removeStaleWorkspaceManagedFiles(
  rootPath: string,
  outputRoots: readonly string[],
  previousManagedPaths: ReadonlySet<string>,
  expectedPaths: ReadonlySet<string>
): Promise<void> {
  for (const path of previousManagedPaths) {
    if (isInsideAnyOutputRoot(path, outputRoots)) continue;
    if (expectedPaths.has(path)) continue;
    await rm(resolveInside(rootPath, path), { force: true });
  }
}

async function assertNoUnmanagedWorkspaceOverwrites(
  rootPath: string,
  outputRoots: readonly string[],
  previousManagedPaths: ReadonlySet<string>,
  rendered: readonly RenderedFile[]
): Promise<void> {
  for (const file of rendered) {
    if (isInsideAnyOutputRoot(file.path, outputRoots)) continue;
    if (previousManagedPaths.has(file.path)) continue;
    if (!(await exists(resolveInside(rootPath, file.path)))) continue;
    throw new Error(
      `skillset: refusing to overwrite unmanaged workspace file ${file.path}; ` +
        `move it into .skillset/rules or remove it before generating rules`
    );
  }
}

function isInsideAnyOutputRoot(path: string, outputRoots: readonly string[]): boolean {
  return outputRoots.some(
    (outputRoot) => path === outputRoot || path.startsWith(`${outputRoot}/`)
  );
}

async function readWorkspaceManagedPaths(rootPath: string): Promise<ReadonlySet<string>> {
  const lockPath = resolveInside(rootPath, WORKSPACE_LOCK_FILE);
  if (!(await exists(lockPath))) return new Set();

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
  } catch {
    return new Set();
  }

  if (!isRecord(parsed) || typeof parsed.generatedBy !== "string") return new Set();
  if (!parsed.generatedBy.startsWith("skillset@")) return new Set();
  if (parsed.outputRoot !== ".") return new Set();

  const paths = new Set<string>([WORKSPACE_LOCK_FILE]);
  if (!Array.isArray(parsed.items)) return paths;

  for (const item of parsed.items) {
    if (!isRecord(item) || !Array.isArray(item.files)) continue;
    for (const file of item.files) {
      if (typeof file === "string" && file.trim().length > 0) {
        paths.add(file);
      }
    }
  }

  return paths;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
