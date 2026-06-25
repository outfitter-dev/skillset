import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";

import {
  validateAgentFrontmatter,
  validateAdaptiveHookUnitSource,
  validateInstructionFrontmatter,
  validateSkillFrontmatter,
  type SkillsetSchemaDiagnostic,
} from "@skillset/schema";

import {
  readHookAttachments,
  resolveAdaptiveHookAttachments,
} from "./adaptive-hook-attachments";
import {
  applyFeatureTargetDefaults,
  readCompileConfig,
  readCompileTargets,
  readDistributionConfig,
  readOutputConfig,
  readSkillsetMetadata,
  readSkillsetName,
  readString,
  readStringArray,
  resolveFeatureTargets,
  resolveTargets,
  targetNames,
  validateConfigDocument,
  validateRootSourceManifestDocument,
  validateWorkspaceConfigDocument,
} from "./config";
import { readPluginDependencies, validatePluginDependencyGraph } from "./dependencies";
import {
  classifyAdaptiveHookUnitPath,
  validateAdaptiveHookUnitPaths,
} from "./hook-capabilities";
import { SkillsetFeatureDiagnosticError } from "./operation-result";
import { compareStrings, resolveInside, validateSlug } from "./path";
import { readReleaseState } from "./release-state";
import { readSkillResources } from "./resources";
import { validateSupports } from "./supports";
import type {
  BuildGraph,
  JsonRecord,
  JsonValue,
  OutputSelection,
  SkillsetOptions,
  SourceAdaptiveHook,
  SourceAdaptiveHookScriptReference,
  SourceDialect,
  SourceOrigin,
  SourcePlugin,
  SourcePluginFeature,
  SourcePluginFeatureKey,
  SourceIslandFile,
  SourceProjectAgent,
  SourceRule,
  SourceSkill,
  StandaloneSkill,
  TargetName,
} from "./types";
import { validateSchemaField, validateVersionField } from "./versioning";
import { workspaceChangesDir } from "./workspace-state";
import { isJsonRecord, parseMarkdown, parseYamlRecord } from "./yaml";
import { readSkillsetWorkspaceConfig } from "./xdg";

const DEFAULT_SOURCE_DIR = ".skillset";
const ROOT_CONFIG_FILE = "config.yaml";
const ROOT_SOURCE_MANIFEST_FILE = "skillset.yaml";
const PLUGIN_CONFIG_FILES = ["skillset.yaml"] as const;
const PLUGINS_DIR = "plugins";
const SOURCE_ROOT_DIR = "";
const RULES_DIR = "rules";
const SKILLS_DIR = "skills";
const SHARED_DIR = "shared";
const SKILL_FILE = "SKILL.md";
const RULES_OUTPUT_ROOT = ".claude/rules";
const PROJECT_AGENTS_DIR = "agents";
const PROVIDER_SOURCE_DIRS: Readonly<Record<TargetName, string>> = {
  claude: "_claude",
  codex: "_codex",
};
const PLUGIN_FEATURE_KEYS: readonly SourcePluginFeatureKey[] = ["bin", "mcp"];

interface WorkspaceLayout {
  readonly configPath: string;
  readonly configRelativePath: string;
  readonly mode: "workspace";
  readonly sourceDir: string;
  readonly sourcePath: string;
  readonly sourceRoot: string;
  readonly sourceRootDir: string;
  readonly sourceRootPath: string;
  readonly splitRootManifestPath?: string;
  readonly splitRootManifestRelativePath?: string;
}

export async function loadBuildGraph(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<BuildGraph> {
  const workspace = await resolveWorkspaceLayout(rootPath, options);
  const { sourceDir, sourcePath, sourceRoot, sourceRootDir, sourceRootPath } = workspace;
  const rootConfig = parseYamlRecord(await readFile(workspace.configPath, "utf8"), workspace.configPath);
  const sourceManifest = workspace.splitRootManifestPath === undefined
    ? rootConfig
    : parseYamlRecord(await readFile(workspace.splitRootManifestPath, "utf8"), workspace.splitRootManifestPath);
  if (workspace.splitRootManifestPath === undefined) {
    validateConfigDocument(rootConfig, workspace.configPath, { allowCompile: true });
  } else {
    validateWorkspaceConfigDocument(rootConfig, workspace.configPath);
    validateRootSourceManifestDocument(sourceManifest, workspace.splitRootManifestPath);
  }
  const metadataLabel = workspace.splitRootManifestPath ?? workspace.configPath;
  const metadata = readSkillsetMetadata(sourceManifest, metadataLabel);
  validateSchemaField(metadata, `${metadataLabel}.skillset.schema`);
  validateVersionField(metadata, `${metadataLabel}.skillset.version`);
  // Validate root identity.
  readSkillsetName(metadata, basename(rootPath), metadataLabel);
  const outputMetadata = workspace.splitRootManifestPath === undefined ? metadata : {};
  const outputs = readOutputConfig(
    rootConfig,
    outputMetadata,
    options.distDir === undefined ? {} : { distDir: options.distDir }
  );
  const distributions = readDistributionConfig(rootConfig, workspace.configPath);
  const workspaceConfig = readSkillsetWorkspaceConfig(rootConfig, workspace.configPath);
  const rootTargets = resolveTargets(readCompileTargets(rootConfig, workspace.configPath), rootConfig, workspace.configPath, {
    allowDefaults: true,
    objectInheritsEnabled: true,
  });
  const compileConfig = readCompileConfig(rootConfig, workspace.configPath);
  const filteredTargets = applyTargetFilter(rootTargets, options.targetFilter, workspace.configPath);
  const compile = {
    ...compileConfig,
    build: options.buildMode ?? compileConfig.build,
    targets: options.targetFilter ?? compileConfig.targets,
  };
  const root = {
    compile,
    distributions,
    metadata,
    outputs,
    targets: filteredTargets,
    workspace: workspaceConfig,
  };

  const warnings: string[] = [];
  await rejectLegacySourceLayout(rootPath, sourceDir, sourceRootDir);
  await validateSupports(sourceManifest.supports, { label: metadataLabel, rootPath, warnings });
  const releaseState = await readReleaseState(rootPath, { ...options, sourceDir });
  const rootAdaptiveHooks = await loadAdaptiveHooks(rootPath, sourceRootPath, { kind: "root" });
  const plugins = await loadPlugins(rootPath, sourceDir, sourceRootDir, filteredTargets, warnings, outputs);
  try {
    validatePluginDependencyGraph(plugins);
  } catch (error) {
    throw featureDiagnosticError(error, {
      code: "plugin-dependencies-invalid",
      featureId: "dependencies",
      path: join(sourceRoot, PLUGINS_DIR),
    });
  }
  const standaloneSkills = await loadStandaloneSkills(rootPath, sourceDir, sourceRootDir, filteredTargets, warnings);
  const { rules, instructionsDir } = await loadInstructions(rootPath, sourceDir, sourceRootDir, filteredTargets, warnings);
  const projectAgents = await loadProjectAgents(rootPath, sourceDir, sourceRootDir, filteredTargets, warnings);
  const projectIslands = await loadProjectIslands(rootPath, sourceDir, sourceRootDir, plugins);
  const adaptiveHooks = [
    ...rootAdaptiveHooks,
    ...plugins.flatMap((plugin) => plugin.adaptiveHooks),
    ...plugins.flatMap((plugin) => plugin.skills.flatMap((skill) => skill.adaptiveHooks)),
    ...standaloneSkills.flatMap((skill) => skill.adaptiveHooks),
    ...projectAgents.flatMap((agent) => agent.adaptiveHooks),
  ];
  const hookAttachments = [
    ...plugins.flatMap((plugin) => plugin.skills.flatMap((skill) => skill.hookAttachments)),
    ...standaloneSkills.flatMap((skill) => skill.hookAttachments),
    ...projectAgents.flatMap((agent) => agent.hookAttachments),
  ];
  validateAdaptiveHookAttachments(adaptiveHooks, hookAttachments);

  if (plugins.length === 0 && standaloneSkills.length === 0 && rules.length === 0 && projectAgents.length === 0 && projectIslands.length === 0) {
    throw new Error(`skillset: no source plugins, skills, rules, project agents, or provider source found under ${sourceRoot}/`);
  }

  const outputRoots = await outputRootsFor(rootPath, outputs, plugins, standaloneSkills, rules);
  const protectedRoots = [
    { label: "change state", path: resolveInside(rootPath, workspaceChangesDir(sourceDir)) },
    { label: "source root", path: sourceRootPath },
  ];
  validateOutputRoots(rootPath, protectedRoots, outputRoots);
  validateProjectRoots(rootPath, protectedRoots, outputRoots, filteredTargets, projectAgents, projectIslands);

  return {
    adaptiveHooks,
    hookAttachments,
    instructionsDir,
    outputRoots: outputRoots.map((outputRoot) => outputRoot.path),
    plugins,
    projectAgents,
    projectIslands,
    releaseState,
    rules,
    root,
    rootConfigPath: workspace.configPath,
    rootManifestPath: workspace.splitRootManifestPath ?? workspace.configPath,
    rootPath,
    sourceDir,
    sourcePath,
    sourceRoot,
    sourceRootPath,
    standaloneSkills,
    warnings,
  };
}

export async function detectWorkspaceSourceDir(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<string> {
  return (await resolveWorkspaceLayout(rootPath, options)).sourceDir;
}

async function resolveWorkspaceLayout(
  rootPath: string,
  options: SkillsetOptions
): Promise<WorkspaceLayout> {
  if (options.sourceDir !== undefined) {
    if (options.sourceDir !== DEFAULT_SOURCE_DIR) {
      throw new Error(
        `skillset: --source ${options.sourceDir} uses a retired source layout; Skillset source lives under ${DEFAULT_SOURCE_DIR}/ with root skillset.yaml`
      );
    }
  }

  await rejectRetiredWorkspaceMarkers(rootPath);
  return workspaceLayout(rootPath);
}

function workspaceLayout(rootPath: string, sourceDir = DEFAULT_SOURCE_DIR): WorkspaceLayout {
  return {
    configPath: resolveInside(rootPath, ROOT_SOURCE_MANIFEST_FILE),
    configRelativePath: ROOT_SOURCE_MANIFEST_FILE,
    mode: "workspace",
    sourceDir,
    sourcePath: resolveInside(rootPath, sourceDir),
    sourceRoot: sourceDir,
    sourceRootDir: SOURCE_ROOT_DIR,
    sourceRootPath: resolveInside(rootPath, sourceDir),
  };
}

async function rejectRetiredWorkspaceMarkers(rootPath: string): Promise<void> {
  const retiredMarkers: readonly (readonly [string, string])[] = [
    [join(DEFAULT_SOURCE_DIR, ROOT_SOURCE_MANIFEST_FILE), "move workspace configuration to root skillset.yaml"],
    [join(DEFAULT_SOURCE_DIR, ROOT_CONFIG_FILE), "move workspace configuration to root skillset.yaml"],
    [join(DEFAULT_SOURCE_DIR, "src"), `move authored source from ${DEFAULT_SOURCE_DIR}/src/ to ${DEFAULT_SOURCE_DIR}/`],
    ["skillset", `move dedicated source from skillset/ to ${DEFAULT_SOURCE_DIR}/`],
  ];

  for (const [path, guidance] of retiredMarkers) {
    if (await exists(resolveInside(rootPath, path))) {
      throw new Error(`skillset: ${path} uses a retired source layout; ${guidance}`);
    }
  }
}

function applyTargetFilter(
  targets: BuildGraph["root"]["targets"],
  filter: readonly TargetName[] | undefined,
  label: string
): BuildGraph["root"]["targets"] {
  if (filter === undefined) return targets;
  const enabledTargets = new Set(filter);
  for (const target of enabledTargets) {
    if (!targets[target].enabled) {
      throw new Error(`skillset: test target ${target} is not enabled by ${label} target configuration`);
    }
  }
  return {
    claude: enabledTargets.has("claude") ? targets.claude : { enabled: false, options: {} },
    codex: enabledTargets.has("codex") ? targets.codex : { enabled: false, options: {} },
  };
}

function featureDiagnosticError(
  error: unknown,
  args: {
    readonly code: string;
    readonly featureId: string;
    readonly path?: string;
  }
): SkillsetFeatureDiagnosticError {
  if (error instanceof SkillsetFeatureDiagnosticError) return error;
  return new SkillsetFeatureDiagnosticError({
    code: args.code,
    featureId: args.featureId,
    message: error instanceof Error ? error.message : String(error),
    ...(args.path === undefined ? {} : { path: args.path }),
  });
}

async function rejectLegacySourceLayout(rootPath: string, sourceDir: string, sourceRootDir: string): Promise<void> {
  const moves: readonly (readonly [string, string])[] = [
    ["claude", PROVIDER_SOURCE_DIRS.claude],
    ["codex", PROVIDER_SOURCE_DIRS.codex],
  ];

  for (const [oldPath, newPath] of moves) {
    const absoluteOldPath = resolveInside(rootPath, join(sourceDir, oldPath));
    if (await exists(absoluteOldPath)) {
      throw new Error(
        `skillset: ${join(sourceDir, oldPath)} uses the retired source layout; move it to ${join(sourceDir, newPath)}`
      );
    }
  }

  const pluginsPath = resolveInside(rootPath, join(sourceDir, sourceRootDir, PLUGINS_DIR));
  if (!(await exists(pluginsPath))) return;
  for (const entry of await readdir(pluginsPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pluginConfigPath = join(sourceRootDir, PLUGINS_DIR, entry.name, ROOT_CONFIG_FILE);
    const absolutePluginConfigPath = resolveInside(rootPath, join(sourceDir, pluginConfigPath));
    if (await exists(absolutePluginConfigPath)) {
      throw new Error(
        `skillset: ${join(sourceDir, pluginConfigPath)} uses retired plugin config.yaml; rename it to ${join(sourceDir, sourceRootDir, PLUGINS_DIR, entry.name, ROOT_SOURCE_MANIFEST_FILE)}`
      );
    }
    for (const [oldProviderDir, newProviderDir] of Object.entries(PROVIDER_SOURCE_DIRS)) {
      const oldPath = join(sourceRootDir, PLUGINS_DIR, entry.name, oldProviderDir);
      const absoluteOldPath = resolveInside(rootPath, join(sourceDir, oldPath));
      if (!(await exists(absoluteOldPath))) continue;
      const newPath = join(sourceRootDir, PLUGINS_DIR, entry.name, newProviderDir);
      throw new Error(
        `skillset: ${join(sourceDir, oldPath)} uses the retired provider source layout; move it to ${join(sourceDir, newPath)}`
      );
    }
  }
}

async function loadProjectIslands(
  rootPath: string,
  sourceDir: string,
  sourceRootDir: string,
  plugins: readonly SourcePlugin[]
): Promise<readonly SourceIslandFile[]> {
  const srcPath = resolveInside(rootPath, join(sourceDir, sourceRootDir));
  if (!(await exists(srcPath))) return [];

  const islands: SourceIslandFile[] = [];
  islands.push(...(await loadTargetIsland(rootPath, join(srcPath, PROVIDER_SOURCE_DIRS.claude), "claude")));
  islands.push(...(await loadTargetIsland(rootPath, join(srcPath, PROVIDER_SOURCE_DIRS.codex), "codex")));

  const pluginsPath = join(srcPath, "plugins");
  if (await exists(pluginsPath)) {
    await validatePluginIslandOwners(rootPath, pluginsPath, plugins);
    for (const plugin of plugins) {
      const pluginPath = join(pluginsPath, plugin.id);
      islands.push(...(await loadTargetIsland(rootPath, join(pluginPath, PROVIDER_SOURCE_DIRS.claude), "claude", plugin.id)));
      islands.push(...(await loadTargetIsland(rootPath, join(pluginPath, PROVIDER_SOURCE_DIRS.codex), "codex", plugin.id)));
    }
  }

  for (const island of islands) {
    if (island.target === "codex" && island.relativePath.endsWith(".rules") && island.plugin !== undefined) {
      const path = relative(rootPath, island.sourcePath);
      throw new SkillsetFeatureDiagnosticError({
        code: "target-native-island-unsupported",
        featureId: "target-native-islands",
        message:
          `skillset: ${path} targets Codex plugin .rules, which are not supported; ` +
          "Codex .rules are project-only command policy",
        path,
      });
    }
    if (island.target === "codex" && island.relativePath.endsWith(".rules") && !island.relativePath.startsWith("rules/")) {
      const path = relative(rootPath, island.sourcePath);
      throw new SkillsetFeatureDiagnosticError({
        code: "target-native-island-unsupported",
        featureId: "target-native-islands",
        message:
        `skillset: ${path} targets Codex .rules outside ${join(sourceDir, sourceRootDir, PROVIDER_SOURCE_DIRS.codex, "rules")}/; ` +
          "Codex .rules are project-only command policy",
        path,
      });
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
      `skillset: ${relative(rootPath, join(pluginsPath, entry.name))} has provider source for unknown plugin ${entry.name}`
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
  sourceRootDir: string,
  rootTargets: BuildGraph["root"]["targets"],
  warnings: string[]
): Promise<readonly SourceProjectAgent[]> {
  const agentsPath = resolveInside(rootPath, join(sourceDir, sourceRootDir, PROJECT_AGENTS_DIR));
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
  validateSourceFrontmatter(validateAgentFrontmatter(parts.frontmatter, sourceLabel).diagnostics, sourceLabel, parts.frontmatter);
  rejectUnsupportedPortableFrontmatter(parts.frontmatter, sourceLabel);
  await validateSupports(parts.frontmatter.supports, { label: sourceLabel, rootPath, warnings });
  const name = readString(parts.frontmatter, "name") ?? basename(sourcePath, ".md");
  const outputName = sanitizeProjectAgentName(name, sourcePath);
  const scope = { agentId: outputName, kind: "agent" as const };
  const hookAttachments = readHookAttachments(parts.frontmatter.hooks, scope, sourceLabel);
  const adaptiveHooks = await loadAdaptiveHooks(rootPath, join(agentsPath, basename(sourcePath, ".md")), scope);
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
    adaptiveHooks,
    body: parts.body,
    filename: basename(sourcePath),
    frontmatter: parts.frontmatter,
    hookAttachments,
    name,
    outputName,
    relativePath: relative(agentsPath, sourcePath),
    sourcePath: resolveInside(rootPath, relative(rootPath, sourcePath)),
    targets,
  };
}

function rejectUnsupportedPortableFrontmatter(frontmatter: JsonRecord, label: string): void {
  if (frontmatter.tools !== undefined) {
    throw new Error(`skillset: ${label} uses unsupported tools; use tool_intent`);
  }
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
 * Load source rules. Source lives in `.skillset/rules/`. Generated output
 * is unchanged: Claude renders to `.claude/rules/`, Codex renders to
 * `AGENTS.md`.
 */
async function loadInstructions(
  rootPath: string,
  sourceDir: string,
  sourceRootDir: string,
  rootTargets: BuildGraph["root"]["targets"],
  warnings: string[]
): Promise<{ readonly rules: readonly SourceRule[]; readonly instructionsDir: string }> {
  const canonicalPath = resolveInside(rootPath, join(sourceDir, sourceRootDir, RULES_DIR));
  const canonicalFiles = (await exists(canonicalPath)) ? await findMarkdownFiles(canonicalPath) : [];
  if (canonicalFiles.length === 0) {
    return { rules: [], instructionsDir: join(sourceRootDir, RULES_DIR) };
  }

  const ruleFiles = canonicalFiles;
  const rules: SourceRule[] = [];

  for (const sourcePath of ruleFiles) {
    const content = await readFile(sourcePath, "utf8");
    const parts = parseMarkdown(content, sourcePath);
    const relativePath = relative(canonicalPath, sourcePath);
    const frontmatter = normalizeRuleFrontmatter(parts.frontmatter, sourcePath);
    validateSourceFrontmatter(
      validateInstructionFrontmatter(frontmatter, relative(rootPath, sourcePath)).diagnostics,
      relative(rootPath, sourcePath),
      frontmatter
    );
    await validateSupports(frontmatter.supports, { label: relative(rootPath, sourcePath), rootPath, warnings });
    const metadata = readSkillsetMetadata(frontmatter, sourcePath);
    const sourceOrigin = readSourceOrigin(metadata, sourcePath);
    const targets = resolveFeatureTargets(rootTargets, frontmatter, sourcePath, "instructions");
    const dialect = readDialect(frontmatter, relative(rootPath, sourcePath));

    rules.push({
      body: parts.body,
      ...(dialect === undefined ? {} : { dialect }),
      frontmatter,
      id: relativePath.replace(/\.md$/, ""),
      relativePath,
      ...(sourceOrigin === undefined ? {} : { sourceOrigin }),
      sourcePath: resolveInside(rootPath, relative(rootPath, sourcePath)),
      targets,
    });
  }

  return {
    rules: rules.sort((left, right) => compareStrings(left.relativePath, right.relativePath)),
    instructionsDir: join(sourceRootDir, RULES_DIR),
  };
}

/**
 * Read the source-only `dialect` frontmatter key. Only `claude` is supported;
 * any other value fails the build loudly so a typo never silently skips
 * translation. Absent means portable source (no translation).
 */
function readDialect(frontmatter: JsonRecord, label: string): SourceDialect | undefined {
  const value = frontmatter.dialect;
  if (value === undefined) return undefined;
  if (value === "claude") return "claude";
  throw new Error(
    `skillset: ${label} declares unsupported dialect ${JSON.stringify(value)}; only "claude" is supported`
  );
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

async function loadAdaptiveHooks(
  rootPath: string,
  ownerPath: string,
  scope: SourceAdaptiveHook["scope"]
): Promise<readonly SourceAdaptiveHook[]> {
  const hooksPath = join(ownerPath, "hooks");
  if (!(await exists(hooksPath))) return [];

  const files = await collectFiles(hooksPath);
  const relativeHookPaths = files.map((file) => normalizeWorkspacePath(join("hooks", relative(hooksPath, file))));
  const pathIssues = validateAdaptiveHookUnitPaths(relativeHookPaths);
  if (pathIssues.length > 0) {
    const firstIssue = pathIssues[0];
    throw new SkillsetFeatureDiagnosticError({
      code: firstIssue?.code ?? "adaptive-hook-path-invalid",
      featureId: "adaptive-hooks",
      message: `skillset: ${firstIssue?.message ?? "adaptive hook paths are invalid"}`,
      path: firstIssue?.paths[0] === undefined ? relative(rootPath, hooksPath) : relative(rootPath, join(ownerPath, firstIssue.paths[0])),
    });
  }

  const hooks: SourceAdaptiveHook[] = [];
  for (const file of files) {
    const relativeHookPath = normalizeWorkspacePath(join("hooks", relative(hooksPath, file)));
    const classified = classifyAdaptiveHookUnitPath(relativeHookPath);
    if (classified.kind !== "adaptive-unit") continue;

    const label = relative(rootPath, file);
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(await readFile(file, "utf8")) as JsonValue;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SkillsetFeatureDiagnosticError({
        code: "adaptive-hook-invalid-json",
        featureId: "adaptive-hooks",
        message: `skillset: adaptive hook ${label} is not valid JSON: ${message}`,
        path: label,
      });
    }
    if (!isJsonRecord(parsed)) {
      throw new SkillsetFeatureDiagnosticError({
        code: "adaptive-hook-invalid",
        featureId: "adaptive-hooks",
        message: `skillset: adaptive hook ${label} must contain a JSON object`,
        path: label,
      });
    }
    const diagnostics = validateAdaptiveHookUnitSource(parsed, label).diagnostics;
    if (diagnostics.length > 0) {
      throw new SkillsetFeatureDiagnosticError({
        code: "adaptive-hook-invalid",
        featureId: "adaptive-hooks",
        message: `skillset: adaptive hook ${label} failed schema validation: ${diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`,
        path: label,
      });
    }

    const declaredName = readString(parsed, "name");
    if (declaredName !== undefined && declaredName !== classified.name) {
      throw new SkillsetFeatureDiagnosticError({
        code: "adaptive-hook-name-mismatch",
        featureId: "adaptive-hooks",
        message: `skillset: adaptive hook ${label} declares name ${declaredName}, but its path resolves to ${classified.name}`,
        path: label,
      });
    }
    const events = readStringArray(parsed, "events") ?? [];
    const providers = readTargetArray(parsed.providers);
    hooks.push({
      events,
      frontmatter: parsed,
      name: classified.name,
      ...(providers === undefined ? {} : { providers }),
      scriptReferences: await readAdaptiveHookScriptReferences(rootPath, ownerPath, file, classified.shape, parsed),
      scope,
      sourcePath: resolveInside(rootPath, relative(rootPath, file)),
    });
  }

  return hooks.sort((left, right) => compareStrings(left.name, right.name) || compareStrings(left.sourcePath, right.sourcePath));
}

async function readAdaptiveHookScriptReferences(
  rootPath: string,
  ownerPath: string,
  hookSourcePath: string,
  shape: "directory-hook" | "directory-named" | "flat",
  parsed: JsonRecord
): Promise<readonly SourceAdaptiveHookScriptReference[]> {
  if (!isJsonRecord(parsed.run) || typeof parsed.run.script !== "string") return [];
  const reference = parsed.run.script;
  const sourcePath = resolveAdaptiveHookScriptPath(rootPath, ownerPath, hookSourcePath, shape, reference);
  await validateAdaptiveHookScriptSource(rootPath, sourcePath, hookSourcePath, reference);
  return [{
    kind: reference.startsWith("{{scripts.dir}}/") ? "scripts-dir" : "hook-local",
    reference,
    runtimePath: reference,
    sourcePath: resolveInside(rootPath, relative(rootPath, sourcePath)),
  }];
}

function resolveAdaptiveHookScriptPath(
  rootPath: string,
  ownerPath: string,
  hookSourcePath: string,
  shape: "directory-hook" | "directory-named" | "flat",
  reference: string
): string {
  if (reference.startsWith("{{scripts.dir}}/")) {
    const relativeScriptPath = reference.slice("{{scripts.dir}}/".length);
    return resolveInside(ownerPath, join("scripts", relativeScriptPath));
  }
  if (reference.startsWith("./")) {
    if (shape === "flat") {
      throw new SkillsetFeatureDiagnosticError({
        code: "adaptive-hook-script-flat",
        featureId: "adaptive-hooks",
        message: "skillset: adaptive hook run.script uses ./, but hook-local scripts require a directory hook unit",
        path: relative(rootPath, hookSourcePath),
      });
    }
    return resolveInside(dirname(hookSourcePath), reference);
  }
  return resolveInside(ownerPath, reference);
}

async function validateAdaptiveHookScriptSource(
  rootPath: string,
  sourcePath: string,
  hookSourcePath: string,
  reference: string
): Promise<void> {
  let sourceStat;
  try {
    sourceStat = await stat(sourcePath);
  } catch {
    throw new SkillsetFeatureDiagnosticError({
      code: "adaptive-hook-script-missing",
      featureId: "adaptive-hooks",
      message: `skillset: adaptive hook run.script ${reference} does not resolve to an existing source file`,
      path: relative(rootPath, hookSourcePath),
    });
  }
  if (!sourceStat.isFile()) {
    throw new SkillsetFeatureDiagnosticError({
      code: "adaptive-hook-script-invalid",
      featureId: "adaptive-hooks",
      message: `skillset: adaptive hook run.script ${reference} must resolve to a file`,
      path: relative(rootPath, sourcePath),
    });
  }
}

function validateAdaptiveHookAttachments(
  hooks: readonly SourceAdaptiveHook[],
  attachments: BuildGraph["hookAttachments"]
): void {
  const resolution = resolveAdaptiveHookAttachments(hooks, attachments);
  const issue = resolution.issues[0];
  if (issue === undefined) return;
  throw new SkillsetFeatureDiagnosticError({
    code: issue.code,
    featureId: "adaptive-hooks",
    message: `skillset: ${issue.message}`,
    ...(issue.paths[0] === undefined ? {} : { path: issue.paths[0] }),
  });
}

function readTargetArray(value: JsonValue | undefined): readonly TargetName[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const targets = value.filter((item): item is TargetName => item === "claude" || item === "codex");
  return targets.length === 0 ? undefined : targets;
}

async function loadPlugins(
  rootPath: string,
  sourceDir: string,
  sourceRootDir: string,
  rootTargets: BuildGraph["root"]["targets"],
  warnings: string[],
  outputs: BuildGraph["root"]["outputs"]
): Promise<readonly SourcePlugin[]> {
  const pluginsPath = resolveInside(rootPath, join(sourceDir, sourceRootDir, PLUGINS_DIR));
  if (!(await exists(pluginsPath))) return [];

  const entries = await readdir(pluginsPath, { withFileTypes: true });
  const plugins: SourcePlugin[] = [];

  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    if (!entry.isDirectory()) continue;
    const id = validateSlug(entry.name, "plugin directory");
    plugins.push(await loadPlugin(rootPath, sourceDir, sourceRootDir, id, rootTargets, warnings, outputs));
  }

  return plugins;
}

async function loadPlugin(
  rootPath: string,
  sourceDir: string,
  sourceRootDir: string,
  id: string,
  parentTargets: BuildGraph["root"]["targets"],
  warnings: string[],
  outputs: BuildGraph["root"]["outputs"]
): Promise<SourcePlugin> {
  const pluginPath = resolveInside(rootPath, join(sourceDir, sourceRootDir, PLUGINS_DIR, id));
  const configPath = await resolvePluginConfigPath(pluginPath);
  const configRelativePath = relative(rootPath, configPath);
  const config = parseYamlRecord(await readFile(configPath, "utf8"), configPath);
  let dependencies: SourcePlugin["dependencies"];
  let metadata: SourcePlugin["metadata"];
  let sourceOrigin: SourceOrigin | undefined;
  let configuredId: string;
  let inheritedTargets: BuildGraph["root"]["targets"];
  let targets: SourcePlugin["targets"];
  try {
    validateConfigDocument(config, configPath, { featureKeys: PLUGIN_FEATURE_KEYS });
    await validateSupports(config.supports, { label: configRelativePath, rootPath, warnings });
    dependencies = readPluginDependencies(config.dependencies, configRelativePath);
    metadata = readSkillsetMetadata(config, configPath);
    validateSchemaField(metadata, `${configPath}.skillset.schema`);
    validateVersionField(metadata, `${configPath}.skillset.version`);
    sourceOrigin = readSourceOrigin(metadata, configPath);
    configuredId = readSkillsetName(metadata, id, configPath);
    validateSlug(configuredId, `skillset.name in ${configPath}`);
    if (configuredId !== id) {
      throw new Error(
        `skillset: plugin directory ${id} does not match skillset.name ${configuredId}`
      );
    }
    inheritedTargets = resolveTargets(parentTargets, config, configPath, {
      allowDefaults: true,
    });
    targets = applyFeatureTargetDefaults(inheritedTargets, "plugins");
  } catch (error) {
    throw featureDiagnosticError(error, {
      code: "plugin-manifest-invalid",
      featureId: "plugin-manifests",
      path: configRelativePath,
    });
  }
  const features = await loadPluginFeatures(
    rootPath,
    pluginPath,
    config,
    configPath,
    targets,
    id,
    configuredOutputRoots(outputs)
  );
  const adaptiveHooks = await loadAdaptiveHooks(rootPath, pluginPath, { kind: "plugin", pluginId: id });
  const skills = await loadSkills(rootPath, sourceDir, sourceRootDir, pluginPath, inheritedTargets, warnings, id);

  if (await exists(join(pluginPath, "hooks.json"))) {
    const path = relative(rootPath, join(pluginPath, "hooks.json"));
    throw new SkillsetFeatureDiagnosticError({
      code: "plugin-root-hooks-unsupported",
      featureId: "plugin-hooks",
      message: `skillset: plugin ${id} uses unsupported root hooks.json; move it to hooks/hooks.json`,
      path,
    });
  }
  return {
    configPath,
    adaptiveHooks,
    dependencies,
    features,
    id,
    metadata,
    path: pluginPath,
    skills,
    ...(sourceOrigin === undefined ? {} : { sourceOrigin }),
    targets,
  };
}

async function loadPluginFeatures(
  rootPath: string,
  pluginPath: string,
  config: JsonRecord,
  configPath: string,
  targets: SourcePlugin["targets"],
  pluginId: string,
  outputRoots: readonly ActiveOutputRoot[]
): Promise<readonly SourcePluginFeature[]> {
  const features: SourcePluginFeature[] = [];
  for (const key of PLUGIN_FEATURE_KEYS) {
    let feature: SourcePluginFeature | undefined;
    try {
      feature = await loadPluginFeature(
        rootPath,
        pluginPath,
        config,
        configPath,
        targets,
        pluginId,
        outputRoots,
        key
      );
    } catch (error) {
      throw featureDiagnosticError(error, {
        code: `plugin-${key}-invalid`,
        featureId: key === "mcp" ? "plugin-mcp" : "plugin-bin",
        path: relative(rootPath, configPath),
      });
    }
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
  sourceRootDir: string,
  pluginPath: string,
  parentTargets: SourcePlugin["targets"],
  warnings: string[],
  pluginId: string
): Promise<SourceSkill[]> {
  const skillsPath = join(pluginPath, SKILLS_DIR);
  if (!(await exists(skillsPath))) return [];
  return loadSkillsFromDirectory(rootPath, sourceDir, sourceRootDir, skillsPath, pluginPath, parentTargets, warnings, { kind: "plugin", pluginId }, pluginPath);
}

async function loadSkillsFromDirectory(
  rootPath: string,
  sourceDir: string,
  sourceRootDir: string,
  skillsPath: string,
  relativeBasePath: string,
  parentTargets: SourcePlugin["targets"],
  warnings: string[],
  parentScope: SourceAdaptiveHook["scope"],
  pluginPath?: string
): Promise<SourceSkill[]> {
  const skillFiles = await findSkillFiles(skillsPath);
  const skills: SourceSkill[] = [];

  for (const sourcePath of skillFiles) {
    const content = await readFile(sourcePath, "utf8");
    const parts = parseMarkdown(content, sourcePath);
    validateSourceFrontmatter(validateSkillFrontmatter(parts.frontmatter, sourcePath).diagnostics, sourcePath, parts.frontmatter);
    await validateSupports(parts.frontmatter.supports, { label: relative(rootPath, sourcePath), rootPath, warnings });
    const metadata = readSkillsetMetadata(parts.frontmatter, sourcePath);
    validateVersionField(parts.frontmatter, `${sourcePath}.version`);
    if (metadata.name !== undefined) {
      throw new Error(`skillset: ${sourcePath} uses unsupported skillset.name; use top-level name`);
    }
    if (metadata.id !== undefined) {
      throw new Error(`skillset: ${sourcePath} uses unsupported skillset.id; use top-level name`);
    }
    if (metadata.version !== undefined) {
      throw new Error(`skillset: ${sourcePath} uses unsupported skillset.version; use top-level version`);
    }
    const sourceOrigin = readSourceOrigin(metadata, sourcePath);
    const id = validateSlug(
      readString(parts.frontmatter, "name") ?? basename(dirname(sourcePath)),
      `skill id in ${sourcePath}`
    );
    const scope = {
      ...parentScope,
      kind: "skill" as const,
      skillId: id,
    };
    const hookAttachments = readHookAttachments(parts.frontmatter.hooks, scope, relative(rootPath, sourcePath));
    const adaptiveHooks = await loadAdaptiveHooks(rootPath, dirname(sourcePath), scope);
    const targets = resolveFeatureTargets(parentTargets, parts.frontmatter, sourcePath, "skills");
    warnPortableModel(parts.frontmatter, targets, rootPath, sourcePath, warnings);
    const relativePath = relative(relativeBasePath, sourcePath);
    const resources = await readSkillResources(parts.frontmatter.resources, {
      label: sourcePath,
      ...(pluginPath === undefined ? {} : { pluginSharedPath: join(pluginPath, "shared") }),
      sharedPath: resolveInside(rootPath, join(sourceDir, sourceRootDir, SHARED_DIR)),
    });

    const dialect = readDialect(parts.frontmatter, relative(rootPath, sourcePath));

    skills.push({
      adaptiveHooks,
      body: parts.body,
      ...(dialect === undefined ? {} : { dialect }),
      frontmatter: parts.frontmatter,
      hookAttachments,
      id,
      metadata,
      relativePath,
      resources,
      ...(sourceOrigin === undefined ? {} : { sourceOrigin }),
      sourcePath: resolveInside(rootPath, relative(rootPath, sourcePath)),
      targets,
    });
  }

  return skills.sort((left, right) => compareStrings(left.relativePath, right.relativePath));
}

function validateSourceFrontmatter(
  diagnostics: readonly SkillsetSchemaDiagnostic[],
  label: string,
  frontmatter: JsonRecord
): void {
  if (diagnostics.length === 0) return;
  const message = diagnostics.map((diagnostic) => sourceFrontmatterSchemaMessage(diagnostic, frontmatter)).join("; ");
  throw new Error(`skillset: ${label} frontmatter failed schema validation: ${message}`);
}

function sourceFrontmatterSchemaMessage(diagnostic: SkillsetSchemaDiagnostic, frontmatter: JsonRecord): string {
  if (diagnostic.code.endsWith("/key") && diagnostic.path.endsWith(".targets")) {
    return "uses unsupported targets key; use compile.targets";
  }
  if (diagnostic.code.endsWith("/key") && diagnostic.path.endsWith(".tools")) {
    return "uses unsupported tools; use tool_intent";
  }
  if (diagnostic.code === "schema/skill-frontmatter/allowed-tools") {
    return diagnostic.message.replaceAll("$.", "").replace(
      "must be false, a string, a string array, or a target map",
      "to be false, a string, a string array, or target map"
    );
  }
  if (diagnostic.code === "schema/skill-frontmatter/allowed-tools-key") {
    return "target map to contain only claude and codex keys";
  }
  if (diagnostic.code === "schema/skill-frontmatter/implicit-invocation-key") {
    return "target map to contain only claude and codex keys";
  }
  if (diagnostic.code === "schema/skill-frontmatter/version") {
    return `expected ${diagnostic.path} to be a semantic version`;
  }
  if (diagnostic.code.endsWith("/dialect")) {
    const dialect = readString(frontmatter, "dialect");
    if (dialect !== undefined) return `declares unsupported dialect "${dialect}"; only "claude" is supported`;
  }
  if (diagnostic.code === "schema/source-metadata/key" && diagnostic.path.endsWith(".skillset.id")) {
    return "uses unsupported skillset.id; use top-level name";
  }
  return diagnostic.message.replaceAll("$.", "");
}

async function loadStandaloneSkills(
  rootPath: string,
  sourceDir: string,
  sourceRootDir: string,
  rootTargets: BuildGraph["root"]["targets"],
  warnings: string[]
): Promise<readonly StandaloneSkill[]> {
  const skillsPath = resolveInside(rootPath, join(sourceDir, sourceRootDir, SKILLS_DIR));
  if (!(await exists(skillsPath))) return [];

  const skills = await loadSkillsFromDirectory(rootPath, sourceDir, sourceRootDir, skillsPath, skillsPath, rootTargets, warnings, { kind: "root" });
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

function readSourceOrigin(metadata: JsonRecord, label: string): SourceOrigin | undefined {
  const raw = metadata.origin;
  if (raw === undefined) return undefined;
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label}.skillset.origin to be an object`);
  }
  const path = readString(raw, "path");
  if (path === undefined) {
    throw new Error(`skillset: expected ${label}.skillset.origin.path`);
  }
  const repo = readString(raw, "repo");
  const ref = readString(raw, "ref");
  if ((repo === undefined) !== (ref === undefined)) {
    throw new Error(`skillset: ${label}.skillset.origin must set repo and ref together`);
  }
  return {
    path,
    ...(ref === undefined ? {} : { ref }),
    ...(repo === undefined ? {} : { repo }),
  };
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
    if (await exists(join(resolveInside(rootPath, outputRoot.path), "skillset.lock"))) {
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

function normalizeWorkspacePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isInsidePath(path: string, root: string): boolean {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.includes(`..${sep}`));
}

function validateProjectRoots(
  rootPath: string,
  protectedRoots: readonly ProtectedRoot[],
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
    const absoluteProjectRoot = validateOutputRootNotInsideProtectedRoots(rootPath, protectedRoots, projectRoot);
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
  protectedRoots: readonly ProtectedRoot[],
  outputRoots: readonly ActiveOutputRoot[]
): void {
  const seen = new Map<string, string>();

  for (const outputRoot of outputRoots) {
    const absoluteOutputRoot = validateOutputRootNotInsideProtectedRoots(rootPath, protectedRoots, outputRoot);

    const existing = seen.get(absoluteOutputRoot);
    if (existing !== undefined) {
      throw new Error(
        `skillset: ${outputRoot.label} reuses output root ${outputRoot.path}; already used by ${existing}`
      );
    }
    seen.set(absoluteOutputRoot, outputRoot.label);
  }
}

interface ProtectedRoot {
  readonly label: string;
  readonly path: string;
}

function validateOutputRootNotInsideProtectedRoots(
  rootPath: string,
  protectedRoots: readonly ProtectedRoot[],
  outputRoot: ActiveOutputRoot
): string {
  const absoluteOutputRoot = resolveInside(rootPath, outputRoot.path);
  for (const protectedRoot of protectedRoots) {
    if (isSameOrInside(absoluteOutputRoot, protectedRoot.path)) {
      throw new Error(
        `skillset: ${outputRoot.label} must not point inside ${protectedRoot.label} ${relative(rootPath, protectedRoot.path)}`
      );
    }
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
