import { MIGRATION_LOCATION_PATTERN } from "./migration-state-contract";
import type { SchemaJsonRecord, SkillsetReportTarget } from "./types";

export const IMPORT_NORMALIZATION_CODES = [
  "manifest.name", "manifest.name-remap", "manifest.description",
  "mcp.claude-http-transport", "mcp.codex-url-transport", "mcp.codex-header-field",
  "mcp.claude-root-token", "mcp.claude-data-token", "mcp.source-path", "mcp.json-serialization",
] as const;
export type ImportNormalizationCode = (typeof IMPORT_NORMALIZATION_CODES)[number];
export const IMPORT_NORMALIZATION_POINTER_PATTERN = "^(?:/(?:[^~]|~[01])*)*$";

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

export function importNormalizationSchema(targets: readonly string[]): SchemaJsonRecord {
  return {
    type: "object", additionalProperties: false,
    required: ["code", "dialect", "source", "destination", "occurrences", "fidelity", "evidence"],
    properties: {
      code: { enum: [...IMPORT_NORMALIZATION_CODES] },
      dialect: { enum: [...targets, "agent-plugins"] },
      source: importNormalizationLocationSchema, destination: importNormalizationLocationSchema,
      occurrences: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      fidelity: { const: "unknown" },
      evidence: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
      providerVersion: { type: "string", minLength: 1 },
      observedAt: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
    },
  };
}
