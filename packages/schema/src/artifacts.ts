import { sortSchemaRecord } from "./json";
import type { SchemaJsonRecord, SkillsetSchemaContract, SkillsetSchemaContractId } from "./types";
import {
  SKILLSET_SCHEMA_URI_BASE,
  SKILLSET_SCHEMA_VERSION,
  adaptiveHookContract,
  agentFrontmatterContract,
  changeEntryContract,
  cliEventContract,
  cliResultContract,
  hookContract,
  instructionFrontmatterContract,
  skillEvalContract,
  skillFrontmatterContract,
  skillsetSchemaContracts,
  sourceMetadataContract,
  testDeclarationContract,
  workspaceConfigContract,
} from "./contracts";

export interface SkillsetJsonSchemaArtifact {
  readonly contractId: SkillsetSchemaContractId | "skillset";
  readonly path: string;
  readonly schema: SchemaJsonRecord;
}

const schemaFileNames = {
  "adaptive-hook": "adaptive-hook.schema.json",
  "agent-frontmatter": "agent-frontmatter.schema.json",
  "change-entry": "change-entry.schema.json",
  "cli-event": "cli-event.schema.json",
  "cli-result": "cli-result.schema.json",
  hook: "hook.schema.json",
  "instruction-frontmatter": "instruction-frontmatter.schema.json",
  "skill-eval": "skill-eval.schema.json",
  "skill-frontmatter": "skill-frontmatter.schema.json",
  "source-metadata": "source-metadata.schema.json",
  "test-declaration": "test-declaration.schema.json",
  "workspace-config": "workspace-config.schema.json",
} as const satisfies Record<SkillsetSchemaContractId, string>;

export function deriveSkillsetJsonSchemaArtifacts(): readonly SkillsetJsonSchemaArtifact[] {
  return [
    combinedSchemaArtifact(),
    ...skillsetSchemaContracts.map((contract) => ({
      contractId: contract.id,
      path: `docs/reference/schemas/${SKILLSET_SCHEMA_VERSION}/${schemaFileNames[contract.id]}`,
      schema: contract.schema,
    })),
    ...[cliResultContract, cliEventContract].map((contract) => ({
      contractId: contract.id,
      path: `docs/reference/schemas/${SKILLSET_SCHEMA_VERSION}/${schemaFileNames[contract.id]}`,
      schema: contract.schema,
    })),
  ];
}

function combinedSchemaArtifact(): SkillsetJsonSchemaArtifact {
  const definitions: Record<string, SchemaJsonRecord> = {};
  for (const contract of skillsetSchemaContracts) {
    definitions[contract.id] = embeddedContractSchema(contract);
  }

  return {
    contractId: "skillset",
    path: `docs/reference/schemas/${SKILLSET_SCHEMA_VERSION}/skillset.schema.json`,
    schema: sortSchemaRecord({
      $defs: definitions,
      $id: `${SKILLSET_SCHEMA_URI_BASE}/${SKILLSET_SCHEMA_VERSION}/skillset.schema.json`,
      $schema: "https://json-schema.org/draft/2020-12/schema",
      description: "Combined Skillset source contract schema. Use the document-specific schemas for editor file associations.",
      oneOf: [
        { $ref: "#/$defs/workspace-config" },
        { $ref: "#/$defs/source-metadata" },
        { $ref: "#/$defs/skill-frontmatter" },
        { $ref: "#/$defs/agent-frontmatter" },
        { $ref: "#/$defs/instruction-frontmatter" },
        { $ref: "#/$defs/skill-eval" },
        { $ref: "#/$defs/hook" },
        { $ref: "#/$defs/adaptive-hook" },
        { $ref: "#/$defs/change-entry" },
        { $ref: "#/$defs/test-declaration" },
      ],
      title: "Skillset Source Contracts",
    }),
  };
}

function embeddedContractSchema(contract: SkillsetSchemaContract): SchemaJsonRecord {
  const { $id, $schema, ...schema } = contract.schema;
  void $id;
  void $schema;
  return sortSchemaRecord(schema);
}

export function getSkillsetJsonSchemaArtifact(contractId: SkillsetJsonSchemaArtifact["contractId"]): SkillsetJsonSchemaArtifact {
  const artifact = deriveSkillsetJsonSchemaArtifacts().find((candidate) => candidate.contractId === contractId);
  if (!artifact) throw new Error(`unknown Skillset schema artifact ${contractId}`);
  return artifact;
}

export const skillsetWorkspaceJsonSchema = workspaceConfigContract.schema;
export const skillsetSourceMetadataJsonSchema = sourceMetadataContract.schema;
export const skillsetSkillFrontmatterJsonSchema = skillFrontmatterContract.schema;
export const skillsetAgentFrontmatterJsonSchema = agentFrontmatterContract.schema;
export const skillsetInstructionFrontmatterJsonSchema = instructionFrontmatterContract.schema;
export const skillsetSkillEvalJsonSchema = skillEvalContract.schema;
export const skillsetHookJsonSchema = hookContract.schema;
export const skillsetAdaptiveHookJsonSchema = adaptiveHookContract.schema;
export const skillsetChangeEntryJsonSchema = changeEntryContract.schema;
export const skillsetTestDeclarationJsonSchema = testDeclarationContract.schema;
export const skillsetCliResultJsonSchema = cliResultContract.schema;
export const skillsetCliEventJsonSchema = cliEventContract.schema;
