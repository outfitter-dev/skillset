import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";

import {
  applyFeatureTargetDefaults,
  readCompileConfig,
  readCompileTargets,
  readOutputConfig,
  readSkillsetMetadata,
  readSkillsetName,
  readString,
  readStringArray,
  resolveFeatureTargets,
  resolveTargets,
  targetNames,
  validateConfigDocument,
} from "./config";
import { readPluginDependencies, validatePluginDependencyGraph } from "./dependencies";
import { compareStrings, resolveInside, validateSlug } from "./path";
import { readReleaseState } from "./release-state";
import { readSkillResources } from "./resources";
import { validateSupports } from "./supports";
import type {
  BuildGraph,
  JsonRecord,
  OutputSelection,
  SkillsetOptions,
  SourcePlugin,
  SourcePluginFeature,
  SourcePluginFeatureKey,
  SourceIslandFile,
  SourceProjectAgent,
  SourceRule,
  SourceSkill,
  StandaloneSkill,
} from "./types";
import { validateSchemaField, validateVersionField } from "./versioning";
import { isJsonRecord, parseMarkdown, parseYamlRecord } from "./yaml";

const DEFAULT_SOURCE_DIR = ".skillset";
const ROOT_CONFIG_FILE = "config.yaml";
const PLUGIN_CONFIG_FILES = ["skillset.yaml", "config.yaml"] as const;
const PLUGINS_DIR = "plugins";
const INSTRUCTIONS_DIR = "instructions";
const INSTRUCTIONS_COMPAT_DIR = "rules";
const SKILLS_DIR = "skills";
const SKILL_FILE = "SKILL.md";
const RULES_OUTPUT_ROOT = ".claude/rules";
const TARGET_NATIVE_SOURCE_DIR = "src";
const PROJECT_AGENTS_DIR = "agents";
const PLUGIN_FEATURE_KEYS: readonly SourcePluginFeatureKey[] = ["bin", "mcp"];

export async function loadBuildGraph(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<BuildGraph> {
  const sourceDir = options.sourceDir ?? DEFAULT_SOURCE_DIR;
  const sourcePath = resolveInside(rootPath, sourceDir);
  const rootConfigPath = join(sourcePath, ROOT_CONFIG_FILE);
  const rootConfig = parseYamlRecord(await readFile(rootConfigPath, "utf8"), rootConfigPath);
  validateConfigDocument(rootConfig, rootConfigPath, { allowCompile: true });
  const metadata = readSkillsetMetadata(rootConfig, rootConfigPath);
  validateSchemaField(metadata, `${rootConfigPath}.skillset.schema`);
  validateVersionField(metadata, `${rootConfigPath}.skillset.version`);
  // Validate root identity aliases (skillset.name / skillset.id) for conflicts.
  readSkillsetName(metadata, basename(rootPath), rootConfigPath);
  const outputs = readOutputConfig(
    rootConfig,
    metadata,
    options.distDir === undefined ? {} : { distDir: options.distDir }
  );
  const rootTargets = resolveTargets(readCompileTargets(rootConfig, rootConfigPath), rootConfig, rootConfigPath, {
    allowDefaults: true,
    objectInheritsEnabled: true,
  });
  const compileConfig = readCompileConfig(rootConfig, rootConfigPath);
  const compile = {
    ...compileConfig,
    build: options.buildMode ?? compileConfig.build,
  };
  const root = {
    compile,
    metadata,
    outputs,
    targets: rootTargets,
  };

  const warnings: string[] = [];
  await validateSupports(rootConfig.supports, { label: rootConfigPath, rootPath, warnings });
  const releaseState = await readReleaseState(rootPath, options);
  const plugins = await loadPlugins(rootPath, sourceDir, rootTargets, warnings, outputs);
  validatePluginDependencyGraph(plugins);
  const standaloneSkills = await loadStandaloneSkills(rootPath, sourceDir, rootTargets, warnings);
  const { rules, instructionsDir } = await loadInstructions(rootPath, sourceDir, rootTargets, warnings);
  const projectAgents = await loadProjectAgents(rootPath, sourceDir, rootTargets, warnings);
  const projectIslands = await loadProjectIslands(rootPath, sourceDir, plugins);

  if (plugins.length === 0 && standaloneSkills.length === 0 && rules.length === 0 && projectAgents.length === 0 && projectIslands.length === 0) {
    throw new Error(`skillset: no source plugins, skills, instructions, project agents, or target-native islands found under ${sourceDir}/`);
  }

  const outputRoots = await outputRootsFor(rootPath, outputs, plugins, standaloneSkills, rules);
  validateOutputRoots(rootPath, sourcePath, outputRoots);
  validateProjectRoots(rootPath, sourcePath, outputRoots, rootTargets, projectAgents, projectIslands);

  return {
    instructionsDir,
    outputRoots: outputRoots.map((outputRoot) => outputRoot.path),
    plugins,
    projectAgents,
    projectIslands,
    releaseState,
    rules,
    root,
    rootPath,
    sourceDir,
    sourcePath,
    standaloneSkills,
    warnings,
  };
}

async function loadProjectIslands(
  rootPath: string,
  sourceDir: string,
  plugins: readonly SourcePlugin[]
): Promise<readonly SourceIslandFile[]> {
  const srcPath = resolveInside(rootPath, join(sourceDir, TARGET_NATIVE_SOURCE_DIR));
  if (!(await exists(srcPath))) return [];

  const islands: SourceIslandFile[] = [];
  islands.push(...(await loadTargetIsland(rootPath, join(srcPath, "claude"), "claude")));
  islands.push(...(await loadTargetIsland(rootPath, join(srcPath, "codex"), "codex")));

  const pluginsPath = join(srcPath, "plugins");
  if (await exists(pluginsPath)) {
    await validatePluginIslandOwners(rootPath, pluginsPath, plugins);
    for (const plugin of plugins) {
      const pluginPath = join(pluginsPath, plugin.id);
      islands.push(...(await loadTargetIsland(rootPath, join(pluginPath, "claude"), "claude", plugin.id)));
      islands.push(...(await loadTargetIsland(rootPath, join(pluginPath, "codex"), "codex", plugin.id)));
    }
  }

  for (const island of islands) {
    if (island.target === "codex" && island.relativePath.endsWith(".rules") && island.plugin !== undefined) {
      throw new Error(
        `skillset: ${relative(rootPath, island.sourcePath)} targets Codex plugin .rules, which are not supported; Codex .rules are project-only command policy`
      );
    }
    if (island.target === "codex" && island.relativePath.endsWith(".rules") && !island.relativePath.startsWith("rules/")) {
      throw new Error(
        `skillset: ${relative(rootPath, island.sourcePath)} targets Codex .rules outside .skillset/src/codex/rules/; Codex .rules are project-only command policy`
      );
    }
  }

  return islands.sort((left, right) =>
    compareStrings(`${left.plugin ?? ""}/${left.target}/${left.relativePath}`, `${right.plugin ?? ""}/${right.target}/${right.relativePath}`)
  );
}

async function validatePluginIslandOwners(
  rootPath: string,
  pluginsPath: string,
  plugins: readonly SourcePlugin[]
): Promise<void> {
  const pluginIds = new Set(plugins.map((plugin) => plugin.id));
  for (const entry of await readdir(pluginsPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (pluginIds.has(entry.name)) continue;
    throw new Error(
      `skillset: ${relative(rootPath, join(pluginsPath, entry.name))} has target-native island source for unknown plugin ${entry.name}`
    );
  }
}

async function loadTargetIsland(
  rootPath: string,
  islandPath: string,
  target: SourceIslandFile["target"],
  plugin?: string
): Promise<readonly SourceIslandFile[]> {
  if (!(await exists(islandPath))) return [];
  const files = await collectFiles(islandPath);
  return files.map((sourcePath) => ({
    relativePath: relative(islandPath, sourcePath),
    sourcePath: resolveInside(rootPath, relative(rootPath, sourcePath)),
    target,
    ...(plugin === undefined ? {} : { plugin }),
  }));
}

async function loadProjectAgents(
  rootPath: string,
  sourceDir: string,
  rootTargets: BuildGraph["root"]["targets"],
  warnings: string[]
): Promise<readonly SourceProjectAgent[]> {
  const agentsPath = resolveInside(rootPath, join(sourceDir, TARGET_NATIVE_SOURCE_DIR, PROJECT_AGENTS_DIR));
  if (!(await exists(agentsPath))) return [];

  const entries = await readdir(agentsPath, { withFileTypes: true });
  const agents: SourceProjectAgent[] = [];
  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const sourcePath = join(agentsPath, entry.name);
    agents.push(await loadProjectAgent(rootPath, sourceDir, agentsPath, sourcePath, rootTargets, warnings));
  }

  validateProjectAgentCollisions(agents);
  return agents;
}

async function loadProjectAgent(
  rootPath: string,
  sourceDir: string,
  agentsPath: string,
  sourcePath: string,
  parentTargets: BuildGraph["root"]["targets"],
  warnings: string[]
): Promise<SourceProjectAgent> {
  const parts = parseMarkdown(await readFile(sourcePath, "utf8"), sourcePath);
  const sourceLabel = relative(rootPath, sourcePath);
  await validateSupports(parts.frontmatter.supports, { label: sourceLabel, rootPath, warnings });
  const name = readString(parts.frontmatter, "name") ?? basename(sourcePath, ".md");
  const outputName = sanitizeProjectAgentName(name, sourcePath);
  const description = readString(parts.frontmatter, "description");
  if (description === undefined) {
    throw new Error(`skillset: ${sourceLabel} project agent requires description`);
  }
  if (parts.body.trim().length === 0) {
    throw new Error(`skillset: ${sourceLabel} project agent requires a Markdown body`);
  }
  const initialPrompt = readString(parts.frontmatter, "initialPrompt");
  if (initialPrompt?.includes("</initial_prompt>")) {
    throw new Error(`skillset: ${sourceLabel} initialPrompt must not contain </initial_prompt>`);
  }
  readStringArray(parts.frontmatter, "skills");
  const targets = resolveFeatureTargets(parentTargets, parts.frontmatter, sourcePath, "agents");
  warnPortableModel(parts.frontmatter, targets, rootPath, sourcePath, warnings);

  return {
    body: parts.body,
    filename: basename(sourcePath),
    frontmatter: parts.frontmatter,
    name,
    outputName,
    relativePath: relative(agentsPath, sourcePath),
    sourcePath: resolveInside(rootPath, relative(rootPath, sourcePath)),
    targets,
  };
}

function sanitizeProjectAgentName(name: string, sourcePath: string): string {
  const outputName = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (outputName.length === 0) {
    throw new Error(`skillset: ${sourcePath} project agent name must contain a letter or number`);
  }
  return validateSlug(outputName, `project agent output name in ${sourcePath}`);
}

function validateProjectAgentCollisions(agents: readonly SourceProjectAgent[]): void {
  const seenOutputPaths = new Map<string, SourceProjectAgent>();
  const seenTargetNames = new Map<string, SourceProjectAgent>();
  for (const agent of agents) {
    for (const target of targetNames()) {
      if (!agent.targets[target].enabled) continue;
      const outputKey = `${target}:${agent.outputName}`;
      const outputExisting = seenOutputPaths.get(outputKey);
      if (outputExisting !== undefined) {
        throw new Error(
          `skillset: project agents ${outputExisting.sourcePath} and ${agent.sourcePath} both generate ${target} agent ${agent.outputName}`
        );
      }
      seenOutputPaths.set(outputKey, agent);

      const targetName = readString(agent.targets[target].options, "name") ?? agent.name;
      const nameKey = `${target}:${targetName}`;
      const nameExisting = seenTargetNames.get(nameKey);
      if (nameExisting !== undefined) {
        throw new Error(
          `skillset: project agents ${nameExisting.sourcePath} and ${agent.sourcePath} both generate ${target} agent named ${targetName}`
        );
      }
      seenTargetNames.set(nameKey, agent);
    }
  }
}

/**
 * Emit non-fatal source warnings collected during load (e.g. deprecated
 * compatibility paths). Local-only stderr notes; never fails the command.
 */
export function emitGraphWarnings(graph: BuildGraph): void {
  for (const warning of graph.warnings) {
    console.warn(`skillset: ${warning}`);
  }
}

/**
 * Load source instructions. Canonical source lives in `.skillset/instructions/`;
 * `.skillset/rules/` remains a compatibility alias for migration and import. When
 * both directories carry content the build fails (ambiguous), and the compat path
 * emits a deprecation warning. Generated output is unchanged: Claude lowers to
 * `.claude/rules/`, Codex lowers to `AGENTS.md`.
 */
async function loadInstructions(
  rootPath: string,
  sourceDir: string,
  rootTargets: BuildGraph["root"]["targets"],
  warnings: string[]
): Promise<{ readonly rules: readonly SourceRule[]; readonly instructionsDir: string }> {
  const canonicalPath = resolveInside(rootPath, join(sourceDir, INSTRUCTIONS_DIR));
  const compatPath = resolveInside(rootPath, join(sourceDir, INSTRUCTIONS_COMPAT_DIR));
  // Measure both directories by markdown content, not directory existence, so an
  // empty instructions/ or rules/ never causes a false ambiguity error.
  const canonicalFiles = (await exists(canonicalPath)) ? await findMarkdownFiles(canonicalPath) : [];
  const compatFiles = (await exists(compatPath)) ? await findMarkdownFiles(compatPath) : [];

  let basePath: string;
  let instructionsDir: string;
  if (canonicalFiles.length > 0) {
    if (compatFiles.length > 0) {
      throw new Error(
        `skillset: ${sourceDir}/${INSTRUCTIONS_DIR} and ${sourceDir}/${INSTRUCTIONS_COMPAT_DIR} both contain instruction files; ` +
          `consolidate into ${sourceDir}/${INSTRUCTIONS_DIR}`
      );
    }
    basePath = canonicalPath;
    instructionsDir = INSTRUCTIONS_DIR;
  } else if (compatFiles.length > 0) {
    basePath = compatPath;
    instructionsDir = INSTRUCTIONS_COMPAT_DIR;
    warnings.push(
      `${sourceDir}/${INSTRUCTIONS_COMPAT_DIR} is a compatibility alias for ${sourceDir}/${INSTRUCTIONS_DIR}; ` +
        `rename it to ${sourceDir}/${INSTRUCTIONS_DIR}. Generated Claude output stays ${RULES_OUTPUT_ROOT} and Codex stays AGENTS.md.`
    );
  } else {
    return { rules: [], instructionsDir: INSTRUCTIONS_DIR };
  }

  const ruleFiles = await findMarkdownFiles(basePath);
  const rules: SourceRule[] = [];

  for (const sourcePath of ruleFiles) {
    const content = await readFile(sourcePath, "utf8");
    const parts = parseMarkdown(content, sourcePath);
    const relativePath = relative(basePath, sourcePath);
    const frontmatter = normalizeRuleFrontmatter(parts.frontmatter, sourcePath);
    await validateSupports(frontmatter.supports, { label: relative(rootPath, sourcePath), rootPath, warnings });
    const targets = resolveFeatureTargets(rootTargets, frontmatter, sourcePath, "instructions");

    rules.push({
      body: parts.body,
      frontmatter,
      id: relativePath.replace(/\.md$/, ""),
      relativePath,
      sourcePath: resolveInside(rootPath, relative(rootPath, sourcePath)),
      targets,
    });
  }

  return {
    rules: rules.sort((left, right) => compareStrings(left.relativePath, right.relativePath)),
    instructionsDir,
  };
}

function normalizeRuleFrontmatter(frontmatter: SourceRule["frontmatter"], label: string): SourceRule["frontmatter"] {
  const codexMode = isJsonRecord(frontmatter.codex)
    ? readString(frontmatter.codex, "mode")
    : undefined;
  if (frontmatter.codex === "symlink" || codexMode === "symlink") {
    throw new Error(
      `skillset: ${label} uses codex: symlink, which is not supported yet; use codex: true or codex: false`
    );
  }
  return frontmatter;
}

async function loadPlugins(
  rootPath: string,
  sourceDir: string,
  rootTargets: BuildGraph["root"]["targets"],
  warnings: string[],
  outputs: BuildGraph["root"]["outputs"]
): Promise<readonly SourcePlugin[]> {
  const pluginsPath = resolveInside(rootPath, join(sourceDir, PLUGINS_DIR));
  if (!(await exists(pluginsPath))) return [];

  const entries = await readdir(pluginsPath, { withFileTypes: true });
  const plugins: SourcePlugin[] = [];

  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    if (!entry.isDirectory()) continue;
    const id = validateSlug(entry.name, "plugin directory");
    plugins.push(await loadPlugin(rootPath, sourceDir, id, rootTargets, warnings, outputs));
  }

  return plugins;
}

async function loadPlugin(
  rootPath: string,
  sourceDir: string,
  id: string,
  parentTargets: BuildGraph["root"]["targets"],
  warnings: string[],
  outputs: BuildGraph["root"]["outputs"]
): Promise<SourcePlugin> {
  const pluginPath = resolveInside(rootPath, join(sourceDir, PLUGINS_DIR, id));
  const configPath = await resolvePluginConfigPath(pluginPath);
  const config = parseYamlRecord(await readFile(configPath, "utf8"), configPath);
  validateConfigDocument(config, configPath, { featureKeys: PLUGIN_FEATURE_KEYS });
  await validateSupports(config.supports, { label: relative(rootPath, configPath), rootPath, warnings });
  const dependencies = readPluginDependencies(config.dependencies, relative(rootPath, configPath));
  const metadata = readSkillsetMetadata(config, configPath);
  validateSchemaField(metadata, `${configPath}.skillset.schema`);
  validateVersionField(metadata, `${configPath}.skillset.version`);
  const configuredId = readSkillsetName(metadata, id, configPath);
  validateSlug(configuredId, `skillset.name in ${configPath}`);
  if (configuredId !== id) {
    throw new Error(
      `skillset: plugin directory ${id} does not match skillset.name ${configuredId}`
    );
  }

  const inheritedTargets = resolveTargets(parentTargets, config, configPath, {
    allowDefaults: true,
  });
  const targets = applyFeatureTargetDefaults(inheritedTargets, "plugins");
  const codexPluginSelection = outputs.targetOutputs.codex.plugins;
  const features = await loadPluginFeatures(
    rootPath,
    pluginPath,
    config,
    configPath,
    targets,
    id,
    codexPluginSelection,
    configuredOutputRoots(outputs)
  );
  const skills = await loadSkills(rootPath, sourceDir, pluginPath, inheritedTargets, warnings);

  // SET-2: Codex's documented plugin hook default is hooks/hooks.json. A root
  // hooks.json is a compatibility source that still builds (emitted to the
  // canonical hooks/hooks.json) but should migrate.
  if (targets.codex.enabled && (await exists(join(pluginPath, "hooks.json")))) {
    warnings.push(
      `plugin ${id} uses a root hooks.json for Codex; Codex's documented default is hooks/hooks.json with a top-level "hooks" object. ` +
        "Move it under hooks/ (create the directory if needed); the build still emits the canonical hooks/hooks.json from the root file for now."
    );
  }
  if (targets.codex.enabled && outputIncludes(codexPluginSelection, id) && (await exists(join(pluginPath, "agents")))) {
    throw new Error(
      `skillset: plugin ${id} has Claude plugin agents, but Codex plugins do not support plugin agents in v1; set codex: false for the plugin or move project agents to ${sourceDir}/src/agents`
    );
  }

  return { configPath, dependencies, features, id, metadata, path: pluginPath, skills, targets };
}

async function loadPluginFeatures(
  rootPath: string,
  pluginPath: string,
  config: JsonRecord,
  configPath: string,
  targets: SourcePlugin["targets"],
  pluginId: string,
  codexPluginSelection: OutputSelection,
  outputRoots: readonly ActiveOutputRoot[]
): Promise<readonly SourcePluginFeature[]> {
  const features: SourcePluginFeature[] = [];
  for (const key of PLUGIN_FEATURE_KEYS) {
    const feature = await loadPluginFeature(
      rootPath,
      pluginPath,
      config,
      configPath,
      targets,
      pluginId,
      codexPluginSelection,
      outputRoots,
      key
    );
    if (feature !== undefined) features.push(feature);
  }
  return features.sort((left, right) => compareStrings(left.key, right.key));
}

async function loadPluginFeature(
  rootPath: string,
  pluginPath: string,
  config: JsonRecord,
  configPath: string,
  targets: SourcePlugin["targets"],
  pluginId: string,
  codexPluginSelection: OutputSelection,
  outputRoots: readonly ActiveOutputRoot[],
  key: SourcePluginFeatureKey
): Promise<SourcePluginFeature | undefined> {
  const raw = config[key];
  if (raw === false) return undefined;

  const targetPath = pluginFeatureTargetPath(key);
  const conventionalSource = join(pluginPath, targetPath);
  const hasConventionalSource = await exists(conventionalSource);
  let sourcePath: string | undefined;
  let sourcePointer: string | undefined;
  let origin: SourcePluginFeature["origin"] = "conventional";

  if (raw === undefined) {
    if (!hasConventionalSource) return undefined;
    sourcePath = conventionalSource;
  } else if (raw === true) {
    if (!hasConventionalSource) {
      throw new Error(`skillset: plugin ${pluginId} feature ${key}: true requires conventional source ${relative(rootPath, conventionalSource)}`);
    }
    sourcePath = conventionalSource;
  } else if (isJsonRecord(raw)) {
    sourcePointer = readString(raw, "source");
    if (sourcePointer === undefined) {
      throw new Error(`skillset: plugin ${pluginId} feature ${key} requires source`);
    }
    sourcePath = await resolveRepoSourcePointer(rootPath, sourcePointer, `${configPath}.${key}.source`, outputRoots);
    origin = "explicit";
  } else {
    throw new Error(`skillset: expected ${configPath}.${key} to be true, false, or an object`);
  }

  if (key === "bin" && targets.codex.enabled && outputIncludes(codexPluginSelection, pluginId)) {
    throw new Error(
      `skillset: plugin ${pluginId} feature bin is Claude-only in v1; set bin: false, set codex: false for the plugin, or remove Codex plugin output selection`
    );
  }
  const stats = await stat(sourcePath);
  if (key === "mcp" && !stats.isFile()) {
    throw new Error(`skillset: plugin ${pluginId} feature mcp source must be a file`);
  }
  if (key === "bin" && !stats.isDirectory()) {
    throw new Error(`skillset: plugin ${pluginId} feature bin source must be a directory`);
  }

  return {
    key,
    origin,
    sourcePath,
    ...(sourcePointer === undefined ? {} : { sourcePointer }),
    targetPath,
  };
}

function pluginFeatureTargetPath(key: SourcePluginFeatureKey): string {
  return key === "mcp" ? ".mcp.json" : "bin";
}

async function resolveRepoSourcePointer(
  rootPath: string,
  sourcePointer: string,
  label: string,
  outputRoots: readonly ActiveOutputRoot[]
): Promise<string> {
  if (!sourcePointer.startsWith("repo:")) {
    throw new Error(`skillset: ${label} must use a repo:<path> source pointer`);
  }
  const sourcePath = resolveInside(rootPath, sourcePointer.slice("repo:".length));
  const outputRoot = outputRoots.find((root) => isInsidePath(sourcePath, resolveInside(rootPath, root.path)));
  if (outputRoot !== undefined) {
    throw new Error(
      `skillset: ${label} points inside generated output root ${outputRoot.label} (${outputRoot.path}); feature sources must live outside generated outputs`
    );
  }
  if (!(await exists(sourcePath))) {
    throw new Error(`skillset: ${label} points to missing path ${sourcePointer}`);
  }
  return sourcePath;
}

async function resolvePluginConfigPath(pluginPath: string): Promise<string> {
  const candidates = [];
  for (const file of PLUGIN_CONFIG_FILES) {
    const candidate = join(pluginPath, file);
    if (await exists(candidate)) candidates.push(candidate);
  }

  if (candidates.length === 0) {
    throw new Error(`skillset: expected plugin config skillset.yaml in ${pluginPath}`);
  }
  if (candidates.length > 1) {
    throw new Error(`skillset: plugin ${pluginPath} has both skillset.yaml and config.yaml`);
  }

  return candidates[0] ?? join(pluginPath, "skillset.yaml");
}

async function loadSkills(
  rootPath: string,
  sourceDir: string,
  pluginPath: string,
  parentTargets: SourcePlugin["targets"],
  warnings: string[]
): Promise<SourceSkill[]> {
  const skillsPath = join(pluginPath, SKILLS_DIR);
  if (!(await exists(skillsPath))) return [];
  return loadSkillsFromDirectory(rootPath, sourceDir, skillsPath, pluginPath, parentTargets, warnings, pluginPath);
}

async function loadSkillsFromDirectory(
  rootPath: string,
  sourceDir: string,
  skillsPath: string,
  relativeBasePath: string,
  parentTargets: SourcePlugin["targets"],
  warnings: string[],
  pluginPath?: string
): Promise<SourceSkill[]> {
  const skillFiles = await findSkillFiles(skillsPath);
  const skills: SourceSkill[] = [];

  for (const sourcePath of skillFiles) {
    const content = await readFile(sourcePath, "utf8");
    const parts = parseMarkdown(content, sourcePath);
    await validateSupports(parts.frontmatter.supports, { label: relative(rootPath, sourcePath), rootPath, warnings });
    const metadata = readSkillsetMetadata(parts.frontmatter, sourcePath);
    validateVersionField(parts.frontmatter, `${sourcePath}.version`);
    validateVersionField(metadata, `${sourcePath}.skillset.version`);
    const id = validateSlug(
      readSkillsetName(
        metadata,
        basename(dirname(sourcePath)),
        sourcePath,
        readString(parts.frontmatter, "name")
      ),
      `skill id in ${sourcePath}`
    );
    const targets = resolveFeatureTargets(parentTargets, parts.frontmatter, sourcePath, "skills");
    warnPortableModel(parts.frontmatter, targets, rootPath, sourcePath, warnings);
    const relativePath = relative(relativeBasePath, sourcePath);
    const resources = await readSkillResources(parts.frontmatter.resources, {
      label: sourcePath,
      ...(pluginPath === undefined ? {} : { pluginSharedPath: join(pluginPath, "shared") }),
      sharedPath: resolveInside(rootPath, join(sourceDir, "shared")),
    });

    skills.push({
      body: parts.body,
      frontmatter: parts.frontmatter,
      id,
      metadata,
      relativePath,
      resources,
      sourcePath: resolveInside(rootPath, relative(rootPath, sourcePath)),
      targets,
    });
  }

  return skills.sort((left, right) => compareStrings(left.relativePath, right.relativePath));
}

async function loadStandaloneSkills(
  rootPath: string,
  sourceDir: string,
  rootTargets: BuildGraph["root"]["targets"],
  warnings: string[]
): Promise<readonly StandaloneSkill[]> {
  const skillsPath = resolveInside(rootPath, join(sourceDir, SKILLS_DIR));
  if (!(await exists(skillsPath))) return [];

  const skills = await loadSkillsFromDirectory(rootPath, sourceDir, skillsPath, skillsPath, rootTargets, warnings);
  return skills;
}

function warnPortableModel(
  frontmatter: SourceSkill["frontmatter"],
  targets: SourceSkill["targets"],
  rootPath: string,
  sourcePath: string,
  warnings: string[]
): void {
  if (frontmatter.model === undefined) return;
  const missingTargets = targetNames().filter(
    (target) => targets[target].enabled && readString(targets[target].options, "model") === undefined
  );
  if (missingTargets.length === 0) return;
  warnings.push(
    `${relative(rootPath, sourcePath)} uses top-level model, which is not portable in Skillset v1; ` +
      `use claude.model, codex.model, or target defaults for ${missingTargets.join(", ")}.`
  );
}

async function findSkillFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findSkillFiles(path)));
      continue;
    }
    if (entry.isFile() && entry.name === SKILL_FILE) {
      files.push(path);
    }
  }

  return files;
}

async function findMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findMarkdownFiles(path)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }

  return files;
}

async function collectFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
      continue;
    }
    if (entry.isFile()) files.push(path);
  }

  return files;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw error;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

interface ActiveOutputRoot {
  readonly label: string;
  readonly path: string;
}

async function outputRootsFor(
  rootPath: string,
  outputs: BuildGraph["root"]["outputs"],
  plugins: readonly SourcePlugin[],
  standaloneSkills: readonly StandaloneSkill[],
  rules: readonly SourceRule[]
): Promise<readonly ActiveOutputRoot[]> {
  const activeRoots = activeOutputRoots(outputs, plugins, standaloneSkills, rules);
  const roots = new Map(activeRoots.map((outputRoot) => [outputRoot.path, outputRoot]));

  for (const outputRoot of configuredOutputRoots(outputs)) {
    if (roots.has(outputRoot.path)) continue;
    if (await exists(join(resolveInside(rootPath, outputRoot.path), ".skillset.lock"))) {
      roots.set(outputRoot.path, outputRoot);
    }
  }

  return [...roots.values()].sort((left, right) => compareStrings(left.path, right.path));
}

function configuredOutputRoots(outputs: BuildGraph["root"]["outputs"]): readonly ActiveOutputRoot[] {
  return [
    { label: "outputs.rules.claude", path: RULES_OUTPUT_ROOT },
    { label: "outputs.plugins.claude", path: outputs.plugins.claude },
    { label: "outputs.plugins.codex", path: outputs.plugins.codex },
    { label: "outputs.skills.claude", path: outputs.skills.claude },
    { label: "outputs.skills.codex", path: outputs.skills.codex },
  ];
}

function activeOutputRoots(
  outputs: BuildGraph["root"]["outputs"],
  plugins: readonly SourcePlugin[],
  standaloneSkills: readonly StandaloneSkill[],
  rules: readonly SourceRule[]
): readonly ActiveOutputRoot[] {
  const roots: ActiveOutputRoot[] = [];
  if (rules.some((rule) => rule.targets.claude.enabled)) {
    roots.push({ label: "outputs.rules.claude", path: RULES_OUTPUT_ROOT });
  }
  if (plugins.some((plugin) => plugin.targets.claude.enabled && outputIncludes(outputs.targetOutputs.claude.plugins, plugin.id))) {
    roots.push({ label: "outputs.plugins.claude", path: outputs.plugins.claude });
  }
  if (plugins.some((plugin) => plugin.targets.codex.enabled && outputIncludes(outputs.targetOutputs.codex.plugins, plugin.id))) {
    roots.push({ label: "outputs.plugins.codex", path: outputs.plugins.codex });
  }
  if (standaloneSkills.some((skill) => skill.targets.claude.enabled && outputIncludes(outputs.targetOutputs.claude.skills, skill.id))) {
    roots.push({ label: "outputs.skills.claude", path: outputs.skills.claude });
  }
  if (standaloneSkills.some((skill) => skill.targets.codex.enabled && outputIncludes(outputs.targetOutputs.codex.skills, skill.id))) {
    roots.push({ label: "outputs.skills.codex", path: outputs.skills.codex });
  }
  return roots.sort((left, right) => compareStrings(left.path, right.path));
}

function outputIncludes(selection: OutputSelection, name: string): boolean {
  if (selection === true) return true;
  if (selection === false) return false;
  return selection.includes(name);
}

function isInsidePath(path: string, root: string): boolean {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.includes(`..${sep}`));
}

function validateProjectRoots(
  rootPath: string,
  sourcePath: string,
  outputRoots: readonly ActiveOutputRoot[],
  rootTargets: BuildGraph["root"]["targets"],
  projectAgents: readonly SourceProjectAgent[],
  projectIslands: readonly SourceIslandFile[]
): void {
  for (const target of targetNames()) {
    const hasProjectAgentOutput = projectAgents.some((agent) => agent.targets[target].enabled);
    const hasProjectIslandOutput = projectIslands.some((island) => island.plugin === undefined && island.target === target);
    if (!hasProjectAgentOutput && !hasProjectIslandOutput) continue;
    const projectRoot = {
      label: `${target}.projectRoot`,
      path: targetProjectRoot(rootTargets, target),
    };
    const absoluteProjectRoot = validateOutputRootNotInsideSource(rootPath, sourcePath, projectRoot);
    const targetProjectAgents = projectAgents.filter((agent) => agent.targets[target].enabled);
    const targetProjectIslands = projectIslands.filter((island) => island.plugin === undefined && island.target === target);
    for (const outputRoot of outputRoots) {
      const absoluteOutputRoot = resolveInside(rootPath, outputRoot.path);
      if (isSameOrInside(absoluteProjectRoot, absoluteOutputRoot)) {
        throw new Error(
          `skillset: ${projectRoot.label} must not overlap active output root ${outputRoot.label} (${outputRoot.path})`
        );
      }
      const overlappingAgent = targetProjectAgents.find((agent) =>
        isSameOrInside(resolveInside(rootPath, projectAgentOutputPath(projectRoot.path, target, agent)), absoluteOutputRoot)
      );
      if (overlappingAgent !== undefined) {
        throw new Error(
          `skillset: ${relative(rootPath, overlappingAgent.sourcePath)} would write inside active output root ${outputRoot.label} (${outputRoot.path})`
        );
      }
      const overlappingIsland = targetProjectIslands.find((island) =>
        isSameOrInside(resolveInside(rootPath, join(projectRoot.path, island.relativePath)), absoluteOutputRoot)
      );
      if (overlappingIsland === undefined) continue;
      throw new Error(
        `skillset: ${relative(rootPath, overlappingIsland.sourcePath)} would write inside active output root ${outputRoot.label} (${outputRoot.path})`
      );
    }
  }
}

function targetProjectRoot(rootTargets: BuildGraph["root"]["targets"], target: "claude" | "codex"): string {
  return readString(rootTargets[target].options, "projectRoot") ?? (target === "claude" ? ".claude" : ".codex");
}

function projectAgentOutputPath(projectRoot: string, target: "claude" | "codex", agent: SourceProjectAgent): string {
  return join(projectRoot, "agents", `${agent.outputName}.${target === "claude" ? "md" : "toml"}`);
}

function validateOutputRoots(
  rootPath: string,
  sourcePath: string,
  outputRoots: readonly ActiveOutputRoot[]
): void {
  const seen = new Map<string, string>();

  for (const outputRoot of outputRoots) {
    const absoluteOutputRoot = validateOutputRootNotInsideSource(rootPath, sourcePath, outputRoot);

    const existing = seen.get(absoluteOutputRoot);
    if (existing !== undefined) {
      throw new Error(
        `skillset: ${outputRoot.label} reuses output root ${outputRoot.path}; already used by ${existing}`
      );
    }
    seen.set(absoluteOutputRoot, outputRoot.label);
  }
}

function validateOutputRootNotInsideSource(
  rootPath: string,
  sourcePath: string,
  outputRoot: ActiveOutputRoot
): string {
  const absoluteOutputRoot = resolveInside(rootPath, outputRoot.path);
  if (isSameOrInside(absoluteOutputRoot, sourcePath)) {
    throw new Error(
      `skillset: ${outputRoot.label} must not point inside source root ${relative(rootPath, sourcePath)}`
    );
  }
  return absoluteOutputRoot;
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const relativePath = relative(parent, candidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !relativePath.includes(`..${sep}`))
  );
}
