export type SchemaJsonScalar = boolean | null | number | string;
export type SchemaJsonValue = SchemaJsonScalar | SchemaJsonRecord | SchemaJsonValue[];

export interface SchemaJsonRecord {
  readonly [key: string]: SchemaJsonValue | undefined;
}

export type SkillsetSchemaContractId =
  | "adaptive-hook"
  | "agent-frontmatter"
  | "change-entry"
  | "cli-event"
  | "cli-result"
  | "hook"
  | "instruction-frontmatter"
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

export interface SkillsetSchemaContract {
  readonly description: string;
  readonly id: SkillsetSchemaContractId;
  readonly schema: SchemaJsonRecord;
  readonly title: string;
  readonly version: string;
}
