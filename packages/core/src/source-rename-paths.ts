/* eslint-disable func-style, no-await-in-loop, no-use-before-define -- Hoisted path predicates keep containment policy together. */
/* eslint-disable unicorn/import-style, unicorn/no-await-expression-member -- Named path helpers and direct lstat checks keep safety code concise. */

import { lstat, realpath, readdir, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { compareStrings, validateSlug } from "./path";
import { SourceRenamePlanError } from "./source-rename-types";
import type { SourceRenameKind } from "./source-rename-types";
import { targetNames } from "./targets";
import type { BuildGraph, SourcePlugin, SourceSkill } from "./types";

export interface RenameClassification {
  readonly kind: SourceRenameKind;
  readonly scope: string;
  readonly skill?: SourceSkill;
}

export async function workspaceRoot(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    throw new SourceRenamePlanError(`workspace root does not exist: ${path}`);
  }
}

export async function existingContainedPath(
  rootPath: string,
  value: string,
  label: string
): Promise<string> {
  const path = containedPath(rootPath, value, label);
  if (!(await pathExists(path))) {
    throw new SourceRenamePlanError(
      `${label} does not exist: ${display(rootPath, path)}`
    );
  }
  return path;
}

export async function futureContainedPath(
  rootPath: string,
  value: string,
  label: string
): Promise<string> {
  const path = containedPath(rootPath, value, label);
  const ancestor = await nearestExistingAncestor(path);
  const actual = await realpath(ancestor);
  if (!isWithin(rootPath, actual)) {
    throw new SourceRenamePlanError(
      `${label} escapes the workspace through a symbolic link`
    );
  }
  return path;
}

export function assertSourceContained(
  graph: BuildGraph,
  path: string,
  label: string
): void {
  if (!isWithin(graph.sourceRootPath, path)) {
    throw new SourceRenamePlanError(
      `${label} must stay inside ${display(graph.rootPath, graph.sourceRootPath)}`
    );
  }
}

export async function assertNoSymlinkTraversal(
  rootPath: string,
  path: string,
  label: string
): Promise<void> {
  const parts = relative(rootPath, path).split(sep).filter(Boolean);
  let current = rootPath;
  for (const part of parts) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new SourceRenamePlanError(
          `${label} traverses symbolic link ${display(rootPath, current)}`
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

export function classifyRename(
  graph: BuildGraph,
  fromPath: string,
  isDirectory: boolean
): RenameClassification {
  const standalone = graph.standaloneSkills.find(
    (skill) => dirname(skill.sourcePath) === fromPath
  );
  if (standalone !== undefined) {
    if (!isDirectory) {
      throw new SourceRenamePlanError(
        "a skill must be renamed by its directory"
      );
    }
    return {
      kind: "standalone-skill",
      scope: dirname(fromPath),
      skill: standalone,
    };
  }
  const plugin = graph.plugins
    .flatMap((entry) => entry.skills)
    .find((skill) => dirname(skill.sourcePath) === fromPath);
  if (plugin !== undefined) {
    if (!isDirectory) {
      throw new SourceRenamePlanError(
        "a skill must be renamed by its directory"
      );
    }
    return { kind: "plugin-skill", scope: dirname(fromPath), skill: plugin };
  }
  if (isDirectory) {
    throw new SourceRenamePlanError(
      "only complete standalone or plugin skill directories can be renamed in this first source planner"
    );
  }
  return { kind: "file", scope: sourceScope(graph, fromPath) };
}

export function assertDestination(
  graph: BuildGraph,
  classification: RenameClassification,
  fromPath: string,
  toPath: string
): void {
  if (fromPath === toPath) {
    throw new SourceRenamePlanError("source and destination are the same path");
  }
  if (
    classification.kind === "standalone-skill" ||
    classification.kind === "plugin-skill"
  ) {
    if (dirname(toPath) !== dirname(fromPath)) {
      throw new SourceRenamePlanError(
        "a skill rename must remain in its current skill collection"
      );
    }
    try {
      validateSlug(basename(toPath), "renamed skill directory");
    } catch (error) {
      throw new SourceRenamePlanError(
        error instanceof Error
          ? error.message.replace(/^skillset: /u, "")
          : String(error)
      );
    }
    return;
  }
  if (sourceScope(graph, toPath) !== classification.scope) {
    throw new SourceRenamePlanError(
      "a file rename cannot cross authored source surfaces"
    );
  }
}

function sourceScope(graph: BuildGraph, path: string): string {
  const skill = allSkills(graph).find((entry) =>
    isWithin(dirname(entry.sourcePath), path)
  );
  if (skill !== undefined) {
    const plugin = pluginForSkill(graph, skill);
    return plugin === undefined
      ? `standalone-skill:${skill.id}`
      : `plugin-skill:${plugin.id}:${skill.id}`;
  }
  const plugin = graph.plugins.find((entry) => isWithin(entry.path, path));
  const ownerPath = plugin?.path ?? graph.sourceRootPath;
  const [surface = "root"] = relative(ownerPath, path).split(sep);
  if (
    surface === "changes" ||
    surface === "releases" ||
    surface === "tests" ||
    surface.startsWith("_")
  ) {
    throw new SourceRenamePlanError(
      `cannot rename files in preserved ${surface} source (preserved source surface)`
    );
  }
  return plugin === undefined
    ? `workspace:${surface}`
    : `plugin:${plugin.id}:${surface}`;
}

export function sourceYamlDocuments(graph: BuildGraph): readonly string[] {
  return [
    ...new Set([
      graph.rootConfigPath,
      graph.rootManifestPath,
      ...graph.plugins.map((plugin) => plugin.configPath),
    ]),
  ].toSorted(compareStrings);
}

export async function sourceMarkdownDocuments(
  graph: BuildGraph
): Promise<readonly string[]> {
  const paths = await collectFiles(graph.sourceRootPath);
  return paths
    .filter(
      (path) =>
        path.endsWith(".md") &&
        !isAppendOnlySourcePath(graph, path) &&
        !isProviderOpaqueSourcePath(graph, path)
    )
    .toSorted(compareStrings);
}

export function allSkills(graph: BuildGraph): readonly SourceSkill[] {
  return [
    ...graph.standaloneSkills,
    ...graph.plugins.flatMap((plugin) => plugin.skills),
  ];
}

export function pluginForSkill(
  graph: BuildGraph,
  skill: SourceSkill
): SourcePlugin | undefined {
  return graph.plugins.find((plugin) => plugin.skills.includes(skill));
}

export function pluginForPath(
  graph: BuildGraph,
  path: string
): SourcePlugin | undefined {
  return graph.plugins.find((plugin) => isWithin(plugin.path, path));
}

export function remapPath(path: string, from: string, to: string): string {
  if (path === from) {
    return to;
  }
  if (!isWithin(from, path)) {
    return path;
  }
  return join(to, relative(from, path));
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function sameExistingEntry(
  left: string,
  right: string
): Promise<boolean> {
  try {
    return (await realpath(left)) === (await realpath(right));
  } catch {
    return false;
  }
}

export async function pathIsDirectory(path: string): Promise<boolean> {
  return (await stat(path)).isDirectory();
}

export function isCaseOnlyRename(from: string, to: string): boolean {
  return from !== to && from.toLowerCase() === to.toLowerCase();
}

export function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
}

export function display(rootPath: string, path: string): string {
  const value = toPosix(relative(rootPath, path));
  return value === "" ? "." : value;
}

export function absoluteWorkspacePath(rootPath: string, path: string): string {
  return isAbsolute(path) ? path : resolve(rootPath, path);
}

export function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

async function nearestExistingAncestor(path: string): Promise<string> {
  let candidate = path;
  while (!(await pathExists(candidate))) {
    const parent = dirname(candidate);
    if (parent === candidate) {
      return candidate;
    }
    candidate = parent;
  }
  return candidate;
}

function containedPath(rootPath: string, value: string, label: string): string {
  const path = isAbsolute(value) ? resolve(value) : resolve(rootPath, value);
  if (!isWithin(rootPath, path)) {
    throw new SourceRenamePlanError(`${label} must stay inside the workspace`);
  }
  return path;
}

async function collectFiles(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.toSorted((left, right) =>
    compareStrings(left.name, right.name)
  )) {
    if (entry.name === ".git") {
      continue;
    }
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function isAppendOnlySourcePath(graph: BuildGraph, path: string): boolean {
  return (
    isWithin(join(graph.sourcePath, "changes"), path) ||
    isWithin(join(graph.sourcePath, "releases"), path)
  );
}

function isProviderOpaqueSourcePath(graph: BuildGraph, path: string): boolean {
  const owners = [
    graph.sourceRootPath,
    ...graph.plugins.map((plugin) => plugin.path),
  ];
  return owners.some((owner) =>
    targetNames().some((target) => isWithin(join(owner, `_${target}`), path))
  );
}
