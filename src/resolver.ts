import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";

import {
  defaultTargets,
  readSkillsetMetadata,
  readString,
  resolveTargets,
  validateConfigDocument,
} from "./config";
import { resolveInside, validateSlug } from "./path";
import type { BuildGraph, SkillsetOptions, SourcePlugin, SourceSkill } from "./types";
import { parseMarkdown, parseYamlRecord } from "./yaml";

const DEFAULT_SOURCE_DIR = "src";
const DEFAULT_DIST_DIR = "dist";
const SKILLSET_FILE = "skillset.yaml";
const SKILL_FILE = "SKILL.md";

export async function loadBuildGraph(
  rootPath: string,
  options: SkillsetOptions = {}
): Promise<BuildGraph> {
  const sourceDir = options.sourceDir ?? DEFAULT_SOURCE_DIR;
  const distDir = options.distDir ?? DEFAULT_DIST_DIR;
  const sourcePath = resolveInside(rootPath, sourceDir);
  const rootConfigPath = join(sourcePath, SKILLSET_FILE);
  const rootConfig = parseYamlRecord(await readFile(rootConfigPath, "utf8"), rootConfigPath);
  validateConfigDocument(rootConfig, rootConfigPath);
  const rootTargets = resolveTargets(defaultTargets(), rootConfig, rootConfigPath);
  const root = {
    metadata: readSkillsetMetadata(rootConfig, rootConfigPath),
    targets: rootTargets,
  };

  const entries = await readdir(sourcePath, { withFileTypes: true });
  const plugins: SourcePlugin[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const id = validateSlug(entry.name, "plugin directory");
    plugins.push(await loadPlugin(rootPath, sourceDir, id, rootTargets));
  }

  if (plugins.length === 0) {
    throw new Error(`skillset: no source plugins found under ${sourceDir}/`);
  }

  return { distDir, plugins, root, rootPath, sourceDir, sourcePath };
}

async function loadPlugin(
  rootPath: string,
  sourceDir: string,
  id: string,
  parentTargets: BuildGraph["root"]["targets"]
): Promise<SourcePlugin> {
  const pluginPath = resolveInside(rootPath, join(sourceDir, id));
  const configPath = join(pluginPath, SKILLSET_FILE);
  const config = parseYamlRecord(await readFile(configPath, "utf8"), configPath);
  validateConfigDocument(config, configPath);
  const metadata = readSkillsetMetadata(config, configPath);
  const configuredId = readString(metadata, "id") ?? id;
  validateSlug(configuredId, `skillset.id in ${configPath}`);
  if (configuredId !== id) {
    throw new Error(
      `skillset: plugin directory ${id} does not match skillset.id ${configuredId}`
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
  const skillsPath = join(pluginPath, "skills");
  if (!(await exists(skillsPath))) return [];

  const skillFiles = await findSkillFiles(skillsPath);
  const skills: SourceSkill[] = [];

  for (const sourcePath of skillFiles) {
    const content = await readFile(sourcePath, "utf8");
    const parts = parseMarkdown(content, sourcePath);
    const metadata = readSkillsetMetadata(parts.frontmatter, sourcePath);
    const id = validateSlug(
      readString(metadata, "id") ?? readString(parts.frontmatter, "name") ?? basename(sourcePath),
      `skill id in ${sourcePath}`
    );
    const targets = resolveTargets(parentTargets, parts.frontmatter, sourcePath);
    const pluginRelativePath = relative(pluginPath, sourcePath);

    skills.push({
      body: parts.body,
      frontmatter: parts.frontmatter,
      id,
      metadata,
      pluginRelativePath,
      sourcePath: resolveInside(rootPath, relative(rootPath, sourcePath)),
      targets,
    });
  }

  return skills.sort((left, right) => left.pluginRelativePath.localeCompare(right.pluginRelativePath));
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
