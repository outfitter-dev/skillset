import { MIGRATION_LOCATION_PATTERN } from "./migration-state-contract";
import { IMPORT_NORMALIZATION_POINTER_PATTERN } from "./import-normalization";
import type { SchemaJsonRecord, SkillsetReportTarget } from "./types";

export const IMPORT_CAPABILITY_CONSTRUCTS = ["native-skill-frontmatter", "native-hook-runtime", "mcp-conversion", "manifest-conversion"] as const;
export const IMPORT_CAPABILITY_ELIGIBILITIES = ["unknown-source", "no-capability", "no-judgment", "stale-evidence", "scope-mismatch"] as const;

/** Candidate comparisons do not imply that a target is selected or an output was emitted. */
export interface ImportCapabilityAssessment {
  readonly construct: (typeof IMPORT_CAPABILITY_CONSTRUCTS)[number];
  /** Retained source location relative to the receiving workspace. */
  readonly source: { readonly path: string; readonly pointer: string };
  readonly sourceProvider?: SkillsetReportTarget | "agent-plugins";
  readonly candidateTarget: SkillsetReportTarget;
  readonly capabilityId?: string;
  readonly featureId?: string;
  readonly fidelity: "unknown";
  readonly eligibility: (typeof IMPORT_CAPABILITY_ELIGIBILITIES)[number];
  readonly judgmentScope?: string;
  readonly authorityHash?: string;
  readonly reasons: readonly string[];
  readonly evidence: readonly string[];
}

export function importCapabilityAssessmentSchema(targets: readonly string[]): SchemaJsonRecord {
  const strings = { type: "array", minItems: 1, items: { type: "string", minLength: 1 } };
  return {
    type: "object", additionalProperties: false,
    required: ["construct", "source", "candidateTarget", "fidelity", "eligibility", "reasons", "evidence"],
    properties: {
      construct: { enum: [...IMPORT_CAPABILITY_CONSTRUCTS] },
      source: { type: "object", additionalProperties: false, required: ["path", "pointer"], properties: {
        path: { type: "string", pattern: MIGRATION_LOCATION_PATTERN },
        pointer: { type: "string", pattern: IMPORT_NORMALIZATION_POINTER_PATTERN },
      } },
      sourceProvider: { enum: [...targets, "agent-plugins"] }, candidateTarget: { enum: [...targets] },
      capabilityId: { type: "string", minLength: 1 }, featureId: { type: "string", minLength: 1 },
      fidelity: { const: "unknown" }, eligibility: { enum: [...IMPORT_CAPABILITY_ELIGIBILITIES] },
      judgmentScope: { type: "string", minLength: 1 }, authorityHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
      reasons: strings, evidence: strings,
    },
  };
}
