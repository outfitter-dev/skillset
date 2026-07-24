export type SchemaJsonScalar = boolean | null | number | string;
export type SchemaJsonValue = SchemaJsonScalar | SchemaJsonRecord | SchemaJsonValue[];

export interface SchemaJsonRecord {
  readonly [key: string]: SchemaJsonValue | undefined;
}

export type SkillsetSchemaContractId =
  | "adaptive-hook"
  | "agent-frontmatter"
  | "activation-inspection"
  | "change-entry"
  | "cli-event"
  | "cli-result"
  | "hook"
  | "instruction-frontmatter"
  | "skill-eval"
  | "skill-frontmatter"
  | "source-metadata"
  | "test-declaration"
  | "workspace-config";

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
