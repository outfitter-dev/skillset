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
  resolveFeatureTargets,
  resolveTargets,
  targetNames,
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
const INSTRUCTIONS_DIR = "instructions";
const INSTRUCTIONS_COMPAT_DIR = "rules";
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
  const compile = readCompileConfig(rootConfig, rootConfigPath);
  const root = {
    compile,
    metadata,
    outputs,
    targets: rootTargets,
  };

  const warnings: string[] = [];
  const plugins = await loadPlugins(rootPath, sourceDir, rootTargets, warnings);
  const standaloneSkills = await loadStandaloneSkills(rootPath, sourceDir, rootTargets, warnings);
  const { rules, instructionsDir } = await loadInstructions(rootPath, sourceDir, rootTargets, warnings);

  if (plugins.length === 0 && standaloneSkills.length === 0 && rules.length === 0) {
    throw new Error(`skillset: no source plugins, skills, or instructions found under ${sourceDir}/`);
  }

  const outputRoots = await outputRootsFor(rootPath, outputs, plugins, standaloneSkills, rules);
  validateOutputRoots(rootPath, sourcePath, outputRoots);

  return {
    instructionsDir,
    outputRoots: outputRoots.map((outputRoot) => outputRoot.path),
    plugins,
    rules,
    root,
    rootPath,
    sourceDir,
    sourcePath,
    standaloneSkills,
    warnings,
  };
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
  warnings: string[]
): Promise<readonly SourcePlugin[]> {
  const pluginsPath = resolveInside(rootPath, join(sourceDir, PLUGINS_DIR));
  if (!(await exists(pluginsPath))) return [];

  const entries = await readdir(pluginsPath, { withFileTypes: true });
  const plugins: SourcePlugin[] = [];

  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    if (!entry.isDirectory()) continue;
    const id = validateSlug(entry.name, "plugin directory");
    plugins.push(await loadPlugin(rootPath, sourceDir, id, rootTargets, warnings));
  }

  return plugins;
}

async function loadPlugin(
  rootPath: string,
  sourceDir: string,
  id: string,
  parentTargets: BuildGraph["root"]["targets"],
  warnings: string[]
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

  const inheritedTargets = resolveTargets(parentTargets, config, configPath, {
    allowDefaults: true,
  });
  const targets = applyFeatureTargetDefaults(inheritedTargets, "plugins");
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
