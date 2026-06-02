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
import { resolveInside, validateSlug } from "./path";
import type { BuildGraph, SkillsetOptions, SourcePlugin, SourceSkill, StandaloneSkill } from "./types";
import { parseMarkdown, parseYamlRecord } from "./yaml";

const DEFAULT_SOURCE_DIR = ".skillset";
const CONFIG_FILE = "config.yaml";
const PLUGINS_DIR = "plugins";
const SKILLS_DIR = "skills";
const SKILL_FILE = "SKILL.md";

export async function loadBuildGraph(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<BuildGraph> {
  const sourceDir = options.sourceDir ?? DEFAULT_SOURCE_DIR;
  const sourcePath = resolveInside(rootPath, sourceDir);
  const rootConfigPath = join(sourcePath, CONFIG_FILE);
  const rootConfig = parseYamlRecord(await readFile(rootConfigPath, "utf8"), rootConfigPath);
  validateConfigDocument(rootConfig, rootConfigPath);
  const metadata = readSkillsetMetadata(rootConfig, rootConfigPath);
  const outputs = readOutputConfig(
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

  if (plugins.length === 0 && standaloneSkills.length === 0) {
    throw new Error(`skillset: no source plugins or skills found under ${sourceDir}/`);
  }

  const outputRoots = activeOutputRoots(outputs, plugins, standaloneSkills);
  validateOutputRoots(rootPath, sourcePath, outputRoots);

  return {
    outputRoots: outputRoots.map((outputRoot) => outputRoot.path),
    plugins,
    root,
    rootPath,
    sourceDir,
    sourcePath,
    standaloneSkills,
  };
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

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
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
  const configPath = join(pluginPath, CONFIG_FILE);
  const config = parseYamlRecord(await readFile(configPath, "utf8"), configPath);
  validateConfigDocument(config, configPath);
  const metadata = readSkillsetMetadata(config, configPath);
  const configuredId = readSkillsetName(metadata, id, configPath);
  validateSlug(configuredId, `skillset.name in ${configPath}`);
  if (configuredId !== id) {
    throw new Error(
      `skillset: plugin directory ${id} does not match skillset.name ${configuredId}`
    );
  }

  const targets = resolveTargets(parentTargets, config, configPath);
  const skills = await loadSkills(rootPath, pluginPath, targets);

  return { id, metadata, path: pluginPath, skills, targets };
}

async function loadSkills(
  rootPath: string,
  pluginPath: string,
  parentTargets: SourcePlugin["targets"]
): Promise<SourceSkill[]> {
  const skillsPath = join(pluginPath, SKILLS_DIR);
  if (!(await exists(skillsPath))) return [];
  return loadSkillsFromDirectory(rootPath, skillsPath, pluginPath, parentTargets);
}

async function loadSkillsFromDirectory(
  rootPath: string,
  skillsPath: string,
  relativeBasePath: string,
  parentTargets: SourcePlugin["targets"]
): Promise<SourceSkill[]> {
  const skillFiles = await findSkillFiles(skillsPath);
  const skills: SourceSkill[] = [];

  for (const sourcePath of skillFiles) {
    const content = await readFile(sourcePath, "utf8");
    const parts = parseMarkdown(content, sourcePath);
    const metadata = readSkillsetMetadata(parts.frontmatter, sourcePath);
    const id = validateSlug(
      readSkillsetName(metadata, readString(parts.frontmatter, "name") ?? basename(dirname(sourcePath)), sourcePath),
      `skill id in ${sourcePath}`
    );
    const targets = resolveTargets(parentTargets, parts.frontmatter, sourcePath);
    const relativePath = relative(relativeBasePath, sourcePath);

    skills.push({
      body: parts.body,
      frontmatter: parts.frontmatter,
      id,
      metadata,
      relativePath,
      sourcePath: resolveInside(rootPath, relative(rootPath, sourcePath)),
      targets,
    });
  }

  return skills.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function loadStandaloneSkills(
  rootPath: string,
  sourceDir: string,
  rootTargets: BuildGraph["root"]["targets"]
): Promise<readonly StandaloneSkill[]> {
  const skillsPath = resolveInside(rootPath, join(sourceDir, SKILLS_DIR));
  if (!(await exists(skillsPath))) return [];

  const skills = await loadSkillsFromDirectory(rootPath, skillsPath, skillsPath, rootTargets);
  return skills;
}

async function findSkillFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
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

function activeOutputRoots(
  outputs: BuildGraph["root"]["outputs"],
  plugins: readonly SourcePlugin[],
  standaloneSkills: readonly StandaloneSkill[]
): readonly ActiveOutputRoot[] {
  const roots: ActiveOutputRoot[] = [];
  if (plugins.some((plugin) => plugin.targets.claude.enabled)) {
    roots.push({ label: "outputs.plugins.claude", path: outputs.plugins.claude });
  }
  if (plugins.some((plugin) => plugin.targets.codex.enabled)) {
    roots.push({ label: "outputs.plugins.codex", path: outputs.plugins.codex });
  }
  if (standaloneSkills.some((skill) => skill.targets.claude.enabled)) {
    roots.push({ label: "outputs.skills.claude", path: outputs.skills.claude });
  }
  if (standaloneSkills.some((skill) => skill.targets.codex.enabled)) {
    roots.push({ label: "outputs.skills.codex", path: outputs.skills.codex });
  }
  return roots.sort((left, right) => left.path.localeCompare(right.path));
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
