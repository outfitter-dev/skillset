import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

import { defineRenderResult, type SkillsetRenderResult } from "@skillset/core";

import { seedReleaseBaselines, type ReleaseBaselineEntry } from "./adoption";
import { readSkillsetMetadata, readSkillsetName, readString } from "./config";
import { compareStrings, resolveInside, validateSlug } from "./path";
import { detectWorkspaceSourceDir } from "./resolver";
import { selectorForPluginConfig, selectorForStandaloneSkill } from "./source-unit-selector";
import type { JsonRecord, SourceOrigin } from "./types";
import { isJsonRecord, parseMarkdown, parseYamlRecord, stringifyMarkdown, stringifyYaml } from "./yaml";

const DEFAULT_SOURCE_DIR = ".skillset";
const SOURCE_ROOT_DIR = "src";
const PLUGINS_DIR = "plugins";
const SKILLS_DIR = "skills";

export type ImportKind = "plugin" | "plugins" | "skill" | "skills";
export type ImportProvider = "agents" | "claude" | "codex" | "skillset";
type SingularImportKind = "plugin" | "skill";

/**
 * Frontmatter keys Skillset understands as portable source. Present keys are
 * reported as inferred source fields; absent ones are classified further.
 */
const RECOGNIZED_SOURCE_KEYS: ReadonlySet<string> = new Set([
  "agents",
  "allowed_tools",
  "claude",
  "codex",
  "description",
  "id",
  "implicit_invocation",
  "name",
  "resources",
  "skillset",
  "summary",
  "title",
  "tool_intent",
  "version",
]);

/**
 * Frontmatter keys that are target-native (Claude/Codex) rather than Skillset
 * source. Import preserves them verbatim and reports them so the author can
 * decide whether to move them under a portable key or a `claude`/`codex` block.
 */
const KNOWN_TARGET_NATIVE_KEYS: ReadonlySet<string> = new Set([
  "allowed-tools",
  "argument-hint",
  "color",
  "disable-model-invocation",
  "disallowed-tools",
  "license",
  "metadata",
  "model",
  "user-facing-name",
]);

export interface ImportOptions {
  readonly kind: SingularImportKind;
  readonly name?: string;
  readonly rootPath: string;
  readonly sourceDir?: string;
  readonly sourceOrigin?: (sourcePath: string, copiedFile?: string) => SourceOrigin;
  readonly sourcePath: string;
}

export interface ImportSourcesOptions {
  readonly kind?: ImportKind;
  readonly name?: string;
  readonly provider?: ImportProvider;
  readonly rootPath: string;
  readonly sourceDir?: string;
  readonly sourceOrigin?: (sourcePath: string, copiedFile?: string) => SourceOrigin;
  readonly sourcePath?: string;
}

export interface ImportReport {
  readonly baselines: readonly ReleaseBaselineEntry[];
  readonly copiedFiles: readonly string[];
  readonly files: number;
  readonly inferredSourceFields: readonly string[];
  readonly kind: SingularImportKind;
  readonly renderResults: readonly SkillsetRenderResult[];
  readonly name: string;
  readonly nextChecks: readonly string[];
  readonly preservedTargetNativeFields: readonly string[];
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly unsupportedFields: readonly string[];
  readonly warnings: readonly string[];
}

export interface ImportBatchReport {
  readonly files: number;
  readonly imports: readonly ImportReport[];
  readonly kind: ImportKind;
  readonly renderResults: readonly SkillsetRenderResult[];
  readonly provider?: ImportProvider;
  readonly sourcePath: string;
  readonly warnings: readonly string[];
}

export async function importSources(options: ImportSourcesOptions): Promise<ImportBatchReport> {
  const sourcePath = resolveImportSourcePath(options);
  const plan = await planImports(sourcePath, options.kind);
  if (options.name !== undefined && plan.items.length !== 1) {
    throw new Error("skillset: --name can only be used when importing one skill or plugin");
  }

  const imports: ImportReport[] = [];
  for (const item of plan.items) {
    imports.push(
      await importSource({
        kind: item.kind,
        rootPath: options.rootPath,
        sourcePath: item.sourcePath,
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.sourceDir === undefined ? {} : { sourceDir: options.sourceDir }),
        ...(options.sourceOrigin === undefined ? {} : { sourceOrigin: options.sourceOrigin }),
      })
    );
  }

  return {
    files: imports.reduce((total, report) => total + report.files, 0),
    imports,
    kind: plan.kind,
    renderResults: imports.flatMap((report) => report.renderResults),
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    sourcePath,
    warnings: plan.warnings,
  };
}

export async function importSource(options: ImportOptions): Promise<ImportReport> {
  const sourcePath = resolve(options.sourcePath);
  const sourceDir = await resolveImportSourceDir(options.rootPath, options.sourceDir);
  const sourceRoot = sourceDir === "." ? "skillset" : join(sourceDir, SOURCE_ROOT_DIR);
  const name = await resolveImportName(sourcePath, options);
  const targetPath = resolveInside(
    options.rootPath,
    join(sourceRoot, options.kind === "plugin" ? PLUGINS_DIR : SKILLS_DIR, name)
  );

  if (await exists(targetPath)) {
    throw new Error(
      `skillset: import target already exists: ${targetPath}. ` +
        "Import never overwrites; remove the existing source or import under a different --name."
    );
  }

  const targetParent = dirname(targetPath);
  await mkdir(targetParent, { recursive: true });
  const stagingPath = await mkdtemp(join(targetParent, `.${basename(targetPath)}.tmp-`));
  let committed = false;

  try {
    const copiedFiles = await copyImportSource(sourcePath, stagingPath, options.kind, name);
    if (options.sourceOrigin !== undefined) {
      await stampImportedOrigins(stagingPath, sourcePath, copiedFiles, options.kind, options.sourceOrigin);
    }
    const frontmatter = await readImportedFrontmatter(stagingPath, options.kind);
    const classification = classifyFrontmatter(frontmatter);

    if (await exists(targetPath)) {
      throw new Error(
        `skillset: import target already exists: ${targetPath}. ` +
          "Import never overwrites; remove the existing source or import under a different --name."
      );
    }

    await rename(stagingPath, targetPath);
    committed = true;
    let baselineReport: { readonly entries: readonly ReleaseBaselineEntry[] };
    try {
      baselineReport = await seedImportedBaselines(options.rootPath, {
        kind: options.kind,
        name,
        sourceDir,
      });
    } catch (error) {
      await rm(targetPath, { force: true, recursive: true });
      throw error;
    }

    return {
      baselines: baselineReport.entries,
      copiedFiles,
      files: copiedFiles.length,
      inferredSourceFields: classification.recognized,
      kind: options.kind,
      renderResults: importRenderResults({
        classification,
        kind: options.kind,
        name,
        rootPath: options.rootPath,
        targetPath,
      }),
      name,
      nextChecks: [
        "skillset lint",
        "skillset build",
        "skillset verify",
      ],
      preservedTargetNativeFields: classification.targetNative,
      sourcePath,
      targetPath,
      unsupportedFields: classification.unsupported,
      warnings: importWarnings(classification),
    };
  } finally {
    if (!committed) {
      await rm(stagingPath, { force: true, recursive: true });
    }
  }
}

async function resolveImportSourceDir(rootPath: string, explicitSourceDir: string | undefined): Promise<string> {
  if (explicitSourceDir !== undefined) return explicitSourceDir;
  try {
    return await detectWorkspaceSourceDir(rootPath);
  } catch (error) {
    if (isMissingWorkspace(error)) return DEFAULT_SOURCE_DIR;
    throw error;
  }
}

function isMissingWorkspace(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("skillset workspace not found") || message.includes("no source plugins, skills, rules");
}

async function seedImportedBaselines(
  rootPath: string,
  options: {
    readonly kind: SingularImportKind;
    readonly name: string;
    readonly sourceDir: string;
  }
): Promise<{ readonly entries: readonly ReleaseBaselineEntry[] }> {
  const includeScope = (scope: string): boolean => {
    if (options.kind === "skill") return scope === `skill:${options.name}`;
    return scope === `plugin:${options.name}` || scope.startsWith(`plugin.${options.name}.`);
  };
  const report = await seedReleaseBaselines(
    rootPath,
    { sourceDir: options.sourceDir },
    { includeScope, write: true }
  );
  return { entries: report.entries };
}

interface FrontmatterClassification {
  readonly recognized: readonly string[];
  readonly targetNative: readonly string[];
  readonly unsupported: readonly string[];
}

function classifyFrontmatter(frontmatter: JsonRecord): FrontmatterClassification {
  const recognized: string[] = [];
  const targetNative: string[] = [];
  const unsupported: string[] = [];

  for (const key of Object.keys(frontmatter).sort(compareStrings)) {
    if (RECOGNIZED_SOURCE_KEYS.has(key)) recognized.push(key);
    else if (KNOWN_TARGET_NATIVE_KEYS.has(key)) targetNative.push(key);
    else unsupported.push(key);
  }

  return { recognized, targetNative, unsupported };
}

function importWarnings(classification: FrontmatterClassification): readonly string[] {
  const warnings: string[] = [];
  if (classification.targetNative.length > 0) {
    warnings.push(
      `preserved target-native fields verbatim: ${classification.targetNative.join(", ")}. ` +
        "Consider moving them to a portable source key (e.g. tool_intent, implicit_invocation) or a claude/codex block."
    );
  }
  if (classification.unsupported.length > 0) {
    warnings.push(
      `kept unrecognized frontmatter keys verbatim: ${classification.unsupported.join(", ")}. ` +
        "Verify they lower correctly with skillset build, or remove them."
    );
  }
  return warnings;
}

function importRenderResults(args: {
  readonly classification: FrontmatterClassification;
  readonly kind: SingularImportKind;
  readonly name: string;
  readonly rootPath: string;
  readonly targetPath: string;
}): readonly SkillsetRenderResult[] {
  const toolPolicyFields = args.classification.targetNative.filter(isClaudeToolPolicyField);
  if (toolPolicyFields.length === 0) return [];
  const sourcePath = importSourcePath(args.rootPath, args.targetPath, args.kind);
  return [
    defineRenderResult({
      destination: "skill-frontmatter",
      diagnostics: [
        {
          code: "import-preserved-target-native-frontmatter",
          message: `preserved target-native fields verbatim: ${toolPolicyFields.join(", ")}`,
          path: sourcePath,
        },
      ],
      featureId: "tool-intent",
      outputs: [{ kind: "imported-source", path: sourcePath }],
      sourcePath,
      sourceUnit: args.kind === "skill"
        ? selectorForStandaloneSkill(args.name)
        : selectorForPluginConfig(args.name),
      status: "target_native",
      target: "claude",
    }),
  ];
}

function isClaudeToolPolicyField(field: string): boolean {
  return field === "allowed-tools" || field === "disallowed-tools" || field === "disable-model-invocation";
}

function importSourcePath(rootPath: string, targetPath: string, kind: SingularImportKind): string {
  const path = kind === "skill" ? join(targetPath, "SKILL.md") : join(targetPath, "skillset.yaml");
  return relative(rootPath, path).replaceAll("\\", "/");
}

async function readImportedFrontmatter(targetPath: string, kind: SingularImportKind): Promise<JsonRecord> {
  if (kind === "skill") {
    const skillFile = join(targetPath, "SKILL.md");
    if (!(await exists(skillFile))) return {};
    return parseMarkdown(await readFile(skillFile, "utf8"), skillFile).frontmatter;
  }

  const configPath = join(targetPath, "skillset.yaml");
  if (!(await exists(configPath))) return {};
  return parseYamlRecord(await readFile(configPath, "utf8"), configPath);
}

async function resolveImportName(sourcePath: string, options: ImportOptions): Promise<string> {
  if (options.name !== undefined) {
    return validateSlug(options.name, "import name");
  }

  if (options.kind === "skill") {
    const skillPath = await resolveSkillFile(sourcePath);
    const parts = parseMarkdown(await readFile(skillPath, "utf8"), skillPath);
    const metadata = readSkillsetMetadata(parts.frontmatter, skillPath);
    return validateSlug(
      readSkillsetName(metadata, readString(parts.frontmatter, "name") ?? basename(dirname(skillPath)), skillPath),
      `skillset.name in ${skillPath}`
    );
  }

  const configPath = await resolvePluginConfig(sourcePath);
  if (configPath === undefined) {
    return validateSlug(basename(sourcePath), "plugin directory");
  }

  const config = parseYamlRecord(await readFile(configPath, "utf8"), configPath);
  const metadata = readSkillsetMetadata(config, configPath);
  return validateSlug(readSkillsetName(metadata, basename(sourcePath), configPath), `skillset.name in ${configPath}`);
}

async function copyImportSource(
  sourcePath: string,
  targetPath: string,
  kind: SingularImportKind,
  name: string
): Promise<readonly string[]> {
  const stats = await stat(sourcePath);
  if (stats.isFile()) {
    if (kind !== "skill" || basename(sourcePath) !== "SKILL.md") {
      throw new Error("skillset: importing a file is only supported for skill SKILL.md files");
    }
  }

  const copyRoot = stats.isFile() ? dirname(sourcePath) : sourcePath;
  const copied: string[] = [];
  for (const file of await collectFiles(copyRoot)) {
    const relativePath = relativeImportPath(copyRoot, file, kind);
    await mkdir(dirname(join(targetPath, relativePath)), { recursive: true });
    await writeFile(join(targetPath, relativePath), await readFile(file));
    copied.push(relativePath);
  }

  if (kind === "plugin" && !(await exists(join(targetPath, "skillset.yaml")))) {
    await writeImportedPluginConfig(targetPath, name);
    copied.push("skillset.yaml");
  }

  return copied.sort(compareStrings);
}

async function stampImportedOrigins(
  targetPath: string,
  sourcePath: string,
  copiedFiles: readonly string[],
  kind: SingularImportKind,
  sourceOrigin: (sourcePath: string, copiedFile?: string) => SourceOrigin
): Promise<void> {
  if (kind === "plugin") {
    await writeYamlSourceOrigin(join(targetPath, "skillset.yaml"), sourceOrigin(sourcePath));
  }

  for (const file of copiedFiles) {
    if (basename(file) !== "SKILL.md") continue;
    await writeMarkdownSourceOrigin(join(targetPath, file), sourceOrigin(sourcePath, file));
  }
}

async function writeYamlSourceOrigin(path: string, origin: SourceOrigin): Promise<void> {
  const config = parseYamlRecord(await readFile(path, "utf8"), path);
  await writeFile(path, stringifyYaml(withSkillsetOrigin(config, origin)));
}

async function writeMarkdownSourceOrigin(path: string, origin: SourceOrigin): Promise<void> {
  const parts = parseMarkdown(await readFile(path, "utf8"), path);
  await writeFile(path, stringifyMarkdown(withSkillsetOrigin(parts.frontmatter, origin), parts.body));
}

function withSkillsetOrigin(record: JsonRecord, origin: SourceOrigin): JsonRecord {
  const existing = isJsonRecord(record.skillset) ? record.skillset : {};
  return {
    ...record,
    skillset: {
      ...existing,
      origin: sourceOriginRecord(origin),
    },
  };
}

function sourceOriginRecord(origin: SourceOrigin): JsonRecord {
  return {
    path: origin.path,
    ...(origin.ref === undefined ? {} : { ref: origin.ref }),
    ...(origin.repo === undefined ? {} : { repo: origin.repo }),
  };
}

function relativeImportPath(sourceRoot: string, file: string, kind: SingularImportKind): string {
  const relativePath = file.slice(sourceRoot.length + 1);
  if (kind === "plugin" && (relativePath === "skillset.yaml" || relativePath === "config.yaml")) {
    return "skillset.yaml";
  }
  return relativePath;
}

async function resolveSkillFile(sourcePath: string): Promise<string> {
  const stats = await stat(sourcePath);
  if (stats.isFile()) return sourcePath;
  return join(sourcePath, "SKILL.md");
}

async function resolvePluginConfig(sourcePath: string): Promise<string | undefined> {
  for (const file of ["config.yaml", "skillset.yaml"]) {
    const candidate = join(sourcePath, file);
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

async function collectFiles(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile() && entry.name !== ".DS_Store") {
      files.push(path);
    }
  }
  return files;
}

interface ImportPlan {
  readonly items: readonly ImportPlanItem[];
  readonly kind: ImportKind;
  readonly warnings: readonly string[];
}

interface ImportPlanItem {
  readonly kind: SingularImportKind;
  readonly sourcePath: string;
}

function resolveImportSourcePath(options: ImportSourcesOptions): string {
  if (options.sourcePath !== undefined) return resolve(options.sourcePath);
  if (options.provider !== undefined) return defaultProviderSkillRoot(options.provider);
  throw new Error("skillset: expected import path");
}

function defaultProviderSkillRoot(provider: ImportProvider): string {
  const home = homedir();
  if (provider === "agents") return join(home, ".agents", "skills");
  if (provider === "claude") return join(home, ".claude", "skills");
  if (provider === "codex") return join(home, ".codex", "skills");
  return join(home, ".skillset");
}

async function planImports(sourcePath: string, requestedKind: ImportKind | undefined): Promise<ImportPlan> {
  if (requestedKind === "skill") {
    if (!(await isSkillSource(sourcePath))) {
      throw new Error(`skillset: expected a skill directory or SKILL.md file: ${sourcePath}`);
    }
    return { items: [{ kind: "skill", sourcePath }], kind: "skill", warnings: [] };
  }

  if (requestedKind === "plugin") {
    if (!(await isPluginSource(sourcePath))) {
      throw new Error(`skillset: expected a plugin directory: ${sourcePath}`);
    }
    return { items: [{ kind: "plugin", sourcePath }], kind: "plugin", warnings: [] };
  }

  if (requestedKind === "skills") {
    const items = await skillChildren(sourcePath);
    if (items.length === 0) {
      throw new Error(`skillset: expected a skills root with child skill directories: ${sourcePath}`);
    }
    return { items, kind: "skills", warnings: [] };
  }

  if (requestedKind === "plugins") {
    const items = await pluginChildren(sourcePath);
    if (items.length === 0) {
      throw new Error(`skillset: expected a plugins root with child plugin directories: ${sourcePath}`);
    }
    return { items, kind: "plugins", warnings: [] };
  }

  if (await isSkillSource(sourcePath)) {
    return { items: [{ kind: "skill", sourcePath }], kind: "skill", warnings: [] };
  }
  if (await isPluginSource(sourcePath)) {
    return { items: [{ kind: "plugin", sourcePath }], kind: "plugin", warnings: [] };
  }

  const skills = await skillChildren(sourcePath);
  const plugins = await pluginChildren(sourcePath);
  if (skills.length > 0 && plugins.length === 0) {
    return { items: skills, kind: "skills", warnings: [] };
  }
  if (plugins.length > 0 && skills.length === 0) {
    return { items: plugins, kind: "plugins", warnings: [] };
  }
  if (skills.length > 0 && plugins.length > 0) {
    throw new Error(
      `skillset: import source is ambiguous; found ${skills.length} skill(s) and ${plugins.length} plugin(s). ` +
        "Use --kind skills or --kind plugins."
    );
  }

  throw new Error(
    `skillset: could not infer import kind for ${sourcePath}. ` +
      "Use --kind skill, --kind skills, --kind plugin, or --kind plugins."
  );
}

async function isSkillSource(sourcePath: string): Promise<boolean> {
  if (!(await exists(sourcePath))) return false;
  const stats = await stat(sourcePath);
  if (stats.isFile()) return basename(sourcePath) === "SKILL.md";
  if (!stats.isDirectory()) return false;
  return exists(join(sourcePath, "SKILL.md"));
}

async function isPluginSource(sourcePath: string): Promise<boolean> {
  if (!(await exists(sourcePath))) return false;
  const stats = await stat(sourcePath);
  if (!stats.isDirectory()) return false;
  return (
    (await exists(join(sourcePath, "skillset.yaml"))) ||
    (await exists(join(sourcePath, "config.yaml"))) ||
    (await exists(join(sourcePath, ".claude-plugin", "plugin.json"))) ||
    (await exists(join(sourcePath, ".codex-plugin", "plugin.json")))
  );
}

async function skillChildren(sourcePath: string): Promise<readonly ImportPlanItem[]> {
  return importChildren(sourcePath, "skill", async (path) => isSkillSource(path));
}

async function pluginChildren(sourcePath: string): Promise<readonly ImportPlanItem[]> {
  const pluginRoot = (await exists(join(sourcePath, "plugins"))) ? join(sourcePath, "plugins") : sourcePath;
  return importChildren(pluginRoot, "plugin", async (path) => isPluginSource(path));
}

async function importChildren(
  sourcePath: string,
  kind: SingularImportKind,
  predicate: (path: string) => Promise<boolean>
): Promise<readonly ImportPlanItem[]> {
  if (!(await exists(sourcePath))) return [];
  const stats = await stat(sourcePath);
  if (!stats.isDirectory()) return [];

  const entries = await readdir(sourcePath, { withFileTypes: true });
  const seen = new Set<string>();
  const items: ImportPlanItem[] = [];
  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    if (entry.name === ".DS_Store") continue;
    const candidate = join(sourcePath, entry.name);
    if (!(await exists(candidate))) continue;
    const candidateStats = await stat(candidate);
    if (!candidateStats.isDirectory()) continue;
    if (!(await predicate(candidate))) continue;

    const realCandidate = await realpath(candidate);
    if (seen.has(realCandidate)) continue;
    seen.add(realCandidate);
    items.push({ kind, sourcePath: candidate });
  }

  return items;
}

async function writeImportedPluginConfig(
  targetPath: string,
  name: string
): Promise<void> {
  const nativeManifest = await readNativePluginManifest(targetPath);
  // Lift every manifest field the generated projection round-trips, so an
  // imported plugin compiles back to a manifest substantially identical to
  // its origin. `version` stays a source fallback: release state owns it once
  // releases exist (see the field-authority table in docs/features/plugins.md).
  const metadata: JsonRecord = {
    name,
    description: readString(nativeManifest, "description"),
    version: readString(nativeManifest, "version"),
    author: nativeManifest.author,
    homepage: nativeManifest.homepage,
    repository: nativeManifest.repository,
    license: nativeManifest.license,
    keywords: nativeManifest.keywords,
  };
  await writeFile(
    join(targetPath, "skillset.yaml"),
    stringifyYaml({
      skillset: metadata,
    })
  );
}

async function readNativePluginManifest(targetPath: string): Promise<JsonRecord> {
  for (const file of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
    const candidate = join(targetPath, file);
    if (!(await exists(candidate))) continue;
    const parsed = JSON.parse(await readFile(candidate, "utf8")) as unknown;
    if (!isJsonRecord(parsed)) {
      throw new Error(`skillset: expected native plugin manifest ${candidate} to contain a JSON object`);
    }
    return parsed;
  }
  return {};
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
