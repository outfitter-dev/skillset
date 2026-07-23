import {
  adaptiveHookContract,
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
  getSkillsetFeature,
  type SkillsetFeatureEntry,
  type SkillsetFeatureId,
} from "./feature-registry";
import {
  hookHandlerTypesForEvent,
  hookProviderCapabilities,
  type HookMatcherKind,
} from "./hook-capabilities";
import { compareStrings } from "./path";
import { targetNames } from "./targets";
import {
  listToolsRealizationFacts,
  type ToolsAspect,
  type ToolsRealizationDirection,
  type ToolsRealizationEnforcement,
  type ToolsRealizationSurface,
  type ToolsRealizationTier,
} from "./tools-realization";
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
  readonly canBlock: boolean;
  readonly handlerTypes: readonly string[];
  readonly matcherEvaluation: string;
  readonly matcherKind: HookMatcherKind;
  readonly matcherValues: readonly string[];
  readonly name: string;
  readonly outputFields: readonly string[];
  readonly providerRef: string;
  readonly rawOutputFields: readonly string[];
  readonly runtimeNotes: readonly string[];
  readonly target: TargetName;
  readonly unsupportedOutputFields: readonly string[];
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

/**
 * One row of the portable tools realization matrix: how a portable aspect is
 * realized on a target. `rendered: false` rows document provider surfaces
 * Skillset knows about but deliberately does not drive during build.
 */
export interface LookupToolsRealization {
  readonly aspect: ToolsAspect;
  readonly diagnostic?: string;
  readonly direction?: ToolsRealizationDirection;
  readonly emits?: string;
  readonly enforcement: ToolsRealizationEnforcement;
  readonly rendered: boolean;
  readonly surface: ToolsRealizationSurface;
  readonly target: TargetName;
  readonly tier: ToolsRealizationTier;
}

export interface LookupReport {
  readonly aspects: readonly string[];
  readonly compatibility: readonly LookupCompatibility[];
  readonly diagnostics: readonly LookupDiagnostic[];
  readonly events: readonly LookupEvent[];
  readonly examples: readonly LookupExample[];
  readonly fields: readonly LookupField[];
  readonly realizations: readonly LookupToolsRealization[];
  readonly schema?: SkillsetSchemaContract;
  readonly subject?: LookupSubject;
  readonly subjects: readonly LookupSubjectSummary[];
  readonly summary: string;
  readonly targets: readonly TargetName[];
  readonly views: readonly LookupView[];
}

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
  hooks: ["plugin-hooks", "adaptive-hooks"],
  instruction: ["project-instructions"],
  plugin: ["plugin-manifests"],
  skill: ["standalone-skills"],
};

const ASPECT_FEATURES: Partial<Record<LookupSubject, Record<string, readonly SkillsetFeatureId[]>>> = {
  agent: {
    skills: ["project-agents"],
  },
  hooks: {
    adaptive: ["adaptive-hooks"],
    attachments: ["adaptive-hooks"],
    context: ["runtime-context"],
    aggregate: ["plugin-hooks"],
    handlers: ["plugin-hooks"],
    native: ["plugin-hooks"],
    runtime: ["runtime-context"],
    toolkit: ["runtime-context"],
    units: ["adaptive-hooks"],
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
    tools: ["tools-policy"],
    "tools-policy": ["tools-policy"],
  },
};

const LOOKUP_VIEW_ORDER = [
  "fields",
  "frontmatter",
  "values",
  "events",
  "compat",
  "examples",
  "schema",
] as const satisfies readonly LookupView[];

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
      realizations: [],
      subjects: SUBJECTS,
      summary: "Skillset lookup subjects.",
      targets,
      views,
    };
  }

  const contract = contractForLookup(subject, aspects);
  const fields: LookupField[] = [];
  const events: LookupEvent[] = [];
  const compatibility: LookupCompatibility[] = [];
  const examples: LookupExample[] = [];
  let schema: SkillsetSchemaContract | undefined;

  for (const diagnostic of invalidCombinationDiagnostics(subject, views, query.field)) {
    diagnostics.push(diagnostic);
  }

  if (contract !== undefined) {
    if (
      views.includes("fields") ||
      views.includes("frontmatter") ||
      views.includes("values") ||
      query.field !== undefined
    ) {
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
  }

  if (views.includes("compat")) {
    compatibility.push(...lookupCompatibility(subject, aspects, targets, diagnostics));
  }

  const realizations = views.includes("compat") && subject === "skill" && aspects.some(isToolsPolicyAspect)
    ? lookupToolsRealizations(targets)
    : [];

  return {
    aspects,
    compatibility,
    diagnostics,
    events,
    examples,
    fields,
    realizations,
    ...(schema === undefined ? {} : { schema }),
    subject,
    subjects: [],
    summary: summarizeLookup(subject, aspects, views),
    targets,
    views,
  };
}

export function listLookupViews(subject: LookupSubject): readonly LookupView[] {
  const contract = contractForLookup(subject, []);
  return LOOKUP_VIEW_ORDER.filter((view) => {
    if (view === "events") return subject === "hooks";
    if (view === "compat") return SUBJECT_FEATURES[subject] !== undefined;
    if (view === "frontmatter") {
      return subject === "agent" || subject === "instruction" || subject === "skill";
    }
    return contract !== undefined;
  });
}

export function listLookupSubjects(
  query: Pick<LookupQuery, "aspects" | "field" | "views"> = {}
): readonly LookupSubjectSummary[] {
  const requiredViews = new Set(query.views ?? []);
  if (query.field !== undefined) requiredViews.add("fields");
  if (requiredViews.size === 0) return SUBJECTS;
  const applicable = SUBJECTS.filter((summary) => {
    const views = listLookupViews(summary.subject);
    return [...requiredViews].every((view) => views.includes(view));
  });
  if (query.field === undefined) return applicable;
  const fieldPath = query.field.trim();
  const fieldOwners = applicable.filter((summary) =>
    listLookupFields({
      ...(query.aspects === undefined ? {} : { aspects: query.aspects }),
      subject: summary.subject,
    }).some((field) => field.path === fieldPath)
  );
  return fieldOwners.length === 0 ? applicable : fieldOwners;
}

export function listLookupFields(
  query: Pick<LookupQuery, "aspects" | "subject">
): readonly LookupField[] {
  if (query.subject === undefined) return [];
  const contract = contractForLookup(query.subject, query.aspects ?? []);
  return contract === undefined ? [] : nestedFields(contract);
}

function isToolsPolicyAspect(aspect: string): boolean {
  return aspect === "tools" || aspect === "tools-policy";
}

function lookupToolsRealizations(targets: readonly TargetName[]): readonly LookupToolsRealization[] {
  return targets
    .flatMap((target) =>
      listToolsRealizationFacts({ provider: target }).flatMap((fact) =>
        fact.aspects.map((aspect): LookupToolsRealization => ({
          aspect,
          ...(fact.diagnostic === undefined ? {} : { diagnostic: fact.diagnostic }),
          ...(fact.direction === undefined ? {} : { direction: fact.direction }),
          ...(fact.emits === undefined ? {} : { emits: fact.emits }),
          enforcement: fact.enforcement,
          rendered: fact.rendered,
          surface: fact.surface,
          target,
          tier: fact.tier,
        }))
      )
    )
    .sort((left, right) =>
      compareStrings(
        `${left.target}\0${left.aspect}\0${left.rendered ? 0 : 1}\0${left.tier}\0${left.direction ?? ""}`,
        `${right.target}\0${right.aspect}\0${right.rendered ? 0 : 1}\0${right.tier}\0${right.direction ?? ""}`
      )
    );
}

function normalizeTargets(targets: readonly TargetName[] | undefined): readonly TargetName[] {
  if (targets === undefined || targets.length === 0) return targetNames();
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

function contractForLookup(subject: LookupSubject, aspects: readonly string[]): SkillsetSchemaContract | undefined {
  if (subject === "hooks" && aspects.some(isAdaptiveHookAspect)) return adaptiveHookContract;
  return CONTRACTS_BY_SUBJECT[subject];
}

function isAdaptiveHookAspect(aspect: string): boolean {
  return aspect === "adaptive" || aspect === "context" || aspect === "runtime" || aspect === "toolkit" || aspect === "units";
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

function nestedFields(contract: SkillsetSchemaContract): readonly LookupField[] {
  const fields: LookupField[] = [];
  collectNestedFields(contract, contract.schema, "", fields);
  return fields;
}

function collectNestedFields(
  contract: SkillsetSchemaContract,
  schema: SchemaJsonRecord,
  prefix: string,
  fields: LookupField[]
): void {
  const required = new Set(schemaRequired(schema));
  for (const [name, child] of Object.entries(schemaProperties(schema)).sort(
    ([left], [right]) => compareStrings(left, right)
  )) {
    const path = prefix.length === 0 ? name : `${prefix}.${name}`;
    const description = schemaDescription(child);
    fields.push({
      contractId: contract.id,
      ...(description === undefined ? {} : { description }),
      path,
      required: required.has(name),
      type: summarizeSchemaType(child),
    });
    collectNestedFields(contract, child, path, fields);
  }
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
  return targets.flatMap((target) => {
    const capabilities = hookProviderCapabilities[target];
    return [...capabilities.documentedEvents].map((event) => {
      return {
        canBlock: capabilities.canBlockByEvent[event] === true,
        fields: capabilities.inputFieldsByEvent[event] ?? [],
        handlerTypes: [...hookHandlerTypesForEvent(target, event)].sort(compareStrings),
        matcherEvaluation: capabilities.matcherEvaluationByEvent[event] ?? "provider-native",
        matcherKind: capabilities.matcherByEvent[event] ?? "none",
        matcherValues: readStringList(capabilities.matcherValuesByEvent[event]),
        name: event,
        outputFields: readStringList(capabilities.outputFieldsByEvent[event]),
        providerRef: capabilities.providerRefByEvent[event] ?? `hook-capabilities:${target}`,
        rawOutputFields: readStringList(capabilities.rawOutputFieldsByEvent[event]),
        runtimeNotes: readStringList(capabilities.runtimeNotesByEvent[event]),
        target,
        unsupportedOutputFields: readStringList(capabilities.unsupportedOutputFieldsByEvent[event]),
      };
    });
  }).sort((left, right) => compareStrings(`${left.target}:${left.name}`, `${right.target}:${right.name}`));
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

function readStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
