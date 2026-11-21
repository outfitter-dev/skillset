import { TARGET_NAMES } from "./contracts";
import type { SchemaJsonRecord } from "./types";

export const HOOK_CATALOG_VERSION = "skillset.registry.hooks@1";
export const CAPABILITY_FIDELITIES = [
  "exact", "equivalent", "partial", "synthesized", "provider-only", "unavailable", "unknown",
] as const;
export type CapabilityFidelity = (typeof CAPABILITY_FIDELITIES)[number];

const string = { type: "string", minLength: 1 };
const boolean = { type: "boolean" };
const url = { ...string, pattern: "^https://" };
const digest = { ...string, pattern: "^sha256:[a-f0-9]{64}$" };

function list(items: SchemaJsonRecord): SchemaJsonRecord {
  return { type: "array", items, uniqueItems: true };
}

function object(
  properties: SchemaJsonRecord,
  optional: readonly string[] = []
): SchemaJsonRecord {
  return {
    type: "object",
    properties,
    required: Object.keys(properties).filter((key) => !optional.includes(key)),
    additionalProperties: false,
  };
}

function index(values: SchemaJsonRecord): SchemaJsonRecord {
  return { type: "object", propertyNames: string, additionalProperties: values };
}

function targets(values: SchemaJsonRecord): SchemaJsonRecord {
  return object(Object.fromEntries(TARGET_NAMES.map((target) => [target, values])));
}

const evidenceIds = { ...list(string), minItems: 1 };
const compatibility = {
  ...object({
    fidelity: { enum: [...CAPABILITY_FIDELITIES] },
    scope: string,
    reason: string,
    nativeName: string,
    evidenceIds,
  }, ["nativeName"]),
  if: {
    properties: { fidelity: { const: "unavailable" } },
    required: ["fidelity"],
  },
  then: { not: { properties: { nativeName: string }, required: ["nativeName"] } },
};

const field = object({ name: string, required: { type: ["boolean", "null"] } });
const payload = {
  oneOf: [
    object({ coverage: { const: "unknown" } }),
    object({
      coverage: { const: "field-inventory" },
      fields: list(field),
      schemaRef: object({ url, contentHash: digest }),
    }, ["schemaRef"]),
  ],
};
const nativeEvent = object({
  sourceAliases: list(string),
  skillsetEventIds: list(string),
  canBlock: boolean,
  matcher: object({ subject: string, evaluation: string, values: list(string) }),
  handlerTypes: list(string),
  input: payload,
  output: object({
    contract: payload,
    recognizedFields: list(string),
    fieldsWithoutEstablishedEffect: list(string),
  }),
  runtimeNotes: list(string),
  evidenceIds,
});

const provider = object({
  config: object({
    handlerEnvelope: { enum: ["flat", "grouped"] },
    groupFields: list(string),
    handlerCommonFields: list(string),
    rootFields: list(string),
  }),
  handlers: list(object({ type: string, fields: list(string), skippedFields: list(string) }, ["skippedFields"])),
  outputLimits: list(object({
    approximate: boolean, field: string, kind: string, source: url,
    unit: string, value: { type: "number", minimum: 0 }, verifiedAt: string,
  })),
  placement: object({
    providerReads: { const: "unknown" },
    skillsetWrites: object({ plugin: string }),
  }),
  installedRuntime: { const: "unknown" },
  events: index({ $ref: "#/$defs/nativeEvent" }),
  nativeNamesByAlias: index({ ...list(string), minItems: 1 }),
  evidenceIds,
});

export const hookCatalogSchema: SchemaJsonRecord = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $defs: { compatibility, nativeEvent, provider },
  title: "Skillset hook catalog v1",
  ...object({
    schemaVersion: { const: HOOK_CATALOG_VERSION },
    targets: { const: [...TARGET_NAMES] },
    events: index(object({ meaning: string, providers: targets({ $ref: "#/$defs/compatibility" }) }, ["meaning"])),
    providers: targets({ $ref: "#/$defs/provider" }),
    evidence: index(object({
      basis: { enum: ["provider-docs", "provider-schema"] },
      target: { enum: [...TARGET_NAMES] },
      scope: string,
      urls: { ...list(url), minItems: 1 },
      contentHash: digest,
    })),
  }),
};
