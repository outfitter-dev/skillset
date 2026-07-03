import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { diffSkillset, type SkillsetDiff } from "./build";
import { readString } from "./config";
import { compareStrings, resolveInside } from "./path";
import { gitSafeEnv } from "./git-env";
import {
  formatPreprocessDependency,
  preprocessText,
  readPreprocessDependencySync,
} from "./preprocess";
import { readReleaseState } from "./release-state";
import { detectWorkspaceSourceDir, loadBuildGraph } from "./resolver";
import {
  isPluginOwnedSelector,
  selectorForInstruction,
  selectorForPluginCompanion,
  selectorForPluginConfig,
  selectorForPluginFeature,
  selectorForPluginSkill,
  selectorForProjectAgent,
  selectorForRootConfig,
  selectorForStandaloneSkill,
  selectorForTargetNativeIsland,
  sourceUnitSelector,
} from "./source-unit-selector";
import type {
  BuildGraph,
  JsonRecord,
  JsonValue,
  SkillsetOptions,
  SourcePlugin,
  SourcePluginFeature,
  SourceProjectAgent,
  SourceResource,
  SourceRule,
  SourceSkill,
} from "./types";
import { workspaceChangeFile } from "./workspace-state";
import { isJsonRecord, parseMarkdown, parseYamlRecord, stringifyJson, stringifyYaml } from "./yaml";

export const SOURCE_HASH_SCHEMA = "skillset-source-unit-v2";

export type SourceUnitKind =
  | "instruction"
  | "plugin"
  | "plugin-companion"
  | "plugin-config"
  | "plugin-feature"
  | "plugin-skill"
  | "project-agent"
  | "root-config"
  | "standalone-skill"
  | "target-native-island";

export interface SourceUnitRegion {
  readonly name: string;
  readonly severityBearing: boolean;
}

export interface SourceUnit {
  readonly hash: string;
  readonly hashSchema: string;
  readonly id: string;
  readonly kind: SourceUnitKind;
  readonly regions: readonly SourceUnitRegion[];
  readonly sourcePath: string;
  readonly sourcePaths: readonly string[];
}

export interface SourceInventory {
  readonly hashSchema: string;
  readonly units: readonly SourceUnit[];
}

export type SourceUnitChangeStatus = "added" | "changed" | "removed";

export interface SourceUnitChange {
  readonly baselineHash?: string;
  readonly baselineRegions?: readonly SourceUnitRegion[];
  readonly currentHash?: string;
  readonly currentRegions?: readonly SourceUnitRegion[];
  readonly id: string;
  readonly kind: SourceUnitKind;
  readonly sourcePath: string;
  readonly status: SourceUnitChangeStatus;
}

export type ChangeBaseline =
  | {
      readonly kind: "git-ref";
      readonly ref: string;
      readonly resolvedRef?: string;
    }
  | {
      readonly hashSchema: string;
      readonly kind: "source-inventory";
      readonly label: string;
    };

export interface ChangeStatusOptions extends SkillsetOptions {
  readonly since?: string;
  readonly staged?: boolean;
}

export interface ChangeStatusReport {
  readonly baseline: ChangeBaseline;
  readonly generatedDrift: SkillsetDiff;
  readonly hashSchema: string;
  readonly sourceChanges: readonly SourceUnitChange[];
  readonly sourceUnits: readonly SourceUnit[];
}

interface BaselineInventory {
  readonly baseline: ChangeBaseline;
  readonly inventory: SourceInventory;
}

const LEGACY_ROOT_CONFIG_FILE = "config.yaml";
const LEGACY_SOURCE_ROOT_DIR = "src";
const WORKSPACE_SOURCE_DIR = ".skillset";
const ROOT_SOURCE_MANIFEST_FILE = "skillset.yaml";
const LEGACY_BASELINE_SOURCE_MOVES: readonly (readonly [string, string])[] = [
  ["src/instructions", "rules"],
  ["src/rules", "rules"],
  ["src/skills", "skills"],
  ["src/plugins", "plugins"],
  ["src/shared", "shared"],
  ["src/agents", "agents"],
  ["src/hooks", "hooks"],
  ["src/claude", "_claude"],
  ["src/codex", "_codex"],
  ["src/_claude", "_claude"],
  ["src/_codex", "_codex"],
  ["instructions", "rules"],
  ["claude", "_claude"],
  ["codex", "_codex"],
];
const PLUGIN_COMPANION_PATHS = [
  "README.md",
  "commands",
  "agents",
  "hooks",
  ".lsp.json",
  "output-styles",
  "themes",
  "monitors",
  "assets",
  "scripts",
  "src",
  ".app.json",
] as const;
type RelativePathPredicate = (path: string) => boolean;

export async function changeStatus(
  rootPath: string,
  options: ChangeStatusOptions = {}
): Promise<ChangeStatusReport> {
  const stagedSnapshot = options.staged === true ? await snapshotGitIndex(rootPath) : undefined;
  try {
    const currentRoot = stagedSnapshot ?? rootPath;
    const graph = await loadBuildGraph(currentRoot, options);
    const releaseOptions = withDetectedSourceDir(options, graph);
    const baselineOptions = options.sourceDir === undefined ? options : releaseOptions;
    const current = await sourceInventoryForGraph(graph);
    const baseline = await resolveBaselineInventory(rootPath, baselineOptions, releaseOptions);
    const generatedDrift = await diffSkillset(currentRoot, releaseOptions);

    return {
      baseline: baseline.baseline,
      generatedDrift,
      hashSchema: SOURCE_HASH_SCHEMA,
      sourceChanges: compareInventories(current, baseline.inventory),
      sourceUnits: current.units,
    };
  } finally {
    if (stagedSnapshot !== undefined) await rm(stagedSnapshot, { force: true, recursive: true });
  }
}

export async function collectSourceInventory(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<SourceInventory> {
  const graph = await loadBuildGraph(rootPath, options);
  return sourceInventoryForGraph(graph);
}

export async function detectWorkspaceOptions<T extends SkillsetOptions>(
  rootPath: string,
  options: T
): Promise<T> {
  return { ...options, sourceDir: await detectWorkspaceSourceDir(rootPath, options) };
}

function withDetectedSourceDir<T extends SkillsetOptions>(options: T, graph: BuildGraph): T {
  return { ...options, sourceDir: graph.sourceDir };
}

async function sourceInventoryForGraph(graph: BuildGraph): Promise<SourceInventory> {
  const units: SourceUnit[] = [];
  units.push(await rootConfigUnit(graph));

  for (const skill of graph.standaloneSkills) {
    units.push(await skillUnit(graph, skill, "standalone-skill", selectorForStandaloneSkill(skill.id)));
  }

  for (const rule of graph.rules) {
    units.push(await ruleUnit(graph, rule));
  }

  for (const agent of graph.projectAgents) {
    units.push(await projectAgentUnit(graph, agent));
  }

  for (const island of graph.projectIslands) {
    units.push(await islandUnit(graph, island));
  }

  for (const plugin of graph.plugins) {
    units.push(await fileUnit(
      graph,
      "plugin-config",
      selectorForPluginConfig(plugin.id),
      plugin.configPath,
      await regionsForYaml(plugin.configPath)
    ));

    for (const skill of plugin.skills) {
      units.push(await skillUnit(graph, skill, "plugin-skill", selectorForPluginSkill(plugin.id, skill.id), plugin));
    }

    for (const feature of plugin.features) {
      units.push(await pluginFeatureUnit(graph, plugin, feature));
    }

    for (const companion of await pluginCompanionUnits(graph, plugin)) {
      units.push(companion);
    }
  }

  const unitsWithoutAggregates = [...units];
  for (const plugin of graph.plugins) {
    units.push(pluginAggregateUnit(graph, plugin, unitsWithoutAggregates));
  }

  return {
    hashSchema: SOURCE_HASH_SCHEMA,
    units: [...dedupeUnits(units)].sort((left, right) => compareStrings(left.id, right.id)),
  };
}

async function rootConfigUnit(graph: BuildGraph): Promise<SourceUnit> {
  const configPath = graph.rootConfigPath;
  const manifestPath = graph.rootManifestPath;
  const sourcePaths = sortedUnique([relativePath(graph, configPath), relativePath(graph, manifestPath)]);
  const hash = createSourceHash("root-config");
  hash.update("metadata\0");
  hash.update(stringifyJson({ id: "root-config", sourcePaths: [...sourcePaths] }));
  hash.update("\0config\0");
  await hashPathInto(hash, configPath);
  if (manifestPath !== configPath) {
    hash.update("\0manifest\0");
    await hashPathInto(hash, manifestPath);
  }
  const regions =
    manifestPath === configPath
      ? await regionsForYaml(configPath)
      : mergeRegions([
          ...(await regionsForYaml(configPath)),
          ...(await regionsForYaml(manifestPath)),
        ]);
  return {
    hash: digest(hash),
    hashSchema: SOURCE_HASH_SCHEMA,
    id: selectorForRootConfig(),
    kind: "root-config",
    regions,
    sourcePath: sourcePaths[0] ?? "",
    sourcePaths,
  };
}

async function fileUnit(
  graph: BuildGraph,
  kind: SourceUnitKind,
  id: string,
  sourcePath: string,
  regions: readonly SourceUnitRegion[] = [],
  hashId: string = id
): Promise<SourceUnit> {
  const sourcePaths = [relativePath(graph, sourcePath)];
  return {
    hash: await hashPath(kind, sourcePath, { id: hashId, sourcePaths }),
    hashSchema: SOURCE_HASH_SCHEMA,
    id,
    kind,
    regions,
    sourcePath: sourcePaths[0] ?? "",
    sourcePaths,
  };
}

async function skillUnit(
  graph: BuildGraph,
  skill: SourceSkill,
  kind: "plugin-skill" | "standalone-skill",
  id: string,
  plugin?: SourcePlugin
): Promise<SourceUnit> {
  const sourceDir = dirname(skill.sourcePath);
  const preprocessDependencies = await skillPreprocessDependencies(graph, skill, plugin);
  const sourcePaths = await sourcePathsForSkill(graph, sourceDir, skill.resources, preprocessDependencies);
  const hash = createSourceHash(kind);
  hash.update("id\0");
  hash.update(id);
  hash.update("\0");
  await hashDirectory(hash, sourceDir, isGeneratedEntityChangelogPath);
  await hashResources(hash, skill.resources);
  await hashPreprocessDependencies(hash, graph, preprocessDependencies);
  return {
    hash: digest(hash),
    hashSchema: SOURCE_HASH_SCHEMA,
    id,
    kind,
    regions: regionsForRecord(skill.frontmatter),
    sourcePath: relativePath(graph, skill.sourcePath),
    sourcePaths,
  };
}

async function ruleUnit(graph: BuildGraph, rule: SourceRule): Promise<SourceUnit> {
  const preprocessDependencies = await rulePreprocessDependencies(graph, rule);
  const hash = createSourceHash("instruction");
  hash.update("id\0");
  hash.update(rule.id);
  hash.update("\0frontmatter\0");
  hash.update(stringifyJson(rule.frontmatter));
  hash.update("\0body\0");
  hash.update(rule.body);
  hash.update("\0");
  await hashPreprocessDependencies(hash, graph, preprocessDependencies);
  const sourcePath = relativePath(graph, rule.sourcePath);
  return {
    hash: digest(hash),
    hashSchema: SOURCE_HASH_SCHEMA,
    id: selectorForInstruction(rule.id),
    kind: "instruction",
    regions: regionsForRecord(rule.frontmatter),
    sourcePath,
    sourcePaths: sortedUnique([sourcePath, ...preprocessDependencies]),
  };
}

async function projectAgentUnit(graph: BuildGraph, agent: SourceProjectAgent): Promise<SourceUnit> {
  const preprocessDependencies = await projectAgentPreprocessDependencies(graph, agent);
  const hash = createSourceHash("project-agent");
  hash.update("name\0");
  hash.update(agent.name);
  hash.update("\0outputName\0");
  hash.update(agent.outputName);
  hash.update("\0frontmatter\0");
  hash.update(stringifyJson(agent.frontmatter));
  hash.update("\0body\0");
  hash.update(agent.body);
  hash.update("\0");
  await hashPreprocessDependencies(hash, graph, preprocessDependencies);
  const sourcePath = relativePath(graph, agent.sourcePath);
  return {
    hash: digest(hash),
    hashSchema: SOURCE_HASH_SCHEMA,
    id: selectorForProjectAgent(agent.outputName),
    kind: "project-agent",
    regions: regionsForRecord(agent.frontmatter),
    sourcePath,
    sourcePaths: sortedUnique([sourcePath, ...preprocessDependencies]),
  };
}

async function islandUnit(
  graph: BuildGraph,
  island: BuildGraph["projectIslands"][number]
): Promise<SourceUnit> {
  const preprocessDependencies = await islandPreprocessDependencies(graph, island);
  const owner: "project" | `plugin:${string}` = island.plugin === undefined ? "project" : `plugin:${island.plugin}`;
  const id = selectorForTargetNativeIsland(island.target, owner, island.relativePath);
  const hash = createSourceHash("target-native-island");
  hash.update("id\0");
  hash.update(id);
  hash.update("\0target\0");
  hash.update(island.target);
  hash.update("\0plugin\0");
  hash.update(island.plugin ?? "");
  hash.update("\0relativePath\0");
  hash.update(island.relativePath);
  hash.update("\0content\0");
  hash.update(await readFile(island.sourcePath));
  hash.update("\0");
  await hashPreprocessDependencies(hash, graph, preprocessDependencies);
  const sourcePath = relativePath(graph, island.sourcePath);
  return {
    hash: digest(hash),
    hashSchema: SOURCE_HASH_SCHEMA,
    id,
    kind: "target-native-island",
    regions: [{ name: "target-native", severityBearing: true }],
    sourcePath,
    sourcePaths: sortedUnique([sourcePath, ...preprocessDependencies]),
  };
}

async function pluginFeatureUnit(
  graph: BuildGraph,
  plugin: SourcePlugin,
  feature: SourcePluginFeature
): Promise<SourceUnit> {
  const id = selectorForPluginFeature(plugin.id, feature.key);
  const sourcePaths = await sourcePathsForPath(graph, feature.sourcePath);
  const hash = createSourceHash("plugin-feature");
  hash.update("id\0");
  hash.update(id);
  hash.update("\0key\0");
  hash.update(feature.key);
  hash.update("\0origin\0");
  hash.update(feature.origin);
  hash.update("\0sourcePointer\0");
  hash.update(feature.sourcePointer ?? "");
  hash.update("\0targetPath\0");
  hash.update(feature.targetPath);
  hash.update("\0source\0");
  await hashPathInto(hash, feature.sourcePath);
  return {
    hash: digest(hash),
    hashSchema: SOURCE_HASH_SCHEMA,
    id,
    kind: "plugin-feature",
    regions: [{ name: feature.key, severityBearing: true }],
    sourcePath: sourcePaths[0] ?? relativePath(graph, feature.sourcePath),
    sourcePaths,
  };
}

async function pluginCompanionUnits(
  graph: BuildGraph,
  plugin: SourcePlugin
): Promise<readonly SourceUnit[]> {
  const featureSourcePaths = new Set(plugin.features.map((feature) => feature.sourcePath));
  const units: SourceUnit[] = [];
  for (const companionPath of PLUGIN_COMPANION_PATHS) {
    const sourcePath = join(plugin.path, companionPath);
    if (featureSourcePaths.has(sourcePath) || !(await exists(sourcePath))) continue;
    units.push(
      await fileUnit(
        graph,
        "plugin-companion",
        selectorForPluginCompanion(plugin.id, companionPath),
        sourcePath,
        companionRegions(companionPath)
      )
    );
  }
  return units;
}

function pluginAggregateUnit(
  graph: BuildGraph,
  plugin: SourcePlugin,
  units: readonly SourceUnit[]
): SourceUnit {
  const childUnits = units
    .filter((unit) => isPluginOwnedSelector(unit.id, plugin.id))
    .sort((left, right) => compareStrings(left.id, right.id));
  const hash = createSourceHash("plugin");
  hash.update("id\0");
  hash.update(plugin.id);
  hash.update("\0metadata\0");
  hash.update(stringifyJson(plugin.metadata));
  hash.update("\0targets\0");
  hash.update(stringifyJson({ claude: plugin.targets.claude.options, codex: plugin.targets.codex.options }));
  hash.update("\0children\0");
  for (const child of childUnits) {
    hash.update(child.id);
    hash.update("\0");
    hash.update(child.hash);
    hash.update("\0");
  }
  const sourcePaths = sortedUnique([
    relativePath(graph, plugin.configPath),
    ...childUnits.flatMap((unit) => unit.sourcePaths),
  ]);
  return {
    hash: digest(hash),
    hashSchema: SOURCE_HASH_SCHEMA,
    id: `plugin:${plugin.id}`,
    kind: "plugin",
    regions: regionsForRecord(plugin.metadata),
    sourcePath: relativePath(graph, plugin.configPath),
    sourcePaths,
  };
}

async function sourcePathsForSkill(
  graph: BuildGraph,
  sourceDir: string,
  resources: readonly SourceResource[],
  preprocessDependencies: readonly string[]
): Promise<readonly string[]> {
  return sortedUnique([
    ...(await sourcePathsForPath(graph, sourceDir, isGeneratedEntityChangelogPath)),
    ...resources.flatMap((resource) => [
      relativePath(graph, resource.sourcePath),
    ]),
    ...preprocessDependencies,
  ]);
}

async function sourcePathsForPath(
  graph: BuildGraph,
  sourcePath: string,
  shouldSkip?: RelativePathPredicate
): Promise<readonly string[]> {
  const stats = await stat(sourcePath);
  if (stats.isFile()) return [relativePath(graph, sourcePath)];
  return (await collectFiles(sourcePath))
    .filter((file) => !shouldSkip?.(relative(sourcePath, file)))
    .map((file) => relativePath(graph, file))
    .sort(compareStrings);
}

async function hashPath(
  kind: SourceUnitKind,
  sourcePath: string,
  metadata: JsonRecord
): Promise<string> {
  const hash = createSourceHash(kind);
  hash.update("metadata\0");
  hash.update(stringifyJson(metadata));
  hash.update("\0source\0");
  await hashPathInto(hash, sourcePath);
  return digest(hash);
}

async function hashPathInto(hash: ReturnType<typeof createHash>, sourcePath: string): Promise<void> {
  const stats = await stat(sourcePath);
  if (stats.isFile()) {
    hash.update("file\0");
    hash.update(await readFile(sourcePath));
    hash.update("\0");
    return;
  }

  await hashDirectory(hash, sourcePath);
}

async function hashDirectory(
  hash: ReturnType<typeof createHash>,
  sourceDir: string,
  shouldSkip?: RelativePathPredicate
): Promise<void> {
  hash.update("dir\0");
  for (const file of await collectFiles(sourceDir)) {
    const relativeFile = relative(sourceDir, file);
    if (shouldSkip?.(relativeFile)) continue;
    hash.update(relativeFile);
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
}

function isGeneratedEntityChangelogPath(path: string): boolean {
  return path === "CHANGELOG.md";
}

async function hashResources(
  hash: ReturnType<typeof createHash>,
  resources: readonly SourceResource[]
): Promise<void> {
  for (const resource of [...resources].sort((left, right) => compareStrings(left.targetPath, right.targetPath))) {
    hash.update("resource\0");
    hash.update(resource.from);
    hash.update("\0");
    hash.update(resource.targetPath);
    hash.update("\0");
    await hashPathInto(hash, resource.sourcePath);
    hash.update("\0");
  }
}

async function hashPreprocessDependencies(
  hash: ReturnType<typeof createHash>,
  graph: BuildGraph,
  dependencies: readonly string[]
): Promise<void> {
  for (const dependency of [...dependencies].sort(compareStrings)) {
    hash.update("preprocess\0");
    hash.update(dependency);
    hash.update("\0");
    hash.update(readPreprocessDependencySync(graph.rootPath, dependency));
    hash.update("\0");
  }
}

async function skillPreprocessDependencies(
  graph: BuildGraph,
  skill: SourceSkill,
  plugin?: SourcePlugin
): Promise<readonly string[]> {
  const dependencies = new Set<string>();
  const context = {
    frontmatter: skill.frontmatter,
    preprocessDependencies: dependencies,
    rootPath: graph.rootPath,
    sourcePath: skill.sourcePath,
    sourceRoot: graph.sourceRoot,
    ...(plugin === undefined ? {} : { pluginPath: plugin.path }),
  };
  await preprocessText(skill.body, context);

  const sourceOpenAiPath = join(dirname(skill.sourcePath), "agents/openai.yaml");
  if (await exists(sourceOpenAiPath)) {
    await preprocessText(await readFile(sourceOpenAiPath, "utf8"), {
      ...context,
      sourcePath: sourceOpenAiPath,
    });
  }

  return formattedPreprocessDependencies(graph, dependencies);
}

async function rulePreprocessDependencies(
  graph: BuildGraph,
  rule: SourceRule
): Promise<readonly string[]> {
  const dependencies = new Set<string>();
  await preprocessText(rule.body, {
    frontmatter: rule.frontmatter,
    preprocessDependencies: dependencies,
    rootPath: graph.rootPath,
    sourcePath: rule.sourcePath,
    sourceRoot: graph.sourceRoot,
    variables: {
      "skillset.output_dir": ".",
      "skillset.repo_root": ".",
      "skillset.source_rule": relativePath(graph, rule.sourcePath),
    },
  });
  return formattedPreprocessDependencies(graph, dependencies);
}

async function projectAgentPreprocessDependencies(
  graph: BuildGraph,
  agent: SourceProjectAgent
): Promise<readonly string[]> {
  const dependencies = new Set<string>();
  const collect = async (content: string | undefined): Promise<void> => {
    if (content === undefined) return;
    await preprocessText(content, {
      frontmatter: agent.frontmatter,
      preprocessDependencies: dependencies,
      rootPath: graph.rootPath,
      sourcePath: agent.sourcePath,
      sourceRoot: graph.sourceRoot,
    });
  };

  await collect(agent.body);
  await collect(readString(agent.frontmatter, "initialPrompt"));
  await collect(readString(agent.targets.claude.options, "initialPrompt"));
  await collect(readString(agent.targets.codex.options, "initialPrompt"));
  await collect(readString(agent.targets.codex.options, "developer_instructions"));

  return formattedPreprocessDependencies(graph, dependencies);
}

async function islandPreprocessDependencies(
  graph: BuildGraph,
  island: BuildGraph["projectIslands"][number]
): Promise<readonly string[]> {
  if (!isTextIslandFile(island.relativePath)) return [];

  const dependencies = new Set<string>();
  const source = await readFile(island.sourcePath, "utf8");
  if (island.relativePath.endsWith(".md")) {
    const parsed = parseMarkdown(source, island.sourcePath);
    await preprocessText(parsed.body, {
      frontmatter: parsed.frontmatter,
      preprocessDependencies: dependencies,
      rootPath: graph.rootPath,
      sourcePath: island.sourcePath,
      sourceRoot: graph.sourceRoot,
    });
  } else {
    await preprocessText(source, {
      frontmatter: {},
      preprocessDependencies: dependencies,
      rootPath: graph.rootPath,
      sourcePath: island.sourcePath,
      sourceRoot: graph.sourceRoot,
    });
  }

  return formattedPreprocessDependencies(graph, dependencies);
}

function formattedPreprocessDependencies(
  graph: BuildGraph,
  dependencies: ReadonlySet<string>
): readonly string[] {
  return [...dependencies]
    .map((dependency) => formatPreprocessDependency(graph.rootPath, dependency))
    .sort(compareStrings);
}

function isTextIslandFile(path: string): boolean {
  return /\.(json|md|rules|toml|txt|ya?ml)$/.test(path);
}

async function collectFiles(root: string): Promise<readonly string[]> {
  const entries = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root, dot: true, onlyFiles: true }));
  return entries
    .filter((entry) => !entry.split("/").some((part) => part === ".DS_Store"))
    .sort(compareStrings)
    .map((entry) => join(root, entry));
}

function createSourceHash(kind: SourceUnitKind): ReturnType<typeof createHash> {
  const hash = createHash("sha256");
  hash.update(SOURCE_HASH_SCHEMA);
  hash.update("\0");
  hash.update(kind);
  hash.update("\0");
  return hash;
}

function digest(hash: ReturnType<typeof createHash>): string {
  return `sha256:${hash.digest("hex")}`;
}

function dedupeUnits(units: readonly SourceUnit[]): readonly SourceUnit[] {
  const seen = new Map<string, SourceUnit>();
  for (const unit of units) {
    const existing = seen.get(unit.id);
    if (existing !== undefined) {
      throw new Error(
        `skillset: duplicate source unit ${unit.id} from ${existing.sourcePath} and ${unit.sourcePath}`
      );
    }
    seen.set(unit.id, unit);
  }
  return [...seen.values()];
}

function compareInventories(
  current: SourceInventory,
  baseline: SourceInventory
): readonly SourceUnitChange[] {
  const currentById = new Map(current.units.map((unit) => [unit.id, unit]));
  const baselineById = new Map(baseline.units.map((unit) => [unit.id, unit]));
  const changes: SourceUnitChange[] = [];

  for (const unit of current.units) {
    const previous = baselineById.get(unit.id);
    if (previous === undefined) {
      changes.push({
        currentHash: unit.hash,
        currentRegions: unit.regions,
        id: unit.id,
        kind: unit.kind,
        sourcePath: unit.sourcePath,
        status: "added",
      });
      continue;
    }
    if (previous.hash === unit.hash) continue;
    changes.push({
      baselineHash: previous.hash,
      baselineRegions: previous.regions,
      currentHash: unit.hash,
      currentRegions: unit.regions,
      id: unit.id,
      kind: unit.kind,
      sourcePath: unit.sourcePath,
      status: "changed",
    });
  }

  for (const unit of baseline.units) {
    if (currentById.has(unit.id)) continue;
    changes.push({
      baselineHash: unit.hash,
      baselineRegions: unit.regions,
      id: unit.id,
      kind: unit.kind,
      sourcePath: unit.sourcePath,
      status: "removed",
    });
  }

  return changes.sort((left, right) => compareStrings(left.id, right.id));
}

async function resolveBaselineInventory(
  rootPath: string,
  baselineOptions: ChangeStatusOptions,
  releaseOptions: ChangeStatusOptions
): Promise<BaselineInventory> {
  if (baselineOptions.since !== undefined) {
    return inventoryFromGitRef(rootPath, baselineOptions.since, baselineOptions);
  }
  if (baselineOptions.staged === true) {
    return inventoryFromGitRef(rootPath, "HEAD", baselineOptions);
  }

  const fallback = await fallbackBaselineInventory(rootPath, baselineOptions);
  const releaseInventory = await sourceInventoryFromReleaseState(rootPath, releaseOptions, fallback.inventory);
  if (releaseInventory !== undefined) return releaseInventory;
  return fallback;
}

async function fallbackBaselineInventory(
  rootPath: string,
  options: ChangeStatusOptions
): Promise<BaselineInventory> {
  const lockInventory = await sourceInventoryFromLock(rootPath, options);
  if (lockInventory !== undefined) return lockInventory;
  const mergeBase = await defaultMergeBase(rootPath);
  return inventoryFromGitRef(rootPath, mergeBase, options);
}

async function inventoryFromGitRef(
  rootPath: string,
  ref: string,
  options: SkillsetOptions
): Promise<BaselineInventory> {
  const snapshotPath = await snapshotGitRef(rootPath, ref);
  try {
    const inventory = await collectGitSnapshotInventory(snapshotPath, options);
    const resolvedRef = await gitRevParse(rootPath, ref);
    return {
      baseline: { kind: "git-ref", ref, ...(resolvedRef === undefined ? {} : { resolvedRef }) },
      inventory,
    };
  } finally {
    await rm(snapshotPath, { force: true, recursive: true });
  }
}

async function collectGitSnapshotInventory(
  snapshotPath: string,
  options: SkillsetOptions
): Promise<SourceInventory> {
  try {
    await normalizeLegacyBaselineSnapshot(snapshotPath, options);
    await stripRetiredBaselineTests(snapshotPath, options);
    return await collectSourceInventory(snapshotPath, options);
  } catch (error) {
    if (options.sourceDir === undefined || !canRetryBaselineWithDetectedLayout(error)) throw error;
    const autoOptions = withoutSourceDir(options);
    await normalizeLegacyBaselineSnapshot(snapshotPath, autoOptions);
    await stripRetiredBaselineTests(snapshotPath, autoOptions);
    return collectSourceInventory(snapshotPath, autoOptions);
  }
}

function withoutSourceDir<T extends SkillsetOptions>(options: T): T {
  const { sourceDir: _sourceDir, ...rest } = options;
  return rest as T;
}

function canRetryBaselineWithDetectedLayout(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("skillset: no source plugins, skills, rules, project agents, or provider source found");
}

async function normalizeLegacyBaselineSnapshot(
  snapshotPath: string,
  options: SkillsetOptions
): Promise<void> {
  const sourceDir = options.sourceDir ?? WORKSPACE_SOURCE_DIR;
  if (sourceDir !== WORKSPACE_SOURCE_DIR) return;

  await moveLegacyBaselinePath(join(snapshotPath, "skillset"), join(snapshotPath, WORKSPACE_SOURCE_DIR));

  const skillsetPath = join(snapshotPath, sourceDir);
  if (!(await exists(skillsetPath))) return;

  for (const [from, to] of LEGACY_BASELINE_SOURCE_MOVES) {
    await moveLegacyBaselinePath(join(skillsetPath, from), join(skillsetPath, to));
  }
  await moveLegacyBaselinePluginProviderDirs(join(skillsetPath, "plugins"));
  await writeCanonicalBaselineRootConfig(snapshotPath, skillsetPath);
  await removeEmptyDirectory(join(skillsetPath, LEGACY_SOURCE_ROOT_DIR));
}

async function moveLegacyBaselinePluginProviderDirs(pluginsPath: string): Promise<void> {
  if (!(await exists(pluginsPath))) return;
  const entries = await readdir(pluginsPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginPath = join(pluginsPath, entry.name);
    await moveLegacyBaselinePath(join(pluginPath, LEGACY_ROOT_CONFIG_FILE), join(pluginPath, ROOT_SOURCE_MANIFEST_FILE));
    await moveLegacyBaselinePath(join(pluginPath, "claude"), join(pluginPath, "_claude"));
    await moveLegacyBaselinePath(join(pluginPath, "codex"), join(pluginPath, "_codex"));
  }
}

async function writeCanonicalBaselineRootConfig(snapshotPath: string, skillsetPath: string): Promise<void> {
  const rootConfigPath = join(snapshotPath, ROOT_SOURCE_MANIFEST_FILE);
  let canonical = await readYamlRecordIfExists(rootConfigPath) ?? {};
  const legacyConfigPaths = [
    join(skillsetPath, LEGACY_SOURCE_ROOT_DIR, ROOT_SOURCE_MANIFEST_FILE),
    join(skillsetPath, ROOT_SOURCE_MANIFEST_FILE),
    join(skillsetPath, LEGACY_ROOT_CONFIG_FILE),
  ];

  let changed = false;
  for (const legacyConfigPath of legacyConfigPaths) {
    const legacyConfig = await readYamlRecordIfExists(legacyConfigPath);
    if (legacyConfig === undefined) continue;
    canonical = mergeMissingConfigKeys(canonical, legacyConfig);
    await rm(legacyConfigPath, { force: true });
    changed = true;
  }

  if (changed) {
    await writeFile(rootConfigPath, stringifyYaml(canonical), "utf8");
  }
}

async function readYamlRecordIfExists(path: string): Promise<JsonRecord | undefined> {
  if (!(await exists(path))) return undefined;
  return parseYamlRecord(await readFile(path, "utf8"), path);
}

function mergeMissingConfigKeys(canonical: JsonRecord, legacyConfig: JsonRecord): JsonRecord {
  const merged: Record<string, JsonValue> = {};
  for (const key of Object.keys(canonical)) {
    const value = canonical[key];
    if (value !== undefined) merged[key] = value;
  }
  for (const key of Object.keys(legacyConfig)) {
    if (key in merged) continue;
    const value = legacyConfig[key];
    if (value === undefined) continue;
    merged[key] = value;
  }
  return merged;
}

async function stripRetiredBaselineTests(
  snapshotPath: string,
  options: SkillsetOptions
): Promise<void> {
  await stripRetiredTestsKey(join(snapshotPath, ROOT_SOURCE_MANIFEST_FILE));

  const sourceDir = options.sourceDir ?? WORKSPACE_SOURCE_DIR;
  await stripRetiredTestsKey(join(snapshotPath, sourceDir, ROOT_SOURCE_MANIFEST_FILE));
  await stripRetiredTestsKey(join(snapshotPath, sourceDir, LEGACY_SOURCE_ROOT_DIR, ROOT_SOURCE_MANIFEST_FILE));
  await stripRetiredTestsKey(join(snapshotPath, sourceDir, LEGACY_ROOT_CONFIG_FILE));
}

async function removeEmptyDirectory(path: string): Promise<void> {
  if (!(await exists(path))) return;
  const entries = await readdir(path);
  if (entries.length > 0) return;
  await rmdir(path);
}

async function stripRetiredTestsKey(configPath: string): Promise<void> {
  if (!(await exists(configPath))) return;
  const config = parseYamlRecord(await readFile(configPath, "utf8"), configPath);
  if (config.tests === undefined) return;
  const { tests: _tests, ...rest } = config;
  await writeFile(configPath, stringifyYaml(rest), "utf8");
}

async function moveLegacyBaselinePath(from: string, to: string): Promise<void> {
  if (!(await exists(from))) return;
  if (await exists(to)) {
    const [fromStat, toStat] = await Promise.all([stat(from), stat(to)]);
    if (!fromStat.isDirectory() || !toStat.isDirectory()) {
      throw new Error(`skillset: cannot normalize baseline because ${to} already exists`);
    }
    const entries = await readdir(from, { withFileTypes: true });
    for (const entry of entries) {
      await moveLegacyBaselinePath(join(from, entry.name), join(to, entry.name));
    }
    await rmdir(from);
    return;
  }
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
}

async function sourceInventoryFromReleaseState(
  rootPath: string,
  options: SkillsetOptions,
  fallback: SourceInventory
): Promise<BaselineInventory | undefined> {
  const state = await readReleaseState(rootPath, options);
  const releaseScopes = Object.entries(state.scopes).filter(([, scope]) => scope.sourceHash !== undefined || scope.removed === true);
  if (releaseScopes.length === 0) return undefined;

  const current = await collectSourceInventory(rootPath, options);
  const fallbackUnits = new Map(fallback.units.map((unit) => [unit.id, unit]));
  const currentUnits = new Map(current.units.map((unit) => [unit.id, unit]));
  const units = new Map(fallbackUnits);
  for (const [id, scope] of releaseScopes) {
    const selector = sourceUnitSelector(id);
    if (scope.removed === true) {
      units.delete(selector);
      continue;
    }
    const template = currentUnits.get(selector) ?? fallbackUnits.get(selector) ?? inferredReleaseUnit(selector, scope.sourceHash ?? "");
    units.set(selector, {
      ...template,
      hash: scope.sourceHash ?? template.hash,
      hashSchema: SOURCE_HASH_SCHEMA,
    });
  }

  return {
    baseline: { hashSchema: SOURCE_HASH_SCHEMA, kind: "source-inventory", label: releaseStateRelativePath(options) },
    inventory: {
      hashSchema: SOURCE_HASH_SCHEMA,
      units: [...units.values()].sort((left, right) => compareStrings(left.id, right.id)),
    },
  };
}

function releaseStateRelativePath(options: SkillsetOptions): string {
  return workspaceChangeFile(options.sourceDir, "state.json");
}

function inferredReleaseUnit(id: string, hash: string): SourceUnit {
  const kind = kindForSourceUnitId(id);
  return {
    hash,
    hashSchema: SOURCE_HASH_SCHEMA,
    id,
    kind,
    regions: [],
    sourcePath: id,
    sourcePaths: [id],
  };
}

function kindForSourceUnitId(id: string): SourceUnitKind {
  const selector = sourceUnitSelector(id);
  if (selector === "config:root") return "root-config";
  if (selector.startsWith("instruction:")) return "instruction";
  if (selector.startsWith("plugin:")) return "plugin";
  if (selector.startsWith("agent:")) return "project-agent";
  if (selector.startsWith("skill:")) return "standalone-skill";
  if (/^plugin\.[^.]+\.companion:/.test(selector)) return "plugin-companion";
  if (/^plugin\.[^.]+\.config:/.test(selector)) return "plugin-config";
  if (/^plugin\.[^.]+\.feature:/.test(selector)) return "plugin-feature";
  if (/^plugin\.[^.]+\.skill:/.test(selector)) return "plugin-skill";
  if (/^(?:plugin\.[^.]+\.)?(?:claude|codex)\.[^.]+:/.test(selector)) return "target-native-island";
  return "root-config";
}

async function sourceInventoryFromLock(
  rootPath: string,
  _options: SkillsetOptions
): Promise<BaselineInventory | undefined> {
  const lockPath = resolveInside(rootPath, "skillset.lock");
  if (!(await exists(lockPath))) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
  if (!isJsonRecord(parsed) || !isJsonRecord(parsed.sourceInventory)) return undefined;
  const rawInventory = parsed.sourceInventory;
  const hashSchema = readString(rawInventory, "hashSchema");
  const rawUnits = rawInventory.units;
  if (hashSchema === undefined || !Array.isArray(rawUnits)) return undefined;

  const units: SourceUnit[] = [];
  for (const rawUnit of rawUnits) {
    if (!isJsonRecord(rawUnit)) continue;
    const id = readString(rawUnit, "id");
    const kind = readString(rawUnit, "kind");
    const hash = readString(rawUnit, "hash");
    const sourcePath = readString(rawUnit, "sourcePath");
    if (
      id === undefined ||
      hash === undefined ||
      sourcePath === undefined ||
      !isSourceUnitKind(kind)
    ) {
      continue;
    }
    const selector = sourceUnitSelector(id);
    units.push({
      hash,
      hashSchema,
      id: selector,
      kind: kindForSourceUnitId(selector),
      regions: [],
      sourcePath,
      sourcePaths: [sourcePath],
    });
  }
  if (units.length === 0) return undefined;
  return {
    baseline: { hashSchema, kind: "source-inventory", label: "skillset.lock" },
    inventory: { hashSchema, units },
  };
}

async function snapshotGitRef(rootPath: string, ref: string): Promise<string> {
  const tempRoot = await mkdtemp(join(tmpdir(), "skillset-ref-"));
  const tarPath = join(tempRoot, "snapshot.tar");
  await runCommand(["git", "-C", rootPath, "archive", "--format=tar", "--output", tarPath, ref], rootPath);
  await runCommand(["tar", "-xf", tarPath, "-C", tempRoot], rootPath);
  await rm(tarPath, { force: true });
  return tempRoot;
}

export async function snapshotGitIndex(rootPath: string): Promise<string> {
  const tempRoot = await mkdtemp(join(tmpdir(), "skillset-index-"));
  await runCommand(["git", "-C", rootPath, "checkout-index", "--all", `--prefix=${tempRoot}/`], rootPath);
  return tempRoot;
}

async function defaultMergeBase(rootPath: string): Promise<string> {
  for (const candidate of ["origin/main", "main"]) {
    const mergeBase = await runCommand(
      ["git", "-C", rootPath, "merge-base", "HEAD", candidate],
      rootPath,
      { allowFailure: true }
    );
    if (mergeBase !== undefined && mergeBase.trim().length > 0) return mergeBase.trim();
  }
  const head = await gitRevParse(rootPath, "HEAD");
  if (head !== undefined) return head;
  throw new Error("skillset: could not resolve a change status baseline; pass --since <ref>");
}

async function gitRevParse(rootPath: string, ref: string): Promise<string | undefined> {
  const resolved = await runCommand(
    ["git", "-C", rootPath, "rev-parse", "--verify", `${ref}^{commit}`],
    rootPath,
    { allowFailure: true }
  );
  return resolved?.trim();
}

async function runCommand(
  cmd: readonly string[],
  cwd: string,
  options: { readonly allowFailure?: boolean } = {}
): Promise<string | undefined> {
  const proc = Bun.spawn({
    cmd: [...cmd],
    cwd,
    env: gitSafeEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode === 0) return stdout;
  if (options.allowFailure === true) return undefined;
  throw new Error(`skillset: command failed: ${cmd.join(" ")}\n${stderr.trim()}`);
}

async function regionsForYaml(sourcePath: string): Promise<readonly SourceUnitRegion[]> {
  try {
    return regionsForRecord(parseYamlRecord(await readFile(sourcePath, "utf8"), sourcePath));
  } catch {
    return [];
  }
}

function regionsForRecord(record: JsonRecord): readonly SourceUnitRegion[] {
  const regions: SourceUnitRegion[] = [];
  if (record.supports !== undefined) regions.push({ name: "supports", severityBearing: false });
  if (record.dependencies !== undefined) regions.push({ name: "dependencies", severityBearing: true });
  if (record.allowed_tools !== undefined || record.tools !== undefined) {
    regions.push({ name: "tools", severityBearing: true });
  }
  if (record.mcp !== undefined) regions.push({ name: "mcp", severityBearing: true });
  if (record.bin !== undefined) regions.push({ name: "bin", severityBearing: true });
  if (record.hooks !== undefined) regions.push({ name: "hooks", severityBearing: true });
  return regions.sort((left, right) => compareStrings(left.name, right.name));
}

function mergeRegions(regions: readonly SourceUnitRegion[]): readonly SourceUnitRegion[] {
  const byName = new Map<string, SourceUnitRegion>();
  for (const region of regions) {
    const existing = byName.get(region.name);
    byName.set(region.name, {
      name: region.name,
      severityBearing: region.severityBearing || existing?.severityBearing === true,
    });
  }
  return [...byName.values()].sort((left, right) => compareStrings(left.name, right.name));
}

function companionRegions(path: string): readonly SourceUnitRegion[] {
  if (path === "hooks") return [{ name: "hooks", severityBearing: true }];
  if (path === ".app.json") return [{ name: "apps", severityBearing: true }];
  if (path === "commands") return [{ name: "commands", severityBearing: true }];
  if (path === "agents") return [{ name: "agents", severityBearing: true }];
  if (path === "scripts" || path === "src") return [{ name: path, severityBearing: true }];
  return [{ name: "target-native", severityBearing: true }];
}

function isSourceUnitKind(value: string | undefined): value is SourceUnitKind {
  return (
    value === "instruction" ||
    value === "plugin" ||
    value === "plugin-companion" ||
    value === "plugin-config" ||
    value === "plugin-feature" ||
    value === "plugin-skill" ||
    value === "project-agent" ||
    value === "root-config" ||
    value === "standalone-skill" ||
    value === "target-native-island"
  );
}

function relativePath(graph: BuildGraph, path: string): string {
  return relative(graph.rootPath, path).replaceAll("\\", "/");
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareStrings);
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
