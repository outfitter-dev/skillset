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

const CONFIG_TOP_LEVEL_KEYS = new Set([
  "agents",
  "changes",
  "claude",
  "codex",
  "compile",
  "defaults",
  "dependencies",
  "distributions",
  "skillset",
  "supports",
  "tests",
]);

const COMPILE_BUILD_MODES = new Set(["all", "updated"]);
const COMPILE_KEYS = new Set(["build", "features", "skillset", "targets", "unsupportedDestination"]);
const UNSUPPORTED_DESTINATION_POLICIES = new Set(["error", "force", "skip", "warn"]);

export function checkWorkbenchSourceContract(
  input: WorkbenchSourceContractInput
): readonly WorkbenchDiagnostic[] {
  const parsed = parseWorkbenchDocument({
    content: input.content,
    kind: parseKindForContract(input.kind),
    path: input.path,
  });
  if (parsed.diagnostics.length > 0) return parsed.diagnostics;

  if (input.kind === "agent") return sortWorkbenchDiagnostics(checkAgentContract(parsed, input.path));
  if (input.kind === "hook") return sortWorkbenchDiagnostics(checkHookContract(parsed, input.path));
  if (input.kind === "skill") return sortWorkbenchDiagnostics(checkSkillContract(parsed, input.path));
  return sortWorkbenchDiagnostics(checkWorkspaceConfigContract(parsed, input.path));
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

  const diagnostics: WorkbenchDiagnostic[] = [];
  for (const key of Object.keys(parsed.data).sort()) {
    if (!CONFIG_TOP_LEVEL_KEYS.has(key)) {
      diagnostics.push(schemaDiagnostic({
        message: `unsupported workspace config key ${key}`,
        path,
        ruleId: "schema/workspace-config",
        scope: "workspace",
        subjectKind: "workspace",
      }));
    }
  }
  if (parsed.data.targets !== undefined) {
    diagnostics.push(schemaDiagnostic({
      message: "workspace config must use compile.targets instead of targets",
      path,
      ruleId: "schema/workspace-config",
      scope: "workspace",
      subjectKind: "workspace",
    }));
  }
  diagnostics.push(...checkCompileBlock(parsed.data.compile, path));
  diagnostics.push(...checkWorkspaceSkillsetMetadata(parsed.data.skillset, path));
  diagnostics.push(...checkSupportsBlock(parsed.data.supports, path));
  return diagnostics;
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

function checkCompileBlock(value: unknown, path: string): readonly WorkbenchDiagnostic[] {
  if (value === undefined) return [];
  if (!isRecord(value)) {
    return [
      schemaDiagnostic({
        message: "compile must be an object",
        path,
        ruleId: "schema/workspace-config",
        scope: "workspace",
        subjectKind: "workspace",
      }),
    ];
  }

  const diagnostics: WorkbenchDiagnostic[] = [];
  for (const key of Object.keys(value).sort()) {
    if (!COMPILE_KEYS.has(key)) {
      diagnostics.push(schemaDiagnostic({
        message: `unsupported compile key ${key}`,
        path,
        ruleId: "schema/workspace-config",
        scope: "workspace",
        subjectKind: "workspace",
      }));
    }
  }

  diagnostics.push(...checkCompileBuild(value.build, path));
  diagnostics.push(...checkCompileFeatures(value.features, path));
  diagnostics.push(...checkCompileSkillset(value.skillset, path));

  const targets = value.targets;
  if (targets !== undefined) {
    if (!Array.isArray(targets) || targets.length === 0) {
      diagnostics.push(schemaDiagnostic({
        message: "compile.targets must be a non-empty array of claude/codex",
        path,
        ruleId: "schema/workspace-config",
        scope: "workspace",
        subjectKind: "workspace",
      }));
    } else {
      const seen = new Set<string>();
      for (const target of targets) {
        if (target !== "claude" && target !== "codex") {
          diagnostics.push(schemaDiagnostic({
            message: `unsupported compile target ${String(target)}`,
            path,
            ruleId: "schema/workspace-config",
            scope: "workspace",
            subjectKind: "workspace",
          }));
        } else if (seen.has(target)) {
          diagnostics.push(schemaDiagnostic({
            message: `duplicate compile target ${target}`,
            path,
            ruleId: "schema/workspace-config",
            scope: "workspace",
            subjectKind: "workspace",
          }));
        }
        if (typeof target === "string") seen.add(target);
      }
    }
  }

  const unsupportedDestination = value.unsupportedDestination;
  if (
    unsupportedDestination !== undefined &&
    (typeof unsupportedDestination !== "string" ||
      !UNSUPPORTED_DESTINATION_POLICIES.has(unsupportedDestination))
  ) {
    diagnostics.push(schemaDiagnostic({
      message: "compile.unsupportedDestination must be one of error, warn, skip, force",
      path,
      ruleId: "schema/workspace-config",
      scope: "workspace",
      subjectKind: "workspace",
    }));
  } else if (unsupportedDestination !== undefined && unsupportedDestination !== "error") {
    diagnostics.push(schemaDiagnostic({
      message: "compile.unsupportedDestination warn, skip, and force are reserved; use error",
      path,
      ruleId: "schema/workspace-config",
      scope: "workspace",
      subjectKind: "workspace",
    }));
  }

  return diagnostics;
}

function checkWorkspaceSkillsetMetadata(value: unknown, path: string): readonly WorkbenchDiagnostic[] {
  if (value === undefined) return [];
  if (!isRecord(value)) {
    return [
      schemaDiagnostic({
        message: "skillset must be an object when present",
        path,
        ruleId: "schema/workspace-config",
        scope: "workspace",
        subjectKind: "workspace",
      }),
    ];
  }

  const diagnostics: WorkbenchDiagnostic[] = [];
  for (const key of ["description", "name", "summary", "title", "version"]) {
    const field = value[key];
    if (field !== undefined && !isNonEmptyString(field)) {
      diagnostics.push(schemaDiagnostic({
        message: `skillset.${key} must be a non-empty string when present`,
        path,
        ruleId: "schema/workspace-config",
        scope: "workspace",
        subjectKind: "workspace",
      }));
    }
  }
  if (value.schema !== undefined && !isPositiveInteger(value.schema)) {
    diagnostics.push(schemaDiagnostic({
      message: "skillset.schema must be a positive integer when present",
      path,
      ruleId: "schema/workspace-config",
      scope: "workspace",
      subjectKind: "workspace",
    }));
  }
  if (value.id !== undefined) {
    diagnostics.push(schemaDiagnostic({
      message: "skillset.id is unsupported; use skillset.name",
      path,
      ruleId: "schema/workspace-config",
      scope: "workspace",
      subjectKind: "workspace",
    }));
  }
  return diagnostics;
}

function checkSupportsBlock(value: unknown, path: string): readonly WorkbenchDiagnostic[] {
  if (value === undefined) return [];
  if (typeof value === "string" || Array.isArray(value)) return [];
  if (!isRecord(value)) {
    return [
      schemaDiagnostic({
        message: "supports must be a string, array, or object when present",
        path,
        ruleId: "schema/workspace-config",
        scope: "workspace",
        subjectKind: "workspace",
      }),
    ];
  }
  for (const key of Object.keys(value).sort()) {
    if (key !== "packages") {
      return [
        schemaDiagnostic({
          message: `unsupported supports key ${key}; v1 supports packages`,
          path,
          ruleId: "schema/workspace-config",
          scope: "workspace",
          subjectKind: "workspace",
        }),
      ];
    }
  }
  if (value.packages !== undefined && !Array.isArray(value.packages)) {
    return [
      schemaDiagnostic({
        message: "supports.packages must be an array when present",
        path,
        ruleId: "schema/workspace-config",
        scope: "workspace",
        subjectKind: "workspace",
      }),
    ];
  }
  return [];
}

function checkCompileBuild(value: unknown, path: string): readonly WorkbenchDiagnostic[] {
  if (value === undefined) return [];
  if (typeof value === "string" && COMPILE_BUILD_MODES.has(value)) return [];
  return [
    schemaDiagnostic({
      message: "compile.build must be one of all, updated",
      path,
      ruleId: "schema/workspace-config",
      scope: "workspace",
      subjectKind: "workspace",
    }),
  ];
}

function checkCompileFeatures(value: unknown, path: string): readonly WorkbenchDiagnostic[] {
  if (value === undefined) return [];
  if (!isRecord(value)) {
    return [
      schemaDiagnostic({
        message: "compile.features must be an object",
        path,
        ruleId: "schema/workspace-config",
        scope: "workspace",
        subjectKind: "workspace",
      }),
    ];
  }

  const diagnostics: WorkbenchDiagnostic[] = [];
  for (const key of Object.keys(value).sort()) {
    if (key !== "promptArguments") {
      diagnostics.push(schemaDiagnostic({
        message: `unsupported compile feature key ${key}`,
        path,
        ruleId: "schema/workspace-config",
        scope: "workspace",
        subjectKind: "workspace",
      }));
    }
  }
  if (value.promptArguments !== undefined && typeof value.promptArguments !== "boolean") {
    diagnostics.push(schemaDiagnostic({
      message: "compile.features.promptArguments must be a boolean",
      path,
      ruleId: "schema/workspace-config",
      scope: "workspace",
      subjectKind: "workspace",
    }));
  }
  return diagnostics;
}

function checkCompileSkillset(value: unknown, path: string): readonly WorkbenchDiagnostic[] {
  if (value === undefined) return [];
  if (!isRecord(value)) {
    return [
      schemaDiagnostic({
        message: "compile.skillset must be an object",
        path,
        ruleId: "schema/workspace-config",
        scope: "workspace",
        subjectKind: "workspace",
      }),
    ];
  }

  const diagnostics: WorkbenchDiagnostic[] = [];
  for (const key of Object.keys(value).sort()) {
    if (key !== "metadata") {
      diagnostics.push(schemaDiagnostic({
        message: `unsupported compile skillset key ${key}`,
        path,
        ruleId: "schema/workspace-config",
        scope: "workspace",
        subjectKind: "workspace",
      }));
    }
  }
  if (value.metadata !== undefined && typeof value.metadata !== "boolean") {
    diagnostics.push(schemaDiagnostic({
      message: "compile.skillset.metadata must be a boolean",
      path,
      ruleId: "schema/workspace-config",
      scope: "workspace",
      subjectKind: "workspace",
    }));
  }
  return diagnostics;
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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function compareEntries(left: [string, unknown], right: [string, unknown]): number {
  if (left[0] < right[0]) return -1;
  if (left[0] > right[0]) return 1;
  return 0;
}
