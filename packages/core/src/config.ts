import { listProviderDestinationFormatSnapshots } from "@skillset/registry";
import {
  CODEX_MARKETPLACE_AUTHENTICATION_POLICIES,
  CODEX_MARKETPLACE_INSTALLATION_POLICIES,
  CODEX_MARKETPLACE_INTERFACE_KEYS,
  CODEX_MARKETPLACE_PRODUCT_INPUTS,
  CODEX_MARKETPLACE_SOURCE_KINDS,
  COMPILE_BUILD_MODES as SCHEMA_COMPILE_BUILD_MODES,
  PLUGIN_CONFIG_KEYS as SCHEMA_PLUGIN_CONFIG_KEYS,
  ROOT_SOURCE_MANIFEST_KEYS as SCHEMA_ROOT_SOURCE_MANIFEST_KEYS,
  SINGLE_FILE_ROOT_CONFIG_KEYS as SCHEMA_SINGLE_FILE_ROOT_CONFIG_KEYS,
  SPLIT_WORKSPACE_CONFIG_KEYS as SCHEMA_SPLIT_WORKSPACE_CONFIG_KEYS,
  UNSUPPORTED_DESTINATION_POLICIES as SCHEMA_UNSUPPORTED_DESTINATION_POLICIES,
  validatePluginConfig,
  validateRootSourceManifest,
  validateSingleFileRootConfig,
  validateSplitWorkspaceConfig,
  type SkillsetSchemaDiagnostic,
  type SkillsetSchemaValidationResult,
} from "@skillset/schema";

import type {
  CodexMarketplaceAuthor,
  CodexMarketplaceInterface,
  CodexMarketplacePluginConfig,
  CodexMarketplacePluginPolicy,
  CodexMarketplaceProduct,
  CodexMarketplacePluginSource,
  CompileBuildMode,
  CompileConfig,
  CompileFeatureConfig,
  InstructionFrontPageDestination,
  CompileSkillsetConfig,
  UnsupportedDestinationPolicy,
  DistributionConfig,
  JsonRecord,
  JsonValue,
  MarketplaceCatalogConfig,
  MarketplacePluginEntryConfig,
  InternalUseConfig,
  OutputConfig,
  OutputSelection,
  ResolvedTarget,
  TargetName,
  WorkspacePluginsConfig,
} from "./types";
import { SKILLSET_RUNTIME_IDS, type SkillsetRuntimeId } from "./feature-registry";
import { DEFAULT_PLUGIN_OUTPUT_ROOT } from "./plugin-output";
import {
  parseRemoteRepositoryReference,
  validateRemoteRepositoryRevision,
} from "./remote-repository-reference";
import {
  DEFAULT_TARGET_NAME_SET,
  DEFAULT_TARGET_NAMES,
  TARGET_LIST_TEXT,
  TARGET_NAMES,
  isTargetName,
  targetNames,
  targetRecord,
} from "./targets";
import { isJsonRecord } from "./yaml";

export {
  defaultTargetNames,
  isTargetName,
  targetDescriptor,
  targetNames,
  targetRecord,
} from "./targets";

export type FeatureSurface = "agents" | "instructions" | "plugins" | "skills";

const DEFAULT_SURFACES = new Set<FeatureSurface>(["agents", "instructions", "plugins", "skills"]);
const BASE_CONFIG_TOP_LEVEL_KEYS = new Set<string>(
  SCHEMA_PLUGIN_CONFIG_KEYS.filter((key) => key !== "bin" && key !== "hooks" && key !== "mcp")
);
const PLUGIN_CONFIG_TOP_LEVEL_KEYS = new Set<string>(SCHEMA_PLUGIN_CONFIG_KEYS);
const ROOT_CONFIG_TOP_LEVEL_KEYS = new Set<string>(SCHEMA_SINGLE_FILE_ROOT_CONFIG_KEYS);
const WORKSPACE_CONFIG_TOP_LEVEL_KEYS = new Set<string>(SCHEMA_SPLIT_WORKSPACE_CONFIG_KEYS);
const ROOT_SOURCE_MANIFEST_TOP_LEVEL_KEYS = new Set<string>(SCHEMA_ROOT_SOURCE_MANIFEST_KEYS);
const COMPILE_BUILD_MODES = new Set<CompileBuildMode>(SCHEMA_COMPILE_BUILD_MODES as readonly CompileBuildMode[]);
const UNSUPPORTED_DESTINATION_POLICIES = new Set<UnsupportedDestinationPolicy>(
  SCHEMA_UNSUPPORTED_DESTINATION_POLICIES as readonly UnsupportedDestinationPolicy[]
);
const INSTRUCTION_FRONT_PAGE_DESTINATIONS = new Set<InstructionFrontPageDestination>([
  "claude-dir",
  "repo-root",
]);
const DEFAULT_PACKAGE_OUTPUT_PATH = "plugins/[name]";
const CODEX_MARKETPLACE_SOURCE_KIND_SET = new Set<string>(
  CODEX_MARKETPLACE_SOURCE_KINDS
);
const CODEX_MARKETPLACE_INSTALLATION_POLICY_SET = new Set<string>(
  CODEX_MARKETPLACE_INSTALLATION_POLICIES
);
const CODEX_MARKETPLACE_AUTHENTICATION_POLICY_SET = new Set<string>(
  CODEX_MARKETPLACE_AUTHENTICATION_POLICIES
);
const CODEX_MARKETPLACE_PRODUCT_SET = new Set<string>(
  CODEX_MARKETPLACE_PRODUCT_INPUTS
);
const CODEX_MARKETPLACE_INTERFACE_KEY_SET = new Set<string>(
  CODEX_MARKETPLACE_INTERFACE_KEYS
);
export const DISTRIBUTION_RUNTIME_TARGETS: Readonly<Record<TargetName, readonly SkillsetRuntimeId[]>> = {
  claude: ["claude-code"],
  codex: ["codex-app", "codex-cli"],
  cursor: ["cursor"],
};
export const NON_DISTRIBUTABLE_RUNTIME_IDS: ReadonlySet<SkillsetRuntimeId> = new Set([
  "devin",
  "droid",
  "gemini-cli",
  "opencode",
]);
const SOURCE_ONLY_KEYS = new Set([
  "agents",
  "allowed_tools",
  "bin",
  "claude",
  "changes",
  "compile",
  "codex",
  "cursor",
  "defaults",
  "dependencies",
  "distributions",
  "dialect",
  "implicit_invocation",
  "hooks",
  "mcp",
  "marketplaces",
  "model",
  "resources",
  "schema",
  "skillset",
  "status",
  "summary",
  "supports",
  "targets",
  "title",
  "tools",
  "version",
]);

export function defaultTargets(): Readonly<Record<TargetName, ResolvedTarget>> {
  return targetRecord((target) => ({ enabled: DEFAULT_TARGET_NAME_SET.has(target), options: {} }));
}

export function readCompileConfig(record: JsonRecord, label: string): CompileConfig {
  const compile = readCompileRecord(record, label);
  if (compile === undefined) {
    return {
      build: "updated",
      features: { promptArguments: true },
      instructionFrontPage: "claude-dir",
      skillset: { metadata: true },
      targets: [...DEFAULT_TARGET_NAMES],
      unsupportedDestination: "error",
    };
  }

  for (const key of Object.keys(compile)) {
    if (
      key !== "build" &&
      key !== "features" &&
      key !== "instruction_front_page" &&
      key !== "skillset" &&
      key !== "targets" &&
      key !== "unsupportedDestination"
    ) {
      throw new Error(`skillset: unsupported compile key ${key} in ${label}`);
    }
  }

  const unsupportedDestination = readUnsupportedDestinationPolicy(compile, `${label}.compile.unsupportedDestination`);

  return {
    build: readCompileBuildMode(compile, `${label}.compile.build`),
    features: readCompileFeatureConfig(compile, `${label}.compile.features`),
    instructionFrontPage: readInstructionFrontPage(
      compile.instruction_front_page,
      `${label}.compile.instruction_front_page`
    ),
    skillset: readCompileSkillsetConfig(compile, `${label}.compile.skillset`),
    targets: readCompileTargetNames(compile, `${label}.compile.targets`),
    unsupportedDestination,
  };
}

export function readCompileTargets(
  record: JsonRecord,
  label: string
): Readonly<Record<TargetName, ResolvedTarget>> {
  const compile = readCompileRecord(record, label);
  const rootDefaults = readShorthandTargetDefaults(record, label);
  if (compile === undefined) return mergeTargetDefaults(defaultTargets(), rootDefaults);

  const targets = readCompileTargetNames(compile, `${label}.compile.targets`);
  const enabledTargets = new Set(targets);

  return mergeTargetDefaults(
    targetRecord((target) => ({ enabled: enabledTargets.has(target), options: {} })),
    rootDefaults
  );
}

function readInstructionFrontPage(
  value: JsonValue | undefined,
  label: string
): InstructionFrontPageDestination {
  if (value === undefined) return "claude-dir";
  if (
    typeof value !== "string" ||
    !INSTRUCTION_FRONT_PAGE_DESTINATIONS.has(
      value as InstructionFrontPageDestination
    )
  ) {
    throw new Error(
      `skillset: expected ${label} to be claude-dir or repo-root`
    );
  }
  return value as InstructionFrontPageDestination;
}

export function readDraftSelectors(
  record: JsonRecord,
  label: string
): readonly string[] {
  const raw = record.drafts;
  if (raw === undefined) return [];
  return readStringArrayValue(raw, `${label}.drafts`);
}

export function readInternalMarker(record: JsonRecord, label: string): boolean {
  const value = record.internal_marker;
  if (value === undefined) return true;
  if (typeof value !== "boolean") {
    throw new Error(`skillset: expected ${label}.internal_marker to be a boolean`);
  }
  return value;
}

export function readWorkspacePluginsConfig(
  record: JsonRecord,
  label: string
): WorkspacePluginsConfig {
  const raw = record.plugins;
  if (raw === undefined) {
    return {
      internalUse: emptyInternalUseConfig(),
      output: defaultPackageOutputConfig(),
    };
  }
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label}.plugins to be an object`);
  }
  for (const key of Object.keys(raw)) {
    if (key !== "internal_use" && key !== "output") {
      throw new Error(`skillset: unsupported ${label}.plugins key ${key}`);
    }
  }
  return {
    internalUse: readInternalUseConfig(
      raw.internal_use,
      `${label}.plugins.internal_use`
    ),
    output: readPackageOutputConfig(raw.output, `${label}.plugins.output`),
  };
}

function emptyInternalUseConfig(): InternalUseConfig {
  return { drafts: {}, plugins: false, skills: {} };
}

function readInternalUseConfig(
  value: JsonValue | undefined,
  label: string
): InternalUseConfig {
  if (value === undefined || value === false) return emptyInternalUseConfig();
  if (value === true) return { drafts: {}, plugins: true, skills: {} };
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label} to be a boolean or an object`);
  }
  for (const key of Object.keys(value)) {
    if (key !== "drafts" && key !== "plugins" && key !== "skills") {
      throw new Error(`skillset: unsupported ${label} key ${key}`);
    }
  }
  return {
    drafts: readInternalUseByPlugin(value.drafts, `${label}.drafts`),
    plugins: readInternalUseSelector(value.plugins, `${label}.plugins`),
    skills: readInternalUseByPlugin(value.skills, `${label}.skills`),
  };
}

function readInternalUseByPlugin(
  value: JsonValue | undefined,
  label: string
): Readonly<Record<string, InternalUseConfig["plugins"]>> {
  if (value === undefined) return {};
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label} to be an object`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([pluginId, selection]) => [
      pluginId,
      readInternalUseSelector(selection, `${label}.${pluginId}`),
    ])
  );
}

function readInternalUseSelector(
  value: JsonValue | undefined,
  label: string
): InternalUseConfig["plugins"] {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  return readStringArrayValue(value, label);
}

function defaultPackageOutputConfig(): WorkspacePluginsConfig["output"] {
  return {
    path: DEFAULT_PACKAGE_OUTPUT_PATH,
    targets: targetRecord(() => ({})),
  };
}

function readPackageOutputConfig(
  value: JsonValue | undefined,
  label: string
): WorkspacePluginsConfig["output"] {
  if (value === undefined) return defaultPackageOutputConfig();
  if (typeof value === "string") {
    return { path: value, targets: targetRecord(() => ({})) };
  }
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label} to be a path or an object`);
  }
  for (const key of Object.keys(value)) {
    if (key !== "path" && !isTargetName(key)) {
      throw new Error(`skillset: unsupported ${label} key ${key}`);
    }
  }
  return {
    path: readString(value, "path") ?? DEFAULT_PACKAGE_OUTPUT_PATH,
    targets: targetRecord((target) =>
      readPackageOutputTarget(value[target], `${label}.${target}`)
    ),
  };
}

function readPackageOutputTarget(
  value: JsonValue | undefined,
  label: string
): WorkspacePluginsConfig["output"]["targets"][TargetName] {
  if (value === undefined) return {};
  if (typeof value === "string") return { path: value };
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label} to be a path or an object`);
  }
  for (const key of Object.keys(value)) {
    if (key !== "combine" && key !== "name" && key !== "path") {
      throw new Error(`skillset: unsupported ${label} key ${key}`);
    }
  }
  const combine = value.combine;
  if (combine !== undefined && typeof combine !== "boolean") {
    throw new Error(`skillset: expected ${label}.combine to be a boolean`);
  }
  const name = readString(value, "name");
  const path = readString(value, "path");
  return {
    ...(combine === undefined ? {} : { combine }),
    ...(name === undefined ? {} : { name }),
    ...(path === undefined ? {} : { path }),
  };
}

function readCompileTargetNames(record: JsonRecord, label: string): readonly TargetName[] {
  const targets = record.targets;
  if (targets === undefined) return [...DEFAULT_TARGET_NAMES];
  if (!Array.isArray(targets)) {
    throw new Error(`skillset: expected ${label} to be a string array`);
  }
  const enabledTargets = new Set<TargetName>();
  for (const target of targets) {
    if (!isTargetName(target)) {
      throw new Error(
        `skillset: unsupported target ${JSON.stringify(target)} in ${label}; expected ${TARGET_LIST_TEXT}`
      );
    }
    if (enabledTargets.has(target)) {
      throw new Error(`skillset: duplicate target ${JSON.stringify(target)} in ${label}`);
    }
    enabledTargets.add(target);
  }

  return [...enabledTargets];
}

export function readSkillsetMetadata(record: JsonRecord, label: string): JsonRecord {
  rejectTargetsKey(record, label);
  const raw = record.skillset;
  if (raw === undefined) return {};
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label}.skillset to be an object`);
  }
  return raw;
}

/**
 * Resolve root/plugin source identity. Machine identity derives from the
 * directory name by default; an explicit `skillset.name` overrides it.
 * `topLevelName` is used by import helpers that need to compare imported skill
 * frontmatter before the compiler normalizes it.
 */
export function readSkillsetName(
  metadata: JsonRecord,
  fallback: string,
  label: string,
  topLevelName?: string
): string {
  const name = readString(metadata, "name");
  const id = readString(metadata, "id");
  if (id !== undefined) {
    throw new Error(`skillset: ${label} uses unsupported skillset.id; use skillset.name`);
  }
  if (topLevelName !== undefined && name !== undefined && topLevelName !== name) {
    throw new Error(
      `skillset: ${label} has conflicting top-level name ${JSON.stringify(topLevelName)} and skillset.name ${JSON.stringify(name)}`
    );
  }
  return topLevelName ?? name ?? fallback;
}

export function readOutputConfig(
  record: JsonRecord,
  metadata: JsonRecord,
  options: { readonly distDir?: string } = {}
): OutputConfig {
  rejectProviderSkillOutputRoots(record);
  rejectLegacySkillOutputRoots(metadata);
  const outputs = readRecord(metadata, "outputs") ?? {};
  const pluginOutputs = readRecord(outputs, "plugins") ?? {};
  const claudePlugins = readTargetOutputSetting(record.claude, "plugins", "claude.plugins");
  const claudeSkills = readTargetOutputSetting(record.claude, "skills", "claude.skills");
  const codexPlugins = readTargetOutputSetting(record.codex, "plugins", "codex.plugins");
  const codexSkills = readTargetOutputSetting(record.codex, "skills", "codex.skills");
  const cursorPlugins = readTargetOutputSetting(record.cursor, "plugins", "cursor.plugins");
  const cursorSkills = readTargetOutputSetting(record.cursor, "skills", "cursor.skills");

  return {
    plugins: {
      claude:
        claudePlugins.path ??
        readString(pluginOutputs, "claude") ??
        (options.distDir === undefined ? DEFAULT_PLUGIN_OUTPUT_ROOT : `${options.distDir}/claude`),
      codex:
        codexPlugins.path ??
        readString(pluginOutputs, "codex") ??
        (options.distDir === undefined ? DEFAULT_PLUGIN_OUTPUT_ROOT : `${options.distDir}/codex`),
      cursor:
        cursorPlugins.path ??
        readString(pluginOutputs, "cursor") ??
        (options.distDir === undefined ? DEFAULT_PLUGIN_OUTPUT_ROOT : `${options.distDir}/cursor`),
    },
    skills: targetRecord(fixedSkillOutputRoot),
    targetOutputs: {
      claude: {
        plugins: claudePlugins.selection,
        skills: claudeSkills.selection,
      },
      codex: {
        plugins: codexPlugins.selection,
        skills: codexSkills.selection,
      },
      cursor: {
        plugins: cursorPlugins.selection,
        skills: cursorSkills.selection,
      },
    },
  };
}

export function readDistributionConfig(
  record: JsonRecord,
  label: string
): Readonly<Record<string, DistributionConfig>> {
  const raw = record.distributions;
  if (raw === undefined) return {};
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label}.distributions to be an object`);
  }

  const result: Record<string, DistributionConfig> = {};
  for (const name of Object.keys(raw).sort()) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
      throw new Error(`skillset: expected ${label}.distributions key ${JSON.stringify(name)} to be a lowercase id`);
    }
    const value = raw[name];
    if (!isJsonRecord(value)) {
      throw new Error(`skillset: expected ${label}.distributions.${name} to be an object`);
    }
    for (const key of Object.keys(value)) {
      if (key !== "dryRun" && key !== "from" && key !== "to") {
        throw new Error(`skillset: unsupported distribution key ${key} in ${label}.distributions.${name}`);
      }
    }
    result[name] = readDistributionObject(value, `${label}.distributions.${name}`);
  }
  return result;
}

export function readMarketplaceCatalogConfig(
  record: JsonRecord,
  label: string
): Readonly<Record<string, MarketplaceCatalogConfig>> {
  const raw = record.marketplaces;
  if (raw === undefined) return {};
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label}.marketplaces to be an object`);
  }

  const result: Record<string, MarketplaceCatalogConfig> = {};
  let codexCatalog: string | undefined;
  for (const name of Object.keys(raw)) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
      throw new Error(`skillset: expected ${label}.marketplaces key ${JSON.stringify(name)} to be a lowercase id`);
    }
    const value = raw[name];
    if (!isJsonRecord(value)) {
      throw new Error(`skillset: expected ${label}.marketplaces.${name} to be an object`);
    }
    for (const key of Object.keys(value)) {
      if (key !== "description" && key !== "plugins" && key !== "targets" && key !== "title") {
        throw new Error(`skillset: unsupported marketplace key ${key} in ${label}.marketplaces.${name}`);
      }
    }
    const catalog = readMarketplaceCatalogObject(
      value,
      `${label}.marketplaces.${name}`
    );
    if (catalog.targets.includes("codex")) {
      if (codexCatalog !== undefined) {
        throw new Error(
          `skillset: Codex supports exactly one marketplace catalog; ${codexCatalog} and ${name} both target codex`
        );
      }
      codexCatalog = name;
    }
    result[name] = catalog;
  }
  return result;
}

export function validateConfigDocument(
  record: JsonRecord,
  label: string,
  options: { readonly allowCompile?: boolean; readonly allowHooks?: boolean } = {}
): void {
  rejectProviderSkillOutputRoots(record);
  if (isJsonRecord(record.skillset)) rejectLegacySkillOutputRoots(record.skillset);
  if (options.allowCompile === true) {
    validateWorkspaceSchemaDocument(record, label, ROOT_CONFIG_TOP_LEVEL_KEYS, validateSingleFileRootConfig, "top-level");
    return;
  }
  if (options.allowHooks === true) {
    validateWorkspaceSchemaDocument(record, label, PLUGIN_CONFIG_TOP_LEVEL_KEYS, validatePluginConfig, "top-level");
    return;
  }
  validateWorkspaceSchemaDocument(record, label, BASE_CONFIG_TOP_LEVEL_KEYS, validateSingleFileRootConfig, "top-level");
}

export function validateWorkspaceConfigDocument(record: JsonRecord, label: string): void {
  validateWorkspaceSchemaDocument(record, label, WORKSPACE_CONFIG_TOP_LEVEL_KEYS, validateSplitWorkspaceConfig, "workspace");
}

export function validateRootSourceManifestDocument(record: JsonRecord, label: string): void {
  validateWorkspaceSchemaDocument(record, label, ROOT_SOURCE_MANIFEST_TOP_LEVEL_KEYS, validateRootSourceManifest, "root-source-manifest");
}

export function resolveTargets(
  parent: Readonly<Record<TargetName, ResolvedTarget>>,
  record: JsonRecord,
  label: string,
  options: {
    readonly allowDefaults?: boolean;
    readonly objectInheritsEnabled?: boolean;
  } = {}
): Readonly<Record<TargetName, ResolvedTarget>> {
  rejectTargetsKey(record, label);
  if (record.defaults !== undefined && options.allowDefaults !== true) {
    throw new Error(
      `skillset: ${label} uses unsupported defaults key; configure target defaults in root or plugin config`
    );
  }
  const parentWithDefaults =
    options.allowDefaults === true
      ? mergeTargetDefaults(parent, readShorthandTargetDefaults(record, label))
      : parent;
  return targetRecord((target) =>
    resolveTarget(parentWithDefaults[target], record[target], `${label}.${target}`, options)
  );
}

export function resolveFeatureTargets(
  parent: Readonly<Record<TargetName, ResolvedTarget>>,
  record: JsonRecord,
  label: string,
  surface: FeatureSurface,
  options: {
    readonly allowDefaults?: boolean;
    readonly objectInheritsEnabled?: boolean;
  } = {}
): Readonly<Record<TargetName, ResolvedTarget>> {
  return applyFeatureTargetDefaults(resolveTargets(parent, record, label, options), surface);
}

export function applyFeatureTargetDefaults(
  targets: Readonly<Record<TargetName, ResolvedTarget>>,
  surface: FeatureSurface
): Readonly<Record<TargetName, ResolvedTarget>> {
  return targetRecord((target) => applyFeatureDefaults(targets[target], surface));
}

export function resolveTarget(
  parent: ResolvedTarget,
  raw: JsonValue | undefined,
  label: string,
  options: {
    readonly allowDefaults?: boolean;
    readonly objectInheritsEnabled?: boolean;
  } = {}
): ResolvedTarget {
  if (raw === undefined) return parent;
  if (raw === true) return { enabled: true, options: parent.options };
  if (raw === false) return { enabled: false, options: parent.options };

  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label} to be true, false, or an object`);
  }

  const { enabled, ...rest } = raw;
  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new Error(`skillset: expected ${label}.enabled to be a boolean`);
  }
  if (rest.defaults !== undefined) {
    if (options.allowDefaults !== true) {
      throw new Error(
        `skillset: ${label}.defaults is only supported in root or plugin config`
      );
    }
    if (!isJsonRecord(rest.defaults)) {
      throw new Error(`skillset: expected ${label}.defaults to be an object`);
    }
    validateDefaultSurfaces(rest.defaults, `${label}.defaults`);
  }

  return {
    enabled:
      enabled === undefined && options.objectInheritsEnabled === true
        ? parent.enabled
        : enabled !== false,
    options: mergeRecords(parent.options, rest),
  };
}

export function stripSourceFrontmatter(frontmatter: JsonRecord, label = "source frontmatter"): JsonRecord {
  if (frontmatter.tool_intent !== undefined) {
    throw new Error(`skillset: ${label} uses retired tool_intent; use tools`);
  }
  const stripped: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || SOURCE_ONLY_KEYS.has(key)) continue;
    stripped[key] = value;
  }
  return stripped;
}

export function mergeRecords(base: JsonRecord, override: JsonRecord): JsonRecord {
  const merged: Record<string, JsonValue> = {};

  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) merged[key] = value;
  }

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = merged[key];
    if (isJsonRecord(current) && isJsonRecord(value)) {
      merged[key] = mergeRecords(current, value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

export function readString(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function readStringArray(record: JsonRecord, key: string): readonly string[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  return readStringArrayValue(value, key);
}

export function readRecord(record: JsonRecord, key: string): JsonRecord | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${key} to be an object`);
  }
  return value;
}

export function isOutputSelected(selection: OutputSelection, name: string): boolean {
  if (selection === true) return true;
  if (selection === false) return false;
  return selection.includes(name);
}

function rejectTargetsKey(record: JsonRecord, label: string): void {
  if (record.targets !== undefined) {
    throw new Error(`skillset: ${label} uses unsupported targets key; use compile.targets`);
  }
}

function validateWorkspaceSchemaDocument(
  record: JsonRecord,
  label: string,
  supportedKeys: ReadonlySet<string>,
  validator: (value: unknown, path?: string) => SkillsetSchemaValidationResult,
  keyMessageKind: "top-level" | "workspace" | "root-source-manifest"
): void {
  const messages: string[] = [];
  for (const key of Object.keys(record)) {
    if (key === "targets") {
      messages.push(`${label} uses unsupported targets key; use compile.targets`);
    } else if (!supportedKeys.has(key)) {
      messages.push(unsupportedWorkspaceKeyMessage(key, label, keyMessageKind));
    }
  }

  for (const diagnostic of validator(record, "$").diagnostics) {
    if (diagnostic.code.endsWith("/unsupported-destination")) continue;
    if (shouldDeferSourceMetadataDiagnostic(diagnostic)) continue;
    const topLevelKey = schemaTopLevelKey(diagnostic.path);
    if (topLevelKey !== undefined && !supportedKeys.has(topLevelKey)) {
      continue;
    }
    messages.push(workspaceSchemaMessage(diagnostic, record, label, keyMessageKind));
  }

  if (messages.length > 0) {
    throw new Error(`skillset: ${dedupeMessages(messages).join("; ")}`);
  }
}

function unsupportedWorkspaceKeyMessage(
  key: string,
  label: string,
  kind: "top-level" | "workspace" | "root-source-manifest"
): string {
  if (kind === "workspace") {
    return `unsupported workspace config key ${key} in ${label}; move source identity and compatibility metadata to the workspace manifest`;
  }
  if (kind === "root-source-manifest") return `unsupported root source manifest key ${key} in ${label}`;
  return `unsupported top-level key ${key} in ${label}`;
}

function workspaceSchemaMessage(
  diagnostic: SkillsetSchemaDiagnostic,
  record: JsonRecord,
  label: string,
  keyMessageKind: "top-level" | "workspace" | "root-source-manifest"
): string {
  const path = schemaPathToLabel(diagnostic.path, label);
  const key = diagnostic.path.split(".").at(-1) ?? "";
  const normalizedCode = diagnostic.code.replace(
    /^schema\/(?:single-file-root-config|split-workspace-config)\//,
    "schema/workspace-config/"
  );
  switch (normalizedCode) {
    case "schema/workspace-config/key":
      if (key === "targets") return `${label} uses unsupported targets key; use compile.targets`;
      return unsupportedWorkspaceKeyMessage(key, label, keyMessageKind);
    case "schema/workspace-config/targets":
      if (diagnostic.path === "$.targets") return `${label} uses unsupported targets key; use compile.targets`;
      return workspaceCompileTargetsMessage(record, label);
    case "schema/workspace-config/target":
      return `unsupported target ${JSON.stringify(valueAtSchemaPath(record, diagnostic.path))} in ${path.replace(/\[\d+\]$/, "")}; expected ${TARGET_LIST_TEXT}`;
    case "schema/workspace-config/target-duplicate":
      return `duplicate target ${JSON.stringify(valueAtSchemaPath(record, diagnostic.path))} in ${path.replace(/\[\d+\]$/, "")}`;
    case "schema/workspace-config/compile":
      return `expected ${path} to be an object`;
    case "schema/workspace-config/compile-key":
      return `unsupported compile key ${key} in ${label}.compile`;
    case "schema/workspace-config/compile-build":
      return workspaceCompileBuildMessage(record, label);
    case "schema/workspace-config/boolean-record":
      return `expected ${path} to be an object`;
    case "schema/workspace-config/boolean-record-key":
      if (diagnostic.path.startsWith("$.compile.features.")) {
        return `unsupported compile feature key ${key} in ${label}.compile.features`;
      }
      if (diagnostic.path.startsWith("$.compile.skillset.")) {
        return `unsupported compile skillset key ${key} in ${label}.compile.skillset`;
      }
      return diagnostic.message.replaceAll("$.", "");
    case "schema/workspace-config/boolean-record-value":
      return `expected ${path} to be a boolean`;
    case "schema/workspace-config/workspace":
      return `expected ${path} to be an object`;
    case "schema/workspace-config/workspace-key":
      return `unsupported workspace key ${key} in ${label}.workspace`;
    case "schema/workspace-config/cache-key":
      return `${path} must be a lowercase repo cache key`;
    case "schema/source-metadata/type":
      return `expected ${path} to be an object`;
    case "schema/source-metadata/key":
      if (diagnostic.path.endsWith(".skillset.id")) {
        return `${path.replace(/\.id$/, "")} uses unsupported skillset.id; use skillset.name`;
      }
      return diagnostic.message.replaceAll("$.", `${label}.`).replaceAll("$", label);
    default:
      return diagnostic.message.replaceAll("$.", `${label}.`).replaceAll("$", label);
  }
}

function workspaceCompileTargetsMessage(record: JsonRecord, label: string): string {
  const compile = record.compile;
  const targets = isJsonRecord(compile) ? compile.targets : undefined;
  if (!Array.isArray(targets)) return `expected ${label}.compile.targets to be a string array`;
  return "compile.targets must be an array";
}

function workspaceCompileBuildMessage(record: JsonRecord, label: string): string {
  const compile = record.compile;
  const value = isJsonRecord(compile) ? compile.build : undefined;
  if (typeof value !== "string") return `expected ${label}.compile.build to be one of: updated, all`;
  return `unsupported ${label}.compile.build ${JSON.stringify(value)}; expected one of: updated, all`;
}

function shouldDeferSourceMetadataDiagnostic(diagnostic: SkillsetSchemaDiagnostic): boolean {
  return diagnostic.path === "$.skillset.schema" || diagnostic.path === "$.skillset.version";
}

function schemaTopLevelKey(path: string): string | undefined {
  if (!path.startsWith("$.")) return undefined;
  return path.slice(2).split(/[.[\]]/, 1)[0];
}

function schemaPathToLabel(path: string, label: string): string {
  if (path === "$") return label;
  if (path.startsWith("$.")) return `${label}.${path.slice(2)}`;
  if (path.startsWith("$[")) return `${label}${path.slice(1)}`;
  return path.replaceAll("$", label);
}

function valueAtSchemaPath(record: JsonRecord, path: string): JsonValue | undefined {
  if (!path.startsWith("$.")) return undefined;
  let current: JsonValue | undefined = record;
  for (const segment of path.slice(2).replaceAll("[", ".").replaceAll("]", "").split(".")) {
    if (segment.length === 0) continue;
    if (Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (isJsonRecord(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function dedupeMessages(messages: readonly string[]): readonly string[] {
  return [...new Set(messages)];
}

function readCompileRecord(record: JsonRecord, label: string): JsonRecord | undefined {
  const compile = record.compile;
  if (compile === undefined) return undefined;
  if (!isJsonRecord(compile)) {
    throw new Error(`skillset: expected ${label}.compile to be an object`);
  }
  return compile;
}

function readCompileBuildMode(record: JsonRecord, label: string): CompileBuildMode {
  const value = record.build;
  if (value === undefined) return "updated";
  if (typeof value !== "string") {
    throw new Error(`skillset: expected ${label} to be one of: updated, all`);
  }
  if (!COMPILE_BUILD_MODES.has(value as CompileBuildMode)) {
    throw new Error(
      `skillset: unsupported ${label} ${JSON.stringify(value)}; expected one of: updated, all`
    );
  }
  return value as CompileBuildMode;
}

function readCompileSkillsetConfig(record: JsonRecord, label: string): CompileSkillsetConfig {
  const value = record.skillset;
  if (value === undefined) return { metadata: true };
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label} to be an object`);
  }
  for (const key of Object.keys(value)) {
    if (key !== "metadata") {
      throw new Error(`skillset: unsupported compile skillset key ${key} in ${label}`);
    }
  }
  const metadata = value.metadata;
  if (metadata === undefined) return { metadata: true };
  if (typeof metadata !== "boolean") {
    throw new Error(`skillset: expected ${label}.metadata to be a boolean`);
  }
  return { metadata };
}

function readCompileFeatureConfig(record: JsonRecord, label: string): CompileFeatureConfig {
  const value = record.features;
  if (value === undefined) return { promptArguments: true };
  if (!isJsonRecord(value)) {
    throw new Error(`skillset: expected ${label} to be an object`);
  }
  for (const key of Object.keys(value)) {
    if (key !== "promptArguments") {
      throw new Error(`skillset: unsupported compile feature key ${key} in ${label}`);
    }
  }
  const promptArguments = value.promptArguments;
  if (promptArguments === undefined) return { promptArguments: true };
  if (typeof promptArguments !== "boolean") {
    throw new Error(`skillset: expected ${label}.promptArguments to be a boolean`);
  }
  return { promptArguments };
}

function readUnsupportedDestinationPolicy(record: JsonRecord, label: string): UnsupportedDestinationPolicy {
  const value = record.unsupportedDestination;
  if (value === undefined) return "error";
  if (typeof value !== "string") {
    throw new Error(`skillset: expected ${label} to be one of: error, warn, skip, force`);
  }
  if (!UNSUPPORTED_DESTINATION_POLICIES.has(value as UnsupportedDestinationPolicy)) {
    throw new Error(
      `skillset: unsupported ${label} ${JSON.stringify(value)}; expected one of: error, warn, skip, force`
    );
  }
  return value as UnsupportedDestinationPolicy;
}

function readDistributionObject(record: JsonRecord, label: string): DistributionConfig {
  const from = readDistributionFrom(record.from, `${label}.from`);
  const to = readDistributionTo(record.to, `${label}.to`);
  const dryRun = record.dryRun;
  if (dryRun !== undefined && typeof dryRun !== "boolean") {
    throw new Error(`skillset: expected ${label}.dryRun to be a boolean`);
  }
  return {
    dryRun: dryRun ?? true,
    from,
    to,
  };
}

function readMarketplaceCatalogObject(record: JsonRecord, label: string): MarketplaceCatalogConfig {
  const title = readOptionalString(record, "title", `${label}.title`);
  const description = readOptionalString(record, "description", `${label}.description`);
  const targets = readOptionalTargetNames(record.targets, `${label}.targets`) ?? targetNames();
  const rawPlugins = record.plugins;
  if (!Array.isArray(rawPlugins) || rawPlugins.length === 0) {
    throw new Error(`skillset: expected ${label}.plugins to be a non-empty array`);
  }

  const plugins = rawPlugins.map((entry, index) =>
    readMarketplacePluginEntry(entry, `${label}.plugins[${index}]`)
  );
  const seenIds = new Map<string, Set<TargetName>>();
  for (const entry of plugins) {
    const effectiveTargets = entry.targets ?? targets;
    const seenTargets = seenIds.get(entry.id) ?? new Set<TargetName>();
    if (effectiveTargets.some((target) => seenTargets.has(target))) {
      throw new Error(
        `skillset: expected ${label}.plugins to have unique effective ids per target; duplicate ${entry.id}`
      );
    }
    for (const target of effectiveTargets) seenTargets.add(target);
    seenIds.set(entry.id, seenTargets);
  }

  return {
    ...(description === undefined ? {} : { description }),
    plugins,
    targets,
    ...(title === undefined ? {} : { title }),
  };
}

function readMarketplacePluginEntry(raw: JsonValue | undefined, label: string): MarketplacePluginEntryConfig {
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label} to be an object`);
  }
  for (const key of Object.keys(raw)) {
    if (key !== "channel" && key !== "codex" && key !== "id" && key !== "plugin" && key !== "ref" && key !== "repo" && key !== "sha" && key !== "targets" && key !== "version") {
      throw new Error(`skillset: unsupported marketplace plugin key ${key} in ${label}`);
    }
  }

  const plugin = readRequiredString(raw, "plugin", `${label}.plugin`);
  const codex = readCodexMarketplacePluginConfig(raw.codex, `${label}.codex`);
  const id = readOptionalString(raw, "id", `${label}.id`) ?? plugin;
  validateMarketplaceId(id, `${label}.id`);
  validateMarketplaceId(plugin, `${label}.plugin`);
  const repo = readOptionalString(raw, "repo", `${label}.repo`);
  if (repo !== undefined) validateMarketplaceRepo(repo, `${label}.repo`);
  const targets = readOptionalTargetNames(raw.targets, `${label}.targets`);
  const channel = readOptionalString(raw, "channel", `${label}.channel`);
  const ref = readOptionalString(raw, "ref", `${label}.ref`);
  const sha = readOptionalString(raw, "sha", `${label}.sha`);
  const version = readOptionalString(raw, "version", `${label}.version`);
  const policies = [channel, ref, sha, version].filter((value) => value !== undefined);
  if (policies.length > 1) {
    throw new Error(`skillset: expected ${label} to set at most one of channel, ref, sha, or version`);
  }
  if (channel !== undefined && channel !== "latest") {
    throw new Error(`skillset: expected ${label}.channel to be latest`);
  }
  if (ref !== undefined) validateRemoteRepositoryRevision({ kind: "ref", ref });
  if (sha !== undefined) validateRemoteRepositoryRevision({ kind: "sha", sha });
  if (version !== undefined) validateRemoteRepositoryRevision({ kind: "version", version });
  return {
    ...(channel === undefined ? {} : { channel }),
    ...(codex === undefined ? {} : { codex }),
    id,
    plugin,
    ...(ref === undefined ? {} : { ref }),
    ...(repo === undefined ? {} : { repo }),
    ...(sha === undefined ? {} : { sha }),
    ...(targets === undefined ? {} : { targets }),
    ...(version === undefined ? {} : { version }),
  };
}

function readCodexMarketplacePluginConfig(
  raw: JsonValue | undefined,
  label: string
): CodexMarketplacePluginConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label} to be an object`);
  }
  const allowed = new Set([
    "author",
    "category",
    "description",
    "displayName",
    "homepage",
    "interface",
    "keywords",
    "policy",
    "source",
    "version",
  ]);
  rejectUnknownKeys(raw, allowed, label, "Codex marketplace plugin");
  const author = readCodexMarketplaceAuthor(raw.author, `${label}.author`);
  const category = readOptionalString(raw, "category", `${label}.category`);
  const description = readOptionalString(
    raw,
    "description",
    `${label}.description`
  );
  const homepage = readOptionalString(raw, "homepage", `${label}.homepage`);
  const displayName = readOptionalString(
    raw,
    "displayName",
    `${label}.displayName`
  );
  const authoredInterface = readCodexMarketplaceInterface(
    raw.interface,
    `${label}.interface`
  );
  const interfaceConfig =
    displayName === undefined || authoredInterface?.displayName !== undefined
      ? authoredInterface
      : { ...(authoredInterface ?? {}), displayName };
  const keywords = readOptionalNonEmptyStringArray(
    raw.keywords,
    `${label}.keywords`
  );
  const policy = readCodexMarketplacePolicy(raw.policy, `${label}.policy`);
  const source = readCodexMarketplaceSource(raw.source, `${label}.source`);
  const version = readOptionalString(raw, "version", `${label}.version`);
  if (version !== undefined) {
    validateRemoteRepositoryRevision({ kind: "version", version });
  }
  return {
    ...(author === undefined ? {} : { author }),
    ...(category === undefined ? {} : { category }),
    ...(description === undefined ? {} : { description }),
    ...(homepage === undefined ? {} : { homepage }),
    ...(interfaceConfig === undefined ? {} : { interface: interfaceConfig }),
    ...(keywords === undefined ? {} : { keywords }),
    ...(policy === undefined ? {} : { policy }),
    ...(source === undefined ? {} : { source }),
    ...(version === undefined ? {} : { version }),
  };
}

function readCodexMarketplaceAuthor(
  raw: JsonValue | undefined,
  label: string
): CodexMarketplaceAuthor | undefined {
  if (raw === undefined) return undefined;
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label} to be an object`);
  }
  rejectUnknownKeys(
    raw,
    new Set(["email", "name", "url"]),
    label,
    "Codex marketplace author"
  );
  const name = readRequiredString(raw, "name", `${label}.name`);
  const email = readOptionalString(raw, "email", `${label}.email`);
  const url = readOptionalString(raw, "url", `${label}.url`);
  return {
    ...(email === undefined ? {} : { email }),
    name,
    ...(url === undefined ? {} : { url }),
  };
}

function readCodexMarketplaceInterface(
  raw: JsonValue | undefined,
  label: string
): CodexMarketplaceInterface | undefined {
  if (raw === undefined) return undefined;
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label} to be an object`);
  }
  rejectUnknownKeys(
    raw,
    CODEX_MARKETPLACE_INTERFACE_KEY_SET,
    label,
    "Codex marketplace interface"
  );
  const result: Record<string, string | readonly string[]> = {};
  for (const key of CODEX_MARKETPLACE_INTERFACE_KEYS) {
    if (key === "capabilities" || key === "defaultPrompt" || key === "screenshots") {
      const strings = readOptionalNonEmptyStringArray(
        raw[key],
        `${label}.${key}`
      );
      if (strings === undefined) continue;
      if (
        key === "defaultPrompt" &&
        (strings.length > 3 || strings.some((value) => [...value].length > 128))
      ) {
        throw new Error(
          `skillset: ${label}.defaultPrompt permits at most three 128-character prompts`
        );
      }
      if (
        key === "screenshots" &&
        strings.some((value) => !isCodexMarketplaceLocalPath(value))
      ) {
        throw new Error(
          `skillset: expected ${label}.screenshots entries to be contained ./ asset paths`
        );
      }
      result[key] = strings;
      continue;
    }
    const value = readOptionalString(raw, key, `${label}.${key}`);
    if (value === undefined) continue;
    if (
      (key === "composerIcon" || key === "logo" || key === "logoDark") &&
      !isCodexMarketplaceLocalPath(value)
    ) {
      throw new Error(
        `skillset: expected ${label}.${key} to be a contained ./ asset path`
      );
    }
    result[key] = value;
  }
  return result as CodexMarketplaceInterface;
}

function readCodexMarketplacePolicy(
  raw: JsonValue | undefined,
  label: string
): CodexMarketplacePluginPolicy | undefined {
  if (raw === undefined) return undefined;
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label} to be an object`);
  }
  rejectUnknownKeys(
    raw,
    new Set(["authentication", "installation", "products"]),
    label,
    "Codex marketplace policy"
  );
  const installation = readOptionalString(
    raw,
    "installation",
    `${label}.installation`
  );
  if (
    installation !== undefined &&
    !CODEX_MARKETPLACE_INSTALLATION_POLICY_SET.has(installation)
  ) {
    throw new Error(
      `skillset: expected ${label}.installation to be AVAILABLE, INSTALLED_BY_DEFAULT, or NOT_AVAILABLE`
    );
  }
  const authentication = readOptionalString(
    raw,
    "authentication",
    `${label}.authentication`
  );
  if (
    authentication !== undefined &&
    !CODEX_MARKETPLACE_AUTHENTICATION_POLICY_SET.has(authentication)
  ) {
    throw new Error(
      `skillset: expected ${label}.authentication to be ON_INSTALL or ON_USE`
    );
  }
  const products = readCodexMarketplaceProducts(
    raw.products,
    `${label}.products`
  );
  return {
    ...(authentication === undefined ? {} : { authentication }),
    ...(installation === undefined ? {} : { installation }),
    ...(products === undefined ? {} : { products }),
  } as CodexMarketplacePluginPolicy;
}

function readCodexMarketplaceSource(
  raw: JsonValue | undefined,
  label: string
): CodexMarketplacePluginSource | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "string") {
    if (!isCodexMarketplaceLocalPath(raw)) {
      throw new Error(
        `skillset: expected ${label} to be a contained ./ path relative to the marketplace root`
      );
    }
    return { path: raw, source: "local" };
  }
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label} to be a local path or source object`);
  }
  const source = readRequiredString(raw, "source", `${label}.source`);
  if (!CODEX_MARKETPLACE_SOURCE_KIND_SET.has(source)) {
    throw new Error(
      `skillset: expected ${label}.source to be git-subdir, local, npm, or url`
    );
  }
  if (source === "local") {
    rejectUnknownKeys(
      raw,
      new Set(["path", "source"]),
      label,
      "Codex marketplace local source"
    );
    const path = readRequiredString(raw, "path", `${label}.path`);
    if (!isCodexMarketplaceLocalPath(path)) {
      throw new Error(
        `skillset: expected ${label}.path to be a contained ./ path relative to the marketplace root`
      );
    }
    return { path, source };
  }
  if (source === "npm") {
    rejectUnknownKeys(
      raw,
      new Set(["package", "registry", "source", "version"]),
      label,
      "Codex marketplace npm source"
    );
    const packageName = readRequiredString(raw, "package", `${label}.package`);
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(packageName)) {
      throw new Error(`skillset: expected ${label}.package to be an npm package name`);
    }
    const registry = readOptionalString(raw, "registry", `${label}.registry`);
    if (registry !== undefined && !isCredentialFreeHttpsUrl(registry)) {
      throw new Error(
        `skillset: expected ${label}.registry to be a credential-free HTTPS URL`
      );
    }
    const version = readOptionalString(raw, "version", `${label}.version`);
    if (version !== undefined && !isRegistryNpmVersionSelector(version)) {
      throw new Error(
        `skillset: expected ${label}.version to be an npm registry version, tag, or range`
      );
    }
    return {
      package: packageName,
      ...(registry === undefined ? {} : { registry }),
      source,
      ...(version === undefined ? {} : { version }),
    };
  }
  rejectUnknownKeys(
    raw,
    new Set(["path", "ref", "sha", "source", "url"]),
    label,
    `Codex marketplace ${source} source`
  );
  const url = readRequiredString(raw, "url", `${label}.url`);
  validateCodexMarketplaceGitUrl(url, `${label}.url`);
  const path = readOptionalString(raw, "path", `${label}.path`);
  if (source === "git-subdir" && path === undefined) {
    throw new Error(`skillset: expected ${label}.path to be a non-empty string`);
  }
  if (path !== undefined && !isCodexMarketplaceLocalPath(path)) {
    throw new Error(
      `skillset: expected ${label}.path to be a contained ./ path relative to the repository root`
    );
  }
  const ref = readOptionalString(raw, "ref", `${label}.ref`);
  const sha = readOptionalString(raw, "sha", `${label}.sha`);
  if (ref !== undefined) validateRemoteRepositoryRevision({ kind: "ref", ref });
  if (sha !== undefined) validateRemoteRepositoryRevision({ kind: "sha", sha });
  return {
    ...(path === undefined ? {} : { path }),
    ...(ref === undefined ? {} : { ref }),
    ...(sha === undefined ? {} : { sha }),
    source,
    url,
  } as CodexMarketplacePluginSource;
}

function readCodexMarketplaceProducts(
  raw: JsonValue | undefined,
  label: string
): readonly CodexMarketplaceProduct[] | undefined {
  if (raw === undefined) return undefined;
  if (
    !Array.isArray(raw) ||
    raw.some(
      (value) =>
        typeof value !== "string" || !CODEX_MARKETPLACE_PRODUCT_SET.has(value)
    )
  ) {
    throw new Error(`skillset: expected ${label} entries to be atlas, chatgpt, or codex`);
  }
  const products = raw.map(
    (value) => String(value).toLowerCase() as CodexMarketplaceProduct
  );
  if (new Set(products).size !== products.length) {
    throw new Error(`skillset: expected ${label} entries to be unique`);
  }
  return products;
}

function isRegistryNpmVersionSelector(value: string): boolean {
  return value !== "." && value !== ".." && !/[\\/:]/u.test(value);
}

function rejectUnknownKeys(
  record: JsonRecord,
  allowed: ReadonlySet<string>,
  label: string,
  subject: string
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(`skillset: unsupported ${subject} key ${key} in ${label}`);
    }
  }
}

function readOptionalNonEmptyStringArray(
  raw: JsonValue | undefined,
  label: string
): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.some((value) => typeof value !== "string" || value.trim().length === 0)
  ) {
    throw new Error(`skillset: expected ${label} to be a non-empty string array`);
  }
  return raw.map((value) => String(value));
}

function readOptionalEnumArray(
  raw: JsonValue | undefined,
  label: string,
  allowed: ReadonlySet<string>,
  expected: string,
  allowEmpty: boolean
): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  if (
    !Array.isArray(raw) ||
    (!allowEmpty && raw.length === 0) ||
    raw.some((value) => typeof value !== "string" || !allowed.has(value))
  ) {
    throw new Error(`skillset: expected ${label} entries to be ${expected}`);
  }
  if (new Set(raw).size !== raw.length) {
    throw new Error(`skillset: expected ${label} entries to be unique`);
  }
  return raw.map((value) => String(value));
}

function validateCodexMarketplaceGitUrl(value: string, label: string): void {
  if (isCodexMarketplaceFileGitUrl(value) || value.startsWith("/")) return;
  try {
    parseRemoteRepositoryReference(value);
  } catch {
    throw new Error(
      `skillset: expected ${label} to be a credential-free remote Git URL, file URL, or absolute path`
    );
  }
}

function isCodexMarketplaceFileGitUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "file:" &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0 &&
      url.pathname.startsWith("/")
    );
  } catch {
    return false;
  }
}

function isCodexMarketplaceLocalPath(value: string): boolean {
  return value.startsWith("./") && isCodexMarketplaceRemoteSubdir(value.slice(2));
}

function isCodexMarketplaceRemoteSubdir(value: string): boolean {
  return value.length > 0 &&
    value === value.trim() &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function isCredentialFreeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.hostname.length > 0 &&
      url.search.length === 0 &&
      url.hash.length === 0;
  } catch {
    return false;
  }
}

function readOptionalTargetNames(raw: JsonValue | undefined, label: string): readonly TargetName[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`skillset: expected ${label} to be a non-empty target array`);
  }
  const seen = new Set<TargetName>();
  for (const target of raw) {
    if (!isTargetName(target)) {
      throw new Error(`skillset: unsupported target ${JSON.stringify(target)} in ${label}; expected ${TARGET_LIST_TEXT}`);
    }
    if (seen.has(target)) {
      throw new Error(`skillset: duplicate target ${JSON.stringify(target)} in ${label}`);
    }
    seen.add(target);
  }
  return [...seen];
}

function validateMarketplaceId(value: string, label: string): void {
  if (/^[a-z0-9][a-z0-9-]*$/.test(value)) return;
  throw new Error(`skillset: expected ${label} to be a lowercase plugin id`);
}

function validateMarketplaceRepo(value: string, label: string): void {
  if (
    value.startsWith(".") ||
    value.startsWith("/") ||
    value.startsWith("~") ||
    value.startsWith("file:") ||
    /^[A-Za-z]:[\\/]/.test(value)
  ) {
    throw new Error(`skillset: expected ${label} to be a remote repo reference, not a filesystem path`);
  }
  try {
    parseRemoteRepositoryReference(value);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^skillset:\s*/u, "") : String(error);
    throw new Error(`skillset: invalid ${label}: ${message}`);
  }
}

function readDistributionFrom(raw: JsonValue | undefined, label: string): DistributionConfig["from"] {
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label} to be an object`);
  }
  for (const key of Object.keys(raw)) {
    if (key !== "runtime" && key !== "selector" && key !== "target") {
      throw new Error(`skillset: unsupported distribution from key ${key} in ${label}`);
    }
  }

  const target = raw.target;
  if (!isTargetName(target)) {
    throw new Error(`skillset: expected ${label}.target to be ${TARGET_LIST_TEXT}`);
  }
  const selector = readRequiredString(raw, "selector", `${label}.selector`);
  const runtime = readDistributionRuntime(raw, target, label);
  return {
    ...(runtime === undefined ? {} : { runtime }),
    selector,
    target,
  };
}

function readDistributionTo(raw: JsonValue | undefined, label: string): DistributionConfig["to"] {
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label} to be an object`);
  }
  for (const key of Object.keys(raw)) {
    if (key !== "branch" && key !== "kind" && key !== "path" && key !== "repo" && key !== "subdirectory") {
      throw new Error(`skillset: unsupported distribution to key ${key} in ${label}`);
    }
  }

  const kind = raw.kind;
  if (kind !== "git" && kind !== "local") {
    throw new Error(`skillset: expected ${label}.kind to be local or git`);
  }
  const path = readOptionalString(raw, "path", `${label}.path`);
  const repo = readOptionalString(raw, "repo", `${label}.repo`);
  const branch = readOptionalString(raw, "branch", `${label}.branch`);
  const subdirectory = readOptionalString(raw, "subdirectory", `${label}.subdirectory`);
  if (kind === "local" && path === undefined) {
    throw new Error(`skillset: ${label}.path is required for local distributions`);
  }
  if (kind === "local" && repo !== undefined) {
    throw new Error(`skillset: ${label}.repo is only supported for git distributions`);
  }
  if (kind === "git" && repo === undefined) {
    throw new Error(`skillset: ${label}.repo is required for git distributions`);
  }
  if (kind === "git" && path !== undefined) {
    throw new Error(`skillset: ${label}.path is only supported for local distributions`);
  }
  return {
    ...(branch === undefined ? {} : { branch }),
    kind,
    ...(path === undefined ? {} : { path }),
    ...(repo === undefined ? {} : { repo }),
    ...(subdirectory === undefined ? {} : { subdirectory }),
  };
}

function readDistributionRuntime(
  record: JsonRecord,
  target: TargetName,
  label: string
): SkillsetRuntimeId | undefined {
  const runtime = readOptionalString(record, "runtime", `${label}.runtime`);
  if (runtime === undefined) return undefined;
  if (!SKILLSET_RUNTIME_IDS.includes(runtime as SkillsetRuntimeId)) {
    throw new Error(`skillset: unsupported ${label}.runtime ${JSON.stringify(runtime)}; expected one of: ${SKILLSET_RUNTIME_IDS.join(", ")}`);
  }
  const runtimeId = runtime as SkillsetRuntimeId;
  const compatible = DISTRIBUTION_RUNTIME_TARGETS[target];
  if (!compatible.includes(runtimeId)) {
    throw new Error(`skillset: ${label}.runtime ${runtime} is not compatible with target ${target}; expected one of: ${compatible.join(", ")}`);
  }
  return runtimeId;
}

function readRequiredString(record: JsonRecord, key: string, label: string): string {
  const value = readOptionalString(record, key, label);
  if (value === undefined) {
    throw new Error(`skillset: expected ${label} to be a non-empty string`);
  }
  return value;
}

function readOptionalString(record: JsonRecord, key: string, label: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`skillset: expected ${label} to be a non-empty string`);
  }
  return value.trim();
}

function readShorthandTargetDefaults(
  record: JsonRecord,
  label: string
): Readonly<Record<TargetName, JsonRecord>> {
  const defaults = record.defaults;
  const result = targetRecord(() => ({}));
  if (defaults === undefined) return result;
  if (!isJsonRecord(defaults)) {
    throw new Error(`skillset: expected ${label}.defaults to be an object`);
  }
  for (const key of Object.keys(defaults)) {
    if (!isTargetName(key)) {
      throw new Error(
        `skillset: unsupported target ${JSON.stringify(key)} in ${label}.defaults; expected ${TARGET_LIST_TEXT}`
      );
    }
    const targetDefaults = defaults[key];
    if (!isJsonRecord(targetDefaults)) {
      throw new Error(`skillset: expected ${label}.defaults.${key} to be an object`);
    }
    validateDefaultSurfaces(targetDefaults, `${label}.defaults.${key}`);
    result[key] = targetDefaults;
  }
  return result;
}

function validateDefaultSurfaces(defaults: JsonRecord, label: string): void {
  for (const key of Object.keys(defaults)) {
    if (!DEFAULT_SURFACES.has(key as FeatureSurface)) {
      throw new Error(
        `skillset: unsupported defaults surface ${JSON.stringify(key)} in ${label}; expected agents, instructions, plugins, or skills`
      );
    }
  }
}

function mergeTargetDefaults(
  targets: Readonly<Record<TargetName, ResolvedTarget>>,
  defaults: Readonly<Record<TargetName, JsonRecord>>
): Readonly<Record<TargetName, ResolvedTarget>> {
  return targetRecord((target) => mergeTargetDefault(targets[target], defaults[target]));
}

function mergeTargetDefault(target: ResolvedTarget, defaults: JsonRecord): ResolvedTarget {
  if (Object.keys(defaults).length === 0) return target;
  return {
    enabled: target.enabled,
    options: mergeRecords(target.options, {
      defaults: mergeRecords(readRecord(target.options, "defaults") ?? {}, defaults),
    }),
  };
}

function applyFeatureDefaults(
  target: ResolvedTarget,
  surface: FeatureSurface
): ResolvedTarget {
  const defaults = readRecord(target.options, "defaults");
  if (defaults === undefined) return target;
  const surfaceDefaults = readRecord(defaults, surface);
  if (surfaceDefaults === undefined) return target;
  return {
    enabled: target.enabled,
    options: mergeRecords(surfaceDefaults, target.options),
  };
}

interface ParsedTargetOutputSetting {
  readonly path?: string;
  readonly selection: OutputSelection;
}

function readTargetOutputSetting(
  rawTarget: JsonValue | undefined,
  key: "plugins" | "skills",
  label: string
): ParsedTargetOutputSetting {
  if (rawTarget === undefined || rawTarget === true) return { selection: true };
  if (rawTarget === false) return { selection: false };
  if (!isJsonRecord(rawTarget)) {
    throw new Error(`skillset: expected ${label.split(".")[0]} to be true, false, or an object`);
  }

  if (rawTarget.enabled === false) return { selection: false };
  const rawOutput = rawTarget[key];
  if (rawOutput === undefined) return { selection: true };
  return readOutputSetting(rawOutput, label, key === "plugins");
}

function readOutputSetting(
  raw: JsonValue,
  label: string,
  allowPath: boolean
): ParsedTargetOutputSetting {
  if (raw === true || raw === false) return { selection: raw };
  if (Array.isArray(raw)) return { selection: readStringArrayValue(raw, label) };
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label} to be true, false, a string array, or an object`);
  }

  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
    throw new Error(`skillset: expected ${label}.enabled to be a boolean`);
  }
  if (!allowPath && Object.hasOwn(raw, "path")) {
    throw new Error(`skillset: unsupported ${label}.path; provider skill roots are fixed`);
  }

  const include = raw.include === undefined ? undefined : readStringArrayValue(raw.include, `${label}.include`);
  const path = allowPath ? readString(raw, "path") : undefined;
  return {
    ...(path === undefined ? {} : { path }),
    selection: raw.enabled === false ? false : include ?? true,
  };
}

function rejectProviderSkillOutputRoots(record: JsonRecord): void {
  for (const target of targetNames()) {
    const targetConfig = record[target];
    if (!isJsonRecord(targetConfig) || !isJsonRecord(targetConfig.skills)) continue;
    if (Object.hasOwn(targetConfig.skills, "path")) {
      throw new Error(`skillset: unsupported ${target}.skills.path; provider skill roots are fixed`);
    }
  }
}

function rejectLegacySkillOutputRoots(metadata: JsonRecord): void {
  const outputs = metadata.outputs;
  if (!isJsonRecord(outputs) || !isJsonRecord(outputs.skills)) return;
  for (const target of targetNames()) {
    if (Object.hasOwn(outputs.skills, target)) {
      throw new Error(
        `skillset: unsupported skillset.outputs.skills.${target}; provider skill roots are fixed`
      );
    }
  }
}

function fixedSkillOutputRoot(target: TargetName): string {
  const snapshot = listProviderDestinationFormatSnapshots().find(
    (candidate) => candidate.target === target && candidate.destination === "skill"
  );
  const format = snapshot?.format;
  const directoryPattern = isJsonRecord(format) ? format.directoryPattern : undefined;
  const suffix = "/<skill-name>/";
  if (typeof directoryPattern !== "string" || !directoryPattern.endsWith(suffix)) {
    throw new Error(`skillset: ${target} skill destination format has no fixed project root`);
  }
  return directoryPattern.slice(0, -suffix.length);
}

/**
 * Reads a plugin's claude bundle destination override. Schema validation has
 * already constrained the shape; this narrows defensively for direct callers.
 */
export function readClaudeBundlePath(
  config: JsonRecord,
  label: string
): string | undefined {
  const claude = config.claude;
  if (!isJsonRecord(claude) || claude.bundle === undefined) return undefined;
  if (!isJsonRecord(claude.bundle)) {
    throw new Error(`skillset: expected ${label}.claude.bundle to be an object`);
  }
  const path = readString(claude.bundle, "path");
  if (path === undefined) {
    throw new Error(
      `skillset: expected ${label}.claude.bundle.path to be a string`
    );
  }
  return path;
}

function readStringArrayValue(value: JsonValue, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`skillset: expected ${label} to be a string array`);
  }
  return value.map((item) => String(item));
}
