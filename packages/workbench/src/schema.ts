import { validateWorkspaceConfig, type SkillsetSchemaDiagnostic } from "@skillset/schema";

import { createWorkbenchDiagnostic, sortWorkbenchDiagnostics } from "./diagnostics";
import { parseWorkbenchDocument } from "./parser";
import type {
  WorkbenchDiagnostic,
  WorkbenchMarkdownParseResult,
  WorkbenchParseKind,
  WorkbenchParseResult,
} from "./types";

export type WorkbenchSourceContractKind = "agent" | "hook" | "skill" | "workspace-config";

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
    return sortWorkbenchDiagnostics([...parseDiagnostics, ...checkAgentContract(parsed, input.path)]);
  }
  if (input.kind === "hook") {
    return sortWorkbenchDiagnostics([...parseDiagnostics, ...checkHookContract(parsed, input.path)]);
  }
  if (input.kind === "skill") {
    return sortWorkbenchDiagnostics([...parseDiagnostics, ...checkSkillContract(parsed, input.path)]);
  }
  return sortWorkbenchDiagnostics([...parseDiagnostics, ...checkWorkspaceConfigContract(parsed, input.path)]);
}

function parseKindForContract(kind: WorkbenchSourceContractKind): WorkbenchParseKind {
  if (kind === "agent" || kind === "skill") return "markdown";
  if (kind === "hook") return "json";
  return "yaml";
}

function checkSkillContract(
  parsed: WorkbenchParseResult,
  path: string
): readonly WorkbenchDiagnostic[] {
  if (parsed.kind !== "markdown") return [wrongKind(path, "skill", "Markdown")];

  const diagnostics: WorkbenchDiagnostic[] = [];
  diagnostics.push(...checkMarkdownBody(parsed, path, "skill"));
  diagnostics.push(...checkOptionalString(parsed.frontmatter ?? {}, "name", path, "skill", "schema/skill-frontmatter"));
  diagnostics.push(...checkSkillDescription(parsed.frontmatter ?? {}, path));
  diagnostics.push(...checkOptionalString(parsed.frontmatter ?? {}, "version", path, "skill", "schema/skill-frontmatter"));
  diagnostics.push(...checkOptionalObject(parsed.frontmatter ?? {}, "resources", path, "skill", "schema/skill-frontmatter"));
  diagnostics.push(...checkSkillsetSkillMetadata(parsed.frontmatter ?? {}, path));
  if ((parsed.frontmatter ?? {}).targets !== undefined) {
    diagnostics.push(schemaDiagnostic({
      message: "skills must remove targets; use root compile.targets and claude/codex blocks for file-level behavior",
      path,
      ruleId: "schema/skill-frontmatter",
      subjectKind: "skill",
    }));
  }
  return diagnostics;
}

function checkAgentContract(
  parsed: WorkbenchParseResult,
  path: string
): readonly WorkbenchDiagnostic[] {
  if (parsed.kind !== "markdown") return [wrongKind(path, "agent", "Markdown")];

  const frontmatter = parsed.frontmatter ?? {};
  const diagnostics: WorkbenchDiagnostic[] = [];
  diagnostics.push(...checkMarkdownBody(parsed, path, "agent"));
  diagnostics.push(...checkOptionalString(frontmatter, "name", path, "agent", "schema/agent-frontmatter"));
  diagnostics.push(...checkRequiredString(frontmatter, "description", path, "agent", "schema/agent-frontmatter"));
  diagnostics.push(...checkOptionalString(frontmatter, "initialPrompt", path, "agent", "schema/agent-frontmatter"));
  diagnostics.push(...checkOptionalString(frontmatter, "model", path, "agent", "schema/agent-frontmatter"));
  diagnostics.push(...checkOptionalStringArray(frontmatter, "skills", path, "agent", "schema/agent-frontmatter"));
  diagnostics.push(...checkTargetBlock(frontmatter, "claude", path, "agent", "schema/agent-frontmatter"));
  diagnostics.push(...checkTargetBlock(frontmatter, "codex", path, "agent", "schema/agent-frontmatter"));
  if (frontmatter.targets !== undefined) {
    diagnostics.push(schemaDiagnostic({
      message: "agents must remove targets; use root compile.targets and claude/codex blocks for file-level behavior",
      path,
      ruleId: "schema/agent-frontmatter",
      subjectKind: "agent",
    }));
  }
  return diagnostics;
}

function checkWorkspaceConfigContract(
  parsed: WorkbenchParseResult,
  path: string
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
    .map((diagnostic) => workspaceSchemaDiagnostic(diagnostic, data, path));
}

function workspaceSchemaDiagnostic(
  diagnostic: SkillsetSchemaDiagnostic,
  data: Record<string, unknown>,
  path: string
): WorkbenchDiagnostic {
  return schemaDiagnostic({
    message: workspaceSchemaMessage(diagnostic, data),
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
      if (value === "warn" || value === "skip" || value === "force") {
        return "compile.unsupportedDestination warn, skip, and force are reserved; use error";
      }
      return "compile.unsupportedDestination must be error";
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
  path: string
): readonly WorkbenchDiagnostic[] {
  if (parsed.kind !== "json") return [wrongKind(path, "hook", "JSON")];
  if (!isRecord(parsed.data)) {
    return [
      schemaDiagnostic({
        message: "hook file must contain a JSON object",
        path,
        ruleId: "schema/hook",
        subjectKind: "hook",
      }),
    ];
  }

  const diagnostics: WorkbenchDiagnostic[] = [];
  if (parsed.data.hooks !== undefined && !isRecord(parsed.data.hooks)) {
    diagnostics.push(schemaDiagnostic({
      message: "hooks must be an object when present",
      path,
      ruleId: "schema/hook",
      subjectKind: "hook",
    }));
    return diagnostics;
  }

  const events = parsed.data.hooks ?? parsed.data;
  for (const [event, groups] of Object.entries(events).sort(compareEntries)) {
    if (events === parsed.data && event === "hooks") continue;
    if (!Array.isArray(groups)) {
      diagnostics.push(schemaDiagnostic({
        message: `hook event ${event} must be an array`,
        path,
        ruleId: "schema/hook",
        subjectKind: "hook",
      }));
      continue;
    }
    for (const group of groups) {
      if (!isRecord(group)) {
        diagnostics.push(schemaDiagnostic({
          message: `hook event ${event} entries must be objects`,
          path,
          ruleId: "schema/hook",
          subjectKind: "hook",
        }));
        continue;
      }
      if (group.hooks !== undefined && !Array.isArray(group.hooks)) {
        diagnostics.push(schemaDiagnostic({
          message: `hook event ${event} hooks must be an array`,
          path,
          ruleId: "schema/hook",
          subjectKind: "hook",
        }));
        continue;
      }
      if (Array.isArray(group.hooks)) {
        diagnostics.push(...checkHookHandlers(group.hooks, event, path));
      }
    }
  }
  return diagnostics;
}

function checkHookHandlers(
  handlers: readonly unknown[],
  event: string,
  path: string
): readonly WorkbenchDiagnostic[] {
  const diagnostics: WorkbenchDiagnostic[] = [];
  for (const handler of handlers) {
    if (!isRecord(handler)) {
      diagnostics.push(schemaDiagnostic({
        message: `hook event ${event} hook handlers must be objects`,
        path,
        ruleId: "schema/hook",
        subjectKind: "hook",
      }));
      continue;
    }
    if (!isNonEmptyString(handler.type)) {
      diagnostics.push(schemaDiagnostic({
        message: `hook event ${event} hook handlers must include a non-empty string type`,
        path,
        ruleId: "schema/hook",
        subjectKind: "hook",
      }));
    }
  }
  return diagnostics;
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

function checkRequiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  subjectKind: "agent" | "skill",
  ruleId: string
): readonly WorkbenchDiagnostic[] {
  const value = record[key];
  if (typeof value === "string" && value.trim().length > 0) return [];
  return [
    schemaDiagnostic({
      message: `${key} is required and must be a non-empty string`,
      path,
      ruleId,
      subjectKind,
    }),
  ];
}

function checkOptionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  subjectKind: "agent" | "skill",
  ruleId: string
): readonly WorkbenchDiagnostic[] {
  const value = record[key];
  if (value === undefined || (typeof value === "string" && value.trim().length > 0)) return [];
  return [
    schemaDiagnostic({
      message: `${key} must be a non-empty string when present`,
      path,
      ruleId,
      subjectKind,
    }),
  ];
}

function checkOptionalStringArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
  subjectKind: "agent" | "skill",
  ruleId: string
): readonly WorkbenchDiagnostic[] {
  const value = record[key];
  if (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0))
  ) {
    return [];
  }
  return [
    schemaDiagnostic({
      message: `${key} must be a string array when present`,
      path,
      ruleId,
      subjectKind,
    }),
  ];
}

function checkOptionalObject(
  record: Record<string, unknown>,
  key: string,
  path: string,
  subjectKind: "agent" | "skill",
  ruleId: string
): readonly WorkbenchDiagnostic[] {
  const value = record[key];
  if (value === undefined || isRecord(value)) return [];
  return [
    schemaDiagnostic({
      message: `${key} must be an object when present`,
      path,
      ruleId,
      subjectKind,
    }),
  ];
}

function checkSkillDescription(
  record: Record<string, unknown>,
  path: string
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
      path,
      ruleId: "schema/skill-frontmatter",
      subjectKind: "skill",
    }),
  ];
}

function checkSkillsetSkillMetadata(
  record: Record<string, unknown>,
  path: string
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
  for (const key of ["id", "name", "version"]) {
    if (value[key] === undefined) continue;
    diagnostics.push(schemaDiagnostic({
      message: `skillset.${key} is unsupported in skills; use top-level ${key === "id" ? "name" : key}`,
      path,
      ruleId: "schema/skill-frontmatter",
      subjectKind: "skill",
    }));
  }
  return diagnostics;
}

function checkTargetBlock(
  record: Record<string, unknown>,
  key: "claude" | "codex",
  path: string,
  subjectKind: "agent" | "skill",
  ruleId: string
): readonly WorkbenchDiagnostic[] {
  const value = record[key];
  if (value === undefined || value === false || value === true || isRecord(value)) return [];
  return [
    schemaDiagnostic({
      message: `${key} must be true, false, or an object when present`,
      path,
      ruleId,
      subjectKind,
    }),
  ];
}

function wrongKind(
  path: string,
  subjectKind: "agent" | "hook" | "skill" | "workspace",
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
  readonly locationLine?: number;
  readonly message: string;
  readonly path: string;
  readonly ruleId: string;
  readonly scope?: "source" | "workspace";
  readonly subjectKind: "agent" | "hook" | "skill" | "workspace";
}): WorkbenchDiagnostic {
  return createWorkbenchDiagnostic({
    featureId: "source-contracts",
    location: { line: args.locationLine ?? 1, path: args.path },
    message: args.message,
    ruleId: args.ruleId,
    scope: args.scope ?? "source",
    severity: "error",
    subject: { kind: args.subjectKind, path: args.path },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function compareEntries(left: [string, unknown], right: [string, unknown]): number {
  if (left[0] < right[0]) return -1;
  if (left[0] > right[0]) return 1;
  return 0;
}
