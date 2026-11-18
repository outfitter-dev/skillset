import type {
  MIGRATION_FLAG_DISPOSITIONS, MIGRATION_FLAG_SEVERITIES, MIGRATION_MARKER_LABELS, MIGRATION_STATE_SCHEMA_VERSION,
} from "./migration-state-contract";

/** Repository-relative authored or origin location; positions are one-based. */
export interface MigrationLocation {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
}
export interface MigrationFingerprints {
  readonly content: string;
  readonly context: string;
}
export interface MigrationResolution {
  readonly reason: string;
  readonly at: string;
}
/** Previous review decisions, retained in order when a decision is replaced or reopened. */
export interface MigrationDecision extends MigrationResolution {
  readonly state: "accepted" | "resolved";
}
export interface MigrationEvidence {
  readonly summary: string;
  readonly reference?: string;
}
export type MigrationPlacement =
  | { readonly kind: "inline"; readonly label: (typeof MIGRATION_MARKER_LABELS)[number]; readonly line: number }
  | { readonly kind: "sidecar"; readonly reason: string };
export interface MigrationFinding {
  readonly code: string;
  readonly severity: (typeof MIGRATION_FLAG_SEVERITIES)[number];
  readonly disposition: (typeof MIGRATION_FLAG_DISPOSITIONS)[number];
  readonly message: string;
  readonly source: MigrationLocation;
  readonly origin?: MigrationLocation;
  readonly fingerprints: MigrationFingerprints;
  readonly placement: MigrationPlacement;
  readonly evidence: readonly MigrationEvidence[];
  readonly relatedReportIds: readonly string[];
}
export type MigrationFlag = MigrationFinding & {
  readonly id: string;
  readonly history: readonly MigrationDecision[];
} & (
  | { readonly state: "open"; readonly resolution?: never }
  | { readonly state: "accepted" | "resolved"; readonly resolution: MigrationResolution }
);
/** Complete scan observation; an explicit ID refers to an existing ledger record. */
export type MigrationObservation = MigrationFinding & { readonly id?: string };
export interface MigrationState {
  readonly schemaVersion: typeof MIGRATION_STATE_SCHEMA_VERSION;
  readonly flags: readonly MigrationFlag[];
}
