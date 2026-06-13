import type {
  CompileBuildMode,
  CompileConfig,
  CompileSkillsetConfig,
  CompileUnsupportedPolicy,
  DistributionConfig,
  JsonRecord,
  JsonValue,
  OutputConfig,
  OutputSelection,
  ResolvedTarget,
  TargetName,
} from "./types";
import { SKILLSET_RUNTIME_IDS, type SkillsetRuntimeId } from "./feature-registry";
import { isJsonRecord } from "./yaml";

const TARGET_NAMES: readonly TargetName[] = ["claude", "codex"];
export type FeatureSurface = "agents" | "instructions" | "plugins" | "skills";

const DEFAULT_SURFACES = new Set<FeatureSurface>(["agents", "instructions", "plugins", "skills"]);
const CONFIG_TOP_LEVEL_KEYS = new Set(["agents", "changes", "claude", "codex", "defaults", "dependencies", "skillset", "supports"]);
const ROOT_CONFIG_TOP_LEVEL_KEYS = new Set([...CONFIG_TOP_LEVEL_KEYS, "compile", "distributions", "tests"]);
const COMPILE_BUILD_MODES = new Set<CompileBuildMode>(["updated", "all"]);
const COMPILE_UNSUPPORTED_POLICIES = new Set<CompileUnsupportedPolicy>([
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
  "mcp",
  "model",
  "resources",
  "schema",
  "skillset",
  "summary",
  "supports",
  "targets",
  "tests",
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
      skillset: { metadata: true },
      targets: [...TARGET_NAMES],
      unsupported: "error",
    };
  }

  for (const key of Object.keys(compile)) {
    if (key !== "build" && key !== "skillset" && key !== "targets" && key !== "unsupported") {
      throw new Error(`skillset: unsupported compile key ${key} in ${label}`);
    }
  }

  const unsupported = readCompileUnsupportedPolicy(compile, `${label}.compile.unsupported`);
  if (unsupported !== "error") {
    throw new Error(
      `skillset: ${label}.compile.unsupported ${unsupported} is reserved but not supported yet; ` +
        "use error until warning, skip, or force provenance is implemented"
    );
  }

  return {
    build: readCompileBuildMode(compile, `${label}.compile.build`),
    skillset: readCompileSkillsetConfig(compile, `${label}.compile.skillset`),
    targets: readCompileTargetNames(compile, `${label}.compile.targets`),
    unsupported,
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

export function validateConfigDocument(
  record: JsonRecord,
  label: string,
  options: { readonly allowCompile?: boolean; readonly featureKeys?: readonly string[] } = {}
): void {
  rejectTargetsKey(record, label);
  const supportedKeys = options.allowCompile === true ? ROOT_CONFIG_TOP_LEVEL_KEYS : CONFIG_TOP_LEVEL_KEYS;
  const featureKeys = new Set(options.featureKeys ?? []);
  for (const key of Object.keys(record)) {
    if (!supportedKeys.has(key) && !featureKeys.has(key)) {
      throw new Error(`skillset: unsupported top-level key ${key} in ${label}`);
    }
  }
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

function readCompileUnsupportedPolicy(record: JsonRecord, label: string): CompileUnsupportedPolicy {
  const value = record.unsupported;
  if (value === undefined) return "error";
  if (typeof value !== "string") {
    throw new Error(`skillset: expected ${label} to be one of: error, warn, skip, force`);
  }
  if (!COMPILE_UNSUPPORTED_POLICIES.has(value as CompileUnsupportedPolicy)) {
    throw new Error(
      `skillset: unsupported ${label} ${JSON.stringify(value)}; expected one of: error, warn, skip, force`
    );
  }
  return value as CompileUnsupportedPolicy;
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
