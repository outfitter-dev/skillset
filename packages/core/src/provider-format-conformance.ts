import {
  getProviderDestinationFormatSnapshot,
  getProviderSchemaSnapshot,
  providerSchemaManualOverlays,
  type ProviderDestinationFormatSnapshotId,
  type ProviderJsonSchemaSummary,
  type ProviderSchemaManualOverlayId,
  type ProviderSchemaSnapshotId,
} from "@skillset/registry";

import { CLAUDE_HOOK_EVENTS, validateHookDefinition } from "./hooks";
import { compareStrings } from "./path";
import type { SkillsetRenderResult } from "./render-result";
import type { JsonRecord, RenderedFile, TargetName } from "./types";
import { isJsonRecord, parseMarkdown } from "./yaml";

const textDecoder = new TextDecoder();

export type ProviderFormatConformanceIssueCode =
  | "invalid-json"
  | "invalid-markdown"
  | "invalid-toml"
  | "invalid-shape"
  | "invalid-field-type"
  | "missing-required-field"
  | "unknown-destination-field";

export interface ProviderFormatConformanceIssue {
  readonly code: ProviderFormatConformanceIssueCode;
  readonly message: string;
  readonly outputPath: string;
  readonly providerRef: ProviderDestinationFormatSnapshotId | ProviderSchemaManualOverlayId | ProviderSchemaSnapshotId;
  readonly sourcePath?: string;
  readonly target: TargetName;
}

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

export interface ProviderFormatConformanceFile {
  readonly content: Uint8Array;
  readonly destination?: string;
  readonly featureId?: string;
  readonly path: string;
  readonly sourcePath?: string;
  readonly target?: TargetName;
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
    author: "string",
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
  const parsed = parseJsonRecord(file, "codex", "codex-plugin-manifest-overlay");
  if (!parsed.ok) return parsed.issues;

  const issues: ProviderFormatConformanceIssue[] = [];
  const format = pluginManifestFormat("codex-plugin");
  const allowedFields = new Set([...format.requiredFields, ...format.optionalFields]);
  issues.push(...checkRequiredFields(file, parsed.value, "codex", "codex-plugin-manifest-overlay", format.requiredFields));
  issues.push(...checkFieldTypes(file, parsed.value, "codex", "codex-plugin-manifest-overlay", {
    apps: "string",
    author: "string",
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
    category: "string",
    commands: "string",
    description: "string",
    displayName: "string",
    hooks: "string",
    logo: "string",
    mcpServers: "string",
    name: "string",
    rules: "string",
    skills: "string",
    tags: "string-array",
    version: "string",
  }));
  issues.push(...checkUnknownFields(file, parsed.value, "cursor", "cursor-plugin", [...allowedFields]));
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

function parseJsonRecord(
  file: ProviderFormatConformanceFile,
  target: TargetName,
  providerRef: ProviderFormatConformanceIssue["providerRef"]
): { readonly issues: readonly ProviderFormatConformanceIssue[]; readonly ok: false } | { readonly ok: true; readonly value: JsonRecord } {
  try {
    const parsed = JSON.parse(textDecoder.decode(file.content)) as unknown;
    if (!isJsonRecord(parsed)) {
      return {
        issues: [issue(file, target, providerRef, "invalid-shape", "JSON content must be an object")],
        ok: false,
      };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    return {
      issues: [issue(file, target, providerRef, "invalid-json", errorMessage(error))],
      ok: false,
    };
  }
}

function parseTomlRecord(
  file: ProviderFormatConformanceFile,
  target: TargetName,
  providerRef: ProviderFormatConformanceIssue["providerRef"]
): { readonly issues: readonly ProviderFormatConformanceIssue[]; readonly ok: false } | { readonly ok: true; readonly value: JsonRecord } {
  try {
    const parsed = Bun.TOML.parse(textDecoder.decode(file.content)) as unknown;
    if (!isJsonRecord(parsed)) {
      return {
        issues: [issue(file, target, providerRef, "invalid-shape", "TOML content must be an object")],
        ok: false,
      };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    return {
      issues: [issue(file, target, providerRef, "invalid-toml", errorMessage(error))],
      ok: false,
    };
  }
}

function checkRequiredFields(
  file: ProviderFormatConformanceFile,
  value: JsonRecord,
  target: TargetName,
  providerRef: ProviderFormatConformanceIssue["providerRef"],
  requiredFields: readonly string[]
): readonly ProviderFormatConformanceIssue[] {
  return requiredFields
    .filter((field) => value[field] === undefined)
    .map((field) =>
      issue(file, target, providerRef, "missing-required-field", `missing required destination field ${field}`)
    );
}

function checkUnknownFields(
  file: ProviderFormatConformanceFile,
  value: JsonRecord,
  target: TargetName,
  providerRef: ProviderFormatConformanceIssue["providerRef"],
  allowedFields: readonly string[],
  prefix?: string
): readonly ProviderFormatConformanceIssue[] {
  const allowed = new Set(allowedFields);
  return Object.keys(value)
    .filter((field) => !allowed.has(field))
    .sort(compareStrings)
    .map((field) => {
      const label = prefix === undefined ? field : `${prefix}.${field}`;
      return issue(
        file,
        target,
        providerRef,
        "unknown-destination-field",
        `unknown destination field ${label}; allowed fields are ${[...allowed].sort(compareStrings).join(", ")}`
      );
    });
}

type FieldType = "object" | "string" | "string-array";

function checkFieldTypes(
  file: ProviderFormatConformanceFile,
  value: JsonRecord,
  target: TargetName,
  providerRef: ProviderFormatConformanceIssue["providerRef"],
  fields: Readonly<Record<string, FieldType>>
): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  for (const [field, expected] of Object.entries(fields).sort(([left], [right]) => compareStrings(left, right))) {
    const actual = value[field];
    if (actual === undefined || matchesFieldType(actual, expected)) continue;
    issues.push(issue(
      file,
      target,
      providerRef,
      "invalid-field-type",
      `destination field ${field} must be ${fieldTypeLabel(expected)}`
    ));
  }
  return issues;
}

function matchesFieldType(value: unknown, expected: FieldType): boolean {
  if (expected === "object") return isJsonRecord(value);
  if (expected === "string") return typeof value === "string";
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function fieldTypeLabel(expected: FieldType): string {
  if (expected === "object") return "an object";
  if (expected === "string-array") return "an array of strings";
  return "a string";
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

function jsonSchemaSummary(id: ProviderSchemaSnapshotId): ProviderJsonSchemaSummary {
  const summary = getProviderSchemaSnapshot(id)?.summary;
  if (isJsonSchemaSummary(summary)) return summary;
  return { schemaUri: "", properties: [], required: [] };
}

function isJsonSchemaSummary(value: unknown): value is ProviderJsonSchemaSummary {
  return isJsonRecord(value) && typeof value.schemaUri === "string";
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

function issue(
  file: ProviderFormatConformanceFile,
  target: TargetName,
  providerRef: ProviderFormatConformanceIssue["providerRef"],
  code: ProviderFormatConformanceIssueCode,
  message: string
): ProviderFormatConformanceIssue {
  const overlay = providerSchemaManualOverlays.find((item) => item.id === providerRef);
  return {
    code,
    message: overlay === undefined ? message : `${message} (${overlay.note})`,
    outputPath: file.path,
    providerRef,
    ...(file.sourcePath === undefined ? {} : { sourcePath: file.sourcePath }),
    target,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
