import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

import {
  classifyNativeHookLiftDiagnostics,
  defineRenderResult,
  type JsonValue,
  type NativeHookLiftDiagnostic,
  type SkillsetRenderResult,
} from "@skillset/core";
import { listProviderPluginComponentManifestFields } from "@skillset/registry";

import { seedReleaseBaselines, type ReleaseBaselineEntry } from "./adoption";
import { readSkillsetMetadata, readSkillsetName, readString, targetNames } from "@skillset/core/internal/config";
import { compareStrings, resolveInside, validateSlug } from "@skillset/core/internal/path";
import { detectWorkspaceSourceDir } from "@skillset/core/internal/resolver";
import { selectorForPluginConfig, selectorForPluginFeature, selectorForStandaloneSkill } from "@skillset/core/internal/source-unit-selector";
import type { JsonRecord, SourceOrigin, TargetName } from "@skillset/core/internal/types";
import { isJsonRecord, parseMarkdown, parseYamlRecord, stringifyMarkdown, stringifyYaml } from "@skillset/core/internal/yaml";

import {
  firstPortablePluginMetadataValue,
  portablePluginMetadataConflicts,
  PORTABLE_PLUGIN_METADATA_FIELDS,
} from "./plugin-manifest-authority";

const DEFAULT_SOURCE_DIR = ".skillset";
const PLUGINS_DIR = "plugins";
const SKILLS_DIR = "skills";
const SOURCE_OWNED_PLUGIN_MANIFEST_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "version",
  ...PORTABLE_PLUGIN_METADATA_FIELDS,
]);

export type ImportKind = "plugin" | "plugins" | "skill" | "skills";
export type ImportProvider = "agents" | "claude" | "codex" | "cursor" | "skillset";
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
  "cursor",
  "description",
  "id",
  "implicit_invocation",
  "name",
  "resources",
  "skillset",
  "summary",
  "title",
  "tools",
  "version",
]);

/**
 * Frontmatter keys that are target-native provider fields rather than Skillset
 * source. Import preserves them verbatim and reports them so the author can
 * decide whether to move them under a portable key or a provider-specific block.
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
  readonly baselinePath?: string;
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

export class ImportBatchError extends Error {
  readonly imports: readonly ImportReport[];

  constructor(message: string, imports: readonly ImportReport[]) {
    super(message);
    this.name = "ImportBatchError";
    this.imports = imports;
  }
}

export async function importSources(options: ImportSourcesOptions): Promise<ImportBatchReport> {
  const sourcePath = resolveImportSourcePath(options);
  const plan = await planImports(sourcePath, options.kind);
  if (options.name !== undefined && plan.items.length !== 1) {
    throw new Error("skillset: --name can only be used when importing one skill or plugin");
  }

  const imports: ImportReport[] = [];
  for (const item of plan.items) {
    try {
      imports.push(await importSource({
        kind: item.kind,
        rootPath: options.rootPath,
        sourcePath: item.sourcePath,
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.sourceDir === undefined ? {} : { sourceDir: options.sourceDir }),
        ...(options.sourceOrigin === undefined ? {} : { sourceOrigin: options.sourceOrigin }),
      }));
    } catch (error) {
      throw new ImportBatchError(errorMessage(error), imports);
    }
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
  const sourceRoot = sourceDir;
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
    const copiedFiles = await copyImportSource({
      kind: options.kind,
      name,
      rootPath: options.rootPath,
      sourcePath,
      targetPath: stagingPath,
    });
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
    let baselineReport: { readonly entries: readonly ReleaseBaselineEntry[]; readonly path?: string };
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

    const renderResults = await importRenderResults({
      classification,
      copiedFiles,
      kind: options.kind,
      name,
      rootPath: options.rootPath,
      targetPath,
    });

    return {
      ...(baselineReport.path === undefined ? {} : { baselinePath: baselineReport.path }),
      baselines: baselineReport.entries,
      copiedFiles,
      files: copiedFiles.length,
      inferredSourceFields: classification.recognized,
      kind: options.kind,
      renderResults,
      name,
      nextChecks: [
        "skillset check",
        "skillset build",
        "skillset check --only outputs",
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
  if (explicitSourceDir !== undefined) {
    if (explicitSourceDir !== DEFAULT_SOURCE_DIR) {
      throw new Error(
        `skillset: sourceDir override ${explicitSourceDir} uses a retired source layout; imports write under ${DEFAULT_SOURCE_DIR}/`
      );
    }
    return explicitSourceDir;
  }
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
): Promise<{ readonly entries: readonly ReleaseBaselineEntry[]; readonly path?: string }> {
  const includeScope = (scope: string): boolean => {
    if (options.kind === "skill") return scope === `skill:${options.name}`;
    return scope === `plugin:${options.name}` || scope.startsWith(`plugin.${options.name}.`);
  };
  const report = await seedReleaseBaselines(
    rootPath,
    { sourceDir: options.sourceDir },
    { includeScope, write: true }
  );
  return {
    entries: report.entries,
    ...(report.path === undefined ? {} : { path: report.path }),
  };
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
        "Consider moving them to a portable source key (e.g. tools, implicit_invocation) or a provider-specific block."
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

async function importRenderResults(args: {
  readonly classification: FrontmatterClassification;
  readonly copiedFiles: readonly string[];
  readonly kind: SingularImportKind;
  readonly name: string;
  readonly rootPath: string;
  readonly targetPath: string;
}): Promise<readonly SkillsetRenderResult[]> {
  return [
    ...importFrontmatterRenderResults(args),
    ...(await importNativeHookRenderResults(args)),
  ];
}

function importFrontmatterRenderResults(args: {
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
      featureId: "tools-policy",
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

async function importNativeHookRenderResults(args: {
  readonly copiedFiles: readonly string[];
  readonly kind: SingularImportKind;
  readonly name: string;
  readonly rootPath: string;
  readonly targetPath: string;
}): Promise<readonly SkillsetRenderResult[]> {
  if (args.kind !== "plugin" || !args.copiedFiles.some((file) => normalizeCopiedImportPath(file) === "hooks/hooks.json")) return [];
  const hookPath = join(args.targetPath, "hooks", "hooks.json");
  const sourcePath = relative(args.rootPath, hookPath).replaceAll("\\", "/");
  const targets = await importedNativePluginTargets(args.targetPath);
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(await readFile(hookPath, "utf8")) as JsonValue;
  } catch (error) {
    return targets.map((target) => importNativeHookParseResult(args, sourcePath, target, errorMessage(error)));
  }
  const diagnostics = classifyNativeHookLiftDiagnostics({
    parsed,
    scope: { kind: "plugin", pluginId: args.name },
    sourcePath,
    targets,
  });
  return diagnostics.map((diagnostic) => importNativeHookRenderResult(args, sourcePath, diagnostic));
}

function importNativeHookParseResult(
  args: {
    readonly name: string;
  },
  sourcePath: string,
  target: TargetName,
  message: string
): SkillsetRenderResult {
  const reason = `could not classify native hook lift for ${sourcePath}: ${message}`;
  return defineRenderResult({
    destination: "hooks",
    diagnostics: [
      {
        code: "import-native-hook-lift-unclassified",
        message: reason,
        path: sourcePath,
      },
    ],
    featureId: "plugin-hooks",
    outputs: [{ kind: "imported-source", path: sourcePath }],
    reason,
    sourcePath,
    sourceUnit: selectorForPluginFeature(args.name, "hooks"),
    status: "target_native",
    target,
  });
}

function importNativeHookRenderResult(
  args: {
    readonly name: string;
  },
  sourcePath: string,
  diagnostic: NativeHookLiftDiagnostic
): SkillsetRenderResult {
  return defineRenderResult({
    destination: "hooks",
    diagnostics: [
      {
        code: `import-${diagnostic.code}`,
        message: diagnostic.message,
        path: diagnostic.path,
      },
    ],
    featureId: "plugin-hooks",
    outputs: [{ kind: "imported-source", path: sourcePath }],
    reason: diagnostic.message,
    sourcePath,
    sourceUnit: selectorForPluginFeature(args.name, "hooks"),
    status: "target_native",
    target: diagnostic.target,
  });
}

async function importedNativePluginTargets(targetPath: string): Promise<readonly TargetName[]> {
  const targets: TargetName[] = [];
  for (const target of targetNames()) {
    if (await exists(join(targetPath, `.${target}-plugin`, "plugin.json"))) targets.push(target);
  }
  return targets.length === 0 ? targetNames() : targets;
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

  const rootPluginImport = options.kind === "plugin" && await isSamePath(sourcePath, options.rootPath);
  const configPath = rootPluginImport ? undefined : await resolvePluginConfig(sourcePath);
  if (configPath === undefined) {
    const nativeManifest = await readNativePluginManifest(sourcePath);
    const nativeName = readString(nativeManifest, "name");
    return validateSlug(
      nativeName !== undefined && isSlug(nativeName) ? nativeName : basename(sourcePath),
      "plugin directory"
    );
  }

  const config = parseYamlRecord(await readFile(configPath, "utf8"), configPath);
  const metadata = readSkillsetMetadata(config, configPath);
  return validateSlug(readSkillsetName(metadata, basename(sourcePath), configPath), `skillset.name in ${configPath}`);
}

async function copyImportSource(options: {
  readonly kind: SingularImportKind;
  readonly name: string;
  readonly rootPath: string;
  readonly sourcePath: string;
  readonly targetPath: string;
}): Promise<readonly string[]> {
  const { kind, name, rootPath, sourcePath, targetPath } = options;
  const stats = await stat(sourcePath);
  if (stats.isFile()) {
    if (kind !== "skill" || basename(sourcePath) !== "SKILL.md") {
      throw new Error("skillset: importing a file is only supported for skill SKILL.md files");
    }
  }

  const copyRoot = stats.isFile() ? dirname(sourcePath) : sourcePath;
  const rootPluginImport = kind === "plugin" && await isSamePath(copyRoot, rootPath);
  const copied: string[] = [];
  const exclude = rootPluginImport ? (path: string) => isRootPluginImportScaffold(copyRoot, path) : undefined;
  for (const file of await collectFiles(copyRoot, exclude)) {
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
  return normalizeCopiedImportPath(relativePath);
}

export function normalizeCopiedImportPath(path: string): string {
  return path.replaceAll("\\", "/");
}

async function isSamePath(left: string, right: string): Promise<boolean> {
  try {
    return await realpath(left) === await realpath(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

function isSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function isRootPluginImportScaffold(rootPath: string, path: string): boolean {
  const relativePath = relative(rootPath, path).replaceAll("\\", "/");
  return (
    relativePath === ".git" ||
    relativePath.startsWith(".git/") ||
    relativePath === ".skillset" ||
    relativePath.startsWith(".skillset/") ||
    relativePath === "skillset.yaml" ||
    relativePath === "skillset.lock"
  );
}

async function resolveSkillFile(sourcePath: string): Promise<string> {
  const stats = await stat(sourcePath);
  if (stats.isFile()) return sourcePath;
  return join(sourcePath, "SKILL.md");
}

async function resolvePluginConfig(sourcePath: string): Promise<string | undefined> {
  for (const file of ["skillset.yaml", "config.yaml"]) {
    const candidate = join(sourcePath, file);
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

async function collectFiles(root: string, exclude?: (path: string) => boolean): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    const path = join(root, entry.name);
    if (exclude?.(path)) continue;
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path, exclude)));
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
  if (provider === "cursor") return join(home, ".cursor", "skills");
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
    (await nativePluginManifestPath(sourcePath)) !== undefined
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
  const nativeManifests = await readNativePluginManifests(targetPath);
  const metadataConflicts = portablePluginMetadataConflicts(nativeManifests);
  if (metadataConflicts.length > 0) {
    throw new Error(
      `skillset: native plugin manifests disagree on portable metadata: ${metadataConflicts.map((conflict) => conflict.field).join(", ")}`
    );
  }
  const firstMetadataValue = (field: (typeof PORTABLE_PLUGIN_METADATA_FIELDS)[number]) =>
    firstPortablePluginMetadataValue(nativeManifests, field);
  const version = [...nativeManifests.values()]
    .map((manifest) => readString(manifest, "version"))
    .find((value) => value !== undefined);
  // Lift every manifest field the generated projection round-trips, so an
  // imported plugin compiles back to a manifest substantially identical to
  // its origin. `version` stays a source fallback: release state owns it once
  // releases exist (see the field-authority table in docs/features/plugins.md).
  const metadata: JsonRecord = {
    name,
    description: firstMetadataValue("description"),
    version,
    author: firstMetadataValue("author"),
    homepage: firstMetadataValue("homepage"),
    repository: firstMetadataValue("repository"),
    license: firstMetadataValue("license"),
    keywords: firstMetadataValue("keywords"),
  };
  const providerOverrides = Object.fromEntries(
    [...nativeManifests.entries()].flatMap(([provider, manifest]) => {
      const override = importedManifestOverride(provider, manifest);
      return Object.keys(override).length === 0 ? [] : [[provider, { manifest: override }]];
    })
  );
  await writeFile(
    join(targetPath, "skillset.yaml"),
    stringifyYaml({
      skillset: metadata,
      ...providerOverrides,
    })
  );
}

function importedManifestOverride(provider: TargetName, manifest: JsonRecord): JsonRecord {
  const override: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (!SOURCE_OWNED_PLUGIN_MANIFEST_FIELDS.has(key) && value !== undefined) {
      override[key] = value;
    }
  }
  for (const field of listProviderPluginComponentManifestFields(provider)) {
    removeManifestField(override, field.split("."));
  }
  return override;
}

function removeManifestField(record: Record<string, JsonValue>, path: readonly string[]): void {
  const [key, ...rest] = path;
  if (key === undefined) return;
  if (rest.length === 0) {
    delete record[key];
    return;
  }

  const value = record[key];
  if (!isJsonRecord(value)) return;
  const nested: Record<string, JsonValue> = {};
  for (const [nestedKey, nestedValue] of Object.entries(value)) {
    if (nestedValue !== undefined) nested[nestedKey] = nestedValue;
  }
  removeManifestField(nested, rest);
  if (Object.keys(nested).length === 0) {
    delete record[key];
  } else {
    record[key] = nested;
  }
}

async function readNativePluginManifest(targetPath: string): Promise<JsonRecord> {
  const candidate = await nativePluginManifestPath(targetPath);
  if (candidate !== undefined) {
    const parsed = JSON.parse(await readFile(candidate, "utf8")) as unknown;
    if (isJsonRecord(parsed)) return parsed;
    throw new Error(`skillset: expected native plugin manifest ${candidate} to contain a JSON object`);
  }
  return {};
}

async function readNativePluginManifests(
  targetPath: string
): Promise<ReadonlyMap<TargetName, JsonRecord>> {
  const manifests = new Map<TargetName, JsonRecord>();
  for (const target of targetNames()) {
    const candidate = join(targetPath, `.${target}-plugin`, "plugin.json");
    if (!(await exists(candidate))) continue;
    const parsed = JSON.parse(await readFile(candidate, "utf8")) as unknown;
    if (!isJsonRecord(parsed)) {
      throw new Error(`skillset: expected native plugin manifest ${candidate} to contain a JSON object`);
    }
    manifests.set(target, parsed);
  }
  return manifests;
}

async function nativePluginManifestPath(targetPath: string): Promise<string | undefined> {
  for (const target of targetNames()) {
    const candidate = join(targetPath, `.${target}-plugin`, "plugin.json");
    if (await exists(candidate)) return candidate;
  }
  return undefined;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
