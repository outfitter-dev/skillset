import { MIGRATION_LOCATION_PATTERN } from "./migration-state-contract";
import type { SchemaJsonRecord, SkillsetReportTarget } from "./types";

export const IMPORT_NORMALIZATION_CODES = [
  "native.license-path",
  "agent-plugins.allowed-tools", "agent-plugins.license-metadata", "agent-plugins.license-file", "agent-plugins.license-path", "agent-plugins.manifest-to-source",
  "marketplace.name", "marketplace.target", "marketplace.description", "marketplace.owner", "marketplace.plugin",
  "manifest.name", "manifest.name-remap", "manifest.description", "manifest.author", "manifest.metadata", "manifest.listing",
  "mcp.claude-http-transport", "mcp.codex-url-transport", "mcp.codex-header-field",
  "mcp.claude-root-token", "mcp.claude-data-token", "mcp.source-path", "mcp.json-serialization",
] as const;
export type ImportNormalizationCode = (typeof IMPORT_NORMALIZATION_CODES)[number];
export const IMPORT_NORMALIZATION_POINTER_PATTERN = "^(?:/(?:[^~]|~[01])*)*$";

/** Field-specific metadata proof; it does not qualify provider runtime behavior. */
export interface ImportManifestRoundTrip {
  readonly scope: "claude-manifest-identity";
  readonly target: "claude";
  readonly fidelity: "exact";
  readonly output: { readonly path: string; readonly pointer: "/name" | "/description" };
  readonly outputHash: string;
  readonly authorityHash: string;
  readonly evidence: readonly string[];
}

/** Observed source conversion, not a destination support or runtime fidelity claim. */
export interface ImportNormalization {
  readonly code: ImportNormalizationCode;
  readonly dialect: SkillsetReportTarget | "agent-plugins";
  /** Relative to the original imported unit, never an absolute acquisition path. */
  readonly source: { readonly path: string; readonly pointer: string };
  /** Relative to the receiving workspace. */
  readonly destination: { readonly path: string; readonly pointer: string };
  readonly occurrences: number;
  readonly fidelity: "unknown";
  readonly roundTrip?: ImportManifestRoundTrip;
  readonly evidence: readonly string[];
  readonly providerVersion?: string;
  readonly observedAt?: string;
}

export const importNormalizationLocationSchema: SchemaJsonRecord = {
  type: "object", additionalProperties: false, required: ["path", "pointer"],
  properties: {
    path: { type: "string", pattern: MIGRATION_LOCATION_PATTERN },
    pointer: { type: "string", pattern: IMPORT_NORMALIZATION_POINTER_PATTERN },
  },
};

export const importManifestRoundTripSchema: SchemaJsonRecord = {
  type: "object", additionalProperties: false,
  required: ["scope", "target", "fidelity", "output", "outputHash", "authorityHash", "evidence"],
  properties: {
    scope: { const: "claude-manifest-identity" }, target: { const: "claude" }, fidelity: { const: "exact" },
    output: { ...importNormalizationLocationSchema, properties: {
      path: { type: "string", pattern: MIGRATION_LOCATION_PATTERN }, pointer: { enum: ["/name", "/description"] },
    } },
    outputHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    authorityHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    evidence: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
  },
};

export function importNormalizationSchema(targets: readonly string[]): SchemaJsonRecord {
  return {
    type: "object", additionalProperties: false,
    required: ["code", "dialect", "source", "destination", "occurrences", "fidelity", "evidence"],
    allOf: ["name", "description"].map((field) => ({
      if: { required: ["roundTrip"], properties: { roundTrip: { properties: { output: { properties: { pointer: { const: `/${field}` } } } } } } },
      then: { properties: {
        code: { const: `manifest.${field}` }, dialect: { const: "claude" }, occurrences: { const: 1 },
        source: { properties: { path: { const: ".claude-plugin/plugin.json" }, pointer: { const: `/${field}` } } },
        destination: { properties: { pointer: { const: `/skillset/${field}` } } },
      } },
    })),
    properties: {
      code: { enum: [...IMPORT_NORMALIZATION_CODES] },
      dialect: { enum: [...targets, "agent-plugins"] },
      source: importNormalizationLocationSchema, destination: importNormalizationLocationSchema,
      occurrences: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      fidelity: { const: "unknown" }, roundTrip: importManifestRoundTripSchema,
      evidence: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
      providerVersion: { type: "string", minLength: 1 },
      observedAt: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
    },
  };
}
