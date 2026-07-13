import {
  AGENT_FRONTMATTER_KEYS,
  CLI_EVENT_SCHEMA_VERSION,
  CLI_RESULT_SCHEMA_VERSION,
  COMPILE_BUILD_MODES,
  SOURCE_LICENSE_IDS,
  SOURCE_LICENSE_NONE,
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
const agentFrontmatterKeys = new Set<string>(AGENT_FRONTMATTER_KEYS);
const targetNames = new Set<string>(TARGET_NAMES);
const targetListText = formatList(TARGET_NAMES);
const compileBuildModes = new Set<string>(COMPILE_BUILD_MODES);
const unsupportedDestinationPolicies = new Set<string>(UNSUPPORTED_DESTINATION_POLICIES);
const sourceLicenseValues = new Set<string>([...SOURCE_LICENSE_IDS, SOURCE_LICENSE_NONE]);
const toolsPolicyKeys = new Set<string>(["claude", "codex", "cursor", "mcp", "read", "search", "shell", "write"]);
const toolsProviderKeys = new Set<string>(["allow", "deny", "mcp", "read", "search", "shell", "write"]);
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const fullGitShaPattern = /^[0-9a-f]{40}$/;
const safeGitRefPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function validateCliResult(value: unknown, root = "$"): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  if (!isSchemaRecord(value)) return result([diagnostic(root, "schema/cli-result/type", "CLI result must be an object")]);
  checkAllowedKeys(value, new Set(["changes", "command", "data", "diagnostics", "exitCode", "kind", "meta", "ok", "schemaVersion"]), root, "schema/cli-result/key", diagnostics);
  checkRequiredNonEmptyString(value.command, `${root}.command`, "schema/cli-result/command", diagnostics);
  checkRequiredNonEmptyString(value.kind, `${root}.kind`, "schema/cli-result/kind", diagnostics);
  if (value.schemaVersion !== CLI_RESULT_SCHEMA_VERSION) diagnostics.push(diagnostic(`${root}.schemaVersion`, "schema/cli-result/version", `schemaVersion must be ${CLI_RESULT_SCHEMA_VERSION}`));
  if (typeof value.ok !== "boolean") diagnostics.push(diagnostic(`${root}.ok`, "schema/cli-result/ok", "ok must be a boolean"));
  if (!Number.isInteger(value.exitCode) || Number(value.exitCode) < 0) diagnostics.push(diagnostic(`${root}.exitCode`, "schema/cli-result/exit-code", "exitCode must be a non-negative integer"));
  if (typeof value.ok === "boolean" && Number.isInteger(value.exitCode) && value.ok !== (value.exitCode === 0)) diagnostics.push(diagnostic(root, "schema/cli-result/state", "ok must be true exactly when exitCode is zero"));
  for (const key of ["data", "meta"] as const) if (!isSchemaRecord(value[key])) diagnostics.push(diagnostic(`${root}.${key}`, "schema/cli-result/object", `${key} must be an object`));
  if (!Array.isArray(value.changes)) diagnostics.push(diagnostic(`${root}.changes`, "schema/cli-result/array", "changes must be an array"));
  else for (const [index, item] of value.changes.entries()) checkCliChange(item, `${root}.changes[${index}]`, diagnostics);
  if (!Array.isArray(value.diagnostics)) diagnostics.push(diagnostic(`${root}.diagnostics`, "schema/cli-result/array", "diagnostics must be an array"));
  else for (const [index, item] of value.diagnostics.entries()) checkCliDiagnostic(item, `${root}.diagnostics[${index}]`, diagnostics);
  return result(diagnostics);
}

export function validateCliEvent(value: unknown, root = "$"): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  if (!isSchemaRecord(value)) return result([diagnostic(root, "schema/cli-event/type", "CLI event must be an object")]);
  checkAllowedKeys(value, new Set(["command", "data", "event", "schemaVersion", "sequence"]), root, "schema/cli-event/key", diagnostics);
  checkRequiredNonEmptyString(value.command, `${root}.command`, "schema/cli-event/command", diagnostics);
  checkRequiredNonEmptyString(value.event, `${root}.event`, "schema/cli-event/event", diagnostics);
  if (value.schemaVersion !== CLI_EVENT_SCHEMA_VERSION) diagnostics.push(diagnostic(`${root}.schemaVersion`, "schema/cli-event/version", `schemaVersion must be ${CLI_EVENT_SCHEMA_VERSION}`));
  if (!Number.isInteger(value.sequence) || Number(value.sequence) < 1) diagnostics.push(diagnostic(`${root}.sequence`, "schema/cli-event/sequence", "sequence must be a positive integer"));
  if (!isSchemaRecord(value.data)) diagnostics.push(diagnostic(`${root}.data`, "schema/cli-event/data", "data must be an object"));
  return result(diagnostics);
}

function checkCliDiagnostic(value: SchemaJsonValue, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (!isSchemaRecord(value)) { diagnostics.push(diagnostic(path, "schema/cli-result/diagnostic", "diagnostic must be an object")); return; }
  checkAllowedKeys(value, new Set(["code", "column", "help", "line", "message", "path", "severity"]), path, "schema/cli-result/diagnostic-key", diagnostics);
  checkRequiredNonEmptyString(value.code, `${path}.code`, "schema/cli-result/diagnostic-code", diagnostics);
  checkRequiredNonEmptyString(value.message, `${path}.message`, "schema/cli-result/diagnostic-message", diagnostics);
  for (const key of ["help", "path"] as const) {
    checkOptionalNonEmptyString(value[key], `${path}.${key}`, "schema/cli-result/diagnostic-string", diagnostics);
  }
  for (const key of ["column", "line"] as const) {
    if (value[key] !== undefined && (!Number.isInteger(value[key]) || Number(value[key]) < 1)) {
      diagnostics.push(diagnostic(`${path}.${key}`, "schema/cli-result/diagnostic-position", `${key} must be a positive integer`));
    }
  }
  if (!new Set(["error", "info", "warning"]).has(String(value.severity))) diagnostics.push(diagnostic(`${path}.severity`, "schema/cli-result/diagnostic-severity", "severity must be error, info, or warning"));
}

function checkCliChange(value: SchemaJsonValue, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (!isSchemaRecord(value)) { diagnostics.push(diagnostic(path, "schema/cli-result/change", "change must be an object")); return; }
  checkAllowedKeys(value, new Set(["action", "path", "reason", "state"]), path, "schema/cli-result/change-key", diagnostics);
  checkRequiredNonEmptyString(value.path, `${path}.path`, "schema/cli-result/change-path", diagnostics);
  checkOptionalNonEmptyString(value.reason, `${path}.reason`, "schema/cli-result/change-reason", diagnostics);
  if (!new Set(["create", "delete", "move", "update"]).has(String(value.action))) diagnostics.push(diagnostic(`${path}.action`, "schema/cli-result/change-action", "action must be create, delete, move, or update"));
  if (!new Set(["planned", "refused", "skipped", "written"]).has(String(value.state))) diagnostics.push(diagnostic(`${path}.state`, "schema/cli-result/change-state", "state must be planned, refused, skipped, or written"));
}

export function validateWorkspaceConfig(value: unknown, path = "$"): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  if (!isSchemaRecord(value)) return result([diagnostic(path, "schema/workspace-config/type", "workspace config must be an object")]);

  checkAllowedKeys(value, workspaceKeys, path, "schema/workspace-config/key", diagnostics);
  if (value.targets !== undefined) {
    diagnostics.push(diagnostic(`${path}.targets`, "schema/workspace-config/targets", "workspace config must use compile.targets instead of targets"));
  }
  checkTargetBlock(value.claude, `${path}.claude`, "schema/workspace-config/target", diagnostics);
  checkTargetBlock(value.codex, `${path}.codex`, "schema/workspace-config/target", diagnostics);
  checkTargetBlock(value.cursor, `${path}.cursor`, "schema/workspace-config/target", diagnostics);
  checkCompile(value.compile, `${path}.compile`, diagnostics);
  checkDependencies(value.dependencies, `${path}.dependencies`, "schema/workspace-config/dependencies", diagnostics);
  checkMarketplaceCatalogs(value.marketplaces, `${path}.marketplaces`, diagnostics);
  checkWorkspace(value.workspace, `${path}.workspace`, diagnostics);
  checkSourceMetadata(value.skillset, `${path}.skillset`, diagnostics);
  checkSupports(value.supports, `${path}.supports`, diagnostics);
  return result(diagnostics);
}

export function validateTestDeclaration(value: unknown, path = "$"): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  if (!isSchemaRecord(value)) return result([diagnostic(path, "schema/test-declaration/type", "test declaration must be an object")]);
  checkAllowedKeys(value, new Set(["activation", "checks", "output", "select", "targets"]), path, "schema/test-declaration/key", diagnostics);
  if (!isSchemaRecord(value.checks)) {
    diagnostics.push(diagnostic(`${path}.checks`, "schema/test-declaration/checks", "test declaration checks must be an object"));
  } else {
    checkTestChecks(value.checks, `${path}.checks`, diagnostics);
  }
  if (value.output !== undefined) checkTestOutput(value.output, `${path}.output`, diagnostics);
  if (value.select !== undefined) checkTestSelection(value.select, `${path}.select`, diagnostics);
  if (value.targets !== undefined) {
    checkTargetNameArray(value.targets, `${path}.targets`, "schema/test-declaration/targets", diagnostics);
  }
  if (value.activation !== undefined) {
    if (!Array.isArray(value.activation)) {
      diagnostics.push(diagnostic(`${path}.activation`, "schema/test-declaration/activation", "activation must be an array"));
    } else {
      for (const [index, probe] of value.activation.entries()) {
        checkTestActivationProbe(probe, `${path}.activation[${index}]`, diagnostics);
      }
    }
  }
  return result(diagnostics);
}

function checkTestChecks(value: SchemaJsonRecord, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  checkAllowedKeys(value, new Set(["files", "pluginManifests", "projection"]), path, "schema/test-declaration/check-key", diagnostics);
  for (const key of ["pluginManifests", "projection"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      diagnostics.push(diagnostic(`${path}.${key}`, "schema/test-declaration/check", `${key} must be true or false`));
    }
  }
  if (value.files !== undefined) {
    if (!Array.isArray(value.files) || value.files.length === 0) {
      diagnostics.push(diagnostic(`${path}.files`, "schema/test-declaration/check-files", "checks.files must be a non-empty array"));
    } else {
      for (const [index, file] of value.files.entries()) {
        const filePath = `${path}.files[${index}]`;
        if (!isSchemaRecord(file)) {
          diagnostics.push(diagnostic(filePath, "schema/test-declaration/check-file", "file check must be an object"));
          continue;
        }
        checkAllowedKeys(file, new Set(["contains", "path"]), filePath, "schema/test-declaration/check-file-key", diagnostics);
        checkOptionalNonEmptyString(file.path, `${filePath}.path`, "schema/test-declaration/check-file", diagnostics);
        if (file.path === undefined) diagnostics.push(diagnostic(`${filePath}.path`, "schema/test-declaration/check-file", "file check path is required"));
        checkOptionalNonEmptyString(file.contains, `${filePath}.contains`, "schema/test-declaration/check-file", diagnostics);
      }
    }
  }
  if (value.files === undefined && value.pluginManifests !== true && value.projection !== true) {
    diagnostics.push(diagnostic(path, "schema/test-declaration/checks", "test checks must enable files, pluginManifests, or projection"));
  }
}

function checkTestOutput(value: SchemaJsonValue, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/test-declaration/output", "test output must be an object"));
    return;
  }
  checkAllowedKeys(value, new Set(["kind"]), path, "schema/test-declaration/output-key", diagnostics);
  if (value.kind !== undefined && value.kind !== "isolated") {
    diagnostics.push(diagnostic(`${path}.kind`, "schema/test-declaration/output-kind", "test output kind must be isolated"));
  }
}

function checkTestSelection(value: SchemaJsonValue, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/test-declaration/select", "test select must be an object"));
    return;
  }
  if (Object.keys(value).length === 0) {
    diagnostics.push(diagnostic(path, "schema/test-declaration/select", "test select must include agents, plugins, or skills"));
  }
  checkAllowedKeys(value, new Set(["agents", "plugins", "skills"]), path, "schema/test-declaration/select-key", diagnostics);
  if (value.agents !== undefined) checkTestSelector(value.agents, `${path}.agents`, diagnostics);
  if (value.plugins !== undefined) {
    if (isSchemaRecord(value.plugins)) {
      if (Object.keys(value.plugins).length === 0) {
        diagnostics.push(diagnostic(`${path}.plugins`, "schema/test-declaration/select", "test plugin selector must include include or skills"));
      }
      checkAllowedKeys(value.plugins, new Set(["include", "skills"]), `${path}.plugins`, "schema/test-declaration/select-key", diagnostics);
      if (value.plugins.include !== undefined) checkTestSelector(value.plugins.include, `${path}.plugins.include`, diagnostics);
      if (value.plugins.skills !== undefined) checkTestSelector(value.plugins.skills, `${path}.plugins.skills`, diagnostics);
    } else {
      checkTestSelector(value.plugins, `${path}.plugins`, diagnostics);
    }
  }
  if (value.skills !== undefined) checkTestSkillSelection(value.skills, `${path}.skills`, diagnostics);
}

function checkTestSkillSelection(value: SchemaJsonValue, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (!isSchemaRecord(value)) {
    checkTestSelector(value, path, diagnostics);
    return;
  }
  if (Object.keys(value).length === 0) {
    diagnostics.push(diagnostic(path, "schema/test-declaration/select", "test skill selector must include primary or plugin"));
  }
  checkAllowedKeys(value, new Set(["plugin", "primary"]), path, "schema/test-declaration/select-key", diagnostics);
  if (value.primary !== undefined) checkTestSelector(value.primary, `${path}.primary`, diagnostics);
  if (value.plugin !== undefined) {
    if (isSchemaRecord(value.plugin)) {
      if (Object.keys(value.plugin).length === 0) {
        diagnostics.push(diagnostic(`${path}.plugin`, "schema/test-declaration/select", "test plugin-skill selector must include at least one plugin"));
      }
      for (const [plugin, selector] of Object.entries(value.plugin)) {
        if (selector !== undefined) checkTestSelector(selector, `${path}.plugin.${plugin}`, diagnostics);
      }
    } else {
      checkTestSelector(value.plugin, `${path}.plugin`, diagnostics);
    }
  }
}

function checkTestSelector(value: SchemaJsonValue, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === true) return;
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    diagnostics.push(diagnostic(path, "schema/test-declaration/select", "test selector must be true or a non-empty string array"));
    return;
  }
  if (new Set(value).size !== value.length) {
    diagnostics.push(diagnostic(path, "schema/test-declaration/select", "test selector entries must be unique"));
  }
}

function checkTestActivationProbe(
  value: SchemaJsonValue,
  path: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/test-declaration/activation", "activation probe must be an object"));
    return;
  }
  checkAllowedKeys(value, new Set(["expect", "name", "prompt", "promptFile", "runtime", "targets"]), path, "schema/test-declaration/activation-key", diagnostics);
  const hasPrompt = typeof value.prompt === "string" && value.prompt.trim().length > 0;
  const hasPromptFile = typeof value.promptFile === "string" && value.promptFile.trim().length > 0;
  if (hasPrompt === hasPromptFile) {
    diagnostics.push(diagnostic(path, "schema/test-declaration/prompt", "activation probe must name exactly one of prompt or promptFile"));
  }
  if (value.promptFile !== undefined && hasPromptFile) {
    const promptFile = String(value.promptFile);
    if (promptFile.startsWith("/") || /^[A-Za-z]:[\\/]/.test(promptFile) || promptFile.split(/[\\/]+/).includes("..")) {
      diagnostics.push(diagnostic(`${path}.promptFile`, "schema/test-declaration/prompt-file", "test promptFile must stay inside the source root"));
    }
  }
  if (!isSchemaRecord(value.expect)) {
    diagnostics.push(diagnostic(`${path}.expect`, "schema/test-declaration/expect", "activation expectation must be an object"));
  } else {
    checkAllowedKeys(value.expect, new Set(["agent", "plugin", "skill"]), `${path}.expect`, "schema/test-declaration/expect-key", diagnostics);
    const expected = [value.expect.agent, value.expect.plugin, value.expect.skill]
      .filter((item) => typeof item === "string" && item.trim().length > 0);
    if (expected.length !== 1) {
      diagnostics.push(diagnostic(`${path}.expect`, "schema/test-declaration/expect", "activation expectation must name exactly one of agent, plugin, or skill"));
    }
  }
  if (value.targets !== undefined) {
    checkTargetNameArray(value.targets, `${path}.targets`, "schema/test-declaration/targets", diagnostics);
  }
  if (value.runtime !== undefined) checkTestRuntime(value.runtime, `${path}.runtime`, diagnostics);
}

function checkTestRuntime(value: SchemaJsonValue, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/test-declaration/runtime", "runtime must be an object"));
    return;
  }
  checkAllowedKeys(value, new Set(["claude", "expect", "timeoutMs"]), path, "schema/test-declaration/runtime-key", diagnostics);
  if (!isSchemaRecord(value.expect)) {
    diagnostics.push(diagnostic(`${path}.expect`, "schema/test-declaration/runtime-expect", "runtime expect must be an object"));
  } else {
    checkAllowedKeys(value.expect, new Set(["contains", "notContains"]), `${path}.expect`, "schema/test-declaration/runtime-expect-key", diagnostics);
    const contains = typeof value.expect.contains === "string" && value.expect.contains.trim().length > 0;
    const notContains = typeof value.expect.notContains === "string" && value.expect.notContains.trim().length > 0;
    if (!contains && !notContains) {
      diagnostics.push(diagnostic(`${path}.expect`, "schema/test-declaration/runtime-expect", "runtime expect must include contains or notContains"));
    }
  }
  if (value.timeoutMs !== undefined && (typeof value.timeoutMs !== "number" || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs <= 0)) {
    diagnostics.push(diagnostic(`${path}.timeoutMs`, "schema/test-declaration/runtime-timeout", "runtime timeoutMs must be a positive integer"));
  }
  if (value.claude !== undefined) {
    if (!isSchemaRecord(value.claude)) {
      diagnostics.push(diagnostic(`${path}.claude`, "schema/test-declaration/runtime-claude", "runtime claude settings must be an object"));
    } else {
      checkAllowedKeys(value.claude, new Set(["settingSources"]), `${path}.claude`, "schema/test-declaration/runtime-claude-key", diagnostics);
      if (!new Set(["isolated", "local", "project", "user"]).has(String(value.claude.settingSources))) {
        diagnostics.push(diagnostic(`${path}.claude.settingSources`, "schema/test-declaration/runtime-claude", "Claude runtime settingSources must be isolated, local, project, or user"));
      }
    }
  }
}

function checkTargetNameArray(
  value: SchemaJsonValue,
  path: string,
  code: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !targetNames.has(item))) {
    diagnostics.push(diagnostic(path, code, `targets must be a non-empty array of ${targetListText}`));
    return;
  }
  if (new Set(value).size !== value.length) {
    diagnostics.push(diagnostic(path, code, "test targets must be unique"));
  }
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
  checkRetiredTargetsKey(value, path, "schema/skill-frontmatter/key", diagnostics);
  checkOptionalNonEmptyString(value.name, `${path}.name`, "schema/skill-frontmatter/name", diagnostics);
  checkOptionalNonEmptyString(value.description, `${path}.description`, "schema/skill-frontmatter/description", diagnostics);
  checkOptionalNonEmptyString(value.summary, `${path}.summary`, "schema/skill-frontmatter/summary", diagnostics);
  checkOptionalNonEmptyString(value.title, `${path}.title`, "schema/skill-frontmatter/title", diagnostics);
  checkOptionalSemverString(value.version, `${path}.version`, "schema/skill-frontmatter/version", diagnostics);
  checkOptionalDialect(value.dialect, `${path}.dialect`, "schema/skill-frontmatter/dialect", diagnostics);
  checkTargetFeature(value.bin, `${path}.bin`, "schema/skill-frontmatter/bin", diagnostics);
  checkDependencies(value.dependencies, `${path}.dependencies`, "schema/skill-frontmatter/dependencies", diagnostics);
  checkGeneratedMetadata(value.metadata, `${path}.metadata`, "schema/skill-frontmatter/metadata", diagnostics);
  checkOptionalNonEmptyString(value.model, `${path}.model`, "schema/skill-frontmatter/model", diagnostics);
  checkTargetFeature(value.mcp, `${path}.mcp`, "schema/skill-frontmatter/mcp", diagnostics);
  checkOptionalStringOrPositiveInteger(value.schema, `${path}.schema`, "schema/skill-frontmatter/schema", diagnostics);
  checkTargetBlock(value.claude, `${path}.claude`, "schema/skill-frontmatter/target", diagnostics);
  checkTargetBlock(value.codex, `${path}.codex`, "schema/skill-frontmatter/target", diagnostics);
  checkTargetBlock(value.cursor, `${path}.cursor`, "schema/skill-frontmatter/target", diagnostics);
  checkHookAttachments(value.hooks, `${path}.hooks`, "schema/skill-frontmatter/hooks", diagnostics);
  checkImplicitInvocation(value.implicit_invocation, `${path}.implicit_invocation`, diagnostics);
  checkAllowedTools(value.allowed_tools, `${path}.allowed_tools`, diagnostics);
  if (value.tool_intent !== undefined) {
    diagnostics.push(diagnostic(`${path}.tool_intent`, "schema/skill-frontmatter/tool-intent-retired", `${path}.tool_intent is retired; use ${path}.tools`));
  }
  checkToolsPolicy(value.tools, `${path}.tools`, diagnostics);
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
  checkTargetBlock(value.cursor, `${path}.cursor`, "schema/agent-frontmatter/target", diagnostics);
  checkHookAttachments(value.hooks, `${path}.hooks`, "schema/agent-frontmatter/hooks", diagnostics);
  checkSourceMetadata(value.skillset, `${path}.skillset`, diagnostics);
  checkSupports(value.supports, `${path}.supports`, diagnostics);
  return result(diagnostics);
}

export function validateInstructionFrontmatter(value: unknown, path = "$"): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  if (!isSchemaRecord(value)) return result([diagnostic(path, "schema/instruction-frontmatter/type", "instruction frontmatter must be an object")]);
  checkRetiredTargetsKey(value, path, "schema/instruction-frontmatter/key", diagnostics);
  checkOptionalNonEmptyString(value.name, `${path}.name`, "schema/instruction-frontmatter/name", diagnostics);
  checkOptionalNonEmptyString(value.description, `${path}.description`, "schema/instruction-frontmatter/description", diagnostics);
  checkOptionalNonEmptyString(value.summary, `${path}.summary`, "schema/instruction-frontmatter/summary", diagnostics);
  checkOptionalNonEmptyString(value.title, `${path}.title`, "schema/instruction-frontmatter/title", diagnostics);
  checkOptionalSemverString(value.version, `${path}.version`, "schema/instruction-frontmatter/version", diagnostics);
  checkOptionalDialect(value.dialect, `${path}.dialect`, "schema/instruction-frontmatter/dialect", diagnostics);
  checkOptionalStringArray(value.paths, `${path}.paths`, "schema/instruction-frontmatter/paths", diagnostics);
  checkTargetBlock(value.claude, `${path}.claude`, "schema/instruction-frontmatter/target", diagnostics);
  checkTargetBlock(value.codex, `${path}.codex`, "schema/instruction-frontmatter/target", diagnostics);
  checkTargetBlock(value.cursor, `${path}.cursor`, "schema/instruction-frontmatter/target", diagnostics);
  checkSourceMetadata(value.skillset, `${path}.skillset`, diagnostics);
  checkSupports(value.supports, `${path}.supports`, diagnostics);
  return result(diagnostics);
}

export function validateHookDefinitionSource(value: unknown, path = "$"): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  if (!isSchemaRecord(value)) return result([diagnostic(path, "schema/hook/type", "hook file must contain a JSON object")]);

  if (value.hooks !== undefined && !isSchemaRecord(value.hooks)) {
    return result([diagnostic(`${path}.hooks`, "schema/hook/hooks", "hooks must be an object when present")]);
  }

  const events = isSchemaRecord(value.hooks) ? value.hooks : value;
  for (const [event, groups] of Object.entries(events)) {
    if (events === value && event === "hooks") continue;
    checkHookEventGroups(groups, event, `${path}.${event}`, diagnostics);
  }
  return result(diagnostics);
}

export function validateAdaptiveHookUnitSource(value: unknown, path = "$"): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  if (!isSchemaRecord(value)) return result([diagnostic(path, "schema/adaptive-hook/type", "adaptive hook unit must contain an object")]);

  checkAllowedKeys(value, new Set(["claude", "codex", "context", "cursor", "description", "events", "match", "name", "providers", "run", "status"]), path, "schema/adaptive-hook/key", diagnostics);
  checkOptionalNonEmptyString(value.name, `${path}.name`, "schema/adaptive-hook/name", diagnostics);
  checkOptionalNonEmptyString(value.description, `${path}.description`, "schema/adaptive-hook/description", diagnostics);
  checkOptionalNonEmptyString(value.status, `${path}.status`, "schema/adaptive-hook/status", diagnostics);
  checkAdaptiveHookEvents(value.events, `${path}.events`, diagnostics);
  checkAdaptiveHookProviders(value.providers, `${path}.providers`, diagnostics);
  checkAdaptiveHookMatch(value.match, `${path}.match`, diagnostics);
  checkOptionalObject(value.claude, `${path}.claude`, "schema/adaptive-hook/provider-override", diagnostics);
  checkOptionalObject(value.codex, `${path}.codex`, "schema/adaptive-hook/provider-override", diagnostics);
  checkOptionalObject(value.cursor, `${path}.cursor`, "schema/adaptive-hook/provider-override", diagnostics);
  checkAdaptiveHookContext(value.context, `${path}.context`, diagnostics);
  checkAdaptiveHookRun(value.run, `${path}.run`, diagnostics);
  return result(diagnostics);
}

export function validateChangeEntryFrontmatter(value: unknown, path = "$"): SkillsetSchemaValidationResult {
  const diagnostics: SkillsetSchemaDiagnostic[] = [];
  if (!isSchemaRecord(value)) return result([diagnostic(path, "schema/change-entry/type", "change entry frontmatter must be an object")]);

  checkOptionalChangeId(value.id, `${path}.id`, diagnostics);
  checkChangeBump(value.bump, `${path}.bump`, diagnostics);
  checkChangeScopes(value, path, diagnostics);
  checkChangeGroup(value.group, `${path}.group`, diagnostics);
  if (value.ignored !== undefined && typeof value.ignored !== "boolean") {
    diagnostics.push(diagnostic(`${path}.ignored`, "schema/change-entry/ignored", "ignored must be a boolean when present"));
  }
  if (value.external !== undefined) {
    diagnostics.push(diagnostic(`${path}.external`, "schema/change-entry/external", "external issue ids belong in group"));
  }
  checkChangeEvidence(value.evidence, `${path}.evidence`, diagnostics);
  return result(diagnostics);
}

function checkRetiredTargetsKey(
  value: SchemaJsonRecord,
  path: string,
  code: string,
  diagnostics: SkillsetSchemaDiagnostic[]
): void {
  if (value.targets !== undefined) diagnostics.push(diagnostic(`${path}.targets`, code, "unsupported key targets"));
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
    diagnostics.push(diagnostic(`${path}.unsupportedDestination`, "schema/workspace-config/unsupported-destination", "compile.unsupportedDestination must be one of error, warn, skip, force"));
  }
  if (value.targets !== undefined) checkTargets(value.targets, `${path}.targets`, diagnostics);
  checkBooleanRecord(value.features, `${path}.features`, new Set(["promptArguments"]), diagnostics);
  checkBooleanRecord(value.skillset, `${path}.skillset`, new Set(["metadata"]), diagnostics);
}

function checkTargets(value: SchemaJsonValue, path: string, diagnostics: SkillsetSchemaDiagnostic[], label = "compile.targets"): void {
  if (!Array.isArray(value) || value.length === 0) {
    diagnostics.push(diagnostic(path, "schema/workspace-config/targets", `${label} must be a non-empty array`));
    return;
  }
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !targetNames.has(item)) {
      diagnostics.push(diagnostic(`${path}[${index}]`, "schema/workspace-config/target", `${label} entries must be ${targetListText}`));
      continue;
    }
    if (seen.has(item)) diagnostics.push(diagnostic(`${path}[${index}]`, "schema/workspace-config/target-duplicate", `duplicate target ${item}`));
    seen.add(item);
  }
}

function checkMarketplaceCatalogs(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/workspace-config/marketplaces", "marketplaces must be an object"));
    return;
  }
  for (const [name, catalog] of Object.entries(value)) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
      diagnostics.push(diagnostic(`${path}.${name}`, "schema/workspace-config/marketplace-id", "marketplace ids must be lowercase ids"));
    }
    checkMarketplaceCatalog(catalog, `${path}.${name}`, diagnostics);
  }
}

function checkMarketplaceCatalog(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/workspace-config/marketplace", "marketplace catalog must be an object"));
    return;
  }
  checkAllowedKeys(value, new Set(["description", "plugins", "targets", "title"]), path, "schema/workspace-config/marketplace-key", diagnostics);
  checkOptionalNonEmptyString(value.title, `${path}.title`, "schema/workspace-config/marketplace-title", diagnostics);
  checkOptionalNonEmptyString(value.description, `${path}.description`, "schema/workspace-config/marketplace-description", diagnostics);
  if (value.targets !== undefined) checkTargets(value.targets, `${path}.targets`, diagnostics, "marketplace targets");
  if (!Array.isArray(value.plugins) || value.plugins.length === 0) {
    diagnostics.push(diagnostic(`${path}.plugins`, "schema/workspace-config/marketplace-plugins", "marketplace plugins must be a non-empty array"));
    return;
  }
  for (const [index, entry] of value.plugins.entries()) {
    checkMarketplacePluginEntry(entry, `${path}.plugins[${index}]`, diagnostics);
  }
}

function checkMarketplacePluginEntry(value: SchemaJsonValue, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/workspace-config/marketplace-plugin", "marketplace plugin entries must be objects"));
    return;
  }
  checkAllowedKeys(value, new Set(["channel", "id", "plugin", "ref", "repo", "sha", "targets", "version"]), path, "schema/workspace-config/marketplace-plugin-key", diagnostics);
  checkOptionalMarketplaceId(value.id, `${path}.id`, diagnostics);
  if (value.plugin === undefined) {
    diagnostics.push(diagnostic(`${path}.plugin`, "schema/workspace-config/marketplace-plugin", "marketplace plugin entries require plugin"));
  } else {
    checkOptionalMarketplaceId(value.plugin, `${path}.plugin`, diagnostics);
  }
  if (value.channel !== undefined && value.channel !== "latest") {
    diagnostics.push(diagnostic(`${path}.channel`, "schema/workspace-config/marketplace-plugin-channel", "marketplace plugin channel must be latest"));
  }
  if (value.ref !== undefined && (typeof value.ref !== "string" || !isSafeGitRef(value.ref))) {
    diagnostics.push(diagnostic(`${path}.ref`, "schema/workspace-config/marketplace-plugin-ref", "marketplace plugin ref must be a safe Git ref"));
  }
  if (value.sha !== undefined && (typeof value.sha !== "string" || !fullGitShaPattern.test(value.sha))) {
    diagnostics.push(diagnostic(`${path}.sha`, "schema/workspace-config/marketplace-plugin-sha", "marketplace plugin sha must be a full lowercase 40-character commit"));
  }
  if (value.version !== undefined && (typeof value.version !== "string" || !semverPattern.test(value.version))) {
    diagnostics.push(diagnostic(`${path}.version`, "schema/workspace-config/marketplace-plugin-version", "marketplace plugin version must be a semantic version"));
  }
  const policies = [value.channel, value.ref, value.sha, value.version].filter((item) => item !== undefined);
  if (policies.length > 1) {
    diagnostics.push(diagnostic(path, "schema/workspace-config/marketplace-plugin-policy", "marketplace plugin entries may set at most one of channel, ref, sha, or version"));
  }
  checkMarketplaceRepo(value.repo, `${path}.repo`, diagnostics);
  if (value.targets !== undefined) checkTargets(value.targets, `${path}.targets`, diagnostics, "marketplace plugin targets");
}

function checkOptionalMarketplaceId(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    diagnostics.push(diagnostic(path, "schema/workspace-config/marketplace-plugin-id", "marketplace plugin ids must be lowercase ids"));
  }
}

function checkMarketplaceRepo(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push(diagnostic(path, "schema/workspace-config/marketplace-plugin-repo", "marketplace plugin repo must be a non-empty string"));
    return;
  }
  if (!isSupportedRemoteRepository(value)) {
    diagnostics.push(diagnostic(
      path,
      "schema/workspace-config/marketplace-plugin-repo",
      "marketplace plugin repo must be a remote repo reference using credential-free GitHub, HTTPS, SSH, or SCP syntax, not a filesystem path"
    ));
  }
}

function isSafeGitRef(value: string): boolean {
  return safeGitRefPattern.test(value) &&
    !value.includes("..") &&
    !value.includes("//") &&
    !value.includes("@{") &&
    !value.endsWith(".") &&
    !value.endsWith("/") &&
    !value.endsWith(".lock");
}

function isSupportedRemoteRepository(value: string): boolean {
  if (/^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(value)) return true;
  if (!value.includes("://") && /^[^:@/\s]+@[^:\s/]+:[^\s]+$/.test(value)) return !value.includes("..");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "ssh:") return false;
  if (url.password.length > 0 || (url.protocol === "https:" && url.username.length > 0)) return false;
  if (url.search.length > 0 || url.hash.length > 0 || url.hostname.length === 0) return false;
  try {
    const path = decodeURIComponent(url.pathname).replace(/^\/+|\.git$/g, "");
    return path.length > 0 && !path.includes("..");
  } catch {
    return false;
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
  checkOptionalLicense(value.license, `${path}.license`, diagnostics);
  checkOptionalObject(value.manifest, `${path}.manifest`, "schema/source-metadata/manifest", diagnostics);
  checkOptionalObject(value.marketplace, `${path}.marketplace`, "schema/source-metadata/marketplace", diagnostics);
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

function checkOptionalLicense(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !sourceLicenseValues.has(value)) {
    diagnostics.push(diagnostic(path, "schema/source-metadata/license", `${path} must be one of ${[...SOURCE_LICENSE_IDS, SOURCE_LICENSE_NONE].join(", ")}`));
  }
}

function checkOptionalStringOrObject(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value !== undefined && typeof value !== "string" && !isSchemaRecord(value)) diagnostics.push(diagnostic(path, code, `${path} must be a string or object`));
}

function checkOptionalStringOrPositiveInteger(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (
    value !== undefined &&
    typeof value !== "string" &&
    !(typeof value === "number" && Number.isInteger(value) && value > 0)
  ) {
    diagnostics.push(diagnostic(path, code, `${path} must be a string or positive integer`));
  }
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

function checkToolsPolicy(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (value === "readonly") return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/skill-frontmatter/tools", `${path} must be readonly or an object`));
    return;
  }
  checkAllowedKeys(value, toolsPolicyKeys, path, "schema/skill-frontmatter/tools-key", diagnostics);
  if (value.allow !== undefined || value.deny !== undefined) {
    diagnostics.push(diagnostic(path, "schema/skill-frontmatter/tools-native", `${path}.allow and ${path}.deny must live under a provider block`));
  }
  checkPortableTools(value, path, diagnostics);
  for (const target of TARGET_NAMES) {
    checkProviderTools(value[target], `${path}.${target}`, diagnostics);
  }
}

function checkProviderTools(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/skill-frontmatter/tools-provider", `${path} must be an object`));
    return;
  }
  checkAllowedKeys(value, toolsProviderKeys, path, "schema/skill-frontmatter/tools-provider-key", diagnostics);
  checkNativeRules(value.allow, `${path}.allow`, diagnostics);
  checkNativeRules(value.deny, `${path}.deny`, diagnostics);
  checkPortableTools(value, path, diagnostics);
}

function checkPortableTools(value: SchemaJsonRecord, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  checkOptionalBoolean(value.read, `${path}.read`, "schema/skill-frontmatter/tools-bool", diagnostics);
  checkOptionalBoolean(value.search, `${path}.search`, "schema/skill-frontmatter/tools-bool", diagnostics);
  checkOptionalBoolean(value.write, `${path}.write`, "schema/skill-frontmatter/tools-bool", diagnostics);
  checkShellTool(value.shell, `${path}.shell`, diagnostics);
  checkMcpTool(value.mcp, `${path}.mcp`, diagnostics);
}

function checkNativeRules(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined || value === false) return;
  if (typeof value === "string") {
    if (value.trim().length === 0) diagnostics.push(diagnostic(path, "schema/skill-frontmatter/tools-native", `${path} must be a non-empty string`));
    return;
  }
  if (isStringArray(value) && value.length > 0) return;
  diagnostics.push(diagnostic(path, "schema/skill-frontmatter/tools-native", `${path} must be a native rule string or string array`));
}

function checkOptionalBoolean(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value !== undefined && typeof value !== "boolean") diagnostics.push(diagnostic(path, code, `${path} must be true or false`));
}

function checkShellTool(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.trim().length === 0) diagnostics.push(diagnostic(path, "schema/skill-frontmatter/tools-shell", `${path} must be a non-empty shell pattern`));
    return;
  }
  if (isStringArray(value) && value.length > 0) return;
  diagnostics.push(diagnostic(path, "schema/skill-frontmatter/tools-shell", `${path} must be true, false, a shell pattern, or a shell pattern list`));
}

function checkMcpTool(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined || value === false) return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/skill-frontmatter/tools-mcp", `${path} must be false or an object keyed by literal MCP server name`));
    return;
  }
  for (const [server, serverValue] of Object.entries(value)) {
    if (server.trim().length === 0 || server.includes("*")) {
      diagnostics.push(diagnostic(`${path}.${server}`, "schema/skill-frontmatter/tools-mcp-server", `${path}.${server} must use a literal MCP server name`));
    }
    if (serverValue === undefined) continue;
    if (typeof serverValue === "boolean") continue;
    if (typeof serverValue === "string") {
      if (serverValue.trim().length === 0) diagnostics.push(diagnostic(`${path}.${server}`, "schema/skill-frontmatter/tools-mcp", `${path}.${server} must be a non-empty tool glob`));
      continue;
    }
    if (isStringArray(serverValue) && serverValue.length > 0) continue;
    diagnostics.push(diagnostic(`${path}.${server}`, "schema/skill-frontmatter/tools-mcp", `${path}.${server} must be true, false, a tool glob, or a tool glob list`));
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

function checkHookEventGroups(value: SchemaJsonValue | undefined, event: string, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic(path, "schema/hook/event", `hook event ${event} must be an array`));
    return;
  }
  for (const [index, group] of value.entries()) {
    const groupPath = `${path}[${index}]`;
    if (!isSchemaRecord(group)) {
      diagnostics.push(diagnostic(groupPath, "schema/hook/group", `hook event ${event} entries must be objects`));
      continue;
    }
    if (group.matcher !== undefined && typeof group.matcher !== "string" && !isSchemaRecord(group.matcher)) {
      diagnostics.push(diagnostic(`${groupPath}.matcher`, "schema/hook/matcher", `hook event ${event} matcher must be a string or object when present`));
    }
    checkOptionalNonEmptyString(group.statusMessage, `${groupPath}.statusMessage`, "schema/hook/status-message", diagnostics);
    if (group.hooks !== undefined && !Array.isArray(group.hooks)) {
      diagnostics.push(diagnostic(`${groupPath}.hooks`, "schema/hook/hooks", `hook event ${event} hooks must be an array`));
      continue;
    }
    if (Array.isArray(group.hooks)) checkHookHandlers(group.hooks, event, `${groupPath}.hooks`, diagnostics);
  }
}

function checkHookHandlers(handlers: readonly SchemaJsonValue[], event: string, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  for (const [index, handler] of handlers.entries()) {
    const handlerPath = `${path}[${index}]`;
    if (!isSchemaRecord(handler)) {
      diagnostics.push(diagnostic(handlerPath, "schema/hook/handler", `hook event ${event} hook handlers must be objects`));
      continue;
    }
    if (typeof handler.type !== "string" || handler.type.trim().length === 0) {
      diagnostics.push(diagnostic(`${handlerPath}.type`, "schema/hook/handler-type", `hook event ${event} hook handlers must include a non-empty string type`));
    }
    checkOptionalNonEmptyString(handler.command, `${handlerPath}.command`, "schema/hook/handler-command", diagnostics);
    checkOptionalNonEmptyString(handler.prompt, `${handlerPath}.prompt`, "schema/hook/handler-prompt", diagnostics);
    checkOptionalNonEmptyString(handler.agent, `${handlerPath}.agent`, "schema/hook/handler-agent", diagnostics);
    checkOptionalNonEmptyString(handler.statusMessage, `${handlerPath}.statusMessage`, "schema/hook/status-message", diagnostics);
    if (handler.async !== undefined && typeof handler.async !== "boolean") {
      diagnostics.push(diagnostic(`${handlerPath}.async`, "schema/hook/handler-async", `hook event ${event} async must be a boolean when present`));
    }
    if (
      handler.timeout !== undefined &&
      !(typeof handler.timeout === "number" && Number.isInteger(handler.timeout) && handler.timeout >= 0)
    ) {
      diagnostics.push(diagnostic(`${handlerPath}.timeout`, "schema/hook/handler-timeout", `hook event ${event} timeout must be a non-negative integer when present`));
    }
  }
}

function checkHookAttachments(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, code, "hooks must be an object keyed by event name or auto"));
    return;
  }
  for (const [event, entries] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
    if (event.trim().length === 0) {
      diagnostics.push(diagnostic(`${path}.${event}`, code, "hook attachment event names must be non-empty"));
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      diagnostics.push(diagnostic(`${path}.${event}`, code, "hook attachment entries must be a non-empty array"));
      continue;
    }
    for (const [index, entry] of entries.entries()) {
      checkHookAttachmentEntry(entry, `${path}.${event}[${index}]`, code, diagnostics);
    }
  }
}

function checkHookAttachmentEntry(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (typeof value === "string") {
    if (value.trim().length === 0) diagnostics.push(diagnostic(path, code, "hook attachment references must be non-empty strings"));
    return;
  }
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, code, "hook attachment entries must be strings or objects"));
    return;
  }
  checkAllowedKeys(value, new Set(["hook", "match", "providers", "status"]), path, `${code}-key`, diagnostics);
  if (typeof value.hook !== "string" || value.hook.trim().length === 0) {
    diagnostics.push(diagnostic(`${path}.hook`, code, "hook attachment objects must include a non-empty hook"));
  }
  checkHookAttachmentMatch(value.match, `${path}.match`, code, diagnostics);
  checkHookAttachmentProviders(value.providers, `${path}.providers`, code, diagnostics);
  checkOptionalNonEmptyString(value.status, `${path}.status`, code, diagnostics);
}

function checkHookAttachmentMatch(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value !== undefined && typeof value !== "string" && !isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, code, "hook attachment match must be a string or object when present"));
  }
  if (typeof value === "string" && value.trim().length === 0) {
    diagnostics.push(diagnostic(path, code, "hook attachment match must be non-empty when present"));
  }
}

function checkHookAttachmentProviders(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0) {
    diagnostics.push(diagnostic(path, code, "hook attachment providers must be a non-empty array when present"));
    return;
  }
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !targetNames.has(item)) {
      diagnostics.push(diagnostic(`${path}[${index}]`, code, `hook attachment providers entries must be ${targetListText}`));
      continue;
    }
    if (seen.has(item)) diagnostics.push(diagnostic(`${path}[${index}]`, `${code}-duplicate`, `duplicate hook attachment provider ${item}`));
    seen.add(item);
  }
}

function checkAdaptiveHookEvents(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    diagnostics.push(diagnostic(path, "schema/adaptive-hook/events", "adaptive hook events must be a non-empty string array"));
    return;
  }
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim().length === 0) {
      diagnostics.push(diagnostic(`${path}[${index}]`, "schema/adaptive-hook/events", "adaptive hook events entries must be non-empty strings"));
      continue;
    }
    if (seen.has(item)) diagnostics.push(diagnostic(`${path}[${index}]`, "schema/adaptive-hook/events-duplicate", `duplicate adaptive hook event ${item}`));
    seen.add(item);
  }
}

function checkAdaptiveHookProviders(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0) {
    diagnostics.push(diagnostic(path, "schema/adaptive-hook/providers", "adaptive hook providers must be a non-empty array when present"));
    return;
  }
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !targetNames.has(item)) {
      diagnostics.push(diagnostic(`${path}[${index}]`, "schema/adaptive-hook/providers", `adaptive hook providers entries must be ${targetListText}`));
      continue;
    }
    if (seen.has(item)) diagnostics.push(diagnostic(`${path}[${index}]`, "schema/adaptive-hook/providers-duplicate", `duplicate adaptive hook provider ${item}`));
    seen.add(item);
  }
}

function checkAdaptiveHookMatch(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value !== undefined && typeof value !== "string" && !isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/adaptive-hook/match", "adaptive hook match must be a string or object when present"));
  }
  if (typeof value === "string" && value.trim().length === 0) {
    diagnostics.push(diagnostic(path, "schema/adaptive-hook/match", "adaptive hook match must be non-empty when present"));
  }
}

const adaptiveHookContextStrategies = new Set(["inline", "none", "toolkit"]);
const adaptiveHookContextEnvFields = new Set(["hook.event", "provider", "session.id"]);

function checkAdaptiveHookContext(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/adaptive-hook/context", "adaptive hook context must be an object when present"));
    return;
  }
  checkAllowedKeys(value, new Set(["env", "includeRaw", "strategy"]), path, "schema/adaptive-hook/context-key", diagnostics);
  if (typeof value.strategy !== "string" || !adaptiveHookContextStrategies.has(value.strategy)) {
    diagnostics.push(diagnostic(`${path}.strategy`, "schema/adaptive-hook/context-strategy", "adaptive hook context.strategy must be inline, none, or toolkit"));
  }
  if (value.includeRaw !== undefined && typeof value.includeRaw !== "boolean") {
    diagnostics.push(diagnostic(`${path}.includeRaw`, "schema/adaptive-hook/context-include-raw", "adaptive hook context.includeRaw must be a boolean"));
  }
  if (value.env !== undefined) checkAdaptiveHookContextEnv(value.env, `${path}.env`, diagnostics);
  if (value.strategy === "inline" && (!Array.isArray(value.env) || value.env.length === 0)) {
    diagnostics.push(diagnostic(`${path}.env`, "schema/adaptive-hook/context-env", "adaptive hook context.env must be a non-empty array for inline strategy"));
  }
}

function checkAdaptiveHookContextEnv(value: SchemaJsonValue, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    diagnostics.push(diagnostic(path, "schema/adaptive-hook/context-env", "adaptive hook context.env must be a non-empty array when present"));
    return;
  }
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !adaptiveHookContextEnvFields.has(item)) {
      diagnostics.push(diagnostic(`${path}[${index}]`, "schema/adaptive-hook/context-env", "adaptive hook context.env entries must be provider, hook.event, or session.id"));
      continue;
    }
    if (seen.has(item)) diagnostics.push(diagnostic(`${path}[${index}]`, "schema/adaptive-hook/context-env-duplicate", `duplicate adaptive hook context env field ${item}`));
    seen.add(item);
  }
}

function checkAdaptiveHookRun(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/adaptive-hook/run", "adaptive hook run must be an object"));
    return;
  }
  checkAllowedKeys(value, new Set(["args", "command", "cwd", "env", "script"]), path, "schema/adaptive-hook/run-key", diagnostics);
  checkOptionalNonEmptyString(value.command, `${path}.command`, "schema/adaptive-hook/run-command", diagnostics);
  checkOptionalNonEmptyString(value.script, `${path}.script`, "schema/adaptive-hook/run-script", diagnostics);
  checkOptionalNonEmptyString(value.cwd, `${path}.cwd`, "schema/adaptive-hook/run-cwd", diagnostics);
  checkOptionalNonEmptyStringArray(value.args, `${path}.args`, "schema/adaptive-hook/run-args", diagnostics);
  checkStringRecord(value.env, `${path}.env`, "schema/adaptive-hook/run-env", diagnostics);
  if (value.command === undefined && value.script === undefined) {
    diagnostics.push(diagnostic(path, "schema/adaptive-hook/run-handler", "adaptive hook run must include command or script"));
  }
  if (typeof value.script === "string") checkRuntimePath(value.script, `${path}.script`, "script", diagnostics);
  if (typeof value.cwd === "string") checkSafeRelativePath(value.cwd, `${path}.cwd`, "cwd", diagnostics);
}

function checkStringRecord(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, code, `${path} must be an object when present`));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") diagnostics.push(diagnostic(`${path}.${key}`, code, `${path}.${key} must be a string`));
  }
}

function checkRuntimePath(value: string, path: string, label: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  checkSafeRelativePath(value, path, label, diagnostics);
  if (!(value.startsWith("./") || value.startsWith("{{scripts.dir}}/"))) {
    diagnostics.push(diagnostic(path, "schema/adaptive-hook/runtime-path-proof", `adaptive hook ${label} must use ./ or {{scripts.dir}}/`));
  }
}

function checkSafeRelativePath(value: string, path: string, label: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.split(/[\\/]+/).includes("..")) {
    diagnostics.push(diagnostic(path, "schema/adaptive-hook/path", `adaptive hook ${label} must not be absolute or escape with ..`));
  }
}

function checkOptionalChangeId(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !/^[0-9a-f]{12}$/.test(value)) {
    diagnostics.push(diagnostic(path, "schema/change-entry/id", "pending change id must be 12 lower-case hex characters"));
  }
}

function checkChangeBump(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) {
    diagnostics.push(diagnostic(path, "schema/change-entry/bump", "pending change entry requires bump: major, minor, patch, or none"));
    return;
  }
  if (value !== "major" && value !== "minor" && value !== "patch" && value !== "none") {
    diagnostics.push(diagnostic(path, "schema/change-entry/bump", "pending change entry requires bump: major, minor, patch, or none"));
  }
}

function checkChangeScopes(value: SchemaJsonRecord, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value.scope === undefined && value.scopes === undefined) {
    diagnostics.push(diagnostic(path, "schema/change-entry/scope", "pending change entry requires scope"));
    return;
  }
  checkOptionalNonEmptyString(value.scope, `${path}.scope`, "schema/change-entry/scope", diagnostics);
  checkOptionalNonEmptyStringArray(value.scopes, `${path}.scopes`, "schema/change-entry/scopes", diagnostics);
}

function checkChangeGroup(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined || typeof value === "string") return;
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/change-entry/group", "group must be a string or an object with id"));
    return;
  }
  checkAllowedKeys(value, new Set(["id", "provider"]), path, "schema/change-entry/group-key", diagnostics);
  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    diagnostics.push(diagnostic(`${path}.id`, "schema/change-entry/group", "group id must be non-empty"));
  }
  checkOptionalNonEmptyString(value.provider, `${path}.provider`, "schema/change-entry/group-provider", diagnostics);
}

function checkChangeEvidence(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (value === undefined) return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) checkChangeEvidenceEntry(item, `${path}[${index}]`, diagnostics);
    return;
  }
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/change-entry/evidence", "evidence must be an array or object when present"));
    return;
  }
  checkOptionalNonEmptyString(value.hash, `${path}.hash`, "schema/change-entry/evidence-hash", diagnostics);
  checkOptionalNonEmptyString(value.sourceHash, `${path}.sourceHash`, "schema/change-entry/evidence-hash", diagnostics);
  checkOptionalNonEmptyString(value.currentHash, `${path}.currentHash`, "schema/change-entry/evidence-hash", diagnostics);
  for (const [key, item] of Object.entries(value)) {
    if (key === "hash" || key === "sourceHash" || key === "currentHash") continue;
    if (typeof item === "string") {
      if (item.trim().length === 0) diagnostics.push(diagnostic(`${path}.${key}`, "schema/change-entry/evidence-hash", "evidence hash values must be non-empty strings"));
      continue;
    }
    checkChangeEvidenceEntry(item, `${path}.${key}`, diagnostics);
  }
}

function checkChangeEvidenceEntry(value: SchemaJsonValue | undefined, path: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (!isSchemaRecord(value)) {
    diagnostics.push(diagnostic(path, "schema/change-entry/evidence", "evidence entries must be objects"));
    return;
  }
  checkOptionalNonEmptyString(value.scope, `${path}.scope`, "schema/change-entry/evidence-scope", diagnostics);
  checkOptionalNonEmptyString(value.hash, `${path}.hash`, "schema/change-entry/evidence-hash", diagnostics);
  checkOptionalNonEmptyString(value.sourceHash, `${path}.sourceHash`, "schema/change-entry/evidence-hash", diagnostics);
  checkOptionalNonEmptyString(value.currentHash, `${path}.currentHash`, "schema/change-entry/evidence-hash", diagnostics);
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

function checkRequiredNonEmptyString(value: SchemaJsonValue | undefined, path: string, code: string, diagnostics: SkillsetSchemaDiagnostic[]): void {
  if (typeof value !== "string" || value.trim().length === 0) diagnostics.push(diagnostic(path, code, `${path} must be a non-empty string`));
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

function formatList(values: readonly string[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")}, or ${values.at(-1)}`;
}
