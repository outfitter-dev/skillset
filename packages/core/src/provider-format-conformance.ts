import {
  CURSOR_VARIABLES_REQUIRED_FIELDS,
  CURSOR_VARIABLES_TYPE,
  getProviderDestinationFormatSnapshot,
  isCursorSemver,
} from "@skillset/registry";

import {
  checkClaudeAuthorObject,
  checkClaudeMarketplace,
  isClaudeMarketplacePath,
} from "./claude-format-conformance";
import { CLAUDE_HOOK_EVENTS, validateHookDefinition } from "./hooks";
import {
  checkFieldTypes,
  checkRequiredFields,
  checkUnknownFields,
  errorMessage,
  issue,
  jsonSchemaSummary,
  parseJsonRecord,
  parseTomlRecord,
  type ProviderFormatConformanceFile,
  type ProviderFormatConformanceIssue,
} from "./provider-format-conformance-validation";
import { compareStrings } from "./path";
import type { SkillsetRenderResult } from "./render-result";
import type { JsonRecord, JsonValue, RenderedFile, TargetName } from "./types";
import { isJsonRecord, parseMarkdown } from "./yaml";

const textDecoder = new TextDecoder();

export type {
  ProviderFormatConformanceFile,
  ProviderFormatConformanceIssue,
  ProviderFormatConformanceIssueCode,
} from "./provider-format-conformance-validation";

export interface ProviderFormatConformanceReport {
  readonly checkedFiles: number;
  readonly issues: readonly ProviderFormatConformanceIssue[];
  readonly ok: boolean;
}

export function checkProviderFormatConformance(
  files: readonly ProviderFormatConformanceFile[]
): ProviderFormatConformanceReport {
  const issues = files.flatMap(checkProviderFormatConformanceFile);
  return {
    checkedFiles: files.length,
    issues: issues.sort(compareIssues),
    ok: issues.length === 0,
  };
}

export function formatProviderFormatConformanceReport(
  report: ProviderFormatConformanceReport
): string {
  if (report.ok) {
    return `skillset: provider format conformance passed for ${report.checkedFiles} files`;
  }
  return [
    `skillset: provider format conformance failed with ${report.issues.length} ${report.issues.length === 1 ? "issue" : "issues"}`,
    ...report.issues.map((issue) =>
      `- ${issue.outputPath} ${issue.providerRef}: ${issue.message}`
    ),
  ].join("\n");
}

export function providerFormatConformanceFiles(
  rendered: readonly RenderedFile[],
  renderResults: readonly SkillsetRenderResult[] = []
): readonly ProviderFormatConformanceFile[] {
  const renderedByPath = new Map(rendered.map((file) => [file.path, file]));
  const selected = new Map<string, ProviderFormatConformanceFile>();

  for (const outcome of renderResults) {
    if (outcome.outputs === undefined || outcome.target === undefined) continue;
    if (!isProviderFormatConformanceOutcome(outcome)) continue;
    for (const output of outcome.outputs) {
      const file = renderedByPath.get(output.path);
      if (file === undefined || selected.has(file.path)) continue;
      selected.set(file.path, {
        ...file,
        ...(outcome.destination === undefined ? {} : { destination: outcome.destination }),
        featureId: outcome.featureId,
        ...(outcome.sourcePath === undefined ? {} : { sourcePath: outcome.sourcePath }),
        target: outcome.target,
      });
    }
  }

  for (const file of rendered) {
    if (selected.has(file.path)) continue;
    if (isProviderFormatConformanceFile(file)) selected.set(file.path, file);
  }

  return [...selected.values()];
}

function isProviderFormatConformanceOutcome(outcome: SkillsetRenderResult): boolean {
  if (outcome.target === undefined) return false;
  if (outcome.featureId === "plugin-manifests") return true;
  if (outcome.featureId === "plugin-hooks") return true;
  if (outcome.featureId === "project-agents") return true;
  if (outcome.featureId === "standalone-skills") return true;
  if (outcome.featureId === "plugin-skills") return true;
  if (outcome.featureId === "plugin-agents" && outcome.target === "claude") return true;
  if (outcome.featureId === "plugin-agents" && outcome.target === "cursor") return true;
  if (outcome.featureId === "project-instructions" && outcome.target === "codex") return true;
  if (outcome.featureId === "project-instructions" && outcome.target === "cursor") return true;
  return false;
}

function isProviderFormatConformanceFile(file: RenderedFile): boolean {
  if (isClaudeMarketplacePath(file.path)) return true;
  if (isCursorMarketplacePath(file.path)) return true;
  if (file.path.endsWith("/.claude-plugin/plugin.json")) return true;
  if (file.path.endsWith("/.codex-plugin/plugin.json")) return true;
  if (file.path.endsWith("/.cursor-plugin/plugin.json")) return true;
  if (isClaudeHookPath(file.path)) return true;
  if (isCodexHookPath(file.path)) return true;
  if (isCursorHookPath(file.path)) return true;
  if (file.path === "AGENTS.md" || file.path.endsWith("/AGENTS.md")) return true;
  if (file.path.endsWith("/SKILL.md") && skillTarget(file.path) !== undefined) return true;
  if (isClaudeSubagentPath(file.path)) return true;
  if (isCodexSubagentPath(file.path)) return true;
  if (isCursorAgentPath(file.path)) return true;
  if (isCursorRulePath(file.path)) return true;
  return false;
}

function checkProviderFormatConformanceFile(
  file: ProviderFormatConformanceFile
): readonly ProviderFormatConformanceIssue[] {
  if (isClaudeMarketplacePath(file.path)) {
    return checkClaudeMarketplace(file);
  }
  if (isCursorMarketplacePath(file.path)) {
    return checkCursorMarketplace(file);
  }
  if (file.path.endsWith("/.claude-plugin/plugin.json")) {
    return checkClaudePluginManifest(file);
  }
  if (file.path.endsWith("/.codex-plugin/plugin.json")) {
    return checkCodexPluginManifest(file);
  }
  if (file.path.endsWith("/.cursor-plugin/plugin.json")) {
    return checkCursorPluginManifest(file);
  }
  if (isClaudeHookFile(file)) {
    return checkClaudeHooks(file);
  }
  if (isCodexHookFile(file)) {
    return checkCodexHooks(file);
  }
  if (isCursorHookFile(file)) {
    return checkCursorHooks(file);
  }
  if (file.path === "AGENTS.md" || file.path.endsWith("/AGENTS.md")) {
    return checkAgentsMarkdown(file);
  }
  if (isClaudeSubagentFile(file)) {
    return checkClaudeSubagent(file);
  }
  if (isCodexSubagentFile(file)) {
    return checkCodexSubagent(file);
  }
  if (isCursorAgentFile(file)) {
    return checkCursorAgent(file);
  }
  if (isCursorRuleFile(file)) {
    return checkCursorRule(file);
  }
  if (file.path.endsWith("/SKILL.md")) {
    return checkSkillMarkdown(file);
  }
  return [];
}

function checkClaudePluginManifest(
  file: ProviderFormatConformanceFile
): readonly ProviderFormatConformanceIssue[] {
  const parsed = parseJsonRecord(file, "claude", "claude-plugin-manifest-schema");
  if (!parsed.ok) return parsed.issues;

  const issues: ProviderFormatConformanceIssue[] = [];
  const schema = jsonSchemaSummary("claude-plugin-manifest-schema");
  const format = pluginManifestFormat("claude-plugin");
  issues.push(...checkRequiredFields(file, parsed.value, "claude", "claude-plugin", format.requiredFields));
  issues.push(...checkFieldTypes(file, parsed.value, "claude", "claude-plugin-manifest-schema", {
    $schema: "string",
    agents: "string",
    author: "object",
    commands: "string",
    dependencies: "object",
    description: "string",
    experimental: "object",
    homepage: "string",
    hooks: "string",
    keywords: "string-array",
    license: "string",
    lspServers: "string",
    mcpServers: "string",
    monitors: "string",
    name: "string",
    outputStyles: "string",
    repository: "string",
    settings: "string",
    skills: "string",
    themes: "string",
    userConfig: "object",
    version: "string",
  }));
  issues.push(
    ...checkUnknownFields(file, parsed.value, "claude", "claude-plugin-manifest-schema", [
      ...(schema.properties ?? []),
      "experimental",
    ])
  );
  if (isJsonRecord(parsed.value.author)) {
    issues.push(
      ...checkClaudeAuthorObject(
        file,
        parsed.value.author,
        "claude-plugin-manifest-schema",
        "author"
      )
    );
  }
  if (isJsonRecord(parsed.value.experimental)) {
    issues.push(
      ...checkUnknownFields(file, parsed.value.experimental, "claude", "claude-plugin", [
        "monitors",
        "themes",
      ], "experimental")
    );
  }
  return issues;
}

function checkCodexPluginManifest(
  file: ProviderFormatConformanceFile
): readonly ProviderFormatConformanceIssue[] {
  // Runtime ingestion is intentionally broader than the plugin-creator handoff
  // preflight. Keep the generic destination contract sourced from the runtime
  // loader; the self-hosted artifact exercises the stricter preflight separately.
  const parsed = parseJsonRecord(file, "codex", "codex-plugin-manifest-overlay");
  if (!parsed.ok) return parsed.issues;

  const issues: ProviderFormatConformanceIssue[] = [];
  const format = pluginManifestFormat("codex-plugin");
  const allowedFields = new Set([...format.requiredFields, ...format.optionalFields]);
  issues.push(...checkRequiredFields(file, parsed.value, "codex", "codex-plugin-manifest-overlay", format.requiredFields));
  issues.push(...checkFieldTypes(file, parsed.value, "codex", "codex-plugin-manifest-overlay", {
    apps: "string",
    author: "object",
    description: "string",
    homepage: "string",
    hooks: "string",
    interface: "object",
    keywords: "string-array",
    license: "string",
    mcpServers: "string",
    name: "string",
    repository: "string",
    skills: "string",
    version: "string",
  }));
  issues.push(...checkUnknownFields(file, parsed.value, "codex", "codex-plugin-manifest-overlay", [...allowedFields]));
  if (isJsonRecord(parsed.value.author)) {
    issues.push(
      ...checkAuthorObject(file, parsed.value.author, "codex", "codex-plugin-manifest-overlay", "author", ["email", "name", "url"])
    );
  }
  if (isJsonRecord(parsed.value.interface)) {
    issues.push(
      ...checkUnknownFields(file, parsed.value.interface, "codex", "codex-plugin-manifest-overlay", format.interfaceFields, "interface")
    );
  }
  return issues;
}

function checkCursorPluginManifest(
  file: ProviderFormatConformanceFile
): readonly ProviderFormatConformanceIssue[] {
  const parsed = parseJsonRecord(file, "cursor", "cursor-plugin");
  if (!parsed.ok) return parsed.issues;

  const issues: ProviderFormatConformanceIssue[] = [];
  const format = pluginManifestFormat("cursor-plugin");
  const allowedFields = new Set([...format.requiredFields, ...format.optionalFields]);
  issues.push(...checkRequiredFields(file, parsed.value, "cursor", "cursor-plugin", format.requiredFields));
  issues.push(...checkFieldTypes(file, parsed.value, "cursor", "cursor-plugin", {
    agents: "string",
    author: "object",
    category: "string",
    commands: "string",
    description: "string",
    displayName: "string",
    hooks: "string",
    homepage: "string",
    keywords: "string-array",
    license: "string",
    logo: "string",
    mcpServers: "string",
    name: "string",
    publisher: "string",
    repository: "string",
    rules: "string",
    skills: "string",
    tags: "string-array",
    version: "string",
  }));
  issues.push(
    ...checkCursorMinClientVersions(file, parsed.value.minClientVersions, "cursor-plugin", "minClientVersions")
  );
  issues.push(...checkCursorVariables(file, parsed.value.variables, "cursor-plugin", "variables"));
  issues.push(...checkUnknownFields(file, parsed.value, "cursor", "cursor-plugin", [...allowedFields]));
  if (isJsonRecord(parsed.value.author)) {
    issues.push(
      ...checkAuthorObject(file, parsed.value.author, "cursor", "cursor-plugin", "author", ["email", "name"])
    );
  }
  return issues;
}

/**
 * The pinned Cursor plugin and marketplace schemas type `minClientVersions` as
 * an object with `minProperties: 1` whose every member is a `semver` string.
 * Checking objectness alone would report conformance for an artifact Cursor
 * rejects, so validate the members against the pinned contract.
 */
function checkCursorMinClientVersions(
  file: ProviderFormatConformanceFile,
  value: JsonValue | undefined,
  providerRef: ProviderFormatConformanceIssue["providerRef"],
  prefix: string
): readonly ProviderFormatConformanceIssue[] {
  if (value === undefined) return [];
  if (!isJsonRecord(value)) {
    return [issue(file, "cursor", providerRef, "invalid-field-type", `destination field ${prefix} must be an object`)];
  }
  const clients = Object.keys(value).sort(compareStrings);
  if (clients.length === 0) {
    return [issue(file, "cursor", providerRef, "invalid-shape", `destination field ${prefix} must declare at least one client version`)];
  }
  return clients
    .filter((client) => !isCursorSemver(value[client]))
    .map((client) =>
      issue(
        file,
        "cursor",
        providerRef,
        "invalid-field-type",
        `destination field ${prefix}.${client} must be a semantic version string such as "3.13.0"`
      )
    );
}

/**
 * The pinned Cursor plugin schema types `variables` as a nested JSON Schema:
 * `type` is required and pinned to the `object` const, `properties` is an
 * object, and `required` is a unique string array. Checking objectness alone
 * would report conformance for an artifact Cursor rejects, so validate the
 * declared members against the pinned contract. Additional keys stay allowed
 * because the pinned definition does not close them.
 */
function checkCursorVariables(
  file: ProviderFormatConformanceFile,
  value: JsonValue | undefined,
  providerRef: ProviderFormatConformanceIssue["providerRef"],
  prefix: string
): readonly ProviderFormatConformanceIssue[] {
  if (value === undefined) return [];
  if (!isJsonRecord(value)) {
    return [issue(file, "cursor", providerRef, "invalid-field-type", `destination field ${prefix} must be an object`)];
  }
  const issues: ProviderFormatConformanceIssue[] = [
    ...checkRequiredFields(file, value, "cursor", providerRef, CURSOR_VARIABLES_REQUIRED_FIELDS, prefix),
  ];
  if (value.type !== undefined && value.type !== CURSOR_VARIABLES_TYPE) {
    issues.push(
      issue(
        file,
        "cursor",
        providerRef,
        "invalid-field-type",
        `destination field ${prefix}.type must be the string "${CURSOR_VARIABLES_TYPE}"`
      )
    );
  }
  issues.push(
    ...checkFieldTypes(file, value, "cursor", providerRef, { properties: "object", required: "string-array" }, prefix)
  );
  const required = value.required;
  if (
    Array.isArray(required) &&
    required.every((entry) => typeof entry === "string") &&
    new Set(required).size !== required.length
  ) {
    issues.push(
      issue(file, "cursor", providerRef, "invalid-shape", `destination field ${prefix}.required must not repeat a variable name`)
    );
  }
  return issues;
}

function checkCursorMarketplace(
  file: ProviderFormatConformanceFile
): readonly ProviderFormatConformanceIssue[] {
  const parsed = parseJsonRecord(file, "cursor", "cursor-marketplace-schema");
  if (!parsed.ok) return parsed.issues;
  const issues: ProviderFormatConformanceIssue[] = [
    ...checkRequiredFields(file, parsed.value, "cursor", "cursor-marketplace-schema", ["name", "plugins"]),
    ...checkFieldTypes(file, parsed.value, "cursor", "cursor-marketplace-schema", {
      name: "string",
      metadata: "object",
      owner: "object",
      plugins: "array",
    }),
    ...checkUnknownFields(file, parsed.value, "cursor", "cursor-marketplace-schema", ["metadata", "name", "owner", "plugins"]),
  ];
  if (isJsonRecord(parsed.value.owner)) {
    issues.push(
      ...checkAuthorObject(file, parsed.value.owner, "cursor", "cursor-marketplace-schema", "owner", ["email", "name"])
    );
  }
  if (Array.isArray(parsed.value.plugins)) {
    for (const [index, plugin] of parsed.value.plugins.entries()) {
      const prefix = `plugins[${index}]`;
      if (!isJsonRecord(plugin)) {
        issues.push(issue(file, "cursor", "cursor-marketplace-schema", "invalid-shape", `destination field ${prefix} must be an object`));
        continue;
      }
      for (const field of ["name", "source"] as const) {
        if (plugin[field] === undefined) {
          issues.push(issue(file, "cursor", "cursor-marketplace-schema", "missing-required-field", `missing required destination field ${prefix}.${field}`));
        }
      }
      for (const field of ["description", "name", "source"] as const) {
        if (plugin[field] !== undefined && typeof plugin[field] !== "string") {
          issues.push(issue(file, "cursor", "cursor-marketplace-schema", "invalid-field-type", `destination field ${prefix}.${field} must be a string`));
        }
      }
      issues.push(
        ...checkCursorMinClientVersions(
          file,
          plugin.minClientVersions,
          "cursor-marketplace-schema",
          `${prefix}.minClientVersions`
        )
      );
      issues.push(
        ...checkUnknownFields(file, plugin, "cursor", "cursor-marketplace-schema", ["description", "minClientVersions", "name", "source"], prefix)
      );
    }
  }
  return issues;
}

function checkClaudeHooks(
  file: ProviderFormatConformanceFile
): readonly ProviderFormatConformanceIssue[] {
  const parsed = parseJsonRecord(file, "claude", "claude-hooks");
  if (!parsed.ok) return parsed.issues;

  const format = claudeHooksFormat();
  const allowedRootFields = [
    ...format.rootFields,
    ...CLAUDE_HOOK_EVENTS,
  ];
  const issues: ProviderFormatConformanceIssue[] = [
    ...checkFieldTypes(file, parsed.value, "claude", "claude-hooks", {
      description: "string",
      hooks: "object",
    }),
    ...checkUnknownFields(file, parsed.value, "claude", "claude-hooks", allowedRootFields),
  ];
  if (parsed.value.hooks !== undefined && !isJsonRecord(parsed.value.hooks)) {
    issues.push(issue(file, "claude", "claude-hooks", "invalid-shape", "hooks must be an object when present"));
  }
  try {
    validateHookDefinition(parsed.value, { sourcePath: file.path, target: "claude" });
  } catch (error) {
    issues.push(issue(file, "claude", "claude-hooks", "invalid-shape", errorMessage(error)));
  }
  return issues;
}

function checkCodexHooks(
  file: ProviderFormatConformanceFile
): readonly ProviderFormatConformanceIssue[] {
  const parsed = parseJsonRecord(file, "codex", "codex-hooks-schema");
  if (!parsed.ok) return parsed.issues;

  const issues: ProviderFormatConformanceIssue[] = [];
  const schema = jsonSchemaSummary("codex-hooks-schema");
  issues.push(...checkRequiredFields(file, parsed.value, "codex", "codex-hooks-schema", schema.required ?? []));
  issues.push(...checkFieldTypes(file, parsed.value, "codex", "codex-hooks-schema", { hooks: "object" }));
  issues.push(...checkUnknownFields(file, parsed.value, "codex", "codex-hooks-schema", schema.properties ?? []));
  try {
    validateHookDefinition(parsed.value, { sourcePath: file.path, target: "codex" });
  } catch (error) {
    issues.push(issue(file, "codex", "codex-hooks-schema", "invalid-shape", errorMessage(error)));
  }
  return issues;
}

function checkCursorHooks(
  file: ProviderFormatConformanceFile
): readonly ProviderFormatConformanceIssue[] {
  const parsed = parseJsonRecord(file, "cursor", "cursor-hooks");
  if (!parsed.ok) return parsed.issues;

  const format = cursorHooksFormat();
  const issues: ProviderFormatConformanceIssue[] = [
    ...checkFieldTypes(file, parsed.value, "cursor", "cursor-hooks", { hooks: "object" }),
    ...checkUnknownFields(file, parsed.value, "cursor", "cursor-hooks", format.rootFields),
  ];
  try {
    validateHookDefinition(parsed.value, { sourcePath: file.path, target: "cursor" });
  } catch (error) {
    issues.push(issue(file, "cursor", "cursor-hooks", "invalid-shape", errorMessage(error)));
  }
  return issues;
}

function checkAgentsMarkdown(
  file: ProviderFormatConformanceFile
): readonly ProviderFormatConformanceIssue[] {
  const text = textDecoder.decode(file.content);
  if (!text.includes("Generated by")) {
    return [
      issue(
        file,
        "codex",
        "codex-agents-md-overlay",
        "invalid-shape",
        "generated AGENTS.md must include the generated-by header required by the Codex AGENTS.md overlay check"
      ),
    ];
  }
  return [];
}

function checkClaudeSubagent(
  file: ProviderFormatConformanceFile
): readonly ProviderFormatConformanceIssue[] {
  const text = textDecoder.decode(file.content);
  let frontmatter: JsonRecord;
  try {
    frontmatter = parseMarkdown(text, file.path).frontmatter;
  } catch (error) {
    return [issue(file, "claude", "claude-subagent-frontmatter-overlay", "invalid-markdown", errorMessage(error))];
  }

  const format = claudeSubagentFormat();
  return [
    ...checkRequiredFields(file, frontmatter, "claude", "claude-subagent-frontmatter-overlay", format.requiredFields),
    ...checkUnknownFields(file, frontmatter, "claude", "claude-subagent-frontmatter-overlay", [
      ...format.requiredFields,
      ...format.optionalFields,
      "metadata",
      "skills",
    ]),
  ];
}

function checkCodexSubagent(
  file: ProviderFormatConformanceFile
): readonly ProviderFormatConformanceIssue[] {
  const parsed = parseTomlRecord(file, "codex", "codex-subagent-toml-overlay");
  if (!parsed.ok) return parsed.issues;

  const format = codexSubagentFormat();
  const allowedFields = [...format.requiredFields, ...format.optionalFields, "metadata"];
  return [
    ...checkRequiredFields(file, parsed.value, "codex", "codex-subagent-toml-overlay", format.requiredFields),
    ...checkUnknownFields(file, parsed.value, "codex", "codex-subagent-toml-overlay", allowedFields),
  ];
}

function checkCursorAgent(
  file: ProviderFormatConformanceFile
): readonly ProviderFormatConformanceIssue[] {
  const text = textDecoder.decode(file.content);
  let frontmatter: JsonRecord;
  try {
    frontmatter = parseMarkdown(text, file.path).frontmatter;
  } catch (error) {
    return [issue(file, "cursor", "cursor-agent", "invalid-markdown", errorMessage(error))];
  }

  const format = cursorAgentFormat();
  return [
    ...checkRequiredFields(file, frontmatter, "cursor", "cursor-agent", format.requiredFields),
    ...checkUnknownFields(file, frontmatter, "cursor", "cursor-agent", [
      ...format.requiredFields,
      ...format.optionalFields,
      "metadata",
    ]),
  ];
}

function checkCursorRule(
  file: ProviderFormatConformanceFile
): readonly ProviderFormatConformanceIssue[] {
  const text = textDecoder.decode(file.content);
  let frontmatter: JsonRecord;
  try {
    frontmatter = parseMarkdown(text, file.path).frontmatter;
  } catch (error) {
    return [issue(file, "cursor", "cursor-rules", "invalid-markdown", errorMessage(error))];
  }

  const format = cursorRuleFormat();
  return [
    ...checkRequiredFields(file, frontmatter, "cursor", "cursor-rules", format.requiredFields),
    ...checkUnknownFields(file, frontmatter, "cursor", "cursor-rules", [
      ...format.requiredFields,
      ...format.optionalFields,
      "metadata",
    ]),
  ];
}

function checkSkillMarkdown(
  file: ProviderFormatConformanceFile
): readonly ProviderFormatConformanceIssue[] {
  const target = file.target ?? skillTarget(file.path) ?? "claude";
  const providerRef =
    target === "codex" ? "codex-skill" : target === "cursor" ? "cursor-skill" : "claude-skill-frontmatter-overlay";
  const text = textDecoder.decode(file.content);
  let frontmatter: JsonRecord;
  try {
    frontmatter = parseMarkdown(text, file.path).frontmatter;
  } catch (error) {
    return [issue(file, target, providerRef, "invalid-markdown", errorMessage(error))];
  }

  if (target === "claude") {
    const format = skillFrontmatterFormat("claude-skill");
    return checkUnknownFields(file, frontmatter, "claude", providerRef, [
      ...(format.optionalFields ?? []),
      ...(format.recommendedFields ?? []),
      "metadata",
      "references",
    ]);
  }

  const format = skillFrontmatterFormat(target === "cursor" ? "cursor-skill" : "codex-skill");
  return [
    ...checkRequiredFields(file, frontmatter, target, providerRef, format.requiredFields ?? []),
    ...checkUnknownFields(file, frontmatter, target, providerRef, [
      ...(format.requiredFields ?? []),
      ...(format.optionalFields ?? []),
      "metadata",
      "references",
    ]),
  ];
}

function checkAuthorObject(
  file: ProviderFormatConformanceFile,
  author: JsonRecord,
  target: TargetName,
  providerRef: ProviderFormatConformanceIssue["providerRef"],
  prefix: string,
  allowedFields: readonly string[]
): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  if (author.name === undefined) {
    issues.push(
      issue(
        file,
        target,
        providerRef,
        "missing-required-field",
        `missing required destination field ${prefix}.name`
      )
    );
  }
  for (const key of allowedFields) {
    const value = author[key];
    if (value === undefined || typeof value === "string") continue;
    issues.push(
      issue(
        file,
        target,
        providerRef,
        "invalid-field-type",
        `destination field ${prefix}.${key} must be a string`
      )
    );
  }
  issues.push(
    ...checkUnknownFields(
      file,
      author,
      target,
      providerRef,
      allowedFields,
      prefix
    )
  );
  return issues;
}

function isCursorMarketplacePath(path: string): boolean {
  return (
    path === ".cursor-plugin/marketplace.json" ||
    path.endsWith("/.cursor-plugin/marketplace.json")
  );
}

function pluginManifestFormat(id: "claude-plugin" | "codex-plugin" | "cursor-plugin"): {
  readonly interfaceFields: readonly string[];
  readonly optionalFields: readonly string[];
  readonly requiredFields: readonly string[];
} {
  const snapshot = getProviderDestinationFormatSnapshot(id);
  const manifest = isJsonRecord(snapshot?.format) && isJsonRecord(snapshot.format.manifest)
    ? snapshot.format.manifest
    : {};
  return {
    interfaceFields: readStringArray(manifest, "interfaceFields"),
    optionalFields: readStringArray(manifest, "optionalFields"),
    requiredFields: readStringArray(manifest, "requiredFields"),
  };
}

function claudeHooksFormat(): {
  readonly rootFields: readonly string[];
} {
  const snapshot = getProviderDestinationFormatSnapshot("claude-hooks");
  const format = isJsonRecord(snapshot?.format) ? snapshot.format : {};
  return {
    rootFields: readStringArray(format, "rootFields"),
  };
}

function cursorHooksFormat(): {
  readonly rootFields: readonly string[];
} {
  const snapshot = getProviderDestinationFormatSnapshot("cursor-hooks");
  const format = isJsonRecord(snapshot?.format) ? snapshot.format : {};
  return {
    rootFields: readStringArray(format, "rootFields"),
  };
}

function claudeSubagentFormat(): {
  readonly optionalFields: readonly string[];
  readonly requiredFields: readonly string[];
} {
  const snapshot = getProviderDestinationFormatSnapshot("claude-subagent");
  const frontmatter = isJsonRecord(snapshot?.format) && isJsonRecord(snapshot.format.frontmatter)
    ? snapshot.format.frontmatter
    : {};
  return {
    optionalFields: readStringArray(frontmatter, "optionalFields"),
    requiredFields: readStringArray(frontmatter, "requiredFields"),
  };
}

function skillFrontmatterFormat(id: "claude-skill" | "codex-skill" | "cursor-skill"): {
  readonly optionalFields?: readonly string[];
  readonly recommendedFields?: readonly string[];
  readonly requiredFields?: readonly string[];
} {
  const snapshot = getProviderDestinationFormatSnapshot(id);
  const frontmatter = isJsonRecord(snapshot?.format) && isJsonRecord(snapshot.format.frontmatter)
    ? snapshot.format.frontmatter
    : {};
  return {
    optionalFields: readStringArray(frontmatter, "optionalFields"),
    recommendedFields: readStringArray(frontmatter, "recommendedFields"),
    requiredFields: readStringArray(frontmatter, "requiredFields"),
  };
}

function codexSubagentFormat(): {
  readonly optionalFields: readonly string[];
  readonly requiredFields: readonly string[];
} {
  const snapshot = getProviderDestinationFormatSnapshot("codex-subagent");
  const format = isJsonRecord(snapshot?.format) ? snapshot.format : {};
  return {
    optionalFields: readStringArray(format, "optionalFields"),
    requiredFields: readStringArray(format, "requiredFields"),
  };
}

function cursorAgentFormat(): {
  readonly optionalFields: readonly string[];
  readonly requiredFields: readonly string[];
} {
  const snapshot = getProviderDestinationFormatSnapshot("cursor-agent");
  const frontmatter = isJsonRecord(snapshot?.format) && isJsonRecord(snapshot.format.frontmatter)
    ? snapshot.format.frontmatter
    : {};
  return {
    optionalFields: readStringArray(frontmatter, "optionalFields"),
    requiredFields: readStringArray(frontmatter, "requiredFields"),
  };
}

function cursorRuleFormat(): {
  readonly optionalFields: readonly string[];
  readonly requiredFields: readonly string[];
} {
  const snapshot = getProviderDestinationFormatSnapshot("cursor-rules");
  const frontmatter = isJsonRecord(snapshot?.format) && isJsonRecord(snapshot.format.frontmatter)
    ? snapshot.format.frontmatter
    : {};
  return {
    optionalFields: readStringArray(frontmatter, "optionalFields"),
    requiredFields: readStringArray(frontmatter, "requiredFields"),
  };
}

function readStringArray(record: JsonRecord, key: string): readonly string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function isClaudeHookPath(path: string): boolean {
  return hasPluginTargetSegment(path, "claude") && path.endsWith("/hooks/hooks.json");
}

function isClaudeHookFile(file: ProviderFormatConformanceFile): boolean {
  return (file.target === "claude" && file.destination === "hooks") || isClaudeHookPath(file.path);
}

function isCodexHookPath(path: string): boolean {
  return hasPluginTargetSegment(path, "codex") && path.endsWith("/hooks/hooks.json");
}

function isCodexHookFile(file: ProviderFormatConformanceFile): boolean {
  return (file.target === "codex" && file.destination === "hooks") || isCodexHookPath(file.path);
}

function isCursorHookPath(path: string): boolean {
  return hasPluginTargetSegment(path, "cursor") && path.endsWith("/hooks/hooks.json");
}

function isCursorHookFile(file: ProviderFormatConformanceFile): boolean {
  return (file.target === "cursor" && file.destination === "hooks") || isCursorHookPath(file.path);
}

function isClaudeSubagentPath(path: string): boolean {
  return path.endsWith(".md") && (
    hasSegmentSequence(path, ".claude", "agents") ||
    (hasPluginTargetSegment(path, "claude") && hasSegment(path, "agents"))
  );
}

function isClaudeSubagentFile(file: ProviderFormatConformanceFile): boolean {
  return (
    file.target === "claude" &&
    (file.destination === "agent" || file.destination === "agents")
  ) || isClaudeSubagentPath(file.path);
}

function isCodexSubagentPath(path: string): boolean {
  return path.endsWith(".toml") && hasSegmentSequence(path, ".codex", "agents");
}

function isCodexSubagentFile(file: ProviderFormatConformanceFile): boolean {
  return (file.target === "codex" && file.destination === "agent") || isCodexSubagentPath(file.path);
}

function isCursorAgentPath(path: string): boolean {
  return path.endsWith(".md") && (
    hasSegmentSequence(path, ".cursor", "agents") ||
    (hasPluginTargetSegment(path, "cursor") && hasSegment(path, "agents"))
  );
}

function isCursorAgentFile(file: ProviderFormatConformanceFile): boolean {
  return (
    file.target === "cursor" &&
    (file.destination === "agent" || file.destination === "agents")
  ) || isCursorAgentPath(file.path);
}

function isCursorRulePath(path: string): boolean {
  return path.endsWith(".mdc") && (
    hasSegmentSequence(path, ".cursor", "rules") ||
    (hasPluginTargetSegment(path, "cursor") && hasSegment(path, "rules"))
  );
}

function isCursorRuleFile(file: ProviderFormatConformanceFile): boolean {
  return (file.target === "cursor" && file.destination === "instructions") || isCursorRulePath(file.path);
}

function skillTarget(path: string): TargetName | undefined {
  if (!path.endsWith("/SKILL.md")) return undefined;
  if (hasSegmentSequence(path, ".agents", "skills") || hasPluginTargetSegment(path, "codex")) return "codex";
  if (hasSegmentSequence(path, ".claude", "skills") || hasPluginTargetSegment(path, "claude")) return "claude";
  if (hasSegmentSequence(path, ".cursor", "skills") || hasPluginTargetSegment(path, "cursor")) return "cursor";
  return undefined;
}

function hasPluginTargetSegment(path: string, target: TargetName): boolean {
  const parts = path.split("/");
  for (let index = 0; index < parts.length - 2; index += 1) {
    if (parts[index] === "plugins" && parts[index + 2] === target) return true;
  }
  return false;
}

function hasSegment(path: string, segment: string): boolean {
  return path.split("/").includes(segment);
}

function hasSegmentSequence(path: string, ...sequence: readonly string[]): boolean {
  const segments = path.split("/");
  return segments.some((segment, index) =>
    segment === sequence[0] &&
    sequence.every((candidate, offset) => segments[index + offset] === candidate)
  );
}

function compareIssues(
  left: ProviderFormatConformanceIssue,
  right: ProviderFormatConformanceIssue
): number {
  return compareStrings(
    `${left.outputPath}\0${left.providerRef}\0${left.code}\0${left.message}`,
    `${right.outputPath}\0${right.providerRef}\0${right.code}\0${right.message}`
  );
}
