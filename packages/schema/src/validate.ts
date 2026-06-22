import {
  AGENT_FRONTMATTER_KEYS,
  COMPILE_BUILD_MODES,
  COMMON_FRONTMATTER_KEYS,
  INSTRUCTION_FRONTMATTER_KEYS,
  SOURCE_METADATA_KEYS,
  TARGET_NAMES,
  UNSUPPORTED_DESTINATION_POLICIES,
  WORKSPACE_CONFIG_KEYS,
} from "./contracts";
import { isSchemaRecord } from "./json";
import type {
  SchemaJsonRecord,
  SchemaJsonValue,
  SkillsetSchemaDiagnostic,
  SkillsetSchemaValidationResult,
} from "./types";

type KeySet = ReadonlySet<string>;

const workspaceKeys = new Set<string>(WORKSPACE_CONFIG_KEYS);
const sourceMetadataKeys = new Set<string>(SOURCE_METADATA_KEYS);
const commonFrontmatterKeys = new Set<string>(COMMON_FRONTMATTER_KEYS);
const agentFrontmatterKeys = new Set<string>(AGENT_FRONTMATTER_KEYS);
const instructionFrontmatterKeys = new Set<string>(INSTRUCTION_FRONTMATTER_KEYS);
const targetNames = new Set<string>(TARGET_NAMES);
const compileBuildModes = new Set<string>(COMPILE_BUILD_MODES);
const unsupportedDestinationPolicies = new Set<string>(UNSUPPORTED_DESTINATION_POLICIES);
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function validateWorkspaceConfig(value: unknown, path = "$"): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  if (!isSchemaRecord(value)) return result([diagnostic(path, "schema/workspace-config/type", "workspace config must be an object")]);

  checkAllowedKeys(value, workspaceKeys, path, "schema/workspace-config/key", diagnostics);
  if (value.targets !== undefined) {
    diagnostics.push(diagnostic(`${path}.targets`, "schema/workspace-config/targets", "workspace config must use compile.targets instead of targets"));
  }
  checkTargetBlock(value.claude, `${path}.claude`, "schema/workspace-config/target", diagnostics);
  checkTargetBlock(value.codex, `${path}.codex`, "schema/workspace-config/target", diagnostics);
  checkCompile(value.compile, `${path}.compile`, diagnostics);
  checkDependencies(value.dependencies, `${path}.dependencies`, "schema/workspace-config/dependencies", diagnostics);
  checkWorkspace(value.workspace, `${path}.workspace`, diagnostics);
  checkSourceMetadata(value.skillset, `${path}.skillset`, diagnostics);
  checkSupports(value.supports, `${path}.supports`, diagnostics);
  return result(diagnostics);
}

export function validateSourceMetadata(value: unknown, path = "$"): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  if (value !== undefined && !isSchemaRecord(value)) {
    return result([diagnostic(path, "schema/source-metadata/type", "skillset metadata must be an object")]);
  }
  checkSourceMetadata(value, path, diagnostics);
  return result(diagnostics);
}

export function validateSkillFrontmatter(value: unknown, path = "$"): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  if (!isSchemaRecord(value)) return result([diagnostic(path, "schema/skill-frontmatter/type", "skill frontmatter must be an object")]);
  checkAllowedKeys(value, commonFrontmatterKeys, path, "schema/skill-frontmatter/key", diagnostics);
  checkOptionalNonEmptyString(value.name, `${path}.name`, "schema/skill-frontmatter/name", diagnostics);
  checkOptionalNonEmptyString(value.description, `${path}.description`, "schema/skill-frontmatter/description", diagnostics);
  checkOptionalNonEmptyString(value.summary, `${path}.summary`, "schema/skill-frontmatter/summary", diagnostics);
  checkOptionalNonEmptyString(value.title, `${path}.title`, "schema/skill-frontmatter/title", diagnostics);
  checkOptionalSemverString(value.version, `${path}.version`, "schema/skill-frontmatter/version", diagnostics);
  checkTargetFeature(value.bin, `${path}.bin`, "schema/skill-frontmatter/bin", diagnostics);
  checkDependencies(value.dependencies, `${path}.dependencies`, "schema/skill-frontmatter/dependencies", diagnostics);
  checkGeneratedMetadata(value.metadata, `${path}.metadata`, "schema/skill-frontmatter/metadata", diagnostics);
  checkOptionalNonEmptyString(value.model, `${path}.model`, "schema/skill-frontmatter/model", diagnostics);
  checkTargetFeature(value.mcp, `${path}.mcp`, "schema/skill-frontmatter/mcp", diagnostics);
  checkOptionalObject(value.resources, `${path}.resources`, "schema/skill-frontmatter/resources", diagnostics);
  checkOptionalNonEmptyString(value.schema, `${path}.schema`, "schema/skill-frontmatter/schema", diagnostics);
  checkTargetBlock(value.claude, `${path}.claude`, "schema/skill-frontmatter/target", diagnostics);
  checkTargetBlock(value.codex, `${path}.codex`, "schema/skill-frontmatter/target", diagnostics);
  checkOptionalDialect(value.dialect, `${path}.dialect`, "schema/skill-frontmatter/dialect", diagnostics);
  checkImplicitInvocation(value.implicit_invocation, `${path}.implicit_invocation`, diagnostics);
  checkAllowedTools(value.allowed_tools, `${path}.allowed_tools`, diagnostics);
  checkOptionalObject(value.tool_intent, `${path}.tool_intent`, "schema/skill-frontmatter/tool-intent", diagnostics);
  checkSourceMetadata(value.skillset, `${path}.skillset`, diagnostics);
  checkSupports(value.supports, `${path}.supports`, diagnostics);
  return result(diagnostics);
}

export function validateAgentFrontmatter(value: unknown, path = "$"): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  if (!isSchemaRecord(value)) return result([diagnostic(path, "schema/agent-frontmatter/type", "agent frontmatter must be an object")]);
  checkAllowedKeys(value, agentFrontmatterKeys, path, "schema/agent-frontmatter/key", diagnostics);
  checkOptionalNonEmptyString(value.name, `${path}.name`, "schema/agent-frontmatter/name", diagnostics);
  if (value.description === undefined) {
    diagnostics.push(diagnostic(`${path}.description`, "schema/agent-frontmatter/description", "agent description is required"));
  } else {
    checkOptionalNonEmptyString(value.description, `${path}.description`, "schema/agent-frontmatter/description", diagnostics);
  }
  checkOptionalNonEmptyString(value.initialPrompt, `${path}.initialPrompt`, "schema/agent-frontmatter/initialPrompt", diagnostics);
  checkOptionalNonEmptyString(value.model, `${path}.model`, "schema/agent-frontmatter/model", diagnostics);
  checkOptionalNonEmptyStringArray(value.skills, `${path}.skills`, "schema/agent-frontmatter/skills", diagnostics);
  checkTargetBlock(value.claude, `${path}.claude`, "schema/agent-frontmatter/target", diagnostics);
  checkTargetBlock(value.codex, `${path}.codex`, "schema/agent-frontmatter/target", diagnostics);
  checkSourceMetadata(value.skillset, `${path}.skillset`, diagnostics);
  checkSupports(value.supports, `${path}.supports`, diagnostics);
  return result(diagnostics);
}

export function validateInstructionFrontmatter(value: unknown, path = "$"): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  if (!isSchemaRecord(value)) return result([diagnostic(path, "schema/instruction-frontmatter/type", "instruction frontmatter must be an object")]);
  checkAllowedKeys(value, instructionFrontmatterKeys, path, "schema/instruction-frontmatter/key", diagnostics);
  checkOptionalNonEmptyString(value.name, `${path}.name`, "schema/instruction-frontmatter/name", diagnostics);
  checkOptionalDialect(value.dialect, `${path}.dialect`, "schema/instruction-frontmatter/dialect", diagnostics);
  checkTargetBlock(value.claude, `${path}.claude`, "schema/instruction-frontmatter/target", diagnostics);
  checkTargetBlock(value.codex, `${path}.codex`, "schema/instruction-frontmatter/target", diagnostics);
  checkSourceMetadata(value.skillset, `${path}.skillset`, diagnostics);
  checkSupports(value.supports, `${path}.supports`, diagnostics);
  return result(diagnostics);
}

function checkCompile(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/workspace-config/compile", "compile must be an object"));
    return;
  }
  checkAllowedKeys(value, new Set(["build", "features", "skillset", "targets", "unsupportedDestination"]), path, "schema/workspace-config/compile-key", diagnostics);
  if (value.build !== undefined && (typeof value.build !== "string" || !compileBuildModes.has(value.build))) {
    diagnostics.push(diagnostic(`${path}.build`, "schema/workspace-config/compile-build", "compile.build must be all or updated"));
  }
  if (value.unsupportedDestination !== undefined && (typeof value.unsupportedDestination !== "string" || !unsupportedDestinationPolicies.has(value.unsupportedDestination))) {
    diagnostics.push(diagnostic(`${path}.unsupportedDestination`, "schema/workspace-config/unsupported-destination", "compile.unsupportedDestination must be error"));
  }
  if (value.targets !== undefined) checkTargets(value.targets, `${path}.targets`, diagnostics);
  checkBooleanRecord(value.features, `${path}.features`, new Set(["promptArguments"]), diagnostics);
  checkBooleanRecord(value.skillset, `${path}.skillset`, new Set(["metadata"]), diagnostics);
}

function checkTargets(value: SchemaJsonValue, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    diagnostics.push(diagnostic(path, "schema/workspace-config/targets", "compile.targets must be a non-empty array"));
    return;
  }
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !targetNames.has(item)) {
      diagnostics.push(diagnostic(`${path}[${index}]`, "schema/workspace-config/target", "compile.targets entries must be claude or codex"));
      continue;
    }
    if (seen.has(item)) diagnostics.push(diagnostic(`${path}[${index}]`, "schema/workspace-config/target-duplicate", `duplicate compile target ${item}`));
    seen.add(item);
  }
}

function checkWorkspace(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/workspace-config/workspace", "workspace must be an object"));
    return;
  }
  checkAllowedKeys(value, new Set(["cacheKey"]), path, "schema/workspace-config/workspace-key", diagnostics);
  if (value.cacheKey !== undefined && (typeof value.cacheKey !== "string" || !/^[a-z0-9][a-z0-9._-]*(?:--[a-z0-9][a-z0-9._-]*)*$/.test(value.cacheKey))) {
    diagnostics.push(diagnostic(`${path}.cacheKey`, "schema/workspace-config/cache-key", "workspace.cacheKey must be a lowercase repo cache key"));
  }
}

function checkSourceMetadata(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/source-metadata/type", "skillset metadata must be an object"));
    return;
  }
  checkAllowedKeys(value, sourceMetadataKeys, path, "schema/source-metadata/key", diagnostics);
  checkOptionalStringOrObject(value.author, `${path}.author`, "schema/source-metadata/author", diagnostics);
  checkOptionalNonEmptyString(value.name, `${path}.name`, "schema/source-metadata/name", diagnostics);
  checkOptionalSupportedSourceSchema(value.schema, `${path}.schema`, "schema/source-metadata/schema", diagnostics);
  checkOptionalSemverString(value.version, `${path}.version`, "schema/source-metadata/version", diagnostics);
  checkOptionalNonEmptyString(value.description, `${path}.description`, "schema/source-metadata/description", diagnostics);
  checkOptionalString(value.homepage, `${path}.homepage`, "schema/source-metadata/homepage", diagnostics);
  checkOptionalString(value.license, `${path}.license`, "schema/source-metadata/license", diagnostics);
  checkOptionalObject(value.manifest, `${path}.manifest`, "schema/source-metadata/manifest", diagnostics);
  checkSourceOrigin(value.origin, `${path}.origin`, diagnostics);
  checkOptionalObject(value.owner, `${path}.owner`, "schema/source-metadata/owner", diagnostics);
  checkOptionalObject(value.outputs, `${path}.outputs`, "schema/source-metadata/outputs", diagnostics);
  checkOptionalObject(value.presentation, `${path}.presentation`, "schema/source-metadata/presentation", diagnostics);
  if (value.preprocess !== undefined && typeof value.preprocess !== "boolean") {
    diagnostics.push(diagnostic(`${path}.preprocess`, "schema/source-metadata/preprocess", `${path}.preprocess must be a boolean`));
  }
  checkOptionalString(value.repository, `${path}.repository`, "schema/source-metadata/repository", diagnostics);
  checkOptionalNonEmptyString(value.summary, `${path}.summary`, "schema/source-metadata/summary", diagnostics);
  checkOptionalNonEmptyString(value.title, `${path}.title`, "schema/source-metadata/title", diagnostics);
  checkOptionalString(value.category, `${path}.category`, "schema/source-metadata/category", diagnostics);
  if (value.strict !== undefined && typeof value.strict !== "boolean") {
    diagnostics.push(diagnostic(`${path}.strict`, "schema/source-metadata/strict", `${path}.strict must be a boolean`));
  }
  checkOptionalStringArray(value.keywords, `${path}.keywords`, "schema/source-metadata/keywords", diagnostics);
}

function checkSupports(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined || typeof value === "string") return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) checkSupportEntry(item, `${path}[${index}]`, diagnostics);
    return;
  }
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/supports/type", "supports must be a string, array, or object"));
    return;
  }
  checkAllowedKeys(value, new Set(["packages"]), path, "schema/supports/key", diagnostics);
  if (!Array.isArray(value.packages)) {
    diagnostics.push(diagnostic(`${path}.packages`, "schema/supports/packages", "supports.packages must be an array"));
    return;
  }
  for (const [index, item] of value.packages.entries()) checkSupportEntry(item, `${path}.packages[${index}]`, diagnostics);
}

function checkSupportEntry(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (typeof value === "string") return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/supports/entry", "support entries must be strings or objects"));
    return;
  }
  checkAllowedKeys(value, new Set(["name", "onMismatch", "range", "source"]), path, "schema/supports/entry-key", diagnostics);
  checkOptionalString(value.name, `${path}.name`, "schema/supports/name", diagnostics);
  checkOptionalString(value.range, `${path}.range`, "schema/supports/range", diagnostics);
  if (value.onMismatch !== undefined && value.onMismatch !== "error" && value.onMismatch !== "warn") {
    diagnostics.push(diagnostic(`${path}.onMismatch`, "schema/supports/on-mismatch", "supports onMismatch must be error or warn"));
  }
}

function checkDependencies(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, code, `${path} must be an object`));
    return;
  }
  checkAllowedKeys(value, new Set(["plugins"]), path, `${code}-key`, diagnostics);
  if (value.plugins === undefined) return;
  if (!Array.isArray(value.plugins)) {
    diagnostics.push(diagnostic(`${path}.plugins`, `${code}-plugins`, `${path}.plugins must be an array`));
    return;
  }
  for (const [index, item] of value.plugins.entries()) checkDependencyPlugin(item, `${path}.plugins[${index}]`, code, diagnostics);
}

function checkDependencyPlugin(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (typeof value === "string") return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, `${code}-plugin`, `${path} must be a string or object`));
    return;
  }
  checkAllowedKeys(value, new Set(["marketplace", "name", "plugin", "range", "unversioned"]), path, `${code}-plugin-key`, diagnostics);
  checkOptionalString(value.marketplace, `${path}.marketplace`, `${code}-marketplace`, diagnostics);
  checkOptionalString(value.name, `${path}.name`, `${code}-name`, diagnostics);
  checkOptionalString(value.plugin, `${path}.plugin`, `${code}-plugin-name`, diagnostics);
  checkOptionalString(value.range, `${path}.range`, `${code}-range`, diagnostics);
  if (value.unversioned !== undefined && typeof value.unversioned !== "boolean") {
    diagnostics.push(diagnostic(`${path}.unversioned`, `${code}-unversioned`, `${path}.unversioned must be a boolean`));
  }
}

function checkOptionalString(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value !== undefined && typeof value !== "string") diagnostics.push(diagnostic(path, code, `${path} must be a string`));
}

function checkOptionalStringOrObject(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value !== undefined && typeof value !== "string" && !isSchemaRecord(value)) diagnostics.push(diagnostic(path, code, `${path} must be a string or object`));
}

function checkOptionalSupportedSourceSchema(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    diagnostics.push(diagnostic(path, code, `${path} must be a positive integer`));
    return;
  }
  if (value !== 1) {
    diagnostics.push(diagnostic(path, code, `${path} must be 1`));
  }
}

function checkOptionalSemverString(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.trim().length === 0) {
    diagnostics.push(diagnostic(path, code, `${path} must be a semantic version string`));
    return;
  }
  if (!semverPattern.test(value.trim())) diagnostics.push(diagnostic(path, code, `${path} must be a semantic version`));
}

function checkOptionalNonEmptyString(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) diagnostics.push(diagnostic(path, code, `${path} must be a non-empty string`));
}

function checkOptionalObject(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value !== undefined && !isSchemaRecord(value)) diagnostics.push(diagnostic(path, code, `${path} must be an object`));
}

function checkGeneratedMetadata(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, code, `${path} must be an object`));
    return;
  }
  checkAllowedKeys(value, new Set(["generated", "version"]), path, `${code}-key`, diagnostics);
  checkOptionalString(value.generated, `${path}.generated`, `${code}-generated`, diagnostics);
  checkOptionalSemverString(value.version, `${path}.version`, `${code}-version`, diagnostics);
}

function checkTargetBlock(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value !== undefined && value !== true && value !== false && !isSchemaRecord(value)) diagnostics.push(diagnostic(path, code, `${path} must be true, false, or an object`));
}

function checkTargetFeature(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value !== undefined && value !== false && !isSchemaRecord(value)) diagnostics.push(diagnostic(path, code, `${path} must be false or an object`));
}

function checkOptionalDialect(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value !== undefined && value !== "claude") diagnostics.push(diagnostic(path, code, `${path} must be claude when present`));
}

function checkImplicitInvocation(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined || typeof value === "boolean") return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/skill-frontmatter/implicit-invocation", `${path} must be a boolean or target map of booleans`));
    return;
  }
  checkAllowedKeys(value, targetNames, path, "schema/skill-frontmatter/implicit-invocation-key", diagnostics);
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined && typeof item !== "boolean") diagnostics.push(diagnostic(`${path}.${key}`, "schema/skill-frontmatter/implicit-invocation", `${path}.${key} must be a boolean`));
  }
}

function checkAllowedTools(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined || value === false) return;
  if (typeof value === "string") {
    if (value.trim().length === 0) diagnostics.push(diagnostic(path, "schema/skill-frontmatter/allowed-tools", `${path} must be a non-empty string`));
    return;
  }
  if (isStringArray(value) && value.length > 0) return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/skill-frontmatter/allowed-tools", `${path} must be false, a string, a string array, or a target map`));
    return;
  }
  checkAllowedKeys(value, targetNames, path, "schema/skill-frontmatter/allowed-tools-key", diagnostics);
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && item.trim().length === 0) {
      diagnostics.push(diagnostic(`${path}.${key}`, "schema/skill-frontmatter/allowed-tools", `${path}.${key} must be a non-empty string`));
    } else if (item !== undefined && item !== false && typeof item !== "string" && !(isStringArray(item) && item.length > 0)) {
      diagnostics.push(diagnostic(`${path}.${key}`, "schema/skill-frontmatter/allowed-tools", `${path}.${key} must be false, a string, or a string array`));
    }
  }
}

function checkSourceOrigin(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/source-metadata/origin", `${path} must be an object`));
    return;
  }
  checkAllowedKeys(value, new Set(["path", "ref", "repo"]), path, "schema/source-metadata/origin-key", diagnostics);
  if (typeof value.path !== "string" || value.path.trim().length === 0) {
    diagnostics.push(diagnostic(`${path}.path`, "schema/source-metadata/origin", `${path}.path must be a non-empty string`));
  }
  checkOptionalNonEmptyString(value.repo, `${path}.repo`, "schema/source-metadata/origin", diagnostics);
  checkOptionalNonEmptyString(value.ref, `${path}.ref`, "schema/source-metadata/origin", diagnostics);
  if ((value.repo === undefined) !== (value.ref === undefined)) {
    diagnostics.push(diagnostic(path, "schema/source-metadata/origin", `${path} must set repo and ref together`));
  }
}

function checkOptionalStringArray(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic(path, code, `${path} must be a string array`));
    return;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string") diagnostics.push(diagnostic(`${path}[${index}]`, code, `${path} entries must be strings`));
  }
}

function checkOptionalNonEmptyStringArray(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic(path, code, `${path} must be a string array`));
    return;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim().length === 0) diagnostics.push(diagnostic(`${path}[${index}]`, code, `${path} entries must be non-empty strings`));
  }
}

function isStringArray(value: SchemaJsonValue): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function checkBooleanRecord(value: SchemaJsonValue | undefined, path: string, allowedKeys: KeySet, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/workspace-config/boolean-record", `${path} must be an object`));
    return;
  }
  checkAllowedKeys(value, allowedKeys, path, "schema/workspace-config/boolean-record-key", diagnostics);
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined && typeof item !== "boolean") diagnostics.push(diagnostic(`${path}.${key}`, "schema/workspace-config/boolean-record-value", `${path}.${key} must be a boolean`));
  }
}

function checkAllowedKeys(record: SchemaJsonRecord, allowed: KeySet, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  for (const key of Object.keys(record).sort()) {
    if (!allowed.has(key)) diagnostics.push(diagnostic(`${path}.${key}`, code, `unsupported key ${key}`));
  }
}

function diagnostic(path: string, code: string, message: string): SkillsetSchemaDiagnostic {
  return { code, message, path };
}

function result(diagnostics: readonly SkillsetSchemaDiagnostic[]): SkillsetSchemaValidationResult {
  return {
    diagnostics,
    ok: diagnostics.length === 0,
  };
}
