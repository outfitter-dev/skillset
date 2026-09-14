import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  classifyNativeHookLiftDiagnostics,
  defineRenderResult,
  normalizeImportedMcpSource,
  parsePortableMcpSource,
  type JsonValue,
  type NativeHookLiftDiagnostic,
  type SkillsetRenderResult,
} from "@skillset/core";
import {
  listProviderPluginComponentManifestFields,
  listProviderSkillFrontmatterFields,
} from "@skillset/registry";

import { seedReleaseBaselines, type ReleaseBaselineEntry } from "./adoption";
import {
  readRecord,
  readSkillsetMetadata,
  readSkillsetName,
  readString,
  targetNames,
} from "@skillset/core/internal/config";
import { compareStrings, resolveInside, validateSlug } from "@skillset/core/internal/path";
import {
  normalizeGeneratedFileMode,
  supportsGeneratedFileModes,
} from "@skillset/core/internal/generated-file-mode";
import { detectWorkspaceSourceDir } from "@skillset/core/internal/resolver";
import {
  selectorForPluginConfig,
  selectorForPluginFeature,
  selectorForPluginSkill,
  selectorForStandaloneSkill,
} from "@skillset/core/internal/source-unit-selector";
import { readAuthorName } from "@skillset/core/internal/source-author";
import type {
  BuildGraph,
  JsonRecord,
  SourceOrigin,
  TargetName,
} from "@skillset/core/internal/types";
import { validateVersionField } from "@skillset/core/internal/versioning";
import {
  stringifyYamlSourceDocument,
  updateMarkdownSourceDocument,
  updateYamlSourceDocument,
} from "@skillset/core/internal/source-document";
import {
  isJsonRecord,
  parseMarkdown,
  parseYamlRecord,
  stringifyJson,
} from "@skillset/core/internal/yaml";

import {
  firstPortablePluginMetadataValue,
  nativeListingMetadataConflicts,
  type NativeListingMetadataConflict,
  type NativeListingMetadataField,
  portablePluginMetadataConflicts,
  PORTABLE_PLUGIN_METADATA_FIELDS,
  unreadableNativeAuthorProviders,
} from "./plugin-manifest-authority";
import type { ImportKind, ImportProvider } from "./source-arg-values";
import { quoteShellArgument } from "./recovery-guidance";

export type { ImportKind, ImportProvider } from "./source-arg-values";

const DEFAULT_SOURCE_DIR = ".skillset";
const PLUGINS_DIR = "plugins";
const SKILLS_DIR = "skills";
const SOURCE_OWNED_PLUGIN_MANIFEST_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "version",
  ...PORTABLE_PLUGIN_METADATA_FIELDS,
]);

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
  readonly mergeTargetNativeSkill?: boolean;
  readonly name?: string;
  readonly provider?: ImportProvider;
  readonly providers?: readonly ImportProvider[];
  readonly rootPath: string;
  readonly sourceDir?: string;
  readonly sourceOrigin?: (sourcePath: string, copiedFile?: string) => SourceOrigin;
  readonly sourcePath: string;
}

export interface ImportSourcesOptions {
  readonly kind?: ImportKind;
  readonly mergeTargetNativeSkill?: boolean;
  readonly name?: string;
  readonly provider?: ImportProvider;
  readonly providers?: readonly ImportProvider[];
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
      imports.push(
        await importSource({
          kind: item.kind,
          ...(options.mergeTargetNativeSkill === true
            ? { mergeTargetNativeSkill: true }
            : {}),
          rootPath: options.rootPath,
          sourcePath: item.sourcePath,
          ...(options.name === undefined ? {} : { name: options.name }),
          ...(options.provider === undefined
            ? {}
            : { provider: options.provider }),
          ...(options.providers === undefined
            ? {}
            : { providers: options.providers }),
          ...(options.sourceDir === undefined
            ? {}
            : { sourceDir: options.sourceDir }),
          ...(options.sourceOrigin === undefined
            ? {}
            : { sourceOrigin: options.sourceOrigin }),
        })
      );
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
    warnings: [
      ...plan.warnings,
      ...imports.flatMap((report) => report.warnings),
    ],
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

  const mayMergeTargetNativeSkill =
    options.kind === "skill" && options.mergeTargetNativeSkill === true;
  if ((await exists(targetPath)) && !mayMergeTargetNativeSkill) {
    throw new Error(
      `skillset: import target already exists: ${targetPath}. ` +
        "Import never overwrites; remove the existing source or import under a different --name."
    );
  }

  const targetParent = dirname(targetPath);
  await mkdir(targetParent, { recursive: true });
  const stagingPath = await mkdtemp(join(targetParent, `.${basename(targetPath)}.tmp-`));
  let committed = false;
  let mergedOriginal: string | undefined;

  try {
    const copied = await copyImportSource({
      kind: options.kind,
      name,
      rootPath: options.rootPath,
      sourcePath,
      targetPath: stagingPath,
    });
    const providers = importProviders(options);
    const copiedFiles =
      options.kind === "plugin"
        ? await rewriteImportedPluginMcp(
            stagingPath,
            copied.files,
            providers
          )
        : copied.files;
    if (options.sourceOrigin !== undefined) {
      await stampImportedOrigins(stagingPath, sourcePath, copiedFiles, options.kind, options.sourceOrigin);
    }
    const frontmatter = await readImportedFrontmatter(stagingPath, options.kind);
    const classification = classifyFrontmatter(frontmatter);
    const scopedInvocationProviders = importedInvocationScopeProviders(providers);
    const pluginSkillFrontmatter = await readImportedPluginSkillFrontmatter(
      stagingPath,
      options.kind,
      copiedFiles
    );
    await scopeImportedInvocationFrontmatter(
      stagingPath,
      options.kind,
      scopedInvocationProviders,
      frontmatter,
      pluginSkillFrontmatter
    );

    if (await exists(targetPath)) {
      if (!mayMergeTargetNativeSkill) {
        throw new Error(
          `skillset: import target already exists: ${targetPath}. ` +
            "Import never overwrites; remove the existing source or import under a different --name."
        );
      }
      mergedOriginal = await mergeImportedProviderSkill(targetPath, stagingPath);
      await rm(stagingPath, { force: true, recursive: true });
    } else {
      await rename(stagingPath, targetPath);
    }
    committed = true;
    let baselineReport: { readonly entries: readonly ReleaseBaselineEntry[]; readonly path?: string };
    try {
      baselineReport = await seedImportedBaselines(options.rootPath, {
        ...(copied.baselineVersion === undefined
          ? {}
          : { baselineVersion: copied.baselineVersion }),
        kind: options.kind,
        name,
        sourceDir,
      });
    } catch (error) {
      if (mergedOriginal === undefined) {
        await rm(targetPath, { force: true, recursive: true });
      } else {
        await writeFile(join(targetPath, "SKILL.md"), mergedOriginal);
      }
      throw error;
    }

    const renderResults = await importRenderResults({
      classification,
      copiedFiles,
      kind: options.kind,
      name,
      pluginSkillFrontmatter,
      ...(options.provider === undefined ? {} : { provider: options.provider }),
      ...(options.providers === undefined ? {} : { providers: options.providers }),
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
      nextChecks: importChecksAtRoot(options.rootPath),
      preservedTargetNativeFields: classification.targetNative,
      sourcePath,
      targetPath,
      unsupportedFields: classification.unsupported,
      warnings: [
        ...importWarnings(classification, scopedInvocationProviders),
        ...pluginSkillFrontmatter.flatMap((skill) =>
          importWarnings(skill.classification, scopedInvocationProviders)
        ),
        ...copied.warnings,
      ],
    };
  } finally {
    if (!committed) {
      await rm(stagingPath, { force: true, recursive: true });
    }
  }
}

function importChecksAtRoot(rootPath: string): readonly string[] {
  const rootArgument = quoteShellArgument(rootPath);
  return [
    `skillset build --root ${rootArgument}`,
    `skillset build --yes --root ${rootArgument}`,
    `skillset check --root ${rootArgument}`,
  ];
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
    readonly baselineVersion?: string;
    readonly kind: SingularImportKind;
    readonly name: string;
    readonly sourceDir: string;
  }
): Promise<{ readonly entries: readonly ReleaseBaselineEntry[]; readonly path?: string }> {
  const includeScope = (scope: string): boolean => {
    if (options.kind === "skill") return scope === `skill:${options.name}`;
    return scope === `plugin:${options.name}` || scope.startsWith(`plugin.${options.name}.`);
  };
  let importedVersion:
    | ((scope: string, graph: BuildGraph) => string | undefined)
    | undefined;
  if (
    options.kind === "plugin" &&
    options.baselineVersion !== undefined
  ) {
    importedVersion = (scope, graph) => {
      const plugin = graph.plugins.find((item) => item.id === options.name);
      const skill = plugin?.skills.find(
        (item) =>
          selectorForPluginSkill(options.name, item.id) === scope
      );
      return (
        (skill === undefined
          ? undefined
          : readString(skill.frontmatter, "version")) ??
        options.baselineVersion
      );
    };
  }
  const report = await seedReleaseBaselines(
    rootPath,
    { sourceDir: options.sourceDir },
    {
      includeScope,
      ...(importedVersion === undefined
        ? {}
        : { sourceVersion: importedVersion }),
      write: true,
    }
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

interface ImportedPluginSkillFrontmatter {
  readonly classification: FrontmatterClassification;
  readonly id: string;
  readonly path: string;
  readonly frontmatter: JsonRecord;
}

function classifyFrontmatter(
  frontmatter: JsonRecord
): FrontmatterClassification {
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

function importWarnings(
  classification: FrontmatterClassification,
  scopedInvocationProviders: readonly TargetName[]
): readonly string[] {
  const warnings: string[] = [];
  const scopedCursorFields =
    scopedInvocationProviders.length > 0 &&
    classification.targetNative.includes("disable-model-invocation")
      ? ["disable-model-invocation"]
      : [];
  const verbatimFields = classification.targetNative.filter(
    (field) => !scopedCursorFields.includes(field)
  );
  if (scopedCursorFields.length > 0) {
    const locations = scopedInvocationProviders
      .map((provider) => `${provider}.frontmatter`)
      .join(", ");
    warnings.push(
      `preserved target-native fields under ${locations}: ${scopedCursorFields.join(", ")}.`
    );
  }
  if (verbatimFields.length > 0) {
    warnings.push(
      `preserved target-native fields verbatim: ${verbatimFields.join(", ")}. ` +
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
  readonly pluginSkillFrontmatter: readonly ImportedPluginSkillFrontmatter[];
  readonly provider?: ImportProvider;
  readonly providers?: readonly ImportProvider[];
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
  readonly pluginSkillFrontmatter: readonly ImportedPluginSkillFrontmatter[];
  readonly provider?: ImportProvider;
  readonly providers?: readonly ImportProvider[];
  readonly rootPath: string;
  readonly targetPath: string;
}): readonly SkillsetRenderResult[] {
  const providers = importFrontmatterProviders(args.provider, args.providers);
  if (providers.length === 0) return [];
  const scopedProviders = importedInvocationScopeProviders(
    args.providers ??
      (args.provider === undefined ? undefined : [args.provider])
  );
  const sourcePath = importSourcePath(
    args.rootPath,
    args.targetPath,
    args.kind
  );
  return [
    ...providers.flatMap((provider) =>
      frontmatterPolicyRenderResults({
        classification: args.classification,
        provider,
        scoped: args.kind === "skill" && scopedProviders.includes(provider),
        sourcePath,
        sourceUnit:
          args.kind === "skill"
            ? selectorForStandaloneSkill(args.name)
            : selectorForPluginConfig(args.name),
      })
    ),
    ...(args.provider === undefined && args.providers === undefined
      ? []
      : providers.flatMap((provider) =>
          args.pluginSkillFrontmatter.flatMap((skill) =>
            frontmatterPolicyRenderResults({
              classification: skill.classification,
              provider,
              scoped: scopedProviders.includes(provider),
              sourcePath: relative(
                args.rootPath,
                join(args.targetPath, skill.path)
              ).replaceAll("\\", "/"),
              sourceUnit: selectorForPluginSkill(args.name, skill.id),
            })
          )
        )),
  ];
}

function frontmatterPolicyRenderResults(args: {
  readonly classification: FrontmatterClassification;
  readonly provider: TargetName;
  readonly scoped: boolean;
  readonly sourcePath: string;
  readonly sourceUnit: string;
}): readonly SkillsetRenderResult[] {
  const policies = [
    ...(args.provider === "claude"
      ? [
          {
            featureId: "tools-policy",
            fields: args.classification.targetNative.filter(
              isClaudeToolPolicyField
            ),
          },
        ]
      : []),
    {
      featureId: "skill-invocation-policy",
      fields: providerSupportsNativeInvocationFrontmatter(args.provider)
        ? args.classification.targetNative.filter(
            (field) => field === "disable-model-invocation"
          )
        : [],
    },
  ].filter((policy) => policy.fields.length > 0);
  if (policies.length === 0) return [];
  return policies.map((policy) =>
    defineRenderResult({
      destination: "skill-frontmatter",
      diagnostics: [
        {
          code: "import-preserved-target-native-frontmatter",
          message: args.scoped
            ? `preserved target-native fields under ${args.provider}.frontmatter: ${policy.fields.join(", ")}`
            : `preserved target-native fields verbatim: ${policy.fields.join(", ")}`,
          path: args.sourcePath,
        },
      ],
      featureId: policy.featureId,
      outputs: [{ kind: "imported-source", path: args.sourcePath }],
      sourcePath: args.sourcePath,
      sourceUnit: args.sourceUnit,
      status: "target_native",
      target: args.provider,
    })
  );
}

function importFrontmatterProviders(
  provider: ImportProvider | undefined,
  providers: readonly ImportProvider[] | undefined
): readonly TargetName[] {
  const candidates = providers ?? (provider === undefined ? ["claude"] : [provider]);
  return targetNames().filter((target) => candidates.includes(target));
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
  return field === "allowed-tools" || field === "disallowed-tools";
}

async function scopeImportedInvocationFrontmatter(
  targetPath: string,
  kind: SingularImportKind,
  providers: readonly TargetName[],
  frontmatter: JsonRecord,
  pluginSkillFrontmatter: readonly ImportedPluginSkillFrontmatter[]
): Promise<void> {
  if (providers.length === 0) return;
  if (kind === "skill") {
    await scopeSkillInvocationFrontmatter(
      join(targetPath, "SKILL.md"),
      frontmatter,
      providers
    );
    return;
  }
  for (const skill of pluginSkillFrontmatter) {
    await scopeSkillInvocationFrontmatter(
      join(targetPath, skill.path),
      skill.frontmatter,
      providers
    );
  }
}

async function scopeSkillInvocationFrontmatter(
  skillPath: string,
  frontmatter: JsonRecord,
  providers: readonly TargetName[]
): Promise<void> {
  const nativeValue = frontmatter["disable-model-invocation"];
  if (nativeValue === undefined) return;
  const source = await readFile(skillPath, "utf8");
  await writeFile(
    skillPath,
    updateMarkdownSourceDocument(source, skillPath, (parts) => {
      const { "disable-model-invocation": _nativeInvocation, ...portable } =
        parts.frontmatter;
      const scoped = Object.fromEntries(
        providers.map((provider) => {
          const target = readRecord(parts.frontmatter, provider) ?? {};
          const targetFrontmatter = readRecord(target, "frontmatter") ?? {};
          return [
            provider,
            {
              ...target,
              frontmatter: {
                ...targetFrontmatter,
                "disable-model-invocation": nativeValue,
              },
            },
          ];
        })
      );
      return {
        ...parts,
        frontmatter: {
          ...portable,
          ...scoped,
        },
      };
    })
  );
}

async function mergeImportedProviderSkill(
  targetPath: string,
  stagingPath: string
): Promise<string> {
  await assertMatchingImportedSkillResources(targetPath, stagingPath);
  const targetSkillPath = join(targetPath, "SKILL.md");
  const stagedSkillPath = join(stagingPath, "SKILL.md");
  const targetSource = await readFile(targetSkillPath, "utf8");
  const stagedSource = await readFile(stagedSkillPath, "utf8");
  const targetParts = parseMarkdown(targetSource, targetSkillPath);
  const stagedParts = parseMarkdown(stagedSource, stagedSkillPath);
  if (
    targetParts.body !== stagedParts.body ||
    !isDeepStrictEqual(
      portableImportedSkillFrontmatter(targetParts.frontmatter),
      portableImportedSkillFrontmatter(stagedParts.frontmatter)
    )
  ) {
    throw importedSkillMergeConflict(targetPath);
  }

  const stagedTargets = targetNames().flatMap((target) => {
    const staged = stagedParts.frontmatter[target];
    if (staged === undefined) return [];
    const current = targetParts.frontmatter[target];
    if (current !== undefined && !isDeepStrictEqual(current, staged)) {
      throw importedSkillMergeConflict(targetPath);
    }
    return [[target, staged] as const];
  });
  await writeFile(
    targetSkillPath,
    updateMarkdownSourceDocument(targetSource, targetSkillPath, (parts) => ({
      ...parts,
      frontmatter: {
        ...parts.frontmatter,
        ...Object.fromEntries(stagedTargets),
      },
    }))
  );
  return targetSource;
}

function portableImportedSkillFrontmatter(frontmatter: JsonRecord): JsonRecord {
  const targetKeys = new Set<string>(targetNames());
  return Object.fromEntries(
    Object.entries(frontmatter).filter(
      ([key]) => key !== "skillset" && !targetKeys.has(key)
    )
  );
}

async function assertMatchingImportedSkillResources(
  targetPath: string,
  stagingPath: string
): Promise<void> {
  const targetFiles = (await collectFiles(targetPath))
    .map((path) => relative(targetPath, path).replaceAll("\\", "/"))
    .filter((path) => path !== "SKILL.md");
  const stagedFiles = (await collectFiles(stagingPath))
    .map((path) => relative(stagingPath, path).replaceAll("\\", "/"))
    .filter((path) => path !== "SKILL.md");
  if (!isDeepStrictEqual(targetFiles, stagedFiles)) {
    throw importedSkillMergeConflict(targetPath);
  }
  for (const path of targetFiles) {
    const targetFile = join(targetPath, path);
    const stagedFile = join(stagingPath, path);
    const [targetContent, stagedContent, targetStat, stagedStat] =
      await Promise.all([
        readFile(targetFile),
        readFile(stagedFile),
        stat(targetFile),
        stat(stagedFile),
      ]);
    if (
      !targetContent.equals(stagedContent) ||
      normalizeGeneratedFileMode(targetStat.mode) !==
        normalizeGeneratedFileMode(stagedStat.mode)
    ) {
      throw importedSkillMergeConflict(targetPath);
    }
  }
}

function importedSkillMergeConflict(targetPath: string): Error {
  return new Error(
    `skillset: import target already exists: ${targetPath}. ` +
      "Provider-native adoption merge requires matching portable skill content and resources."
  );
}

function importProviders(options: ImportOptions): readonly ImportProvider[] | undefined {
  if (options.providers !== undefined) return options.providers;
  if (options.provider !== undefined) return [options.provider];
  return undefined;
}

function importedInvocationScopeProviders(
  providers: readonly ImportProvider[] | undefined
): readonly TargetName[] {
  if (providers === undefined) return [];
  return targetNames().filter(
    (target) =>
      providers.includes(target) && providerSupportsNativeInvocationFrontmatter(target)
  );
}

function providerSupportsNativeInvocationFrontmatter(provider: TargetName): boolean {
  return listProviderSkillFrontmatterFields(provider).includes(
    "disable-model-invocation"
  );
}

async function readImportedPluginSkillFrontmatter(
  targetPath: string,
  kind: SingularImportKind,
  copiedFiles: readonly string[]
): Promise<readonly ImportedPluginSkillFrontmatter[]> {
  if (kind !== "plugin") return [];
  const skills: ImportedPluginSkillFrontmatter[] = [];
  for (const copiedFile of copiedFiles) {
    const path = normalizeCopiedImportPath(copiedFile);
    const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(path);
    if (match?.[1] === undefined) continue;
    const frontmatter = parseMarkdown(
      await readFile(join(targetPath, path), "utf8"),
      join(targetPath, path)
    ).frontmatter;
    skills.push({
      classification: classifyFrontmatter(frontmatter),
      frontmatter,
      id: match[1],
      path,
    });
  }
  return skills;
}

function importSourcePath(
  rootPath: string,
  targetPath: string,
  kind: SingularImportKind
): string {
  const path =
    kind === "skill"
      ? join(targetPath, "SKILL.md")
      : join(targetPath, "skillset.yaml");
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
}): Promise<{
  readonly baselineVersion?: string;
  readonly files: readonly string[];
  readonly warnings: readonly string[];
}> {
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
  let baselineVersion: string | undefined;
  let warnings: readonly string[] = [];
  const exclude = rootPluginImport ? (path: string) => isRootPluginImportScaffold(copyRoot, path) : undefined;
  for (const file of await collectFiles(copyRoot, exclude)) {
    const relativePath = relativeImportPath(copyRoot, file, kind);
    const destination = join(targetPath, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(file));
    if (supportsGeneratedFileModes()) {
      await chmod(destination, normalizeGeneratedFileMode((await stat(file)).mode));
    }
    copied.push(relativePath);
  }

  if (kind === "plugin" && !(await exists(join(targetPath, "skillset.yaml")))) {
    const importedConfig = await writeImportedPluginConfig(targetPath, name);
    baselineVersion = importedConfig.baselineVersion;
    warnings = importedConfig.warnings;
    copied.push("skillset.yaml");
  }

  return {
    ...(baselineVersion === undefined ? {} : { baselineVersion }),
    files: copied.sort(compareStrings),
    warnings,
  };
}

async function rewriteImportedPluginMcp(
  targetPath: string,
  copiedFiles: readonly string[],
  providers: readonly ImportProvider[] | undefined
): Promise<readonly string[]> {
  const hiddenPath = join(targetPath, ".mcp.json");
  const visiblePath = join(targetPath, "mcp.json");
  const hasHidden = await exists(hiddenPath);
  const hasVisible = await exists(visiblePath);
  const manifestSource = await importedManifestMcpSource(
    targetPath,
    providers
  );
  if (manifestSource === undefined && !hasHidden && !hasVisible) {
    return copiedFiles;
  }
  if (manifestSource === undefined && hasHidden && hasVisible) {
    throw new Error(
      "skillset: imported plugin contains both .mcp.json and mcp.json; choose one authoritative MCP source before importing"
    );
  }

  const availableSources = [
    ...(hasHidden ? [hiddenPath] : []),
    ...(hasVisible ? [visiblePath] : []),
    ...(manifestSource === undefined ? [] : [manifestSource]),
  ];
  const distinctSources = [...new Set(availableSources)];
  if (distinctSources.length > 1) {
    throw new Error(
      `skillset: imported plugin contains multiple MCP sources: ${distinctSources.join(", ")}; choose one authoritative source before importing`
    );
  }

  const sourcePath = manifestSource ?? (hasHidden ? hiddenPath : visiblePath);
  if (!(await exists(sourcePath))) {
    throw new Error(
      `skillset: imported plugin manifest references missing MCP source ${sourcePath}`
    );
  }
  const dialect = await importedMcpDialect(
    targetPath,
    basename(sourcePath),
    providers
  );
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(await readFile(sourcePath, "utf8")) as JsonValue;
  } catch (error) {
    throw new Error(
      `skillset: imported MCP source ${sourcePath} is not valid JSON: ${errorMessage(error)}`
    );
  }
  const normalized = normalizeImportedMcpSource(parsed, dialect);
  await writeFile(hiddenPath, stringifyJson(normalized));
  if (sourcePath !== hiddenPath) await rm(sourcePath);
  await parsePortableMcpSource({
    pluginRoot: targetPath,
    sourcePath: hiddenPath,
  });

  return [
    ...copiedFiles.filter(
      (file) =>
        normalizeCopiedImportPath(file) !==
          normalizeCopiedImportPath(relative(targetPath, sourcePath)) &&
        normalizeCopiedImportPath(file) !== ".mcp.json" &&
        normalizeCopiedImportPath(file) !== "mcp.json"
    ),
    ".mcp.json",
  ].sort(compareStrings);
}

async function importedManifestMcpSource(
  targetPath: string,
  providers: readonly ImportProvider[] | undefined
): Promise<string | undefined> {
  const manifests = await readNativePluginManifests(targetPath);
  const explicitTargets = targetNames().filter((target) =>
    providers?.includes(target)
  );
  const relevantManifests =
    explicitTargets.length === 0
      ? [...manifests.entries()]
      : explicitTargets.flatMap((target) => {
          const manifest = manifests.get(target);
          return manifest === undefined ? [] : ([[target, manifest]] as const);
        });
  const references = relevantManifests.flatMap(([provider, manifest]) => {
    const value = manifest.mcpServers;
    if (value === undefined) return [];
    if (typeof value !== "string" || !value.startsWith("./")) {
      throw new Error(
        `skillset: imported ${provider} manifest mcpServers must be one local ./ path; inline, remote, and array references cannot be mapped to one portable MCP source`
      );
    }
    return [value];
  });
  const uniqueReferences = [...new Set(references)];
  if (uniqueReferences.length === 0) return undefined;
  if (uniqueReferences.length > 1) {
    throw new Error(
      `skillset: imported native plugin manifests disagree on MCP source: ${uniqueReferences.join(", ")}`
    );
  }
  const [reference] = uniqueReferences;
  if (reference === undefined) return undefined;
  return resolveInside(targetPath, reference.slice(2));
}

async function importedMcpDialect(
  targetPath: string,
  sourceName: string,
  providers: readonly ImportProvider[] | undefined
): Promise<TargetName | "agent-plugins"> {
  if (providers?.includes("agents")) return "agent-plugins";
  if (providers?.includes("skillset")) return "agent-plugins";
  const explicitTargets = targetNames().filter((target) =>
    providers?.includes(target)
  );
  if (explicitTargets.length === 1) return explicitTargets[0] as TargetName;
  if (explicitTargets.length > 1) return "agent-plugins";

  const detected: TargetName[] = [];
  for (const target of targetNames()) {
    if (await exists(join(targetPath, `.${target}-plugin`, "plugin.json"))) {
      detected.push(target);
    }
  }
  if (detected.length === 1) return detected[0] as TargetName;
  if (detected.length > 1) return "agent-plugins";
  if (sourceName === ".mcp.json") return "agent-plugins";

  const standardManifest = join(targetPath, "plugin.json");
  if (await exists(standardManifest)) {
    const parsed = JSON.parse(await readFile(standardManifest, "utf8")) as JsonValue;
    if (
      isJsonRecord(parsed) &&
      parsed.$schema ===
        "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
    ) {
      return "agent-plugins";
    }
  }
  throw new Error(
    "skillset: mcp.json import is ambiguous between Cursor and Agent Plugins; pass --from cursor or --from agents"
  );
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
  const source = await readFile(path, "utf8");
  await writeFile(
    path,
    updateYamlSourceDocument(source, path, (config) => withSkillsetOrigin(config, origin))
  );
}

async function writeMarkdownSourceOrigin(path: string, origin: SourceOrigin): Promise<void> {
  const source = await readFile(path, "utf8");
  await writeFile(
    path,
    updateMarkdownSourceDocument(source, path, (parts) => ({
      ...parts,
      frontmatter: withSkillsetOrigin(parts.frontmatter, origin),
    }))
  );
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
): Promise<{
  readonly baselineVersion?: string;
  readonly warnings: readonly string[];
}> {
  const nativeManifests = await readNativePluginManifests(targetPath);
  // `author` is source-owned, so it is stripped from provider overrides. A
  // value Skillset cannot read has no canonical form to lift and no override to
  // fall back to, and another provider's readable author would quietly stand in
  // for it. Migration surfaces the ambiguity here instead of dropping it.
  const unreadableAuthors = unreadableNativeAuthorProviders(nativeManifests);
  if (unreadableAuthors.length > 0) {
    throw new Error(
      `skillset: native plugin manifests declare an unreadable author: ${unreadableAuthors.join(", ")}; author must be a non-empty string or an object with a non-empty name`
    );
  }
  const metadataConflicts = portablePluginMetadataConflicts(nativeManifests);
  if (metadataConflicts.length > 0) {
    throw new Error(
      `skillset: native plugin manifests disagree on portable metadata: ${metadataConflicts.map((conflict) => conflict.field).join(", ")}`
    );
  }
  const listingConflicts = nativeListingMetadataConflicts(nativeManifests);
  const firstMetadataValue = (field: (typeof PORTABLE_PLUGIN_METADATA_FIELDS)[number]) =>
    firstPortablePluginMetadataValue(nativeManifests, field);
  const nativeVersions = [...nativeManifests.entries()].map(
    ([provider, manifest]) => ({
      provider,
      value: readString(manifest, "version"),
    })
  );
  if (
    new Set(nativeVersions.map((entry) => entry.value ?? "<missing>")).size > 1
  ) {
    throw new Error(
      `skillset: native plugin manifests disagree on version: ${nativeVersions
        .map((entry) => `${entry.provider}=${entry.value ?? "missing"}`)
        .join(", ")}`
    );
  }
  const version = nativeVersions.find((entry) => entry.value !== undefined)
    ?.value;
  if (version !== undefined) {
    validateVersionField(
      { version },
      "native plugin manifest version"
    );
  }
  const manifestAuthor = firstMetadataValue("author");
  const codexDeveloperName = readString(
    readRecord(nativeManifests.get("codex") ?? {}, "interface") ?? {},
    "developerName"
  );
  const canonicalAuthor = manifestAuthor ?? codexDeveloperName;
  const canonicalAuthorName = readAuthorName(canonicalAuthor);
  const developerNameConflict =
    codexDeveloperName !== undefined &&
    canonicalAuthorName !== undefined &&
    codexDeveloperName !== canonicalAuthorName;
  // Lift every manifest field the generated projection round-trips. The
  // discovered version is migration input for release-state seeding, not a
  // second authority in newly synthesized source.
  const listing = importedListing(nativeManifests, listingConflicts);
  const description = firstMetadataValue("description");
  const canonicalManifestDescription =
    readString(listing ?? {}, "summary") ??
    readString(listing ?? {}, "description") ??
    (typeof description === "string" ? description : undefined) ??
    name;
  const metadata: JsonRecord = {
    name,
    description,
    listing,
    author: canonicalAuthor,
    homepage: firstMetadataValue("homepage"),
    repository: firstMetadataValue("repository"),
    license: firstMetadataValue("license"),
    keywords: firstMetadataValue("keywords"),
  };
  const providerOverrides = Object.fromEntries(
    [...nativeManifests.entries()].flatMap(([provider, manifest]) => {
      const override = importedManifestOverride(
        provider,
        manifest,
        listingConflicts,
        canonicalManifestDescription
      );
      const providerConfig: Record<string, JsonValue> = {};
      if (Object.keys(override).length > 0) providerConfig.manifest = override;
      if (provider === "codex") {
        const interfaceOverride = importedCodexInterfaceOverride(
          manifest,
          listingConflicts,
          canonicalAuthorName
        );
        if (Object.keys(interfaceOverride).length > 0) {
          providerConfig.interface = interfaceOverride;
        }
      }
      return Object.keys(providerConfig).length === 0
        ? []
        : [[provider, providerConfig]];
    })
  );
  const cursorNativeDiscoveryFields = ["category", "tags"].filter(
    (field) => nativeManifests.get("cursor")?.[field] !== undefined
  );
  await writeFile(
    join(targetPath, "skillset.yaml"),
    stringifyYamlSourceDocument({
      skillset: metadata,
      ...providerOverrides,
    })
  );
  return {
    ...(version === undefined ? {} : { baselineVersion: version }),
    warnings: [
      ...(cursorNativeDiscoveryFields.length === 0
        ? []
        : [
            `import-preserved-cursor-native-discovery: preserved Cursor manifest fields ${cursorNativeDiscoveryFields.join(", ")} under cursor.manifest; Skillset does not infer portable listing meaning or project them to other providers.`,
          ]),
      ...listingConflicts.map(
        (conflict) =>
          `Native ${conflict.field} differs across ${conflict.providers.join(", ")}; Skillset preserved provider-specific values instead of choosing a canonical listing value.`
    ),
      ...(developerNameConflict
        ? [
            `Native Codex interface.developerName differs from canonical author.name; Skillset preserved the Codex-specific value instead of choosing a canonical author.`,
          ]
        : []),
    ],
  };
}

function importedManifestOverride(
  provider: TargetName,
  manifest: JsonRecord,
  listingConflicts: readonly NativeListingMetadataConflict[],
  canonicalManifestDescription: string
): JsonRecord {
  const override: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (!SOURCE_OWNED_PLUGIN_MANIFEST_FIELDS.has(key) && value !== undefined) {
      override[key] = value;
    }
  }
  for (const field of listProviderPluginComponentManifestFields(provider)) {
    removeManifestField(override, field.split("."));
  }
  if (provider === "codex") delete override.interface;
  if (provider === "cursor") {
    if (!hasListingConflict(listingConflicts, "listing.display_name"))
      delete override.displayName;
    if (!hasListingConflict(listingConflicts, "listing.logo"))
      delete override.logo;
  }
  if (
    provider === "claude" &&
    !hasListingConflict(listingConflicts, "listing.display_name")
  ) {
    delete override.displayName;
  }
  const nativeDescription = readString(manifest, "description");
  if (
    nativeDescription !== undefined &&
    nativeDescription !== canonicalManifestDescription
  ) {
    override.description = nativeDescription;
  }
  return override;
}

const LIFTED_CODEX_INTERFACE_FIELDS: ReadonlySet<string> = new Set([
  "brandColor",
  "capabilities",
  "category",
  "composerIcon",
  "defaultPrompt",
  "displayName",
  "logo",
  "longDescription",
  "privacyPolicyURL",
  "screenshots",
  "shortDescription",
  "termsOfServiceURL",
  "websiteURL",
]);

function importedCodexInterfaceOverride(
  manifest: JsonRecord,
  listingConflicts: readonly NativeListingMetadataConflict[],
  canonicalAuthorName: string | undefined
): JsonRecord {
  const nativeInterface = readRecord(manifest, "interface") ?? {};
  return Object.fromEntries(
    Object.entries(nativeInterface).filter(
      ([field, value]) =>
        !(
          field === "developerName" &&
          typeof value === "string" &&
          value === canonicalAuthorName
        ) &&
        (shouldKeepCodexInterfaceField(field, listingConflicts) ||
          !LIFTED_CODEX_INTERFACE_FIELDS.has(field)) &&
        value !== undefined
    )
  );
}

function shouldKeepCodexInterfaceField(
  field: string,
  conflicts: readonly NativeListingMetadataConflict[]
): boolean {
  if (field === "category")
    return hasListingConflict(conflicts, "listing.category");
  if (field === "displayName")
    return hasListingConflict(conflicts, "listing.display_name");
  if (field === "logo")
    return hasListingConflict(conflicts, "listing.logo");
  return false;
}

function importedListing(
  manifests: ReadonlyMap<TargetName, JsonRecord>,
  conflicts: readonly NativeListingMetadataConflict[]
): JsonRecord | undefined {
  const codexInterface = readRecord(manifests.get("codex") ?? {}, "interface");
  const claudeManifest = manifests.get("claude");
  const cursorManifest = manifests.get("cursor");
  const listing: JsonRecord = {
    display_name:
      hasListingConflict(conflicts, "listing.display_name")
        ? undefined
        : readString(codexInterface ?? {}, "displayName") ??
          readString(claudeManifest ?? {}, "displayName") ??
          readString(cursorManifest ?? {}, "displayName"),
    summary: readString(codexInterface ?? {}, "shortDescription"),
    description: readString(codexInterface ?? {}, "longDescription"),
    category:
      hasListingConflict(conflicts, "listing.category")
        ? undefined
        : readString(codexInterface ?? {}, "category"),
    capabilities: copyJsonStringArray(
      (codexInterface ?? {}).capabilities
    ),
    color: readString(codexInterface ?? {}, "brandColor"),
    website_url: readString(codexInterface ?? {}, "websiteURL"),
    privacy_policy_url: readString(
      codexInterface ?? {},
      "privacyPolicyURL"
    ),
    terms_of_service_url: readString(
      codexInterface ?? {},
      "termsOfServiceURL"
    ),
    default_prompt: copyJsonStringArray(
      (codexInterface ?? {}).defaultPrompt
    ),
    composer_icon: readString(codexInterface ?? {}, "composerIcon"),
    logo:
      hasListingConflict(conflicts, "listing.logo")
        ? undefined
        : readString(codexInterface ?? {}, "logo") ??
          readString(cursorManifest ?? {}, "logo"),
    screenshots: copyJsonStringArray(
      (codexInterface ?? {}).screenshots
    ),
    keywords: copyJsonStringArray(
      firstPortablePluginMetadataValue(manifests, "keywords")
    ),
  };
  return Object.values(listing).some((value) => value !== undefined)
    ? listing
    : undefined;
}

function hasListingConflict(
  conflicts: readonly NativeListingMetadataConflict[],
  field: NativeListingMetadataField
): boolean {
  return conflicts.some((conflict) => conflict.field === field);
}

function copyJsonStringArray(value: JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return undefined;
  }
  return [...value];
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
