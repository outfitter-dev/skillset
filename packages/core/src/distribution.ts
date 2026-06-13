import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

import { readString } from "./config";
import { compareStrings } from "./path";
import { renderBuildGraph } from "./render";
import { loadBuildGraph } from "./resolver";
import type {
  BuildGraph,
  DistributionConfig,
  JsonRecord,
  RenderedFile,
  SkillsetOptions,
  SourcePlugin,
  StandaloneSkill,
  TargetName,
} from "./types";

export type DistributionSelectorKind = "plugin" | "plugins" | "skill";
export type DistributionFileStatus = "add" | "change" | "unchanged" | "unknown";
export type DistributionNoOp = boolean | "unknown";

export interface DistributionPlanReport {
  readonly plans: readonly DistributionPlan[];
  readonly rootPath: string;
}

export interface DistributionPlan {
  readonly destination: DistributionDestinationPlan;
  readonly dryRun: boolean;
  readonly files: readonly DistributionPlanFile[];
  readonly from: DistributionFromPlan;
  readonly name: string;
  readonly noOp: DistributionNoOp;
  readonly sourceDigest: string;
}

export interface DistributionFromPlan {
  readonly outputRoot: string;
  readonly runtime?: string;
  readonly selector: string;
  readonly selectorKind: DistributionSelectorKind;
  readonly target: TargetName;
}

export interface DistributionDestinationPlan {
  readonly branch?: string;
  readonly kind: DistributionConfig["to"]["kind"];
  readonly root: string;
  readonly subdirectory?: string;
}

export interface DistributionPlanFile {
  readonly bytes: number;
  readonly destinationPath: string;
  readonly hash: string;
  readonly sourcePath: string;
  readonly status: DistributionFileStatus;
}

export async function planDistributions(
  rootPath: string,
  options: SkillsetOptions & { readonly name?: string } = {}
): Promise<DistributionPlanReport> {
  const graph = await loadBuildGraph(rootPath, options);
  const allRendered = await renderBuildGraph(graph);
  const names = options.name === undefined ? Object.keys(graph.root.distributions).sort(compareStrings) : [options.name];
  const plans: DistributionPlan[] = [];

  for (const name of names) {
    const config = graph.root.distributions[name];
    if (config === undefined) {
      throw new Error(`skillset: unknown distribution ${name}`);
    }
    plans.push(await planDistribution(graph, allRendered, name, config));
  }

  return { plans, rootPath: graph.rootPath };
}

async function planDistribution(
  graph: BuildGraph,
  rendered: readonly RenderedFile[],
  name: string,
  config: DistributionConfig
): Promise<DistributionPlan> {
  const selected = selectDistributionFiles(graph, rendered, config);
  const files = await Promise.all(
    selected.files.map(async (file) => {
      const hash = sha256(file.content);
      const destinationPath = joinWorkspacePath(selected.destinationPrefix, stripRequiredPrefix(file.path, selected.sourcePrefix));
      return {
        bytes: file.content.byteLength,
        destinationPath,
        hash,
        sourcePath: file.path,
        status: await distributionFileStatus(graph, config, destinationPath, file.content),
      };
    })
  );

  const sortedFiles = [...files].sort((left, right) => compareStrings(left.destinationPath, right.destinationPath));
  return {
    destination: destinationPlan(config),
    dryRun: config.dryRun,
    files: sortedFiles,
    from: {
      outputRoot: selected.sourcePrefix,
      ...(config.from.runtime === undefined ? {} : { runtime: config.from.runtime }),
      selector: config.from.selector,
      selectorKind: selected.selectorKind,
      target: config.from.target,
    },
    name,
    noOp: distributionNoOp(sortedFiles),
    sourceDigest: distributionDigest(sortedFiles),
  };
}

function selectDistributionFiles(
  graph: BuildGraph,
  rendered: readonly RenderedFile[],
  config: DistributionConfig
): {
  readonly destinationPrefix: string;
  readonly files: readonly RenderedFile[];
  readonly selectorKind: DistributionSelectorKind;
  readonly sourcePrefix: string;
} {
  const target = config.from.target;
  if (!graph.root.targets[target].enabled) {
    throw new Error(`skillset: distribution target ${target} is not enabled by compile.targets`);
  }

  const selector = config.from.selector;
  const destinationPrefix = normalizeRelativePath(config.to.subdirectory ?? "", "distribution subdirectory");
  if (selector === "plugins") {
    return {
      destinationPrefix,
      files: filesUnder(rendered, graph.root.outputs.plugins[target], `distribution ${selector}`),
      selectorKind: "plugins",
      sourcePrefix: graph.root.outputs.plugins[target],
    };
  }

  const plugin = parsePrefixedSelector(selector, "plugin");
  if (plugin !== undefined) {
    assertPluginExists(graph.plugins, plugin);
    const sourcePrefix = `${graph.root.outputs.plugins[target]}/plugins/${plugin}`;
    return {
      destinationPrefix,
      files: filesUnder(rendered, sourcePrefix, `distribution ${selector}`),
      selectorKind: "plugin",
      sourcePrefix,
    };
  }

  const skill = parsePrefixedSelector(selector, "skill");
  if (skill !== undefined) {
    assertStandaloneSkillExists(graph.standaloneSkills, skill);
    const sourcePrefix = `${graph.root.outputs.skills[target]}/${skill}`;
    return {
      destinationPrefix,
      files: filesUnder(rendered, sourcePrefix, `distribution ${selector}`),
      selectorKind: "skill",
      sourcePrefix,
    };
  }

  throw new Error("skillset: distribution from.selector must be plugins, plugin:<id>, or skill:<id>");
}

function destinationPlan(config: DistributionConfig): DistributionDestinationPlan {
  const root = config.to.kind === "local" ? config.to.path : config.to.repo;
  if (root === undefined) {
    throw new Error(`skillset: distribution ${config.to.kind} destination is missing a root`);
  }
  return {
    ...(config.to.branch === undefined ? {} : { branch: config.to.branch }),
    kind: config.to.kind,
    root,
    ...(config.to.subdirectory === undefined ? {} : { subdirectory: normalizeRelativePath(config.to.subdirectory, "distribution subdirectory") }),
  };
}

async function distributionFileStatus(
  graph: BuildGraph,
  config: DistributionConfig,
  destinationPath: string,
  content: Uint8Array
): Promise<DistributionFileStatus> {
  if (config.to.kind !== "local") return "unknown";
  const root = config.to.path;
  if (root === undefined) return "unknown";
  try {
    const current = await readFile(resolve(graph.rootPath, root, destinationPath));
    return bytesEqual(current, content) ? "unchanged" : "change";
  } catch (error) {
    if (isNotFound(error)) return "add";
    throw error;
  }
}

function distributionNoOp(files: readonly DistributionPlanFile[]): DistributionNoOp {
  if (files.some((file) => file.status === "unknown")) return "unknown";
  return files.every((file) => file.status === "unchanged");
}

function distributionDigest(files: readonly DistributionPlanFile[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.destinationPath);
    hash.update("\0");
    hash.update(file.hash);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function filesUnder(
  rendered: readonly RenderedFile[],
  sourcePrefix: string,
  label: string
): readonly RenderedFile[] {
  const files = rendered.filter((file) => file.path.startsWith(`${sourcePrefix}/`));
  if (files.length === 0) {
    throw new Error(`skillset: ${label} selected no generated files`);
  }
  return files;
}

function assertPluginExists(plugins: readonly SourcePlugin[], id: string): void {
  if (plugins.some((plugin) => plugin.id === id)) return;
  throw new Error(`skillset: distribution references unknown plugin ${id}`);
}

function assertStandaloneSkillExists(skills: readonly StandaloneSkill[], id: string): void {
  if (skills.some((skill) => skill.id === id)) return;
  throw new Error(`skillset: distribution references unknown standalone skill ${id}`);
}

function parsePrefixedSelector(selector: string, prefix: "plugin" | "skill"): string | undefined {
  const expected = `${prefix}:`;
  if (!selector.startsWith(expected)) return undefined;
  const value = selector.slice(expected.length);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new Error(`skillset: expected distribution selector ${selector} to use a lowercase ${prefix} id`);
  }
  return value;
}

function stripRequiredPrefix(path: string, prefix: string): string {
  const expected = `${prefix}/`;
  if (!path.startsWith(expected)) {
    throw new Error(`skillset: expected ${path} to be inside ${prefix}`);
  }
  return path.slice(expected.length);
}

function joinWorkspacePath(prefix: string, path: string): string {
  const normalizedPath = normalizeRelativePath(path, "distribution output path");
  if (prefix.length === 0) return normalizedPath;
  return `${prefix}/${normalizedPath}`;
}

function normalizeRelativePath(path: string, label: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (normalized === "." || normalized.length === 0) return "";
  const segments = normalized.split("/");
  if (normalized.startsWith("/") || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`skillset: unsafe ${label} ${JSON.stringify(path)}`);
  }
  return normalized;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function isNotFound(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
