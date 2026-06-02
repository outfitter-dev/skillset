import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { resolveInside } from "./path";
import { renderBuildGraph } from "./render";
import { loadBuildGraph } from "./resolver";
import type { CheckResult, RenderedFile, SkillsetOptions } from "./types";

export async function buildSkillset(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<readonly RenderedFile[]> {
  const graph = await loadBuildGraph(rootPath, options);
  const rendered = await renderBuildGraph(graph);

  for (const outputRoot of graph.outputRoots) {
    await rm(resolveInside(rootPath, outputRoot), { force: true, recursive: true });
  }

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
  const actualPaths = await listOutputFiles(rootPath, graph.outputRoots);
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
