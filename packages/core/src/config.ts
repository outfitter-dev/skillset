import {
  COMPILE_BUILD_MODES as SCHEMA_COMPILE_BUILD_MODES,
  TARGET_NAMES as SCHEMA_TARGET_NAMES,
  validateSourceMetadata,
  validateWorkspaceConfig,
  type SkillsetSchemaDiagnostic,
} from "@skillset/schema";

import type {
  CompileBuildMode,
  CompileConfig,
  CompileFeatureConfig,
  CompileSkillsetConfig,
  UnsupportedDestinationPolicy,
  DistributionConfig,
  JsonRecord,
  JsonValue,
  MarketplaceCatalogConfig,
  MarketplacePluginEntryConfig,
  OutputConfig,
  OutputSelection,
  ResolvedTarget,
  TargetName,
} from "./types";
import { SKILLSET_RUNTIME_IDS, type SkillsetRuntimeId } from "./feature-registry";
import { isJsonRecord } from "./yaml";

const TARGET_NAMES = SCHEMA_TARGET_NAMES as readonly TargetName[];
export type FeatureSurface = "agents" | "instructions" | "plugins" | "skills";

const DEFAULT_SURFACES = new Set<FeatureSurface>(["agents", "instructions", "plugins", "skills"]);
const CONFIG_TOP_LEVEL_KEYS = new Set(["agents", "changes", "claude", "codex", "defaults", "dependencies", "skillset", "supports"]);
const PLUGIN_CONFIG_TOP_LEVEL_KEYS = new Set([...CONFIG_TOP_LEVEL_KEYS, "hooks"]);
const ROOT_CONFIG_TOP_LEVEL_KEYS = new Set([...CONFIG_TOP_LEVEL_KEYS, "compile", "distributions", "marketplaces", "workspace"]);
const WORKSPACE_CONFIG_TOP_LEVEL_KEYS = new Set(["agents", "changes", "claude", "codex", "compile", "defaults", "dependencies", "distributions", "marketplaces", "workspace"]);
const ROOT_SOURCE_MANIFEST_TOP_LEVEL_KEYS = new Set(["dependencies", "skillset", "supports"]);
const COMPILE_BUILD_MODES = new Set<CompileBuildMode>(SCHEMA_COMPILE_BUILD_MODES as readonly CompileBuildMode[]);
const UNSUPPORTED_DESTINATION_POLICIES = new Set<UnsupportedDestinationPolicy>([
  "error",
  "warn",
  "skip",
  "force",
]);
const DISTRIBUTION_RUNTIME_TARGETS: Readonly<Record<TargetName, readonly SkillsetRuntimeId[]>> = {
  claude: ["claude-code"],
  codex: ["codex-app", "codex-cli"],
};
const SOURCE_ONLY_KEYS = new Set([
  "agents",
  "allowed_tools",
  "bin",
  "claude",
  "changes",
  "compile",
  "codex",
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
  "summary",
  "supports",
  "targets",
  "title",
  "tool_intent",
  "version",
]);

export function defaultTargets(): Readonly<Record<TargetName, ResolvedTarget>> {
  return {
    claude: { enabled: true, options: {} },
    codex: { enabled: true, options: {} },
  };
}

export function readCompileConfig(record: JsonRecord, label: string): CompileConfig {
  const compile = readCompileRecord(record, label);
  if (compile === undefined) {
    return {
      build: "updated",
      features: { promptArguments: true },
      skillset: { metadata: true },
      targets: [...TARGET_NAMES],
      unsupportedDestination: "error",
    };
  }

  for (const key of Object.keys(compile)) {
    if (
      key !== "build" &&
      key !== "features" &&
      key !== "skillset" &&
      key !== "targets" &&
      key !== "unsupportedDestination"
    ) {
      throw new Error(`skillset: unsupported compile key ${key} in ${label}`);
    }
  }

  const unsupportedDestination = readUnsupportedDestinationPolicy(compile, `${label}.compile.unsupportedDestination`);
  if (unsupportedDestination !== "error") {
    throw new Error(
      `skillset: ${label}.compile.unsupportedDestination ${unsupportedDestination} is reserved but not supported yet; ` +
        "use error until warning, skip, or force provenance is implemented"
    );
  }

  return {
    build: readCompileBuildMode(compile, `${label}.compile.build`),
    features: readCompileFeatureConfig(compile, `${label}.compile.features`),
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

  return mergeTargetDefaults({
    claude: { enabled: enabledTargets.has("claude"), options: {} },
    codex: { enabled: enabledTargets.has("codex"), options: {} },
  }, rootDefaults);
}

function readCompileTargetNames(record: JsonRecord, label: string): readonly TargetName[] {
  const targets = record.targets;
  if (targets === undefined) return [...TARGET_NAMES];
  if (!Array.isArray(targets)) {
    throw new Error(`skillset: expected ${label} to be a string array`);
  }
  if (targets.length === 0) {
    throw new Error(`skillset: expected ${label} to include at least one target`);
  }

  const enabledTargets = new Set<TargetName>();
  for (const target of targets) {
    if (target !== "claude" && target !== "codex") {
      throw new Error(
        `skillset: unsupported target ${JSON.stringify(target)} in ${label}; expected claude or codex`
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
  const outputs = readRecord(metadata, "outputs") ?? {};
  const pluginOutputs = readRecord(outputs, "plugins") ?? {};
  const skillOutputs = readRecord(outputs, "skills") ?? {};
  const claudePlugins = readTargetOutputSetting(record.claude, "plugins", "claude.plugins");
  const claudeSkills = readTargetOutputSetting(record.claude, "skills", "claude.skills");
  const codexPlugins = readTargetOutputSetting(record.codex, "plugins", "codex.plugins");
  const codexSkills = readTargetOutputSetting(record.codex, "skills", "codex.skills");

  return {
    plugins: {
      claude:
        claudePlugins.path ??
        readString(pluginOutputs, "claude") ??
        (options.distDir === undefined ? "plugins-claude" : `${options.distDir}/claude`),
      codex:
        codexPlugins.path ??
        readString(pluginOutputs, "codex") ??
        (options.distDir === undefined ? "plugins-codex" : `${options.distDir}/codex`),
    },
    skills: {
      claude: claudeSkills.path ?? readString(skillOutputs, "claude") ?? ".claude/skills",
      codex: codexSkills.path ?? readString(skillOutputs, "codex") ?? ".agents/skills",
    },
    targetOutputs: {
      claude: {
        plugins: claudePlugins.selection,
        skills: claudeSkills.selection,
      },
      codex: {
        plugins: codexPlugins.selection,
        skills: codexSkills.selection,
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
  for (const name of Object.keys(raw).sort()) {
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
    result[name] = readMarketplaceCatalogObject(value, `${label}.marketplaces.${name}`);
  }
  return result;
}

export function validateConfigDocument(
  record: JsonRecord,
  label: string,
  options: { readonly allowCompile?: boolean; readonly allowHooks?: boolean; readonly featureKeys?: readonly string[] } = {}
): void {
  const supportedKeys = options.allowCompile === true
    ? ROOT_CONFIG_TOP_LEVEL_KEYS
    : options.allowHooks === true
      ? PLUGIN_CONFIG_TOP_LEVEL_KEYS
      : CONFIG_TOP_LEVEL_KEYS;
  const featureKeys = new Set(options.featureKeys ?? []);
  if (options.allowCompile === true) {
    validateWorkspaceSchemaDocument(record, label, supportedKeys, "top-level");
    return;
  }
  rejectTargetsKey(record, label);
  for (const key of Object.keys(record)) {
    if (!supportedKeys.has(key) && !featureKeys.has(key)) {
      throw new Error(`skillset: unsupported top-level key ${key} in ${label}`);
    }
  }
  validateSourceMetadataDocument(record.skillset, label);
}

export function validateWorkspaceConfigDocument(record: JsonRecord, label: string): void {
  validateWorkspaceSchemaDocument(record, label, WORKSPACE_CONFIG_TOP_LEVEL_KEYS, "workspace");
}

export function validateRootSourceManifestDocument(record: JsonRecord, label: string): void {
  rejectTargetsKey(record, label);
  for (const key of Object.keys(record)) {
    if (!ROOT_SOURCE_MANIFEST_TOP_LEVEL_KEYS.has(key)) {
      throw new Error(`skillset: unsupported root source manifest key ${key} in ${label}`);
    }
  }
  validateSourceMetadataDocument(record.skillset, label);
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
  return {
    claude: resolveTarget(parentWithDefaults.claude, record.claude, `${label}.claude`, options),
    codex: resolveTarget(parentWithDefaults.codex, record.codex, `${label}.codex`, options),
  };
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
  return {
    claude: applyFeatureDefaults(targets.claude, surface),
    codex: applyFeatureDefaults(targets.codex, surface),
  };
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
  if (frontmatter.tools !== undefined) {
    throw new Error(`skillset: ${label} uses unsupported tools; use tool_intent`);
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

export function targetNames(): readonly TargetName[] {
  return TARGET_NAMES;
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
  keyMessageKind: "top-level" | "workspace"
): void {
  const messages: string[] = [];
  for (const key of Object.keys(record)) {
    if (key === "targets") {
      messages.push(`${label} uses unsupported targets key; use compile.targets`);
    } else if (!supportedKeys.has(key)) {
      messages.push(unsupportedWorkspaceKeyMessage(key, label, keyMessageKind));
    }
  }

  for (const diagnostic of validateWorkspaceConfig(record, "$").diagnostics) {
    if (diagnostic.code === "schema/workspace-config/unsupported-destination") continue;
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
  kind: "top-level" | "workspace"
): string {
  if (kind === "workspace") {
    return `unsupported workspace config key ${key} in ${label}; move source identity and compatibility metadata to the workspace manifest`;
  }
  return `unsupported top-level key ${key} in ${label}`;
}

function workspaceSchemaMessage(
  diagnostic: SkillsetSchemaDiagnostic,
  record: JsonRecord,
  label: string,
  keyMessageKind: "top-level" | "workspace"
): string {
  const path = schemaPathToLabel(diagnostic.path, label);
  const key = diagnostic.path.split(".").at(-1) ?? "";
  switch (diagnostic.code) {
    case "schema/workspace-config/key":
      if (key === "targets") return `${label} uses unsupported targets key; use compile.targets`;
      return unsupportedWorkspaceKeyMessage(key, label, keyMessageKind);
    case "schema/workspace-config/targets":
      if (diagnostic.path === "$.targets") return `${label} uses unsupported targets key; use compile.targets`;
      return workspaceCompileTargetsMessage(record, label);
    case "schema/workspace-config/target":
      return `unsupported target ${JSON.stringify(valueAtSchemaPath(record, diagnostic.path))} in ${path.replace(/\[\d+\]$/, "")}; expected claude or codex`;
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
  if (targets.length === 0) return `expected ${label}.compile.targets to include at least one target`;
  return "compile.targets must be a non-empty array";
}

function workspaceCompileBuildMessage(record: JsonRecord, label: string): string {
  const compile = record.compile;
  const value = isJsonRecord(compile) ? compile.build : undefined;
  if (typeof value !== "string") return `expected ${label}.compile.build to be one of: updated, all`;
  return `unsupported ${label}.compile.build ${JSON.stringify(value)}; expected one of: updated, all`;
}

function validateSourceMetadataDocument(value: JsonValue | undefined, label: string): void {
  const diagnostics = validateSourceMetadata(value, "$.skillset").diagnostics.filter(
    (diagnostic) => !shouldDeferSourceMetadataDiagnostic(diagnostic)
  );
  if (diagnostics.length === 0) return;
  throw new Error(
    `skillset: ${diagnostics.map((diagnostic) => sourceMetadataSchemaMessage(diagnostic, label)).join("; ")}`
  );
}

function sourceMetadataSchemaMessage(diagnostic: SkillsetSchemaDiagnostic, label: string): string {
  if (diagnostic.code === "schema/source-metadata/type") {
    return `expected ${label}.skillset to be an object`;
  }
  if (diagnostic.code === "schema/source-metadata/key") {
    const key = diagnostic.path.split(".").at(-1) ?? "";
    if (key === "id") return `${label}.skillset uses unsupported skillset.id; use skillset.name`;
    return `unsupported source metadata key ${key} in ${label}.skillset`;
  }
  return diagnostic.message.replaceAll("$.", `${label}.`).replaceAll("$", label);
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

  return {
    ...(description === undefined ? {} : { description }),
    plugins: rawPlugins.map((entry, index) => readMarketplacePluginEntry(entry, `${label}.plugins[${index}]`)),
    targets,
    ...(title === undefined ? {} : { title }),
  };
}

function readMarketplacePluginEntry(raw: JsonValue | undefined, label: string): MarketplacePluginEntryConfig {
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label} to be an object`);
  }
  for (const key of Object.keys(raw)) {
    if (key !== "channel" && key !== "id" && key !== "plugin" && key !== "ref" && key !== "repo" && key !== "sha" && key !== "targets" && key !== "version") {
      throw new Error(`skillset: unsupported marketplace plugin key ${key} in ${label}`);
    }
  }

  const plugin = readRequiredString(raw, "plugin", `${label}.plugin`);
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
  return {
    ...(channel === undefined ? {} : { channel }),
    id,
    plugin,
    ...(ref === undefined ? {} : { ref }),
    ...(repo === undefined ? {} : { repo }),
    ...(sha === undefined ? {} : { sha }),
    ...(targets === undefined ? {} : { targets }),
    ...(version === undefined ? {} : { version }),
  };
}

function readOptionalTargetNames(raw: JsonValue | undefined, label: string): readonly TargetName[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`skillset: expected ${label} to be a non-empty target array`);
  }
  const seen = new Set<TargetName>();
  for (const target of raw) {
    if (target !== "claude" && target !== "codex") {
      throw new Error(`skillset: unsupported target ${JSON.stringify(target)} in ${label}; expected claude or codex`);
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
  if (target !== "claude" && target !== "codex") {
    throw new Error(`skillset: expected ${label}.target to be claude or codex`);
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
  const result: Record<TargetName, JsonRecord> = { claude: {}, codex: {} };
  if (defaults === undefined) return result;
  if (!isJsonRecord(defaults)) {
    throw new Error(`skillset: expected ${label}.defaults to be an object`);
  }
  for (const key of Object.keys(defaults)) {
    if (key !== "claude" && key !== "codex") {
      throw new Error(
        `skillset: unsupported target ${JSON.stringify(key)} in ${label}.defaults; expected claude or codex`
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
  return {
    claude: mergeTargetDefault(targets.claude, defaults.claude),
    codex: mergeTargetDefault(targets.codex, defaults.codex),
  };
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
  return readOutputSetting(rawOutput, label);
}

function readOutputSetting(raw: JsonValue, label: string): ParsedTargetOutputSetting {
  if (raw === true || raw === false) return { selection: raw };
  if (Array.isArray(raw)) return { selection: readStringArrayValue(raw, label) };
  if (!isJsonRecord(raw)) {
    throw new Error(`skillset: expected ${label} to be true, false, a string array, or an object`);
  }

  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
    throw new Error(`skillset: expected ${label}.enabled to be a boolean`);
  }

  const include = raw.include === undefined ? undefined : readStringArrayValue(raw.include, `${label}.include`);
  const path = readString(raw, "path");
  return {
    ...(path === undefined ? {} : { path }),
    selection: raw.enabled === false ? false : include ?? true,
  };
}

function readStringArrayValue(value: JsonValue, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`skillset: expected ${label} to be a string array`);
  }
  return value.map((item) => String(item));
}
