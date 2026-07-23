import {
  TARGET_NAMES,
  validateAgentFrontmatter,
  validateHookDefinitionSource,
  validateInstructionFrontmatter,
  validateSkillEval,
  validateSkillFrontmatter,
  validateTestDeclaration,
  validateWorkspaceConfig,
  type SkillsetSchemaDiagnostic,
} from "@skillset/schema";

import { createWorkbenchDiagnostic, sortWorkbenchDiagnostics } from "./diagnostics";
import { parseWorkbenchDocument } from "./parser";
import type {
  WorkbenchDiagnostic,
  WorkbenchFix,
  WorkbenchMarkdownParseResult,
  WorkbenchParseKind,
  WorkbenchParseResult,
} from "./types";

export type WorkbenchSourceContractKind = "agent" | "hook" | "instruction" | "skill" | "skill-eval" | "test-declaration" | "workspace-config";

const TARGET_LIST = TARGET_NAMES.join(", ");

export interface WorkbenchSourceContractInput {
  readonly content: string;
  readonly kind: WorkbenchSourceContractKind;
  readonly path: string;
}

export function checkWorkbenchSourceContract(
  input: WorkbenchSourceContractInput
): readonly WorkbenchDiagnostic[] {
  const parsed = parseWorkbenchDocument({
    content: input.content,
    kind: parseKindForContract(input.kind),
    path: input.path,
  });
  const parseDiagnostics = [...parsed.diagnostics];
  if (parseDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return sortWorkbenchDiagnostics(parseDiagnostics);
  }

  if (input.kind === "agent") {
    return sortWorkbenchDiagnostics([...parseDiagnostics, ...checkAgentContract(parsed, input.path, input.content)]);
  }
  if (input.kind === "hook") {
    return sortWorkbenchDiagnostics([...parseDiagnostics, ...checkHookContract(parsed, input.path, input.content)]);
  }
  if (input.kind === "instruction") {
    return sortWorkbenchDiagnostics([...parseDiagnostics, ...checkInstructionContract(parsed, input.path, input.content)]);
  }
  if (input.kind === "skill") {
    return sortWorkbenchDiagnostics([...parseDiagnostics, ...checkSkillContract(parsed, input.path, input.content)]);
  }
  if (input.kind === "skill-eval") {
    return sortWorkbenchDiagnostics([...parseDiagnostics, ...checkSkillEvalContract(parsed, input.path, input.content)]);
  }
  if (input.kind === "test-declaration") {
    return sortWorkbenchDiagnostics([...parseDiagnostics, ...checkTestDeclarationContract(parsed, input.path, input.content)]);
  }
  return sortWorkbenchDiagnostics([...parseDiagnostics, ...checkWorkspaceConfigContract(parsed, input.path, input.content)]);
}

function parseKindForContract(kind: WorkbenchSourceContractKind): WorkbenchParseKind {
  if (kind === "agent" || kind === "instruction" || kind === "skill") return "markdown";
  if (kind === "hook" || kind === "skill-eval") return "json";
  return "yaml";
}

function checkSkillEvalContract(
  parsed: WorkbenchParseResult,
  path: string,
  content: string
): readonly WorkbenchDiagnostic[] {
  if (parsed.kind !== "json") return [wrongKind(path, "skill eval", "JSON")];
  return validateSkillEval(parsed.data).diagnostics.map((diagnostic) =>
    schemaDiagnostic({
      locationLine: sourceLineForSchemaPath(content, diagnostic.path, "json"),
      message: diagnostic.message.replaceAll("$.", ""),
      path,
      ruleId: "schema/skill-eval",
      subjectKind: "skill eval",
    })
  );
}

function checkSkillContract(
  parsed: WorkbenchParseResult,
  path: string,
  content: string
): readonly WorkbenchDiagnostic[] {
  if (parsed.kind !== "markdown") return [wrongKind(path, "skill", "Markdown")];

  const frontmatter = parsed.frontmatter ?? {};
  const schemaDiagnostics = validateSkillFrontmatter(frontmatter).diagnostics;
  const diagnostics: WorkbenchDiagnostic[] = [];
  diagnostics.push(...checkMarkdownBody(parsed, path, "skill"));
  diagnostics.push(
    ...schemaDiagnostics
      .filter((diagnostic) => !isRedundantSupportsPackagesDiagnostic(diagnostic, schemaDiagnostics, frontmatter))
      .map((diagnostic) =>
        frontmatterSchemaDiagnostic(diagnostic, frontmatter, path, "skill", "schema/skill-frontmatter", content)
      )
  );
  diagnostics.push(...checkSkillDescription(frontmatter, path, content));
  diagnostics.push(...checkSkillsetSkillMetadata(frontmatter, path, content));
  return diagnostics;
}

function checkAgentContract(
  parsed: WorkbenchParseResult,
  path: string,
  content: string
): readonly WorkbenchDiagnostic[] {
  if (parsed.kind !== "markdown") return [wrongKind(path, "agent", "Markdown")];

  const frontmatter = parsed.frontmatter ?? {};
  const schemaDiagnostics = validateAgentFrontmatter(frontmatter).diagnostics;
  const diagnostics: WorkbenchDiagnostic[] = [];
  diagnostics.push(...checkMarkdownBody(parsed, path, "agent"));
  diagnostics.push(
    ...schemaDiagnostics
      .filter((diagnostic) => !isRedundantSupportsPackagesDiagnostic(diagnostic, schemaDiagnostics, frontmatter))
      .map((diagnostic) =>
        frontmatterSchemaDiagnostic(diagnostic, frontmatter, path, "agent", "schema/agent-frontmatter", content)
      )
  );
  return diagnostics;
}

function checkInstructionContract(
  parsed: WorkbenchParseResult,
  path: string,
  content: string
): readonly WorkbenchDiagnostic[] {
  if (parsed.kind !== "markdown") return [wrongKind(path, "instruction", "Markdown")];

  const frontmatter = parsed.frontmatter ?? {};
  const schemaDiagnostics = validateInstructionFrontmatter(frontmatter).diagnostics;
  return schemaDiagnostics
    .filter((diagnostic) => !isRedundantSupportsPackagesDiagnostic(diagnostic, schemaDiagnostics, frontmatter))
    .map((diagnostic) =>
      frontmatterSchemaDiagnostic(diagnostic, frontmatter, path, "instruction", "schema/instruction-frontmatter", content)
    );
}

function frontmatterSchemaDiagnostic(
  diagnostic: SkillsetSchemaDiagnostic,
  data: Record<string, unknown>,
  path: string,
  subjectKind: "agent" | "instruction" | "skill",
  ruleId: string,
  content: string
): WorkbenchDiagnostic {
  const message = frontmatterSchemaMessage(diagnostic, data, subjectKind);
  return schemaDiagnostic({
    fix: sourceContractFix(diagnostic, data, subjectKind, message),
    locationLine: sourceLineForSchemaPath(content, diagnostic.path, "markdown-frontmatter"),
    message,
    path,
    ruleId,
    subjectKind,
  });
}

function frontmatterSchemaMessage(
  diagnostic: SkillsetSchemaDiagnostic,
  data: Record<string, unknown>,
  subjectKind: "agent" | "instruction" | "skill"
): string {
  const key = schemaPathKey(diagnostic.path);
  const value = schemaPathValue(data, diagnostic.path);

  if (diagnostic.code.endsWith("/key") && key === "targets") {
    return `${subjectKind}s must remove targets; use root compile.targets and provider-specific blocks for file-level behavior`;
  }
  if (diagnostic.code.endsWith("/target")) {
    return `${key} must be true, false, or an object when present`;
  }
  if (diagnostic.code.endsWith("/description") && subjectKind === "agent") {
    return "description is required and must be a non-empty string";
  }
  if (diagnostic.code.endsWith("/skills")) {
    return "skills must be a string array when present";
  }
  if (diagnostic.code.endsWith("/resources")) {
    return "resources must be an object when present";
  }
  if (diagnostic.code === "schema/source-metadata/type") {
    return "skillset must be an object when present";
  }
  if (
    diagnostic.code === "schema/source-metadata/key" &&
    diagnostic.path === "$.skillset.id" &&
    subjectKind === "skill"
  ) {
    return "skillset.id is unsupported in skills; use top-level name";
  }
  if (diagnostic.code === "schema/supports/key") {
    return `unsupported supports key ${key}; v1 supports packages`;
  }
  if (diagnostic.code === "schema/supports/packages") {
    if (value === undefined) return "supports object form must include packages as an array";
    return "supports.packages must be an array when present";
  }
  if (diagnostic.code === "schema/supports/type") {
    return "supports must be a string, array, or object when present";
  }
  return diagnostic.message.replaceAll("$.", "");
}

function checkWorkspaceConfigContract(
  parsed: WorkbenchParseResult,
  path: string,
  content: string
): readonly WorkbenchDiagnostic[] {
  if (parsed.kind !== "yaml") return [wrongKind(path, "workspace", "YAML")];

  if (!isRecord(parsed.data)) {
    return [
      schemaDiagnostic({
        message: "workspace config must be a YAML object",
        path,
        ruleId: "schema/workspace-config",
        scope: "workspace",
        subjectKind: "workspace",
      }),
    ];
  }

  const data = parsed.data;
  const diagnostics = validateWorkspaceConfig(data).diagnostics;
  return diagnostics
    .filter((diagnostic) => !isRedundantWorkspaceSchemaDiagnostic(diagnostic, diagnostics, data))
    .map((diagnostic) => workspaceSchemaDiagnostic(diagnostic, data, path, content));
}

function checkTestDeclarationContract(
  parsed: WorkbenchParseResult,
  path: string,
  content: string
): readonly WorkbenchDiagnostic[] {
  if (parsed.kind !== "yaml") return [wrongKind(path, "test", "YAML")];
  if (!isRecord(parsed.data)) {
    return [schemaDiagnostic({
      message: "test declaration must be a YAML object",
      path,
      ruleId: "schema/test-declaration",
      subjectKind: "test",
    })];
  }
  return validateTestDeclaration(parsed.data).diagnostics.map((diagnostic) =>
    schemaDiagnostic({
      locationLine: sourceLineForSchemaPath(content, diagnostic.path, "yaml"),
      message: diagnostic.message.replaceAll("$.", ""),
      path,
      ruleId: "schema/test-declaration",
      subjectKind: "test",
    })
  );
}

function workspaceSchemaDiagnostic(
  diagnostic: SkillsetSchemaDiagnostic,
  data: Record<string, unknown>,
  path: string,
  content: string
): WorkbenchDiagnostic {
  const message = workspaceSchemaMessage(diagnostic, data);
  return schemaDiagnostic({
    fix: sourceContractFix(diagnostic, data, "workspace", message),
    locationLine: sourceLineForSchemaPath(content, diagnostic.path, "yaml"),
    message,
    path,
    ruleId: "schema/workspace-config",
    scope: "workspace",
    subjectKind: "workspace",
  });
}

function workspaceSchemaMessage(diagnostic: SkillsetSchemaDiagnostic, data: Record<string, unknown>): string {
  const key = schemaPathKey(diagnostic.path);
  const value = schemaPathValue(data, diagnostic.path);
  const displayPath = displaySchemaPath(diagnostic.path);

  switch (diagnostic.code) {
    case "schema/workspace-config/key":
      return `unsupported workspace config key ${key}`;
    case "schema/workspace-config/targets":
      return "workspace config must use compile.targets instead of targets";
    case "schema/workspace-config/target":
      if (diagnostic.path.startsWith("$.compile.targets[")) {
        return `unsupported compile target ${String(value)}`;
      }
      return `${key} must be true, false, or an object when present`;
    case "schema/workspace-config/target-duplicate":
      return `duplicate compile target ${String(value)}`;
    case "schema/workspace-config/compile-key":
      return `unsupported compile key ${key}`;
    case "schema/workspace-config/compile-build":
      return "compile.build must be one of all, updated";
    case "schema/workspace-config/unsupported-destination":
      return "compile.unsupportedDestination must be one of error, warn, skip, force";
    case "schema/workspace-config/boolean-record":
      return `${displayPath} must be an object`;
    case "schema/workspace-config/boolean-record-key":
      if (diagnostic.path.startsWith("$.compile.features.")) {
        return `unsupported compile feature key ${key}`;
      }
      if (diagnostic.path.startsWith("$.compile.skillset.")) {
        return `unsupported compile skillset key ${key}`;
      }
      return `unsupported ${displayPath}`;
    case "schema/workspace-config/boolean-record-value":
      return `${displayPath} must be a boolean`;
    case "schema/workspace-config/workspace-key":
      return `unsupported workspace key ${key}`;
    case "schema/workspace-config/cache-key":
      return "workspace.cacheKey must be a lowercase repo cache key";
    case "schema/source-metadata/type":
      return "skillset must be an object when present";
    case "schema/source-metadata/key":
      if (diagnostic.path === "$.skillset.id") return "skillset.id is unsupported; use skillset.name";
      return `unsupported skillset key ${key}`;
    case "schema/source-metadata/name":
      return "skillset.name must be a non-empty string when present";
    case "schema/source-metadata/schema":
      if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        return "skillset.schema must be 1";
      }
      return "skillset.schema must be a positive integer when present";
    case "schema/supports/type":
      return "supports must be a string, array, or object when present";
    case "schema/supports/key":
      return `unsupported supports key ${key}; v1 supports packages`;
    case "schema/supports/packages":
      if (value === undefined) return "supports object form must include packages as an array";
      return "supports.packages must be an array when present";
    default:
      return diagnostic.message.replaceAll("$.", "");
  }
}

function isRedundantWorkspaceSchemaDiagnostic(
  diagnostic: SkillsetSchemaDiagnostic,
  diagnostics: readonly SkillsetSchemaDiagnostic[],
  data: Record<string, unknown>
): boolean {
  return isRedundantSupportsPackagesDiagnostic(diagnostic, diagnostics, data);
}

function isRedundantSupportsPackagesDiagnostic(
  diagnostic: SkillsetSchemaDiagnostic,
  diagnostics: readonly SkillsetSchemaDiagnostic[],
  data: Record<string, unknown>
): boolean {
  if (diagnostic.code !== "schema/supports/packages" || diagnostic.path !== "$.supports.packages") {
    return false;
  }
  const supports = data.supports;
  return (
    isRecord(supports) &&
    supports.packages === undefined &&
    diagnostics.some((item) => item.code === "schema/supports/key" && item.path.startsWith("$.supports."))
  );
}

function displaySchemaPath(path: string): string {
  return path.startsWith("$.") ? path.slice(2) : path;
}

function schemaPathKey(path: string): string {
  return path.match(/\.([A-Za-z0-9_-]+)(?:\[\d+\])?$/)?.[1] ?? displaySchemaPath(path);
}

function schemaPathValue(data: Record<string, unknown>, path: string): unknown {
  let current: unknown = data;
  for (const segment of schemaPathSegments(path)) {
    if (typeof segment === "number") {
      current = Array.isArray(current) ? current[segment] : undefined;
      continue;
    }
    current = isRecord(current) ? current[segment] : undefined;
  }
  return current;
}

function schemaPathSegments(path: string): readonly (number | string)[] {
  const segments: (number | string)[] = [];
  for (const [, property, index] of path.matchAll(/\.([A-Za-z0-9_-]+)|\[(\d+)\]/g)) {
    if (property !== undefined) {
      segments.push(property);
    } else if (index !== undefined) {
      segments.push(Number(index));
    }
  }
  return segments;
}

function checkHookContract(
  parsed: WorkbenchParseResult,
  path: string,
  content: string
): readonly WorkbenchDiagnostic[] {
  if (parsed.kind !== "json") return [wrongKind(path, "hook", "JSON")];
  return validateHookDefinitionSource(parsed.data).diagnostics.map((diagnostic) =>
    schemaDiagnostic({
      fix: sourceContractFix(diagnostic, {}, "hook", diagnostic.message),
      locationLine: sourceLineForSchemaPath(content, diagnostic.path, "json"),
      message: diagnostic.message.replaceAll("$.", ""),
      path,
      ruleId: "schema/hook",
      subjectKind: "hook",
    })
  );
}

function checkMarkdownBody(
  parsed: WorkbenchMarkdownParseResult,
  path: string,
  subjectKind: "agent" | "skill"
): readonly WorkbenchDiagnostic[] {
  if ((parsed.body ?? "").trim().length > 0) return [];
  return [
    schemaDiagnostic({
      locationLine: parsed.bodyStartLine ?? 1,
      message: `${subjectKind} body is required`,
      path,
      ruleId: `schema/${subjectKind}-body`,
      subjectKind,
    }),
  ];
}

function checkSkillDescription(
  record: Record<string, unknown>,
  path: string,
  content: string
): readonly WorkbenchDiagnostic[] {
  const skillset = isRecord(record.skillset) ? record.skillset : {};
  if (
    isNonEmptyString(record.description) ||
    isNonEmptyString(record.summary) ||
    isNonEmptyString(record.title) ||
    isNonEmptyString(skillset.description) ||
    isNonEmptyString(skillset.summary) ||
    isNonEmptyString(skillset.title)
  ) {
    return [];
  }
  return [
    schemaDiagnostic({
      message: "skill needs description, summary, title, or skillset descriptive metadata",
      fix: { kind: "suggestion", message: "Add `description: <what this skill does>` to the skill frontmatter." },
      locationLine: firstFrontmatterContentLine(content),
      path,
      ruleId: "schema/skill-frontmatter",
      subjectKind: "skill",
    }),
  ];
}

function checkSkillsetSkillMetadata(
  record: Record<string, unknown>,
  path: string,
  content: string
): readonly WorkbenchDiagnostic[] {
  const value = record.skillset;
  if (value === undefined) return [];
  if (!isRecord(value)) {
    return [
      schemaDiagnostic({
        message: "skillset must be an object when present",
        path,
        ruleId: "schema/skill-frontmatter",
        subjectKind: "skill",
      }),
    ];
  }

  const diagnostics: WorkbenchDiagnostic[] = [];
  for (const key of ["name", "version"]) {
    if (value[key] === undefined) continue;
    diagnostics.push(schemaDiagnostic({
      message: `skillset.${key} is unsupported in skills; use top-level ${key === "id" ? "name" : key}`,
      fix: { kind: "suggestion", message: `Move this to top-level \`${key}: ...\` in the skill frontmatter.` },
      locationLine: sourceLineForSchemaPath(content, `$.skillset.${key}`, "markdown-frontmatter"),
      path,
      ruleId: "schema/skill-frontmatter",
      subjectKind: "skill",
    }));
  }
  return diagnostics;
}

function wrongKind(
  path: string,
  subjectKind: "agent" | "hook" | "instruction" | "skill" | "skill eval" | "test" | "workspace",
  expected: string
): WorkbenchDiagnostic {
  return schemaDiagnostic({
    message: `${subjectKind} contract expects ${expected} input`,
    path,
    ruleId: `schema/${subjectKind}`,
    subjectKind,
  });
}

function schemaDiagnostic(args: {
  readonly fix?: WorkbenchFix | undefined;
  readonly locationLine?: number | undefined;
  readonly message: string;
  readonly path: string;
  readonly ruleId: string;
  readonly scope?: "source" | "workspace";
  readonly subjectKind: "agent" | "hook" | "instruction" | "skill" | "skill eval" | "test" | "workspace";
}): WorkbenchDiagnostic {
  return createWorkbenchDiagnostic({
    featureId: "source-contracts",
    ...(args.fix === undefined ? {} : { fix: args.fix }),
    location: { line: args.locationLine ?? 1, path: args.path },
    message: args.message,
    ruleId: args.ruleId,
    scope: args.scope ?? "source",
    severity: "error",
    subject: { kind: args.subjectKind, path: args.path },
  });
}

function sourceContractFix(
  diagnostic: SkillsetSchemaDiagnostic,
  data: Record<string, unknown>,
  subjectKind: "agent" | "hook" | "instruction" | "skill" | "workspace",
  message: string
): WorkbenchFix | undefined {
  const key = schemaPathKey(diagnostic.path);
  const value = schemaPathValue(data, diagnostic.path);

  if (diagnostic.code.endsWith("/key") && key === "targets") {
    return {
      kind: "suggestion",
      message: `Move provider selection to \`skillset.yaml\` as \`compile:\\n  targets: [${TARGET_LIST}]\`; keep file-level behavior in provider-specific blocks.`,
    };
  }
  if (diagnostic.code.endsWith("/target")) {
    return { kind: "suggestion", message: `Use \`${key}: true\`, \`${key}: false\`, or \`${key}: { ... }\`.` };
  }
  if (diagnostic.code.endsWith("/description") && subjectKind === "agent") {
    return { kind: "suggestion", message: "Add `description: <what this agent does>` to the agent frontmatter." };
  }
  if (diagnostic.code.endsWith("/skills")) {
    return { kind: "suggestion", message: "Use a YAML list, for example `skills:\\n  - <skill-name>`." };
  }
  if (diagnostic.code.endsWith("/resources")) {
    return {
      kind: "suggestion",
      message: "Use a resource map, for example `resources:\\n  references:\\n    - shared:references/guide.md`.",
    };
  }
  if (diagnostic.code === "schema/supports/key" || diagnostic.code === "schema/supports/packages") {
    return { kind: "suggestion", message: "Use `supports:\\n  packages: []`, or remove `supports` until package compatibility is needed." };
  }
  if (diagnostic.code === "schema/source-metadata/key" && diagnostic.path.endsWith(".id")) {
    return { kind: "suggestion", message: "Replace `skillset.id` with `skillset.name`." };
  }
  if (diagnostic.code === "schema/source-metadata/name") {
    return { kind: "suggestion", message: "Set `skillset:\\n  name: <workspace-name>` to a non-empty string." };
  }
  if (diagnostic.code === "schema/source-metadata/schema") {
    return { kind: "suggestion", message: "Use `skillset:\\n  schema: 1`." };
  }
  if (diagnostic.code === "schema/workspace-config/targets") {
    return { kind: "suggestion", message: `Replace top-level \`targets\` with \`compile:\\n  targets: [${TARGET_LIST}]\`.` };
  }
  if (diagnostic.code === "schema/workspace-config/compile-build") {
    return { kind: "suggestion", message: "Use `compile:\\n  build: all` or `compile:\\n  build: updated`." };
  }
  if (diagnostic.code === "schema/workspace-config/unsupported-destination") {
    return { kind: "suggestion", message: "Use `compile:\\n  unsupportedDestination: error` unless you intentionally need warn, skip, or force." };
  }
  if (diagnostic.code === "schema/workspace-config/cache-key") {
    return {
      kind: "suggestion",
      message: "Remove `workspace.cacheKey` to use the automatic XDG cache key, or set a lowercase key such as `team--repo`.",
    };
  }
  if (diagnostic.code === "schema/workspace-config/target" && diagnostic.path.startsWith("$.compile.targets[")) {
    return { kind: "suggestion", message: `Remove unsupported target ${JSON.stringify(value)}; supported targets are ${TARGET_LIST}.` };
  }
  if (diagnostic.code === "schema/hook/event") {
    return { kind: "suggestion", message: "Use supported hook event names from `skillset lookup hooks --events --compat`." };
  }
  if (diagnostic.code.startsWith("schema/hook/")) {
    return {
      kind: "suggestion",
      message: "Use a hook event array of handler objects, for example `{ \"hooks\": { \"Stop\": [{ \"hooks\": [{ \"type\": \"command\", \"command\": \"./check.sh\" }] }] } }`.",
    };
  }
  if (message.includes("must be a non-empty string")) {
    return { kind: "suggestion", message: `Set \`${displaySchemaPath(diagnostic.path)}\` to a non-empty string.` };
  }
  return undefined;
}

function sourceLineForSchemaPath(
  content: string,
  schemaPath: string,
  kind: "json" | "markdown-frontmatter" | "yaml"
): number | undefined {
  const normalized = content.replaceAll(/\r\n?/g, "\n");
  if (kind === "json") return sourceLineForJsonPath(normalized, schemaPath);
  if (kind === "markdown-frontmatter") {
    const frontmatter = markdownFrontmatterRange(normalized);
    if (frontmatter === undefined) return 1;
    return sourceLineForYamlPath(frontmatter.text, schemaPath, frontmatter.startLine);
  }
  return sourceLineForYamlPath(normalized, schemaPath, 1);
}

function sourceLineForJsonPath(content: string, schemaPath: string): number {
  const keys = schemaPathSegments(schemaPath).filter((segment): segment is string => typeof segment === "string");
  for (const key of keys.slice().reverse()) {
    const line = findLine(content, new RegExp(`"${escapeRegExp(key)}"\\s*:`, "u"));
    if (line !== undefined) return line;
  }
  return 1;
}

function sourceLineForYamlPath(content: string, schemaPath: string, startLine: number): number {
  const target = schemaPathSegments(schemaPath).filter((segment): segment is string => typeof segment === "string");
  if (target.length === 0) return startLine;

  let best: { readonly depth: number; readonly line: number } | undefined;
  const stack: Array<{ readonly indent: number; readonly key: string }> = [];
  for (const [index, rawLine] of content.split("\n").entries()) {
    const keyMatch = /^(\s*)(?:-\s+)?([A-Za-z0-9_-]+)\s*:/u.exec(rawLine);
    if (keyMatch === null) continue;
    const indent = keyMatch[1]!.length;
    const key = keyMatch[2]!;
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const currentPath = [...stack.map((entry) => entry.key), key];
    stack.push({ indent, key });

    const depth = matchingPrefixDepth(currentPath, target);
    if (depth === 0) continue;
    if (best === undefined || depth > best.depth) {
      best = { depth, line: startLine + index };
    }
    if (depth === target.length) return startLine + index;
  }
  return best?.line ?? startLine;
}

function matchingPrefixDepth(currentPath: readonly string[], target: readonly string[]): number {
  let depth = 0;
  for (let index = 0; index < Math.min(currentPath.length, target.length); index += 1) {
    if (currentPath[index] !== target[index]) break;
    depth += 1;
  }
  return depth;
}

function markdownFrontmatterRange(content: string): { readonly startLine: number; readonly text: string } | undefined {
  const lines = content.split("\n");
  if ((lines[0] ?? "").trim() !== "---") return undefined;
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) return undefined;
  return { startLine: 2, text: lines.slice(1, closingIndex).join("\n") };
}

function firstFrontmatterContentLine(content: string): number {
  return markdownFrontmatterRange(content)?.startLine ?? 1;
}

function findLine(content: string, pattern: RegExp): number | undefined {
  for (const [index, line] of content.split("\n").entries()) {
    if (pattern.test(line)) return index + 1;
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
