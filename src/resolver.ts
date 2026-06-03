import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";

import {
  defaultTargets,
  readOutputConfig,
  readSkillsetMetadata,
  readSkillsetName,
  readString,
  resolveTargets,
  validateConfigDocument,
} from "./config";
import { compareStrings, resolveInside, validateSlug } from "./path";
import { readSkillResources } from "./resources";
import type {
  BuildGraph,
  OutputSelection,
  SkillsetOptions,
  SourcePlugin,
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
const RULES_DIR = "rules";
const SKILLS_DIR = "skills";
const SKILL_FILE = "SKILL.md";
const RULES_OUTPUT_ROOT = ".claude/rules";

export async function loadBuildGraph(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<BuildGraph> {
  const sourceDir = options.sourceDir ?? DEFAULT_SOURCE_DIR;
  const sourcePath = resolveInside(rootPath, sourceDir);
  const rootConfigPath = join(sourcePath, ROOT_CONFIG_FILE);
  const rootConfig = parseYamlRecord(await readFile(rootConfigPath, "utf8"), rootConfigPath);
  validateConfigDocument(rootConfig, rootConfigPath);
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
  const rootTargets = resolveTargets(defaultTargets(), rootConfig, rootConfigPath);
  const root = {
    metadata,
    outputs,
    targets: rootTargets,
  };

  const plugins = await loadPlugins(rootPath, sourceDir, rootTargets);
  const standaloneSkills = await loadStandaloneSkills(rootPath, sourceDir, rootTargets);
  const rules = await loadRules(rootPath, sourceDir, rootTargets);

  if (plugins.length === 0 && standaloneSkills.length === 0 && rules.length === 0) {
    throw new Error(`skillset: no source plugins, skills, or rules found under ${sourceDir}/`);
  }

  const outputRoots = await outputRootsFor(rootPath, outputs, plugins, standaloneSkills, rules);
  validateOutputRoots(rootPath, sourcePath, outputRoots);

  return {
    outputRoots: outputRoots.map((outputRoot) => outputRoot.path),
    plugins,
    rules,
    root,
    rootPath,
    sourceDir,
    sourcePath,
    standaloneSkills,
  };
}

async function loadRules(
  rootPath: string,
  sourceDir: string,
  rootTargets: BuildGraph["root"]["targets"]
): Promise<readonly SourceRule[]> {
  const rulesPath = resolveInside(rootPath, join(sourceDir, RULES_DIR));
  if (!(await exists(rulesPath))) return [];

  const ruleFiles = await findMarkdownFiles(rulesPath);
  const rules: SourceRule[] = [];

  for (const sourcePath of ruleFiles) {
    const content = await readFile(sourcePath, "utf8");
    const parts = parseMarkdown(content, sourcePath);
    const relativePath = relative(rulesPath, sourcePath);
    const frontmatter = normalizeRuleFrontmatter(parts.frontmatter, sourcePath);
    const targets = resolveTargets(rootTargets, frontmatter, sourcePath);

    rules.push({
      body: parts.body,
      frontmatter,
      id: relativePath.replace(/\.md$/, ""),
      relativePath,
      sourcePath: resolveInside(rootPath, relative(rootPath, sourcePath)),
      targets,
    });
  }

  return rules.sort((left, right) => compareStrings(left.relativePath, right.relativePath));
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
  rootTargets: BuildGraph["root"]["targets"]
): Promise<readonly SourcePlugin[]> {
  const pluginsPath = resolveInside(rootPath, join(sourceDir, PLUGINS_DIR));
  if (!(await exists(pluginsPath))) return [];

  const entries = await readdir(pluginsPath, { withFileTypes: true });
  const plugins: SourcePlugin[] = [];

  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    if (!entry.isDirectory()) continue;
    const id = validateSlug(entry.name, "plugin directory");
    plugins.push(await loadPlugin(rootPath, sourceDir, id, rootTargets));
  }

  return plugins;
}

async function loadPlugin(
  rootPath: string,
  sourceDir: string,
  id: string,
  parentTargets: BuildGraph["root"]["targets"]
): Promise<SourcePlugin> {
  const pluginPath = resolveInside(rootPath, join(sourceDir, PLUGINS_DIR, id));
  const configPath = await resolvePluginConfigPath(pluginPath);
  const config = parseYamlRecord(await readFile(configPath, "utf8"), configPath);
  validateConfigDocument(config, configPath);
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

  const targets = resolveTargets(parentTargets, config, configPath);
  const skills = await loadSkills(rootPath, sourceDir, pluginPath, targets);

  return { id, metadata, path: pluginPath, skills, targets };
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
  parentTargets: SourcePlugin["targets"]
): Promise<SourceSkill[]> {
  const skillsPath = join(pluginPath, SKILLS_DIR);
  if (!(await exists(skillsPath))) return [];
  return loadSkillsFromDirectory(rootPath, sourceDir, skillsPath, pluginPath, parentTargets, pluginPath);
}

async function loadSkillsFromDirectory(
  rootPath: string,
  sourceDir: string,
  skillsPath: string,
  relativeBasePath: string,
  parentTargets: SourcePlugin["targets"],
  pluginPath?: string
): Promise<SourceSkill[]> {
  const skillFiles = await findSkillFiles(skillsPath);
  const skills: SourceSkill[] = [];

  for (const sourcePath of skillFiles) {
    const content = await readFile(sourcePath, "utf8");
    const parts = parseMarkdown(content, sourcePath);
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
    const targets = resolveTargets(parentTargets, parts.frontmatter, sourcePath);
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
  rootTargets: BuildGraph["root"]["targets"]
): Promise<readonly StandaloneSkill[]> {
  const skillsPath = resolveInside(rootPath, join(sourceDir, SKILLS_DIR));
  if (!(await exists(skillsPath))) return [];

  const skills = await loadSkillsFromDirectory(rootPath, sourceDir, skillsPath, skillsPath, rootTargets);
  return skills;
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

function validateOutputRoots(
  rootPath: string,
  sourcePath: string,
  outputRoots: readonly ActiveOutputRoot[]
): void {
  const seen = new Map<string, string>();

  for (const outputRoot of outputRoots) {
    const absoluteOutputRoot = resolveInside(rootPath, outputRoot.path);
    if (isSameOrInside(absoluteOutputRoot, sourcePath)) {
      throw new Error(
        `skillset: ${outputRoot.label} must not point inside source root ${relative(rootPath, sourcePath)}`
      );
    }

    const existing = seen.get(absoluteOutputRoot);
    if (existing !== undefined) {
      throw new Error(
        `skillset: ${outputRoot.label} reuses output root ${outputRoot.path}; already used by ${existing}`
      );
    }
    seen.set(absoluteOutputRoot, outputRoot.label);
  }
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const relativePath = relative(parent, candidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !relativePath.includes(`..${sep}`))
  );
}
