export type SchemaJsonScalar = boolean | null | number | string;
export type SchemaJsonValue = SchemaJsonScalar | SchemaJsonRecord | SchemaJsonValue[];

export interface SchemaJsonRecord {
  readonly [key: string]: SchemaJsonValue | undefined;
}

export type SkillsetSchemaContractId =
  | "adaptive-hook"
  | "agent-frontmatter"
  | "change-entry"
  | "hook"
  | "instruction-frontmatter"
  | "skill-frontmatter"
  | "source-metadata"
  | "test-declaration"
  | "workspace-config";

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
