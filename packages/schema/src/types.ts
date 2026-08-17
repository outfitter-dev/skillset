import type { TARGET_NAMES } from "./contracts";

export type SchemaJsonScalar = boolean | null | number | string;
export type SchemaJsonValue =
  | SchemaJsonScalar
  | SchemaJsonRecord
  | SchemaJsonValue[];

export interface SchemaJsonRecord {
  readonly [key: string]: SchemaJsonValue | undefined;
}

export type SkillsetSchemaContractId =
  | "adaptive-hook"
  | "agent-frontmatter"
  | "activation-inspection"
  | "activation-proof-receipt"
  | "change-entry"
  | "cli-event"
  | "cli-result"
  | "hook"
  | "instruction-frontmatter"
  | "report"
  | "skill-eval"
  | "skill-frontmatter"
  | "source-metadata"
  | "test-declaration"
  | "workspace-config";

export interface SkillsetReportRepository {
  readonly commit?: string;
  readonly dirty?: boolean;
  readonly identity: string;
}

export interface SkillsetReportWorkspace {
  readonly id: string;
  readonly name?: string;
  readonly repository?: SkillsetReportRepository;
}

export interface SkillsetExternalFixtureReportWorkspace extends SkillsetReportWorkspace {
  readonly repository: {
    readonly commit: string;
    readonly dirty: boolean;
    readonly identity: string;
  };
}

export interface SkillsetReportResult {
  readonly command: string;
  readonly exitCode: number;
  readonly ok: boolean;
}

export type SkillsetTypedReportExitCode = 0 | 1 | 2 | 3 | 4;

export type SkillsetTypedReportResult<Command extends string> =
  | {
      readonly command: Command;
      readonly exitCode: 0;
      readonly ok: true;
    }
  | {
      readonly command: Command;
      readonly exitCode: Exclude<SkillsetTypedReportExitCode, 0>;
      readonly ok: false;
    };

export type SkillsetReportTarget = (typeof TARGET_NAMES)[number];

export type SkillsetReportPhaseStatus =
  | "failed"
  | "not-run"
  | "passed"
  | "skipped";

export interface SkillsetReportPhaseSummary {
  readonly count: number;
  readonly status: SkillsetReportPhaseStatus;
}

export interface SkillsetReportEvidenceDescriptor {
  readonly available: boolean;
  readonly bytes: number;
  readonly entries: number;
  readonly id: string;
  readonly sha256: string;
}

export interface SkillsetReportRenderResultCounts {
  readonly failed: number;
  readonly rendered: number;
  readonly skipped: number;
  readonly unsupported: number;
}

export interface SkillsetAdoptionReportPayload {
  readonly alreadyAdopted: boolean;
  readonly candidateIds: readonly string[];
  readonly destinations: readonly string[];
  readonly diagnosticCodes: readonly string[];
  readonly importedUnitIds: readonly string[];
  readonly isolatedOutput?: SkillsetReportEvidenceDescriptor;
  readonly listCounts: {
    readonly candidateIds: number;
    readonly destinations: number;
    readonly importedUnitIds: number;
  };
  readonly migrationFlagCodes: readonly string[];
  readonly phases: {
    readonly build: SkillsetReportPhaseSummary;
    readonly import: SkillsetReportPhaseSummary;
    readonly lint: SkillsetReportPhaseSummary;
    readonly setup: SkillsetReportPhaseSummary;
  };
  readonly renderResults: SkillsetReportRenderResultCounts;
}

export interface SkillsetImportReportPayload {
  readonly destinations: readonly string[];
  readonly diagnosticCodes: readonly string[];
  readonly fields: {
    readonly inferred: number;
    readonly preserved: number;
    readonly unsupported: number;
  };
  readonly fileCount: number;
  readonly importedUnitIds: readonly string[];
  readonly listCounts: {
    readonly destinations: number;
    readonly importedUnitIds: number;
  };
  readonly partial: boolean;
  readonly requestedKind: "auto" | "plugin" | "plugins" | "skill" | "skills";
  readonly requestedProvider?: "agents" | SkillsetReportTarget | "skillset";
  readonly renderResults: SkillsetReportRenderResultCounts;
  readonly warningCodes: readonly string[];
}

export interface SkillsetExternalFixtureReportPayload {
  readonly evidence: readonly SkillsetReportEvidenceDescriptor[];
  readonly fixture: {
    readonly manifestEntryCount: number;
    /**
     * SHA-256 of the selected parsed manifest entry's canonical UTF-8 JSON
     * after default-target expansion and fixed key ordering.
     */
    readonly manifestEntrySha256: string;
    /** SHA-256 of the manifest's raw file bytes. */
    readonly manifestSha256: string;
    readonly name: string;
    readonly pinnedCommit: string;
    readonly repository: string;
    readonly targets: readonly SkillsetReportTarget[];
  };
  readonly pipelinePassed: boolean;
  readonly runtime: {
    readonly bunVersion: string;
  };
  readonly phases: {
    readonly acquire: SkillsetExternalFixturePhase;
    readonly init: SkillsetExternalFixturePhase;
    readonly import: SkillsetExternalFixturePhase;
    readonly lint: SkillsetExternalFixturePhase;
    readonly build: SkillsetExternalFixturePhase;
    readonly purity: SkillsetExternalFixturePhase;
    readonly compare: SkillsetExternalFixturePhase;
  };
  readonly summaries: {
    readonly comparisonDifferences: number;
    readonly importedUnits: number;
    readonly migrationFlags: number;
    readonly renderResults: SkillsetReportRenderResultCounts;
    readonly surveyCandidates: number;
  };
}

export interface SkillsetExternalFixturePhase {
  readonly exitClass:
    | "command-failure"
    | "not-run"
    | "signal"
    | "success"
    | "timeout";
  readonly status: SkillsetReportPhaseStatus;
}

export interface SkillsetOperationReport {
  readonly createdAt: string;
  readonly id: string;
  readonly kind: "operation";
  readonly payload: Record<string, never>;
  readonly result: SkillsetReportResult;
  readonly schemaVersion: "skillset.report@1";
  readonly skillset: {
    readonly version: string;
  };
  readonly workspace: SkillsetReportWorkspace;
}

interface SkillsetStructuredReportBase<
  Command extends string,
  Kind extends string,
  Payload,
> {
  readonly createdAt: string;
  readonly id: string;
  readonly kind: Kind;
  readonly payload: Payload;
  readonly result: SkillsetTypedReportResult<Command>;
  readonly schemaVersion: "skillset.report@1";
  readonly skillset: {
    readonly version: string;
  };
  readonly workspace: SkillsetReportWorkspace;
}

export type SkillsetAdoptionReport = SkillsetStructuredReportBase<
  "init.adopt",
  "adoption",
  SkillsetAdoptionReportPayload
>;

export type SkillsetImportReport = SkillsetStructuredReportBase<
  "import",
  "import",
  SkillsetImportReportPayload
>;

export interface SkillsetExternalFixtureReport extends SkillsetStructuredReportBase<
  "conformance.external",
  "external-fixture",
  SkillsetExternalFixtureReportPayload
> {
  readonly workspace: SkillsetExternalFixtureReportWorkspace;
}

export type SkillsetReport =
  | SkillsetAdoptionReport
  | SkillsetExternalFixtureReport
  | SkillsetImportReport
  | SkillsetOperationReport;

export interface SkillsetCliResult {
  readonly changes: readonly SkillsetCliChange[];
  readonly command: string;
  readonly data: SchemaJsonRecord;
  readonly diagnostics: readonly SkillsetCliDiagnostic[];
  readonly exitCode: number;
  readonly kind: string;
  readonly meta: SchemaJsonRecord;
  readonly ok: boolean;
  readonly schemaVersion: string;
}

export interface SkillsetCliDiagnostic {
  readonly code: string;
  readonly column?: number;
  readonly help?: string;
  readonly line?: number;
  readonly message: string;
  readonly path?: string;
  readonly severity: "error" | "info" | "warning";
}

export interface SkillsetCliChange {
  readonly action: "create" | "delete" | "move" | "update";
  readonly path: string;
  readonly reason?: string;
  readonly state: "planned" | "refused" | "skipped" | "written";
}

export interface SkillsetCliEvent {
  readonly command: string;
  readonly data: SchemaJsonRecord;
  readonly event: string;
  readonly schemaVersion: string;
  readonly sequence: number;
}

export interface SkillsetSchemaDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly path: string;
}

export interface SkillsetSchemaValidationResult {
  readonly diagnostics: readonly SkillsetSchemaDiagnostic[];
  readonly ok: boolean;
}

/** Optional source-graph facts used to validate one portable skill eval file. */
export interface SkillsetSkillEvalValidationContext {
  /** Skill-root-relative files that the eval may reference. */
  readonly files?: ReadonlySet<string>;
  /** The owning source skill identity. */
  readonly skillName?: string;
  /** Targets enabled for the owning source skill in the build graph. */
  readonly targets?: readonly string[];
}

export interface SkillsetSchemaContract {
  readonly description: string;
  readonly id: SkillsetSchemaContractId;
  readonly schema: SchemaJsonRecord;
  readonly title: string;
  readonly version: string;
}

/** Structural class of an authored source reference field. */
export type SkillsetSourceReferenceKind =
  | "generated-destination"
  | "source-path"
  | "source-unit-identity";

/** Default treatment when a future Core operation changes a referenced entity. */
export type SkillsetSourceReferenceMutationPolicy =
  | "preserve"
  | "rewrite"
  | "warning-only";

/** Authored contract family containing a source reference field. */
export type SkillsetSourceReferenceContract =
  | "adaptive-hook"
  | "agent-frontmatter"
  | "plugin-config"
  | "root-source-manifest"
  | "skill-eval"
  | "skill-frontmatter"
  | "workspace-config";

/** Authoring scope a Core resolver uses to interpret a descriptor value. */
export type SkillsetSourceReferenceScope =
  | "adaptive-hook-runtime"
  | "agent-visible-skills"
  | "owner-visible-hooks"
  | "skill-local-eval"
  | "skill-resource"
  | "workspace-or-plugin-config";

/**
 * Schema-owned inventory entry for a structured authored reference field.
 * Path patterns describe source syntax, not resolved filesystem locations.
 */
export interface SkillsetSourceReferenceDescriptor {
  readonly contracts: readonly SkillsetSourceReferenceContract[];
  readonly id:
    | "adaptive-hook-run-script"
    | "agent-skills"
    | "hook-attachment"
    | "internal-plugin-dependency"
    | "skill-eval-file"
    | "skill-eval-skill-name"
    | "skill-resource-destination"
    | "skill-resource-source";
  readonly kind: SkillsetSourceReferenceKind;
  readonly mutationPolicy: SkillsetSourceReferenceMutationPolicy;
  readonly notes: readonly string[];
  readonly pathPatterns: readonly string[];
  readonly scope: SkillsetSourceReferenceScope;
}

/** A source surface intentionally excluded from structured reference handling. */
export interface SkillsetSourceReferenceExclusion {
  readonly id:
    | "append-only-history"
    | "plugin-rename"
    | "provider-native-opaque-values"
    | "unmarked-prose-and-markdown"
    | "workspace-test-declarations";
  readonly reason: string;
}
