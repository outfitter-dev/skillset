import { captureMcpDependencyCandidates, type McpDependencySource } from "@skillset/core/internal/adoption-mcp-dependencies";
import { normalizeNativePluginLicense } from "./import-native-license";
import { incompatibleAgentSkillsMetadataKeys } from "@skillset/core/internal/agent-skills-metadata";
import { captureManifestIdentityCandidates, type ManifestIdentityCandidate } from "@skillset/core/internal/import-manifest-roundtrip";
import { assessImportedFrontmatter, assessImportedHookRuntime, assessImportedNormalizations } from "@skillset/core/internal/import-capability-assessment";
import { normalizeImportedAgentPluginPackage, agentPluginUnitObservation } from "./import-agent-plugin-units";
import { importedListing, hasListingConflict } from "./import-plugin-listing";
import { manifestIdentityObservations, manifestNormalizationObservations } from "./import-manifest-observations";
import { recordMcpNormalizations } from "@skillset/core/internal/import-normalization-evidence";
import { chmod, cp, lstat, mkdtemp, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  defineRenderResult,
  normalizeImportedMcpSource,
  parsePortableMcpSource,
  type JsonValue,
  type SkillsetRenderResult,
} from "@skillset/core";
import {
  renameDirectoryNoReplace,
  type DirectoryRenameNoReplaceResult,
} from "@skillset/core/internal/directory-rename-no-replace";
import { listProviderPluginComponentManifestFields, listProviderSkillFrontmatterFields, SKILL_FILE } from "@skillset/registry";

import { AGENT_SKILLS_FRONTMATTER_KEYS } from "@skillset/core/internal/render-agent-skills-standard";
import { recordImportedFindings } from "@skillset/core/internal/adoption-findings";
import { COMMON_FRONTMATTER_KEYS, type ImportNormalization, type ImportCapabilityAssessment, type MigrationFlag } from "@skillset/schema";
import { importedFrontmatterFindings, type FrontmatterFindingSource } from "@skillset/core/internal/adoption-frontmatter-findings";
import { scopeImportedSkillFrontmatter } from "@skillset/core/internal/import-skill-frontmatter";
import { scopeImportedNativeHooks, type ImportedNativeHookBoundary } from "@skillset/core/internal/import-native-hook-boundary";
import { classifyNativeHookSource, type NativeHookFindingSource, type NativeHookSourceDiagnostic } from "@skillset/core/internal/adoption-native-findings";
import { seedReleaseBaselines, type ReleaseBaselineEntry } from "./adoption";
import {
  readRecord,
  readSkillsetMetadata,
  readSkillsetName,
  readString,
  targetNames,
} from "@skillset/core/internal/config";
import { compareStrings, isPathInside, resolveInside, validateSlug } from "@skillset/core/internal/path";
import { prepareRepositoryMutationPath } from "@skillset/core/internal/repository-mutation";
import {
  normalizeGeneratedFileMode,
  supportsGeneratedFileModes,
} from "@skillset/core/internal/generated-file-mode";
import { detectWorkspaceSourceDir, findSkillFiles } from "@skillset/core/internal/resolver";
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
  firstPortablePluginMetadataSource,
  resolveNativeAuthor,
  nativeListingMetadataConflicts,
  type NativeListingMetadataConflict,
  portablePluginMetadataConflicts,
  PORTABLE_PLUGIN_METADATA_FIELDS,
  cursorKeywordBoundary,
  unreadableNativeAuthorProviders,
} from "./plugin-manifest-authority";
import { CliUsageError } from "./cli-output";
import type { ImportKind, ImportProvider } from "./source-arg-values";
import { quoteShellArgument } from "./recovery-guidance";
import {
  agentPluginIdentityWarnings,
  agentPluginSourceMetadata,
  hasAgentPluginManifest,
  inspectAgentPluginImport,
  type AgentPluginImportInspection,
} from "./agent-plugin-import";

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
  ...AGENT_SKILLS_FRONTMATTER_KEYS.filter((field) => field !== "allowed-tools"),
  // These are explicit typed source/provider boundaries, including origin
  // metadata stamped by import; bare Skillset vocabulary needs provenance.
  "skillset",
  ...targetNames(),
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
  "context",
  "arguments",
  "model",
  "user-facing-name",
  "user-invocable",
]);

/** Test-only hooks that observe or substitute the import directory claim. */
export interface ImportTestHooks {
  readonly afterBaselineSeed?: () => Promise<void>;
  readonly beforeFindings?: () => Promise<void>;
  /** Fires after the import commits, before release baselines are seeded. */
  readonly beforeBaselineSeed?: () => Promise<void>;
  readonly beforeClaim?: () => Promise<void>;
  readonly renameDirectory?: (
    sourcePath: string,
    destinationPath: string
  ) => DirectoryRenameNoReplaceResult;
}

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
  readonly testHooks?: ImportTestHooks;
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
  /** Ephemeral field fingerprints for adoption; excluded from persisted receipts. */
  readonly manifestIdentityCandidates?: readonly ManifestIdentityCandidate[];
  readonly capabilityAssessments?: readonly ImportCapabilityAssessment[];
  readonly normalizations?: readonly ImportNormalization[];
  readonly migrationFlags?: readonly MigrationFlag[];
  readonly migrationWritePaths?: readonly string[];
  /** Observations from this import; repository adoption persists them in its ledger. */
  readonly frontmatterFindings?: readonly MigrationFlag[];
  readonly frontmatterSources?: readonly FrontmatterFindingSource[];
  readonly mcpDependencySources?: readonly McpDependencySource[];
  readonly nativeHookSources?: readonly NativeHookFindingSource[];
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
  readonly capabilityAssessments?: readonly ImportCapabilityAssessment[];
  readonly normalizations?: readonly ImportNormalization[];
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
      throw new ImportBatchError(errorMessage(error), [...imports, ...(error instanceof ImportBatchError ? error.imports : [])]);
    }
  }

  return {
    normalizations: imports.flatMap((report) => report.normalizations ?? []),
    capabilityAssessments: imports.flatMap((report) => report.capabilityAssessments ?? []),
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

export interface PreparedImportSource {
  readonly sourcePath: string;
  readonly targetPath: string;
  /** Private normalized snapshot; callers must dispose it after use. */
  readonly stagingPath: string;
  /** Claims these prepared bytes once. Multi-input planners must revalidate their inputs separately. */
  commit(): Promise<ImportReport>;
  dispose(): Promise<void>;
}

export async function importSource(options: ImportOptions): Promise<ImportReport> {
  const prepared = await prepareImportSource(options);
  try {
    return await prepared.commit();
  } finally {
    await prepared.dispose();
  }
}

/** Normalize in private storage without creating workspace source or release state. */
export async function prepareImportSource(options: ImportOptions): Promise<PreparedImportSource> {
  const sourcePath = resolve(options.sourcePath);
  const sourceDir = await resolveImportSourceDir(options.rootPath, options.sourceDir);
  const sourceRoot = sourceDir;
  const agentPluginImport =
    options.kind === "plugin" &&
    (await shouldInspectAgentPluginImport(
      sourcePath,
      options.provider,
      options.providers
    ))
      ? await inspectAgentPluginImport(sourcePath, {
          ignoreSetupScaffold: await isSamePath(sourcePath, options.rootPath),
        })
      : undefined;
  const identity = await resolveImportName(sourcePath, options, agentPluginImport);
  const { name } = identity;
  const targetPath = resolveInside(
    options.rootPath,
    join(sourceRoot, options.kind === "plugin" ? PLUGINS_DIR : SKILLS_DIR, name)
  );

  const mayMergeTargetNativeSkill =
    options.kind === "skill" && options.mergeTargetNativeSkill === true;
  if ((await importTargetOccupied(targetPath)) && !mayMergeTargetNativeSkill) {
    throw importTargetAlreadyExistsError(targetPath);
  }

  const stagingPath = await mkdtemp(join(tmpdir(), "skillset-import-prepared-"));

  try {
    const copied = await copyImportSource({
      kind: options.kind,
      name,
      rootPath: options.rootPath,
      mutationRootPath: stagingPath,
      sourcePath,
      targetPath: stagingPath,
      nameSource: identity.manifestSource,
      configDestination: normalizeCopiedImportPath(relative(options.rootPath, join(targetPath, "skillset.yaml"))),
      ...(agentPluginImport === undefined ? {} : { agentPluginImport }),
    });
    const declaredProviders = options.kind === "plugin" ? await declaredNativePluginTargets(stagingPath) : [];
    const providers = importProviders(options) ?? (declaredProviders.length === 0 ? undefined : declaredProviders);
    const mcpImport: Awaited<ReturnType<typeof rewriteImportedPluginMcp>> = options.kind === "plugin"
      ? await rewriteImportedPluginMcp(stagingPath, copied.files, providers, agentPluginImport !== undefined, normalizeCopiedImportPath(relative(options.rootPath, join(targetPath, ".mcp.json"))))
      : { files: copied.files, normalizations: [] };
    const mcpDependencySources = mcpImport.dependencyCapture === undefined ? [] : [await captureMcpDependencyCandidates(
      sourcePath, mcpImport.dependencyCapture.parsed, mcpImport.dependencyCapture.content, {
        path: normalizeCopiedImportPath(relative(options.rootPath, join(targetPath, ".mcp.json"))),
        configPath: normalizeCopiedImportPath(relative(options.rootPath, join(targetPath, "skillset.yaml"))),
        ...(options.sourceOrigin === undefined ? {} : { origin: options.sourceOrigin(sourcePath, mcpImport.dependencyCapture.originalPath) }),
      }
    )];
    let copiedFiles = mcpImport.files;
    const nativeHookTargets = options.kind === "plugin" ? await importedNativeHookTargets(options, stagingPath) : [];
    const nativeHookBoundary = options.kind === "plugin"
      ? await scopeImportedNativeHooks({ rootPath: stagingPath, stagingPath, files: copiedFiles, targets: nativeHookTargets, synthesizedConfig: copied.synthesizedConfig })
      : undefined;
    if (nativeHookBoundary !== undefined) copiedFiles = nativeHookBoundary.files;
    const hookSourceProviders = importProviders(options) === undefined
      ? declaredProviders.length === 1 ? declaredProviders : []
      : importFrontmatterProviders(options.provider, options.providers);
    const nativeHookSources = nativeHookBoundary?.sources.map((source) => {
      const origin = options.sourceOrigin?.(sourcePath, source.originalPath);
      return {
        path: relative(options.rootPath, join(targetPath, source.path)).replaceAll("\\", "/"),
        targets: nativeHookTargets,
        providers: hookSourceProviders,
        ...(source.pointers === undefined ? {} : { pointers: source.pointers }),
        ...(origin === undefined ? {} : { origin }),
      };
    });

    if (options.sourceOrigin !== undefined) {
      await stampImportedOrigins(stagingPath, sourcePath, options.kind, options.sourceOrigin);
    }
    const canonicalSource = providers?.includes("skillset") === true || agentPluginImport !== undefined;
    const frontmatter = await readImportedFrontmatter(stagingPath, options.kind);
    const classification = classifyFrontmatter(frontmatter, canonicalSource);
    const scopedPolicyProviders = importedInvocationScopeProviders(providers);
    const pluginSkillFrontmatter = await readImportedPluginSkillFrontmatter(
      stagingPath,
      options.kind,
      canonicalSource
    );
    await scopeImportedSkillPolicyFrontmatter(
      stagingPath,
      options.kind,
      scopedPolicyProviders,
      frontmatter,
      pluginSkillFrontmatter,
      canonicalSource
    );

    const frontmatterSources: FrontmatterFindingSource[] = (options.kind === "skill"
      ? [{ path: SKILL_FILE, classification, frontmatter }]
      : pluginSkillFrontmatter).flatMap((skill) => {
        const fields = [...skill.classification.targetNative, ...skill.classification.unsupported];
        const metadataCompatibility = incompatibleAgentSkillsMetadataKeys(readRecord(skill.frontmatter, "metadata") ?? {}).length > 0;
        if (fields.length === 0 && !metadataCompatibility) return [];
        const origin = options.sourceOrigin?.(sourcePath, skill.path);
        return [{ path: relative(options.rootPath, join(targetPath, skill.path)).replaceAll("\\", "/"), providers: scopedPolicyProviders, fields, ...(metadataCompatibility ? { metadataCompatibility: true } : {}), ...(origin === undefined ? {} : { origin }) }];
      });
    const capabilityAssessments = [
      ...frontmatterSources.flatMap(assessImportedFrontmatter),
      ...(nativeHookSources ?? []).flatMap(assessImportedHookRuntime),
      ...assessImportedNormalizations([...copied.normalizations, ...mcpImport.normalizations]),
    ];

    let used = false;
    return {
      sourcePath, targetPath, stagingPath,
      async dispose() {
        used = true;
        await rm(stagingPath, { force: true, recursive: true });
      },
      async commit() {
        if (used) throw new Error("skillset: prepared import already committed or disposed");
        used = true;
        let mergedOriginal: string | undefined;
        let retainedReport: ImportReport | undefined;
        try {
          if (mayMergeTargetNativeSkill && (await exists(targetPath))) {
            mergedOriginal = await mergeImportedProviderSkill(options.rootPath, targetPath, stagingPath);
            await rm(stagingPath, { force: true, recursive: true });
          } else {
            await prepareRepositoryMutationPath(options.rootPath, targetPath);
            const claimPath = await mkdtemp(join(dirname(targetPath), `.${basename(targetPath)}.tmp-`));
            try {
              await cp(stagingPath, claimPath, { recursive: true, force: false });
              await options.testHooks?.beforeClaim?.();
              claimImportedSourceDirectory(claimPath, targetPath, options.testHooks);
            } finally {
              await rm(claimPath, { force: true, recursive: true });
            }
          }
          const fieldClassifications = [classification, ...pluginSkillFrontmatter.map((skill) => skill.classification)];
          const committedReport: ImportReport = {
            baselines: [], copiedFiles, files: copiedFiles.length,
            inferredSourceFields: [...new Set(fieldClassifications.flatMap((item) => item.recognized))].sort(compareStrings),
            kind: options.kind, renderResults: [], name,
            normalizations: [...copied.normalizations, ...mcpImport.normalizations],
            capabilityAssessments,
            frontmatterSources,
            manifestIdentityCandidates: copied.manifestIdentityCandidates,
            mcpDependencySources,
            ...(nativeHookSources === undefined ? {} : { nativeHookSources }),
            nextChecks: importChecksAtRoot(options.rootPath),
            preservedTargetNativeFields: [...new Set(fieldClassifications.flatMap((item) => item.targetNative))].sort(compareStrings),
            sourcePath, targetPath,
            unsupportedFields: [...new Set(fieldClassifications.flatMap((item) => item.unsupported))].sort(compareStrings),
            warnings: [
              ...importWarnings(classification, scopedPolicyProviders),
              ...pluginSkillFrontmatter.flatMap((skill) => importWarnings(skill.classification, scopedPolicyProviders)),
              ...frontmatterSources.filter((source) => source.metadataCompatibility === true).map((source) => `${source.path}: preserved non-string metadata; review Agent Skills standard compatibility before cutover.`),
              ...copied.warnings,
            ],
          };
          retainedReport = committedReport;
          let baselineReport: { readonly entries: readonly ReleaseBaselineEntry[]; readonly path?: string };
          try {
            await options.testHooks?.beforeBaselineSeed?.();
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
              throw new ImportBatchError(
                `skillset: import baseline failed for ${targetPath}: ${errorMessage(error)}. ` +
                  "Inspect the destination; after fixing the baseline error, remove it and rerun only if it is the intended import.",
                [committedReport]
              );
            } else {
              const targetSkillPath = join(targetPath, SKILL_FILE);
              try {
                await prepareRepositoryMutationPath(options.rootPath, targetSkillPath);
                await writeFile(targetSkillPath, mergedOriginal);
                retainedReport = undefined;
              } catch (restoreError) {
                throw new Error(
                  `skillset: import baseline failed and restoring ${targetSkillPath} failed: ${errorMessage(restoreError)}; original error: ${errorMessage(error)}`,
                  { cause: error }
                );
              }
            }
            throw error;
          }

          retainedReport = {
            ...committedReport,
            baselines: baselineReport.entries,
            ...(baselineReport.path === undefined ? {} : { baselinePath: baselineReport.path }),
          };
          await options.testHooks?.afterBaselineSeed?.();
          const renderResults = await importRenderResults({
            classification,
            copiedFiles,
            kind: options.kind,
            name,
            pluginSkillFrontmatter,
            ...(nativeHookBoundary === undefined ? {} : { nativeHookBoundary }),
            ...(options.provider === undefined ? {} : { provider: options.provider }),
            ...(providers === undefined ? {} : { providers }),
            rootPath: options.rootPath,
            targetPath,
          });

          retainedReport = { ...retainedReport, renderResults };
          const frontmatterFindings = (await Promise.all(frontmatterSources.map(async (source) =>
            importedFrontmatterFindings(source, await readFile(join(options.rootPath, source.path), "utf8"))
          ))).flat();
          const unresolvedSources = frontmatterSources.filter((source) => source.providers.length === 0 && source.fields.length > 0);
          // The marker was installed before claim, so even a failed ledger transaction
          // leaves a preserved source that cannot be projected accidentally.
          let persisted: { readonly flags: readonly MigrationFlag[]; readonly writtenPaths: readonly string[] } = { flags: [], writtenPaths: [] };
          let findingError: string | undefined;
          try {
            if (unresolvedSources.length > 0) {
              await options.testHooks?.beforeFindings?.();
              persisted = await recordImportedFindings(options.rootPath, { frontmatter: unresolvedSources });
            }
          } catch (error) {
            findingError = `skillset: imported source is preserved with unresolved frontmatter, but recording review findings failed: ${errorMessage(error)}`;
          }
          const report: ImportReport = {
            ...committedReport,
            ...(baselineReport.path === undefined ? {} : { baselinePath: baselineReport.path }),
            baselines: baselineReport.entries,
            renderResults,
            frontmatterSources,
            frontmatterFindings,
            migrationFlags: persisted.flags,
            migrationWritePaths: persisted.writtenPaths,
          };
          if (findingError !== undefined) throw new ImportBatchError(findingError, [report]);
          return report;
        } catch (error) {
          if (retainedReport !== undefined && !(error instanceof ImportBatchError)) {
            throw new ImportBatchError(errorMessage(error), [retainedReport]);
          }
          throw error;
        }
      },
    };
  } catch (error) {
    await rm(stagingPath, { force: true, recursive: true });
    throw error;
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
  return message.includes("skillset workspace not found");
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
  frontmatter: JsonRecord,
  canonical = false
): FrontmatterClassification {
  const recognized: string[] = [];
  const targetNative: string[] = [];
  const unsupported: string[] = [];

  for (const key of Object.keys(frontmatter).sort(compareStrings)) {
    if (RECOGNIZED_SOURCE_KEYS.has(key) || (canonical && (COMMON_FRONTMATTER_KEYS as readonly string[]).includes(key))) recognized.push(key);
    else if (KNOWN_TARGET_NATIVE_KEYS.has(key)) targetNative.push(key);
    else unsupported.push(key);
  }

  return { recognized, targetNative, unsupported };
}

function importWarnings(
  classification: FrontmatterClassification,
  scopedPolicyProviders: readonly TargetName[]
): readonly string[] {
  const warnings: string[] = [];
  const scopedFields = new Set<string>();
  for (const provider of scopedPolicyProviders) {
    const fields = classification.targetNative;
    if (fields.length === 0) continue;
    for (const field of fields) scopedFields.add(field);
    warnings.push(`preserved target-native fields under ${provider}.frontmatter: ${fields.join(", ")}.`);
  }
  const verbatimFields = classification.targetNative.filter((field) => !scopedFields.has(field));
  if (verbatimFields.length > 0) {
    warnings.push(
      `preserved target-native fields verbatim: ${verbatimFields.join(", ")}. ` +
        "Consider moving them to a portable source key (e.g. tools, implicit_invocation) or a provider-specific block."
    );
  }
  if (classification.unsupported.length > 0) {
    warnings.push(
      `preserved unrecognized frontmatter keys ${scopedPolicyProviders.length === 0 ? "verbatim" : `under ${scopedPolicyProviders.map((provider) => `${provider}.frontmatter`).join(", ")}`}: ${classification.unsupported.join(", ")}. ` +
        "Meaning and cross-provider support remain unknown; review before use."
    );
  }
  return warnings;
}

async function importRenderResults(args: {
  readonly classification: FrontmatterClassification;
  readonly nativeHookBoundary?: ImportedNativeHookBoundary;
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
        ...(args.kind === "skill" ? { skillFeatureId: "standalone-skills" as const } : {}),
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
              skillFeatureId: "plugin-skills",
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
  readonly skillFeatureId?: "standalone-skills" | "plugin-skills";
  readonly classification: FrontmatterClassification;
  readonly provider: TargetName;
  readonly scoped: boolean;
  readonly sourcePath: string;
  readonly sourceUnit: string;
}): readonly SkillsetRenderResult[] {
  const policies = [
    // Native user visibility is not canonical model invocation eligibility.
    ...(args.provider === "claude" && args.scoped && args.skillFeatureId !== undefined
      ? [{ featureId: args.skillFeatureId, fields: args.classification.targetNative.filter((field) => field === "user-invocable") }]
      : []),
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
  const candidates = providers ?? (provider === undefined ? [] : [provider]);
  return targetNames().filter((target) => candidates.includes(target));
}

async function importedNativeHookTargets(
  options: { readonly provider?: ImportProvider; readonly providers?: readonly ImportProvider[] },
  targetPath: string
): Promise<readonly TargetName[]> {
  const explicitProviders = options.providers ?? (options.provider === undefined ? undefined : [options.provider]);
  return explicitProviders === undefined
    ? importedNativePluginTargets(targetPath)
    : targetNames().filter((target) => explicitProviders.includes(target));
}

async function importNativeHookRenderResults(args: {
  readonly nativeHookBoundary?: ImportedNativeHookBoundary;
  readonly copiedFiles: readonly string[];
  readonly kind: SingularImportKind;
  readonly name: string;
  readonly provider?: ImportProvider;
  readonly providers?: readonly ImportProvider[];
  readonly rootPath: string;
  readonly targetPath: string;
}): Promise<readonly SkillsetRenderResult[]> {
  if (args.kind !== "plugin" || args.nativeHookBoundary === undefined) return [];
  const targets = await importedNativeHookTargets(args, args.targetPath);
  const results: SkillsetRenderResult[] = [];
  for (const source of args.nativeHookBoundary.sources) {
    const hookPath = join(args.targetPath, source.path);
    const sourcePath = relative(args.rootPath, hookPath).replaceAll("\\", "/");
    if (args.nativeHookBoundary.evidence !== undefined) {
      results.push(defineRenderResult({
        destination: "hooks", featureId: "plugin-hooks", target: "claude", status: "target_native",
        sourcePath, sourceUnit: selectorForPluginFeature(args.name, "hooks"),
        outputs: [{ kind: "imported-source", path: sourcePath }],
        diagnostics: [{ code: "import-native-hook-provider-scoped", path: sourcePath,
          message: `Preserved the Claude hook declaration and referenced hook files at their emitted paths; file bytes and inline configuration values are unchanged. Arbitrary runtime dependencies still require review. Evidence: ${args.nativeHookBoundary.evidence}` }],
      }));
    }
    let content: string;
    try { content = await readFile(hookPath, "utf8"); }
    catch (error) {
      results.push(...targets.map((target) => importNativeHookParseResult(args, sourcePath, target, errorMessage(error))));
      continue;
    }
    const diagnostics = classifyNativeHookSource({ path: sourcePath, targets, ...(source.pointers === undefined ? {} : { pointers: source.pointers }) }, content);
    results.push(...diagnostics.map((diagnostic) => importNativeHookRenderResult(args, sourcePath, diagnostic)));
  }
  return results;
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
  diagnostic: NativeHookSourceDiagnostic
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
  const targets = await declaredNativePluginTargets(targetPath);
  return targets.length === 0 ? targetNames() : targets;
}

async function declaredNativePluginTargets(targetPath: string): Promise<readonly TargetName[]> {
  const targets: TargetName[] = [];
  for (const target of targetNames()) {
    if (await exists(join(targetPath, `.${target}-plugin`, "plugin.json"))) targets.push(target);
  }
  return targets;
}

function isClaudeToolPolicyField(field: string): boolean {
  return field === "allowed-tools" || field === "disallowed-tools";
}

async function scopeImportedSkillPolicyFrontmatter(
  targetPath: string,
  kind: SingularImportKind,
  providers: readonly TargetName[],
  frontmatter: JsonRecord,
  pluginSkillFrontmatter: readonly ImportedPluginSkillFrontmatter[],
  canonical = false
): Promise<void> {
  if (kind === "skill") {
    await scopeSkillPolicyFrontmatter(
      join(targetPath, SKILL_FILE),
      frontmatter,
      providers,
      canonical
    );
    return;
  }
  for (const skill of pluginSkillFrontmatter) {
    await scopeSkillPolicyFrontmatter(
      join(targetPath, skill.path),
      skill.frontmatter,
      providers,
      canonical
    );
  }
}

async function scopeSkillPolicyFrontmatter(
  skillPath: string,
  frontmatter: JsonRecord,
  providers: readonly TargetName[],
  canonical = false
): Promise<void> {
  const classification = classifyFrontmatter(frontmatter, canonical);
  const fields = [...classification.targetNative, ...classification.unsupported];
  if (fields.length === 0) return;
  const source = await readFile(skillPath, "utf8");
  await writeFile(skillPath, scopeImportedSkillFrontmatter(source, skillPath, providers, fields));
}

export async function composeImportedProviderSkill(
  rootPath: string,
  targetPath: string,
  stagingPath: string
): Promise<{ readonly original: string; readonly merged: string }> {
  await prepareRepositoryMutationPath(rootPath, join(targetPath, SKILL_FILE), { createParents: false });
  await assertMatchingImportedSkillResources(targetPath, stagingPath);
  const targetSkillPath = join(targetPath, SKILL_FILE);
  const stagedSkillPath = join(stagingPath, SKILL_FILE);
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
  return {
    original: targetSource,
    merged: updateMarkdownSourceDocument(targetSource, targetSkillPath, (parts) => ({
      ...parts,
      frontmatter: { ...parts.frontmatter, ...Object.fromEntries(stagedTargets) },
    })),
  };
}

async function mergeImportedProviderSkill(rootPath: string, targetPath: string, stagingPath: string): Promise<string> {
  const composed = await composeImportedProviderSkill(rootPath, targetPath, stagingPath);
  const targetSkillPath = join(targetPath, SKILL_FILE);
  await prepareRepositoryMutationPath(rootPath, targetSkillPath);
  await writeFile(targetSkillPath, composed.merged);
  return composed.original;
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
    .filter((path) => path !== SKILL_FILE);
  const stagedFiles = (await collectFiles(stagingPath))
    .map((path) => relative(stagingPath, path).replaceAll("\\", "/"))
    .filter((path) => path !== SKILL_FILE);
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
      providers.includes(target)
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
  canonical = false
): Promise<readonly ImportedPluginSkillFrontmatter[]> {
  const skillsPath = join(targetPath, "skills");
  if (kind !== "plugin" || !(await exists(skillsPath))) return [];
  const skills: ImportedPluginSkillFrontmatter[] = [];
  // Use compiler discovery: nested primaries count, nested companions do not.
  for (const sourcePath of await findSkillFiles(skillsPath)) {
    const path = normalizeCopiedImportPath(relative(targetPath, sourcePath));
    const frontmatter = parseMarkdown(
      await readFile(join(targetPath, path), "utf8"),
      join(targetPath, path)
    ).frontmatter;
    skills.push({
      classification: classifyFrontmatter(frontmatter, canonical),
      frontmatter,
      id: readString(frontmatter, "name") ?? basename(dirname(path)),
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
      ? join(targetPath, SKILL_FILE)
      : join(targetPath, "skillset.yaml");
  return relative(rootPath, path).replaceAll("\\", "/");
}

async function readImportedFrontmatter(targetPath: string, kind: SingularImportKind): Promise<JsonRecord> {
  if (kind === "skill") {
    const skillFile = join(targetPath, SKILL_FILE);
    if (!(await exists(skillFile))) return {};
    return parseMarkdown(await readFile(skillFile, "utf8"), skillFile).frontmatter;
  }

  const configPath = join(targetPath, "skillset.yaml");
  if (!(await exists(configPath))) return {};
  return parseYamlRecord(await readFile(configPath, "utf8"), configPath);
}

async function resolveImportName(
  sourcePath: string,
  options: ImportOptions,
  agentPluginImport: AgentPluginImportInspection | undefined
): Promise<{ readonly name: string; readonly manifestSource?: ImportNormalization["dialect"] }> {
  if (options.name !== undefined) {
    return { name: validateSlug(options.name, "import name") };
  }

  if (options.kind === "skill") {
    const skillPath = await resolveSkillFile(sourcePath);
    const parts = parseMarkdown(await readFile(skillPath, "utf8"), skillPath);
    const metadata = readSkillsetMetadata(parts.frontmatter, skillPath);
    return { name: validateSlug(
      readSkillsetName(metadata, readString(parts.frontmatter, "name") ?? basename(dirname(skillPath)), skillPath),
      `skillset.name in ${skillPath}`
    ) };
  }

  if (agentPluginImport !== undefined) {
    if (!isSlug(agentPluginImport.manifestName)) {
      throw new Error(
        `skillset: Agent Plugins manifest name ${JSON.stringify(agentPluginImport.manifestName)} is not a Skillset plugin id; pass --name <slug> to map it explicitly`
      );
    }
    return { name: validateSlug(
      agentPluginImport.manifestName,
      "Agent Plugins manifest name"
    ), manifestSource: "agent-plugins" };
  }

  const rootPluginImport = options.kind === "plugin" && await isSamePath(sourcePath, options.rootPath);
  const configPath = rootPluginImport ? undefined : await resolvePluginConfig(sourcePath);
  if (configPath === undefined) {
    const nativeManifest = await readNativePluginManifest(sourcePath);
    const nativeName = readString(nativeManifest.manifest, "name");
    const selectedNativeName = nativeName !== undefined && isSlug(nativeName);
    return {
      name: validateSlug(selectedNativeName ? nativeName : basename(sourcePath), "plugin directory"),
      ...(selectedNativeName ? { manifestSource: nativeManifest.provider } : {}),
    };
  }

  const config = parseYamlRecord(await readFile(configPath, "utf8"), configPath);
  const metadata = readSkillsetMetadata(config, configPath);
  return { name: validateSlug(readSkillsetName(metadata, basename(sourcePath), configPath), `skillset.name in ${configPath}`) };
}

async function copyImportSource(options: {
  readonly kind: SingularImportKind;
  readonly name: string;
  readonly rootPath: string;
  readonly mutationRootPath: string;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly configDestination: string;
  readonly nameSource: ImportNormalization["dialect"] | undefined;
  readonly agentPluginImport?: AgentPluginImportInspection;
}): Promise<{
  readonly baselineVersion?: string;
  readonly files: readonly string[];
  readonly synthesizedConfig: boolean;
  readonly manifestIdentityCandidates: readonly ManifestIdentityCandidate[];
  readonly normalizations: readonly ImportNormalization[];
  readonly warnings: readonly string[];
}> {
  const { agentPluginImport, kind, name, rootPath, sourcePath, targetPath } = options;
  const stats = await stat(sourcePath);
  if (stats.isFile()) {
    if (kind !== "skill" || basename(sourcePath) !== SKILL_FILE) {
      throw new Error("skillset: importing a file is only supported for skill SKILL.md files");
    }
  }

  const copyRoot = stats.isFile() ? dirname(sourcePath) : sourcePath;
  const rootPluginImport = kind === "plugin" && await isSamePath(copyRoot, rootPath);
  const copied: string[] = [];
  let baselineVersion: string | undefined;
  let synthesizedConfig = false;
  let manifestIdentityCandidates: readonly ManifestIdentityCandidate[] = [];
  let normalizations: readonly ImportNormalization[] = [];
  let warnings: readonly string[] = [];
  const exclude =
    rootPluginImport || agentPluginImport !== undefined
      ? (path: string) =>
          isImportScaffold(copyRoot, path, rootPluginImport)
      : undefined;
  for (const file of await collectFiles(copyRoot, exclude)) {
    const relativePath = relativeImportPath(copyRoot, file, kind);
    const destination = resolveImportDestination(targetPath, relativePath);
    await prepareRepositoryMutationPath(options.mutationRootPath, destination);
    await writeFile(destination, await readFile(file));
    if (supportsGeneratedFileModes()) {
      await chmod(destination, normalizeGeneratedFileMode((await stat(file)).mode));
    }
    copied.push(relativePath);
  }

  if (agentPluginImport !== undefined) {
    normalizations = await normalizeImportedAgentPluginPackage(targetPath, copied, dirname(options.configDestination));
  }

  if (kind === "plugin" && !(await exists(join(targetPath, "skillset.yaml")))) {
    const importedConfig =
      agentPluginImport === undefined
        ? await writeImportedPluginConfig(targetPath, name, options.configDestination, options.nameSource, { sourcePath: copyRoot, copiedFiles: copied })
        : await writeImportedAgentPluginConfig(
            targetPath,
            name,
            agentPluginImport,
            options.configDestination,
            options.nameSource
          );
    baselineVersion = importedConfig.baselineVersion;
    warnings = importedConfig.warnings;
    normalizations = [...normalizations, ...importedConfig.normalizations];
    manifestIdentityCandidates = importedConfig.manifestIdentityCandidates ?? [];
    if (agentPluginImport !== undefined) {
      await rm(join(targetPath, "plugin.json"));
      normalizations = [...normalizations, agentPluginUnitObservation("agent-plugins.manifest-to-source", { path: "plugin.json", pointer: "" }, { path: options.configDestination, pointer: "" })];
      const manifestIndex = copied.indexOf("plugin.json");
      if (manifestIndex >= 0) copied.splice(manifestIndex, 1);
    }
    copied.push("skillset.yaml");
    synthesizedConfig = true;
  }

  return {
    ...(baselineVersion === undefined ? {} : { baselineVersion }),
    files: copied.sort(compareStrings),
    synthesizedConfig,
    manifestIdentityCandidates,
    normalizations,
    warnings,
  };
}

async function rewriteImportedPluginMcp(
  targetPath: string,
  copiedFiles: readonly string[],
  providers: readonly ImportProvider[] | undefined,
  agentPluginImport: boolean,
  destinationPath: string
): Promise<{ readonly files: readonly string[]; readonly normalizations: readonly ImportNormalization[]; readonly dependencyCapture?: { readonly parsed: JsonValue; readonly content: string; readonly originalPath: string } }> {
  const hiddenPath = join(targetPath, ".mcp.json");
  const visiblePath = join(targetPath, "mcp.json");
  const hasHidden = await exists(hiddenPath);
  const hasVisible = await exists(visiblePath);
  const manifestSource = await importedManifestMcpSource(
    targetPath,
    providers
  );
  if (manifestSource === undefined && !hasHidden && !hasVisible) {
    return { files: copiedFiles, normalizations: [] };
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
    providers,
    agentPluginImport
  );
  const original = await readFile(sourcePath, "utf8");
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(original) as JsonValue;
  } catch (error) {
    throw new Error(
      `skillset: imported MCP source ${sourcePath} is not valid JSON: ${errorMessage(error)}`
    );
  }
  const normalized = normalizeImportedMcpSource(parsed, dialect);
  const serialized = stringifyJson(normalized.source);
  const changes = [...normalized.changes];
  if (sourcePath !== hiddenPath) changes.push({ code: "mcp.source-path", sourcePointer: "", destinationPointer: "", occurrences: 1 });
  if (stringifyJson(parsed as JsonRecord) !== original) changes.push({ code: "mcp.json-serialization", sourcePointer: "", destinationPointer: "", occurrences: 1 });
  const normalizations = recordMcpNormalizations(changes, dialect, normalizeCopiedImportPath(relative(targetPath, sourcePath)), destinationPath);
  await writeFile(hiddenPath, serialized);
  if (sourcePath !== hiddenPath) await rm(sourcePath);
  await parsePortableMcpSource({
    pluginRoot: targetPath,
    sourcePath: hiddenPath,
  });

  return { normalizations, ...(dialect === "cursor" ? { dependencyCapture: { parsed, content: serialized, originalPath: normalizeCopiedImportPath(relative(targetPath, sourcePath)) } } : {}), files: [
    ...copiedFiles.filter(
      (file) =>
        normalizeCopiedImportPath(file) !==
          normalizeCopiedImportPath(relative(targetPath, sourcePath)) &&
        normalizeCopiedImportPath(file) !== ".mcp.json" &&
        normalizeCopiedImportPath(file) !== "mcp.json"
    ),
    ".mcp.json",
  ].sort(compareStrings) };
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
  providers: readonly ImportProvider[] | undefined,
  agentPluginImport: boolean
): Promise<TargetName | "agent-plugins"> {
  if (agentPluginImport) return "agent-plugins";
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
  kind: SingularImportKind,
  sourceOrigin: (sourcePath: string, copiedFile?: string) => SourceOrigin
): Promise<void> {
  if (kind === "plugin") {
    await writeYamlSourceOrigin(join(targetPath, "skillset.yaml"), sourceOrigin(sourcePath));
  }

  const skillsPath = join(targetPath, "skills");
  // Only compiler-discovered primaries own source metadata. A companion named
  // SKILL.md is runtime content, including inside an opaque provider island.
  const primaryPaths = kind === "skill"
    ? [join(targetPath, SKILL_FILE)]
    : await exists(skillsPath) ? await findSkillFiles(skillsPath) : [];
  for (const path of primaryPaths) {
    const file = normalizeCopiedImportPath(relative(targetPath, path));
    await writeMarkdownSourceOrigin(path, sourceOrigin(sourcePath, file));
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
  if (record.skillset !== undefined && !isJsonRecord(record.skillset)) {
    throw new Error("skillset: cannot stamp source origin over non-object skillset metadata");
  }
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
  if (sep === "/" && relativePath.includes("\\")) {
    throw new Error(
      `skillset: import source contains non-portable backslash path: ${relativePath}`
    );
  }
  if (kind === "plugin" && (relativePath === "skillset.yaml" || relativePath === "config.yaml")) {
    return "skillset.yaml";
  }
  return normalizeCopiedImportPath(relativePath);
}

function resolveImportDestination(targetPath: string, relativePath: string): string {
  const resolvedTarget = resolve(targetPath);
  const destination = resolve(resolvedTarget, relativePath);
  if (!isPathInside(resolvedTarget, destination)) {
    throw new Error(
      `skillset: import source path resolves outside staging root: ${relativePath}`
    );
  }
  return destination;
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

function isImportScaffold(
  rootPath: string,
  path: string,
  rootPluginImport: boolean
): boolean {
  const relativePath = relative(rootPath, path).replaceAll("\\", "/");
  return (
    relativePath === ".git" ||
    relativePath.startsWith(".git/") ||
    (rootPluginImport &&
      (relativePath === ".skillset" ||
        relativePath.startsWith(".skillset/") ||
        relativePath === "skillset.yaml" ||
        relativePath === "skillset.lock"))
  );
}

async function resolveSkillFile(sourcePath: string): Promise<string> {
  const stats = await stat(sourcePath);
  if (stats.isFile()) return sourcePath;
  return join(sourcePath, SKILL_FILE);
}

async function resolvePluginConfig(sourcePath: string): Promise<string | undefined> {
  for (const file of ["skillset.yaml", "config.yaml"]) {
    const candidate = join(sourcePath, file);
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

async function shouldInspectAgentPluginImport(
  sourcePath: string,
  provider: ImportProvider | undefined,
  providers: readonly ImportProvider[] | undefined
): Promise<boolean> {
  if (!(await exists(join(sourcePath, "plugin.json")))) return false;
  if (provider === "agents" || providers?.includes("agents")) return true;
  if (!(await hasAgentPluginManifest(sourcePath))) return false;
  return provider === undefined && providers === undefined;
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
  throw new CliUsageError("skillset: expected import path");
}

function defaultProviderSkillRoot(provider: ImportProvider): string {
  const home = homedir();
  if (provider === "agents") return join(home, ".agents", "skills");
  if (provider === "claude") return join(home, ".claude", "skills");
  if (provider === "codex") return join(home, ".codex", "skills");
  if (provider === "cursor") return join(home, ".cursor", "skills");
  return join(home, ".skillset");
}

export async function planImports(sourcePath: string, requestedKind: ImportKind | undefined): Promise<ImportPlan> {
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
  if (stats.isFile()) return basename(sourcePath) === SKILL_FILE;
  if (!stats.isDirectory()) return false;
  return exists(join(sourcePath, SKILL_FILE));
}

async function isPluginSource(sourcePath: string): Promise<boolean> {
  if (!(await exists(sourcePath))) return false;
  const stats = await stat(sourcePath);
  if (!stats.isDirectory()) return false;
  return (
    (await exists(join(sourcePath, "skillset.yaml"))) ||
    (await exists(join(sourcePath, "config.yaml"))) ||
    (await hasAgentPluginManifest(sourcePath)) ||
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

interface ImportedPluginConfig {
  readonly manifestIdentityCandidates?: readonly ManifestIdentityCandidate[];
  readonly baselineVersion?: string;
  readonly warnings: readonly string[];
  readonly normalizations: readonly ImportNormalization[];
}

async function writeImportedPluginConfig(
  targetPath: string,
  name: string,
  configDestination: string,
  nameSource: ImportNormalization["dialect"] | undefined,
  input: { readonly sourcePath: string; readonly copiedFiles: string[] }
): Promise<ImportedPluginConfig> {
  const nativeManifests = await readNativePluginManifests(targetPath);
  const licenseNormalizations = await normalizeNativePluginLicense({ ...input, stagingPath: targetPath, configDestination, manifests: nativeManifests });
  // `author` is source-owned, so it is stripped from provider overrides. A
  // value Skillset cannot read has no canonical form to lift, and another
  // provider's readable author would quietly stand in for it. Those providers
  // keep their raw native author on their own manifest override instead, and
  // migration warns rather than dropping it.
  const unreadableAuthors = unreadableNativeAuthorProviders(nativeManifests);
  const keywordBoundary = cursorKeywordBoundary(nativeManifests);
  const metadataConflicts = portablePluginMetadataConflicts(nativeManifests);
  if (metadataConflicts.length > 0) {
    throw new Error(
      `skillset: native plugin manifests disagree on portable metadata: ${metadataConflicts.map((conflict) => conflict.field).join(", ")}`
    );
  }
  const listingConflicts = nativeListingMetadataConflicts(nativeManifests);
  const metadataNormalizations: ImportNormalization[] = [];
  const firstMetadataValue = (field: Exclude<(typeof PORTABLE_PLUGIN_METADATA_FIELDS)[number], "author">) => {
    const selected = firstPortablePluginMetadataSource(nativeManifests, field);
    if (selected === undefined) return undefined;
    metadataNormalizations.push(...manifestNormalizationObservations(selected.provider, [{
      code: "manifest.metadata", source: `/${field}`, destination: `/skillset/${field}`,
    }], configDestination));
    return selected.value;
  };
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
  const resolvedAuthor = resolveNativeAuthor(nativeManifests);
  const manifestAuthor = resolvedAuthor.value;
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
  const descriptionSource = [...nativeManifests.entries()].find(([, manifest]) => manifest.description !== undefined);
  const description = descriptionSource?.[1].description;
  const nativeCodexInterface = readRecord(
    nativeManifests.get("codex") ?? {},
    "interface"
  );
  const canonicalManifestDescription =
    (typeof description === "string" ? description : undefined) ??
    readString(nativeCodexInterface ?? {}, "shortDescription") ??
    readString(nativeCodexInterface ?? {}, "longDescription") ??
    name;
  const importedListingResult = importedListing(nativeManifests, listingConflicts, canonicalManifestDescription, configDestination);
  const listing = importedListingResult.value;
  const metadata: JsonRecord = {
    name,
    description: canonicalManifestDescription,
    listing,
    author: canonicalAuthor,
    homepage: firstMetadataValue("homepage"),
    repository: firstMetadataValue("repository"),
    license: firstMetadataValue("license"),
    keywords: firstMetadataValue("keywords"),
  };
  const providerOverrides = Object.fromEntries(
    [...nativeManifests.entries()].flatMap(([provider, manifest]) => {
      const override: JsonRecord = { ...importedManifestOverride(
        provider,
        manifest,
        listingConflicts,
        canonicalManifestDescription,
        unreadableAuthors.includes(provider)
      ), ...(provider === "cursor" && keywordBoundary !== undefined ? { keywords: keywordBoundary.cursor } : {}) };
      const providerConfig: Record<string, JsonValue> = {};
      if (Object.keys(override).length > 0) providerConfig.manifest = override;
      if (provider === "codex") {
        const interfaceOverride = importedCodexInterfaceOverride(
          manifest,
          listingConflicts,
          canonicalAuthorName,
          canonicalManifestDescription,
          listing
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
  const cursorNativeDiscoveryFields = [...["category", "tags"].filter(
    (field) => nativeManifests.get("cursor")?.[field] !== undefined
  ), ...(keywordBoundary === undefined ? [] : ["keywords"])];
  await writeFile(
    join(targetPath, "skillset.yaml"),
    stringifyYamlSourceDocument({
      skillset: metadata,
      ...providerOverrides,
    })
  );
  const normalizations: readonly ImportNormalization[] = [
      ...(keywordBoundary === undefined ? [] : manifestNormalizationObservations("cursor", [{ code: "manifest.metadata", source: "/keywords", destination: "/cursor/manifest/keywords" }], configDestination)),
      ...licenseNormalizations,
      ...metadataNormalizations,
      ...importedListingResult.normalizations,
      ...[...nativeManifests.entries()].flatMap(([provider, manifest]) => manifestIdentityObservations(
      provider, manifest, name, provider === nameSource,
      typeof description === "string"
        ? (provider === descriptionSource?.[0] ? "/description" : undefined)
        : provider === "codex"
          ? (readString(nativeCodexInterface ?? {}, "shortDescription") !== undefined ? "/interface/shortDescription" : readString(nativeCodexInterface ?? {}, "longDescription") !== undefined ? "/interface/longDescription" : undefined)
          : undefined,
      configDestination
    )),
      ...resolvedAuthor.contributions.flatMap((entry) => manifestNormalizationObservations(entry.provider, [{
        code: "manifest.author", source: entry.sourcePointer, destination: entry.destinationPointer,
      }], configDestination)),
      ...(manifestAuthor === undefined && codexDeveloperName !== undefined
        ? manifestNormalizationObservations("codex", [{ code: "manifest.author", source: "/interface/developerName", destination: "/skillset/author" }], configDestination)
        : []),
    ];
  return {
    ...(version === undefined ? {} : { baselineVersion: version }),
    normalizations,
    manifestIdentityCandidates: captureManifestIdentityCandidates(normalizations, nativeManifests.get("claude")),
    warnings: [
      ...(unreadableAuthors.length === 0
        ? []
        : [
            `import-unreadable-plugin-author: native plugin manifests declare an unreadable author: ${unreadableAuthors.join(", ")}; author must be a non-empty string or an object with a non-empty name. Skillset preserved each raw value under <provider>.manifest.author instead of choosing a canonical author.`,
          ]),
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

async function writeImportedAgentPluginConfig(
  targetPath: string,
  name: string,
  inspection: AgentPluginImportInspection,
  configDestination: string,
  nameSource: ImportNormalization["dialect"] | undefined
): Promise<ImportedPluginConfig> {
  if (inspection.version !== undefined) {
    validateVersionField(
      { version: inspection.version },
      "Agent Plugins manifest version"
    );
  }
  const sourceMetadata = agentPluginSourceMetadata(inspection, name);
  await writeFile(
    join(targetPath, "skillset.yaml"),
    stringifyYamlSourceDocument({
      skillset: sourceMetadata.metadata,
    })
  );
  return {
    ...(inspection.version === undefined
      ? {}
      : { baselineVersion: inspection.version }),
    warnings: agentPluginIdentityWarnings(inspection, name),
    normalizations: [
      ...manifestNormalizationObservations("agent-plugins", sourceMetadata.copiedMetadataFields.map((field) => ({
        code: "manifest.metadata", source: `/${field}`, destination: `/skillset/${field}`,
      })), configDestination),
      ...manifestIdentityObservations("agent-plugins", inspection.manifest, name, nameSource === "agent-plugins", typeof inspection.manifest.description === "string" ? "/description" : undefined, configDestination),
      ...(inspection.manifest.author === undefined ? [] : manifestNormalizationObservations("agent-plugins", [{ code: "manifest.author", source: "/author", destination: "/skillset/author" }], configDestination)),
    ],
  };
}

function importedManifestOverride(
  provider: TargetName,
  manifest: JsonRecord,
  listingConflicts: readonly NativeListingMetadataConflict[],
  canonicalManifestDescription: string,
  keepUnreadableAuthor: boolean
): JsonRecord {
  const override: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (!SOURCE_OWNED_PLUGIN_MANIFEST_FIELDS.has(key) && value !== undefined) {
      override[key] = value;
    }
  }
  // An author with no canonical form stays provider-specific so it does not
  // vanish; `skillset.author` comes only from readable authors.
  if (keepUnreadableAuthor && manifest.author !== undefined) {
    override.author = manifest.author;
  }
  for (const field of listProviderPluginComponentManifestFields(provider)) {
    // Claude's declaration supplements default discovery. The staging boundary
    // inventories it before claim and keeps native files at their emitted paths.
    if (provider === "claude" && field === "hooks") continue;
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
  canonicalAuthorName: string | undefined,
  canonicalManifestDescription: string,
  listing: JsonRecord | undefined
): JsonRecord {
  const nativeInterface = readRecord(manifest, "interface") ?? {};
  const canonicalShortDescription =
    readString(listing ?? {}, "summary") ??
    readString(listing ?? {}, "description") ??
    canonicalManifestDescription;
  const canonicalLongDescription =
    readString(listing ?? {}, "description") ??
    canonicalManifestDescription;
  return Object.fromEntries(
    Object.entries(nativeInterface).filter(
      ([field, value]) =>
        !(
          field === "developerName" &&
          typeof value === "string" &&
          value === canonicalAuthorName
        ) &&
        !(
          field === "shortDescription" &&
          typeof value === "string" &&
          value === canonicalShortDescription
        ) &&
        !(
          field === "longDescription" &&
          typeof value === "string" &&
          value === canonicalLongDescription
        ) &&
        (shouldKeepCodexInterfaceField(field, listingConflicts) ||
          field === "shortDescription" ||
          field === "longDescription" ||
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

async function readNativePluginManifest(targetPath: string): Promise<{ readonly manifest: JsonRecord; readonly provider?: TargetName }> {
  for (const provider of targetNames()) {
    const candidate = join(targetPath, `.${provider}-plugin`, "plugin.json");
    if (!(await exists(candidate))) continue;
    const parsed = JSON.parse(await readFile(candidate, "utf8")) as unknown;
    if (isJsonRecord(parsed)) return { manifest: parsed, provider };
    throw new Error(`skillset: expected native plugin manifest ${candidate} to contain a JSON object`);
  }
  return { manifest: {} };
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
    if (isEnoent(error)) {
      return false;
    }
    throw error;
  }
}

async function importTargetOccupied(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isEnoent(error)) {
      return false;
    }
    throw error;
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function importTargetAlreadyExistsError(targetPath: string): Error {
  return new Error(
    `skillset: import target already exists: ${targetPath}. ` +
      "Import never overwrites; remove the existing source or import under a different --name."
  );
}

function unsupportedImportInstallError(targetPath: string, reason: string): Error {
  return new Error(
    `skillset: cannot atomically install import target ${targetPath}: ${reason} ` +
      "(directory installs require atomic no-replace rename support; move the workspace to a supported local filesystem)"
  );
}

function claimImportedSourceDirectory(
  stagingPath: string,
  targetPath: string,
  testHooks: ImportTestHooks | undefined
): void {
  const result = (testHooks?.renameDirectory ?? renameDirectoryNoReplace)(
    stagingPath,
    targetPath
  );
  if (result.kind === "installed") {
    return;
  }
  if (result.kind === "occupied") {
    throw importTargetAlreadyExistsError(targetPath);
  }
  throw unsupportedImportInstallError(targetPath, result.reason);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
