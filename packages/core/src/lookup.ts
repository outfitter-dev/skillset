import {
  agentFrontmatterContract,
  hookContract,
  instructionFrontmatterContract,
  skillFrontmatterContract,
  skillsetSchemaExamples,
  workspaceConfigContract,
  type SchemaJsonRecord,
  type SchemaJsonValue,
  type SkillsetSchemaContract,
  type SkillsetSchemaContractId,
} from "@skillset/schema";
import {
  getProviderSchemaSnapshot,
  type ProviderSchemaSetEntry,
  type ProviderSchemaSetSummary,
} from "@skillset/provider-formats";

import {
  getSkillsetFeature,
  type SkillsetFeatureEntry,
  type SkillsetFeatureId,
} from "./feature-registry";
import { compareStrings } from "./path";
import type { TargetName } from "./types";

export type LookupSubject = "agent" | "hooks" | "instruction" | "plugin" | "skill" | "workspace";
export type LookupView = "compat" | "events" | "examples" | "fields" | "frontmatter" | "schema" | "values";
export type LookupDiagnosticSeverity = "error" | "warning";

export interface LookupQuery {
  readonly aspects?: readonly string[];
  readonly field?: string;
  readonly subject?: LookupSubject;
  readonly targets?: readonly TargetName[];
  readonly views?: readonly LookupView[];
}

export interface LookupSubjectSummary {
  readonly defaultViews: readonly LookupView[];
  readonly description: string;
  readonly subject: LookupSubject;
}

export interface LookupField {
  readonly contractId: SkillsetSchemaContractId;
  readonly description?: string;
  readonly path: string;
  readonly required: boolean;
  readonly type: string;
  readonly values?: readonly SchemaJsonValue[];
}

export interface LookupEvent {
  readonly fields: readonly LookupEventField[];
  readonly name: string;
  readonly providerRef: string;
  readonly target: TargetName;
}

export interface LookupEventField {
  readonly name: string;
  readonly required: boolean;
}

export interface LookupCompatibility {
  readonly docs: readonly string[];
  readonly featureId: SkillsetFeatureId;
  readonly featureTitle: string;
  readonly note?: string;
  readonly reason?: string;
  readonly status: string;
  readonly target: TargetName;
}

export interface LookupExample {
  readonly contractId: SkillsetSchemaContractId;
  readonly description: string;
  readonly path: string;
  readonly value: SchemaJsonRecord;
}

export interface LookupDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: LookupDiagnosticSeverity;
}

export interface LookupReport {
  readonly aspects: readonly string[];
  readonly compatibility: readonly LookupCompatibility[];
  readonly diagnostics: readonly LookupDiagnostic[];
  readonly events: readonly LookupEvent[];
  readonly examples: readonly LookupExample[];
  readonly fields: readonly LookupField[];
  readonly schema?: SkillsetSchemaContract;
  readonly subject?: LookupSubject;
  readonly subjects: readonly LookupSubjectSummary[];
  readonly summary: string;
  readonly targets: readonly TargetName[];
  readonly views: readonly LookupView[];
}

const DEFAULT_TARGETS = ["claude", "codex"] as const satisfies readonly TargetName[];
const CODEX_HOOK_EVENT_SNAPSHOT = getProviderSchemaSnapshot("codex-hook-event-schemas");
const CODEX_HOOK_EVENT_ENTRIES = readProviderSchemaSetEntries(CODEX_HOOK_EVENT_SNAPSHOT?.summary);

const SUBJECTS = [
  {
    defaultViews: ["frontmatter", "fields", "schema", "examples", "compat"],
    description: "Adaptive skill source frontmatter and skill-related compatibility facts.",
    subject: "skill",
  },
  {
    defaultViews: ["frontmatter", "fields", "schema", "examples", "compat"],
    description: "Adaptive project-agent frontmatter and agent compatibility facts.",
    subject: "agent",
  },
  {
    defaultViews: ["frontmatter", "fields", "schema", "examples", "compat"],
    description: "Adaptive project-instruction frontmatter and instruction compatibility facts.",
    subject: "instruction",
  },
  {
    defaultViews: ["fields", "schema", "examples"],
    description: "Workspace skillset.yaml configuration fields and known values.",
    subject: "workspace",
  },
  {
    defaultViews: ["fields", "events", "schema", "examples", "compat"],
    description: "Skillset hook source fields plus provider hook event facts.",
    subject: "hooks",
  },
  {
    defaultViews: ["compat"],
    description: "Plugin component compatibility facts such as bin, mcp, hooks, and skills.",
    subject: "plugin",
  },
] as const satisfies readonly LookupSubjectSummary[];

const CONTRACTS_BY_SUBJECT: Partial<Record<LookupSubject, SkillsetSchemaContract>> = {
  agent: agentFrontmatterContract,
  hooks: hookContract,
  instruction: instructionFrontmatterContract,
  skill: skillFrontmatterContract,
  workspace: workspaceConfigContract,
};

const SUBJECT_FEATURES: Partial<Record<LookupSubject, readonly SkillsetFeatureId[]>> = {
  agent: ["project-agents"],
  hooks: ["plugin-hooks"],
  instruction: ["project-instructions"],
  plugin: ["plugin-manifests"],
  skill: ["standalone-skills"],
};

const ASPECT_FEATURES: Partial<Record<LookupSubject, Record<string, readonly SkillsetFeatureId[]>>> = {
  agent: {
    skills: ["project-agents"],
  },
  hooks: {
    attachments: ["plugin-hooks"],
    handlers: ["plugin-hooks"],
  },
  instruction: {
    rules: ["project-instructions"],
  },
  plugin: {
    agents: ["plugin-agents"],
    apps: ["plugin-apps"],
    assets: ["plugin-assets"],
    bin: ["plugin-bin"],
    commands: ["plugin-commands"],
    hooks: ["plugin-hooks"],
    lsp: ["plugin-lsp-servers"],
    "lsp-servers": ["plugin-lsp-servers"],
    manifests: ["plugin-manifests"],
    mcp: ["plugin-mcp"],
    monitors: ["plugin-monitors"],
    "output-styles": ["plugin-output-styles"],
    readme: ["plugin-readme"],
    scripts: ["plugin-scripts"],
    skills: ["plugin-skills"],
    src: ["plugin-src"],
    themes: ["plugin-themes"],
  },
  skill: {
    bin: ["plugin-bin"],
    mcp: ["plugin-mcp"],
    resources: ["resources"],
    tool_intent: ["tool-intent"],
    "tool-intent": ["tool-intent"],
  },
};

export function lookupSkillsetReference(query: LookupQuery = {}): LookupReport {
  const subject = query.subject;
  const aspects = [...(query.aspects ?? [])].map((aspect) => aspect.trim()).filter(Boolean);
  const targets = normalizeTargets(query.targets);
  const views = normalizeViews(query);
  const diagnostics: LookupDiagnostic[] = [];

  if (subject === undefined) {
    return {
      aspects,
      compatibility: [],
      diagnostics,
      events: [],
      examples: [],
      fields: [],
      subjects: SUBJECTS,
      summary: "Skillset lookup subjects.",
      targets,
      views,
    };
  }

  const contract = CONTRACTS_BY_SUBJECT[subject];
  const fields: LookupField[] = [];
  const events: LookupEvent[] = [];
  const compatibility: LookupCompatibility[] = [];
  const examples: LookupExample[] = [];
  let schema: SkillsetSchemaContract | undefined;

  for (const diagnostic of invalidCombinationDiagnostics(subject, views, query.field)) {
    diagnostics.push(diagnostic);
  }

  if (contract !== undefined) {
    if (views.includes("fields") || views.includes("frontmatter") || query.field !== undefined) {
      fields.push(...resolveFields(contract, query.field, views.includes("values"), diagnostics));
    }
    if (views.includes("schema")) schema = contract;
    if (views.includes("examples")) {
      examples.push(...skillsetSchemaExamples
        .filter((example) => example.id === contract.id)
        .map((example) => ({
          contractId: example.id,
          description: example.description,
          path: example.path,
          value: example.value,
        })));
    }
  }

  if (views.includes("events") && subject === "hooks") {
    events.push(...lookupHookEvents(targets));
    if (targets.includes("claude")) {
      diagnostics.push({
        code: "lookup/events/not-enumerated",
        message: "Claude hook event names are not enumerated in the adopted provider snapshots.",
        severity: "warning",
      });
    }
  }

  if (views.includes("compat")) {
    compatibility.push(...lookupCompatibility(subject, aspects, targets, diagnostics));
  }

  return {
    aspects,
    compatibility,
    diagnostics,
    events,
    examples,
    fields,
    ...(schema === undefined ? {} : { schema }),
    subject,
    subjects: [],
    summary: summarizeLookup(subject, aspects, views),
    targets,
    views,
  };
}

function normalizeTargets(targets: readonly TargetName[] | undefined): readonly TargetName[] {
  if (targets === undefined || targets.length === 0) return DEFAULT_TARGETS;
  return [...new Set(targets)].sort(compareStrings);
}

function normalizeViews(query: LookupQuery): readonly LookupView[] {
  const views = new Set<LookupView>(query.views ?? []);
  if (query.field !== undefined) views.add("fields");
  if (views.size === 0) {
    if (query.subject === undefined) return [];
    const subject = SUBJECTS.find((item) => item.subject === query.subject);
    return subject?.defaultViews ?? [];
  }
  return [...views].sort(compareStrings);
}

function invalidCombinationDiagnostics(
  subject: LookupSubject,
  views: readonly LookupView[],
  field: string | undefined
): readonly LookupDiagnostic[] {
  const diagnostics: LookupDiagnostic[] = [];
  if (views.includes("frontmatter") && subject === "workspace") {
    diagnostics.push({
      code: "lookup/frontmatter/not-applicable",
      message: "Workspace configuration uses fields; use --fields or --field instead of --frontmatter.",
      severity: "error",
    });
  }
  if (views.includes("events") && subject !== "hooks") {
    diagnostics.push({
      code: "lookup/events/not-applicable",
      message: `${subject} lookup does not have hook events; use subject hooks for --events.`,
      severity: "error",
    });
  }
  if (field !== undefined && field.trim().length === 0) {
    diagnostics.push({
      code: "lookup/field/empty",
      message: "--field requires a non-empty field path.",
      severity: "error",
    });
  }
  return diagnostics;
}

function resolveFields(
  contract: SkillsetSchemaContract,
  field: string | undefined,
  includeValues: boolean,
  diagnostics: LookupDiagnostic[]
): readonly LookupField[] {
  const entries = field === undefined
    ? topLevelFields(contract)
    : nestedField(contract, field, diagnostics);
  return entries.map((entry) => {
    const description = schemaDescription(entry.schema);
    return {
      contractId: contract.id,
      ...(description === undefined ? {} : { description }),
      path: entry.path,
      required: entry.required,
      type: summarizeSchemaType(entry.schema),
      ...(includeValues ? valuesProperty(schemaValues(entry.schema)) : {}),
    };
  });
}

function topLevelFields(contract: SkillsetSchemaContract): readonly {
  readonly path: string;
  readonly required: boolean;
  readonly schema: SchemaJsonRecord;
}[] {
  return Object.entries(schemaProperties(contract.schema))
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([path, schema]) => ({
      path,
      required: schemaRequired(contract.schema).includes(path),
      schema,
    }));
}

function nestedField(
  contract: SkillsetSchemaContract,
  field: string,
  diagnostics: LookupDiagnostic[]
): readonly {
  readonly path: string;
  readonly required: boolean;
  readonly schema: SchemaJsonRecord;
}[] {
  const path = field.trim();
  const resolved = resolveSchemaPath(contract.schema, path);
  if (resolved === undefined) {
    diagnostics.push({
      code: "lookup/field/not-found",
      message: `${contract.id} does not define field ${path}.`,
      severity: "error",
    });
    return [];
  }
  return [{ path, required: resolved.required, schema: resolved.schema }];
}

function resolveSchemaPath(
  schema: SchemaJsonRecord,
  path: string
): { readonly required: boolean; readonly schema: SchemaJsonRecord } | undefined {
  let current: SchemaJsonRecord = schema;
  let required = false;
  for (const segment of path.split(".")) {
    const properties = schemaProperties(current);
    const next = properties[segment];
    if (next === undefined) return undefined;
    required = schemaRequired(current).includes(segment);
    current = next;
  }
  return { required, schema: current };
}

function schemaProperties(schema: SchemaJsonRecord): Record<string, SchemaJsonRecord> {
  const properties = schema.properties;
  if (!isRecord(properties)) return {};
  const result: Record<string, SchemaJsonRecord> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (isRecord(value)) result[key] = value;
  }
  return result;
}

function schemaRequired(schema: SchemaJsonRecord): readonly string[] {
  return readStringArray(schema.required);
}

function schemaDescription(schema: SchemaJsonRecord): string | undefined {
  return typeof schema.description === "string" ? schema.description : undefined;
}

function summarizeSchemaType(schema: SchemaJsonRecord): string {
  const anyOf = readRecordArray(schema.anyOf);
  if (anyOf.length > 0) return anyOf.map(summarizeSchemaType).join(" | ");
  if (Array.isArray(schema.enum)) return "enum";
  if (schema.const !== undefined) return "const";
  if (Array.isArray(schema.type)) return schema.type.filter((item): item is string => typeof item === "string").join(" | ");
  if (typeof schema.type === "string") {
    if (schema.type === "array" && isRecord(schema.items)) return `array<${summarizeSchemaType(schema.items)}>`;
    return schema.type;
  }
  return "unknown";
}

function schemaValues(schema: SchemaJsonRecord): readonly SchemaJsonValue[] {
  if (Array.isArray(schema.enum)) return schema.enum;
  if (schema.const !== undefined) return [schema.const];
  if (isRecord(schema.items)) return schemaValues(schema.items);
  const anyOf = readRecordArray(schema.anyOf);
  if (anyOf.length > 0) return uniqueJsonValues(anyOf.flatMap(schemaValues));
  return [];
}

function valuesProperty(values: readonly SchemaJsonValue[]): { readonly values?: readonly SchemaJsonValue[] } {
  return values.length === 0 ? {} : { values };
}

function uniqueJsonValues(values: readonly SchemaJsonValue[]): readonly SchemaJsonValue[] {
  const seen = new Set<string>();
  const result: SchemaJsonValue[] = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function lookupHookEvents(targets: readonly TargetName[]): readonly LookupEvent[] {
  if (!targets.includes("codex")) return [];
  if (CODEX_HOOK_EVENT_SNAPSHOT === undefined || CODEX_HOOK_EVENT_ENTRIES.length === 0) return [];
  return CODEX_HOOK_EVENT_ENTRIES
    .map((entry) => ({
      fields: entry.properties.map((name) => ({
        name,
        required: entry.required.includes(name),
      })),
      name: entry.title,
      providerRef: CODEX_HOOK_EVENT_SNAPSHOT.id,
      target: CODEX_HOOK_EVENT_SNAPSHOT.target,
    }))
    .sort((left, right) => compareStrings(left.name, right.name));
}

function lookupCompatibility(
  subject: LookupSubject,
  aspects: readonly string[],
  targets: readonly TargetName[],
  diagnostics: LookupDiagnostic[]
): readonly LookupCompatibility[] {
  const featureIds = resolveFeatureIds(subject, aspects, diagnostics);
  return featureIds
    .flatMap((featureId) => {
      const feature = getSkillsetFeature(featureId);
      if (feature === undefined) {
        diagnostics.push({
          code: "lookup/compat/feature-not-found",
          message: `Feature registry entry ${featureId} is not available.`,
          severity: "error",
        });
        return [];
      }
      return targets.map((target) => compatibilityForTarget(feature, target));
    })
    .sort((left, right) => compareStrings(`${left.featureId}:${left.target}`, `${right.featureId}:${right.target}`));
}

function resolveFeatureIds(
  subject: LookupSubject,
  aspects: readonly string[],
  diagnostics: LookupDiagnostic[]
): readonly SkillsetFeatureId[] {
  if (aspects.length === 0) return SUBJECT_FEATURES[subject] ?? [];
  const byAspect = ASPECT_FEATURES[subject] ?? {};
  const ids: SkillsetFeatureId[] = [];
  for (const aspect of aspects) {
    const matches = byAspect[aspect];
    if (matches === undefined) {
      diagnostics.push({
        code: "lookup/compat/aspect-not-found",
        message: `${subject} lookup does not define compatibility aspect ${aspect}.`,
        severity: "error",
      });
      continue;
    }
    ids.push(...matches);
  }
  return [...new Set(ids)];
}

function compatibilityForTarget(feature: SkillsetFeatureEntry, target: TargetName): LookupCompatibility {
  const support = feature.targetSupport[target];
  return {
    docs: feature.docs,
    featureId: feature.id,
    featureTitle: feature.title,
    ...(support.note === undefined ? {} : { note: support.note }),
    ...(support.reason === undefined ? {} : { reason: support.reason }),
    status: support.status,
    target,
  };
}

function summarizeLookup(
  subject: LookupSubject,
  aspects: readonly string[],
  views: readonly LookupView[]
): string {
  const aspectText = aspects.length === 0 ? "" : ` ${aspects.join(" ")}`;
  const viewText = views.length === 0 ? "default reference" : views.join(", ");
  return `${subject}${aspectText}: ${viewText}`;
}

function readProviderSchemaSetEntries(value: unknown): readonly ProviderSchemaSetEntry[] {
  if (!isSchemaSetSummary(value)) return [];
  const entries: unknown[] = Array.isArray(value.entries)
    ? [...value.entries]
    : isRecord(value.entries)
      ? Object.values(value.entries)
      : [];
  return entries.filter(isProviderSchemaSetEntry).map((entry) => ({
    contentHash: entry.contentHash,
    name: entry.name,
    properties: [...entry.properties],
    required: [...entry.required],
    title: entry.title,
    url: entry.url,
  }));
}

function isSchemaSetSummary(value: unknown): value is ProviderSchemaSetSummary | (Omit<ProviderSchemaSetSummary, "entries"> & { readonly entries: SchemaJsonValue }) {
  return isRecord(value) && typeof value.schemaCount === "number";
}

function isProviderSchemaSetEntry(value: unknown): value is ProviderSchemaSetEntry {
  return isRecord(value) &&
    typeof value.name === "string" &&
    Array.isArray(value.properties) &&
    value.properties.every((item) => typeof item === "string") &&
    Array.isArray(value.required) &&
    value.required.every((item) => typeof item === "string") &&
    typeof value.title === "string";
}

function isRecord(value: unknown): value is SchemaJsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRecordArray(value: SchemaJsonValue | undefined): readonly SchemaJsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function readStringArray(value: SchemaJsonValue | undefined): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
