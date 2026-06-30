import { sortSchemaRecord } from "./json";
import type { SchemaJsonRecord, SkillsetSchemaContract } from "./types";

export const SKILLSET_SCHEMA_VERSION = "0.1.0";
export const SKILLSET_SCHEMA_URI_BASE = "https://raw.githubusercontent.com/outfitter-dev/skillset/main/docs/reference/schemas";
const SEMVER_PATTERN =
  "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9]\\d*|[A-Za-z-][0-9A-Za-z-]*))*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$";

export const TARGET_NAMES = ["claude", "codex"] as const;
export const COMPILE_BUILD_MODES = ["all", "updated"] as const;
export const UNSUPPORTED_DESTINATION_POLICIES = ["error"] as const;

export const WORKSPACE_CONFIG_KEYS = [
  "agents",
  "changes",
  "claude",
  "codex",
  "compile",
  "defaults",
  "dependencies",
  "distributions",
  "skillset",
  "supports",
  "workspace",
] as const;

export const SOURCE_METADATA_KEYS = [
  "author",
  "category",
  "description",
  "homepage",
  "keywords",
  "license",
  "manifest",
  "marketplace",
  "name",
  "origin",
  "owner",
  "outputs",
  "presentation",
  "preprocess",
  "repository",
  "schema",
  "strict",
  "summary",
  "title",
  "version",
] as const;

export const COMMON_FRONTMATTER_KEYS = [
  "allowed_tools",
  "bin",
  "claude",
  "codex",
  "dependencies",
  "description",
  "dialect",
  "hooks",
  "implicit_invocation",
  "mcp",
  "metadata",
  "model",
  "name",
  "resources",
  "schema",
  "skillset",
  "summary",
  "supports",
  "title",
  "tool_intent",
  "version",
] as const;

export const AGENT_FRONTMATTER_KEYS = [
  "claude",
  "codex",
  "description",
  "hooks",
  "initialPrompt",
  "metadata",
  "model",
  "name",
  "skillset",
  "skills",
  "supports",
] as const;

export const INSTRUCTION_FRONTMATTER_KEYS = [
  "claude",
  "codex",
  "dialect",
  "metadata",
  "name",
  "skillset",
  "supports",
] as const;

export const workspaceConfigContract = contract("workspace-config", "Workspace Config", "Skillset workspace configuration.", {
  additionalProperties: false,
  properties: {
    agents: { type: "object" },
    changes: { type: "object" },
    claude: targetOverrideSchema(),
    codex: targetOverrideSchema(),
    compile: strictObjectSchema({
      build: enumSchema(COMPILE_BUILD_MODES),
      features: strictObjectSchema({
        promptArguments: { type: "boolean" },
      }),
      skillset: strictObjectSchema({
        metadata: { type: "boolean" },
      }),
      targets: arraySchema(enumSchema(TARGET_NAMES), { minItems: 1, uniqueItems: true }),
      unsupportedDestination: enumSchema(UNSUPPORTED_DESTINATION_POLICIES),
    }),
    defaults: { type: "object" },
    dependencies: dependenciesSchema(),
    distributions: { type: "object" },
    skillset: sourceMetadataSchema(),
    supports: supportsSchema(),
    workspace: strictObjectSchema({
      cacheKey: {
        pattern: "^[a-z0-9][a-z0-9._-]*(?:--[a-z0-9][a-z0-9._-]*)*$",
        type: "string",
      },
    }),
  },
  type: "object",
});

export const sourceMetadataContract = contract("source-metadata", "Source Metadata", "Shared source metadata for workspaces, plugins, and generated attribution.", sourceMetadataSchema());

export const skillFrontmatterContract = contract("skill-frontmatter", "Skill Frontmatter", "Adaptive Skillset skill frontmatter.", {
  additionalProperties: true,
  properties: {
    allowed_tools: allowedToolsSchema(),
    bin: targetFeatureSchema(),
    claude: targetOverrideSchema(),
    codex: targetOverrideSchema(),
    dependencies: dependenciesSchema(),
    description: nonEmptyStringSchema(),
    dialect: { enum: ["claude"], type: "string" },
    implicit_invocation: implicitInvocationSchema(),
    hooks: hookAttachmentSchema(),
    mcp: targetFeatureSchema(),
    metadata: generatedMetadataSchema(),
    model: nonEmptyStringSchema(),
    name: nonEmptyStringSchema(),
    resources: resourceDeclarationSchema(),
    schema: {
      anyOf: [
        nonEmptyStringSchema(),
        { minimum: 1, type: "integer" },
      ],
    },
    skillset: sourceMetadataSchema(),
    summary: nonEmptyStringSchema(),
    supports: supportsSchema(),
    title: nonEmptyStringSchema(),
    tool_intent: { type: "object" },
    version: semverStringSchema(),
  },
  type: "object",
});

export const agentFrontmatterContract = contract("agent-frontmatter", "Agent Frontmatter", "Adaptive Skillset agent frontmatter.", {
  additionalProperties: false,
  properties: {
    claude: targetOverrideSchema(),
    codex: targetOverrideSchema(),
    description: nonEmptyStringSchema(),
    hooks: hookAttachmentSchema(),
    initialPrompt: nonEmptyStringSchema(),
    metadata: generatedMetadataSchema(),
    model: nonEmptyStringSchema(),
    name: nonEmptyStringSchema(),
    skillset: sourceMetadataSchema(),
    skills: arraySchema(nonEmptyStringSchema()),
    supports: supportsSchema(),
  },
  required: ["description"],
  type: "object",
});

export const instructionFrontmatterContract = contract("instruction-frontmatter", "Instruction Frontmatter", "Adaptive Skillset instruction/rules frontmatter.", {
  additionalProperties: true,
  properties: {
    claude: targetOverrideSchema(),
    codex: targetOverrideSchema(),
    description: nonEmptyStringSchema(),
    dialect: { enum: ["claude"], type: "string" },
    metadata: generatedMetadataSchema(),
    name: nonEmptyStringSchema(),
    paths: arraySchema(nonEmptyStringSchema()),
    skillset: sourceMetadataSchema(),
    summary: nonEmptyStringSchema(),
    supports: supportsSchema(),
    title: nonEmptyStringSchema(),
    version: semverStringSchema(),
  },
  type: "object",
});

export const hookContract = contract("hook", "Hook Definition", "Skillset hook definition source contract for aggregate hook event maps.", {
  additionalProperties: hookEventGroupsSchema(),
  properties: {
    hooks: hookEventsSchema(),
  },
  type: "object",
});

export const adaptiveHookContract = contract("adaptive-hook", "Adaptive Hook Unit", "Skillset adaptive hook unit source contract for reusable portable hooks.", {
  ...strictObjectSchema({
    claude: { type: "object" },
    context: strictObjectSchema({
      env: arraySchema(enumSchema(["hook.event", "provider", "session.id"]), { minItems: 1, uniqueItems: true }),
      includeRaw: { type: "boolean" },
      strategy: enumSchema(["inline", "none", "toolkit"]),
    }),
    codex: { type: "object" },
    description: nonEmptyStringSchema(),
    events: arraySchema(nonEmptyStringSchema(), { minItems: 1, uniqueItems: true }),
    match: {
      anyOf: [
        nonEmptyStringSchema(),
        { type: "object" },
      ],
    },
    name: nonEmptyStringSchema(),
    providers: arraySchema(enumSchema(TARGET_NAMES), { minItems: 1, uniqueItems: true }),
    run: strictObjectSchema({
      args: arraySchema(nonEmptyStringSchema()),
      command: nonEmptyStringSchema(),
      cwd: nonEmptyStringSchema(),
      env: {
        additionalProperties: { type: "string" },
        type: "object",
      },
      script: nonEmptyStringSchema(),
    }),
    status: nonEmptyStringSchema(),
  }),
  required: ["events", "run"],
});

export const changeEntryContract = contract("change-entry", "Change Entry", "Pending Skillset change entry source contract.", {
  additionalProperties: true,
  anyOf: [
    { required: ["scope"] },
    { required: ["scopes"] },
  ],
  properties: {
    bump: { enum: ["major", "minor", "none", "patch"], type: "string" },
    evidence: evidenceSchema(),
    external: { description: "Unsupported legacy issue metadata; use group instead.", type: ["array", "object", "string"] },
    group: {
      anyOf: [
        nonEmptyStringSchema(),
        {
          ...strictObjectSchema({
            id: nonEmptyStringSchema(),
            provider: nonEmptyStringSchema(),
          }),
          required: ["id"],
        },
      ],
    },
    id: { pattern: "^[0-9a-f]{12}$", type: "string" },
    ignored: { type: "boolean" },
    scope: nonEmptyStringSchema(),
    scopes: arraySchema(nonEmptyStringSchema()),
  },
  required: ["bump"],
  type: "object",
});

export const skillsetSchemaContracts = [
  workspaceConfigContract,
  sourceMetadataContract,
  skillFrontmatterContract,
  agentFrontmatterContract,
  instructionFrontmatterContract,
  hookContract,
  adaptiveHookContract,
  changeEntryContract,
] as const satisfies readonly SkillsetSchemaContract[];

export function schemaUri(id: SkillsetSchemaContract["id"], version = SKILLSET_SCHEMA_VERSION): string {
  return `${SKILLSET_SCHEMA_URI_BASE}/${version}/${id}.schema.json`;
}

function contract(
  id: SkillsetSchemaContract["id"],
  title: string,
  description: string,
  schema: SchemaJsonRecord
): SkillsetSchemaContract {
  return {
    description,
    id,
    schema: sortSchemaRecord({
      $id: schemaUri(id),
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title,
      ...schema,
    }),
    title,
    version: SKILLSET_SCHEMA_VERSION,
  };
}

function sourceMetadataSchema(): SchemaJsonRecord {
  return strictObjectSchema({
    author: { type: ["object", "string"] },
    category: { type: "string" },
    description: nonEmptyStringSchema(),
    homepage: { type: "string" },
    keywords: arraySchema({ type: "string" }),
    license: { type: "string" },
    manifest: { type: "object" },
    marketplace: { type: "object" },
    name: nonEmptyStringSchema(),
    origin: sourceOriginSchema(),
    owner: { type: "object" },
    outputs: { type: "object" },
    presentation: { type: "object" },
    preprocess: { type: "boolean" },
    repository: { type: "string" },
    schema: { const: 1, type: "integer" },
    strict: { type: "boolean" },
    summary: nonEmptyStringSchema(),
    title: nonEmptyStringSchema(),
    version: semverStringSchema(),
  });
}

function generatedMetadataSchema(): SchemaJsonRecord {
  return {
    additionalProperties: true,
    properties: {
      generated: { type: "string" },
      version: semverStringSchema(),
    },
    type: "object",
  };
}

function sourceOriginSchema(): SchemaJsonRecord {
  return {
    ...strictObjectSchema({
      path: nonEmptyStringSchema(),
      ref: nonEmptyStringSchema(),
      repo: nonEmptyStringSchema(),
    }),
    dependentRequired: {
      ref: ["repo"],
      repo: ["ref"],
    },
    required: ["path"],
  };
}

function supportsSchema(): SchemaJsonRecord {
  return {
    anyOf: [
      { type: "string" },
      arraySchema({
        anyOf: [
          { type: "string" },
          strictObjectSchema({
            name: { type: "string" },
            onMismatch: { enum: ["error", "warn"], type: "string" },
            range: { type: "string" },
            source: { type: "string" },
          }),
        ],
      }),
      {
        ...strictObjectSchema({
        packages: arraySchema({
          anyOf: [
            { type: "string" },
            strictObjectSchema({
              name: { type: "string" },
              onMismatch: { enum: ["error", "warn"], type: "string" },
              range: { type: "string" },
              source: { type: "string" },
            }),
          ],
        }),
        }),
        required: ["packages"],
      },
    ],
  };
}

function resourceDeclarationSchema(): SchemaJsonRecord {
  const resourceEntry: SchemaJsonRecord = {
    anyOf: [
      nonEmptyStringSchema(),
      strictObjectSchema({
        from: nonEmptyStringSchema(),
        to: nonEmptyStringSchema(),
      }),
    ],
  };
  return {
    anyOf: [
      nonEmptyStringSchema(),
      arraySchema(resourceEntry),
      {
        additionalProperties: {
          anyOf: [
            nonEmptyStringSchema(),
            arraySchema(resourceEntry),
          ],
        },
        type: "object",
      },
    ],
  };
}

function hookAttachmentSchema(): SchemaJsonRecord {
  const attachmentObject = strictObjectSchema({
    hook: nonEmptyStringSchema(),
    match: {
      anyOf: [
        nonEmptyStringSchema(),
        { type: "object" },
      ],
    },
    providers: arraySchema(enumSchema(TARGET_NAMES), { minItems: 1, uniqueItems: true }),
    status: nonEmptyStringSchema(),
  });
  const attachmentEntry: SchemaJsonRecord = {
    anyOf: [
      nonEmptyStringSchema(),
      attachmentObject,
    ],
  };
  return {
    additionalProperties: arraySchema(attachmentEntry),
    properties: {
      auto: arraySchema(attachmentEntry),
    },
    type: "object",
  };
}

function hookEventsSchema(): SchemaJsonRecord {
  return {
    additionalProperties: hookEventGroupsSchema(),
    type: "object",
  };
}

function hookEventGroupsSchema(): SchemaJsonRecord {
  return arraySchema(hookEventGroupSchema());
}

function hookEventGroupSchema(): SchemaJsonRecord {
  return {
    additionalProperties: true,
    properties: {
      hooks: arraySchema(hookHandlerSchema()),
      matcher: {
        anyOf: [
          nonEmptyStringSchema(),
          { type: "object" },
        ],
      },
      statusMessage: nonEmptyStringSchema(),
    },
    type: "object",
  };
}

function hookHandlerSchema(): SchemaJsonRecord {
  return {
    additionalProperties: true,
    properties: {
      agent: nonEmptyStringSchema(),
      async: { type: "boolean" },
      command: nonEmptyStringSchema(),
      prompt: nonEmptyStringSchema(),
      statusMessage: nonEmptyStringSchema(),
      timeout: { minimum: 0, type: "integer" },
      type: nonEmptyStringSchema(),
    },
    required: ["type"],
    type: "object",
  };
}

function evidenceSchema(): SchemaJsonRecord {
  const evidenceEntry = {
    additionalProperties: true,
    properties: {
      currentHash: nonEmptyStringSchema(),
      hash: nonEmptyStringSchema(),
      scope: nonEmptyStringSchema(),
      sourceHash: nonEmptyStringSchema(),
    },
    type: "object",
  } satisfies SchemaJsonRecord;
  return {
    anyOf: [
      arraySchema(evidenceEntry),
      {
        additionalProperties: {
          anyOf: [
            nonEmptyStringSchema(),
            evidenceEntry,
          ],
        },
        properties: {
          currentHash: nonEmptyStringSchema(),
          hash: nonEmptyStringSchema(),
          sourceHash: nonEmptyStringSchema(),
        },
        type: "object",
      },
    ],
  };
}

function dependenciesSchema(): SchemaJsonRecord {
  return strictObjectSchema({
    plugins: arraySchema({
      anyOf: [
        { type: "string" },
        strictObjectSchema({
          marketplace: { type: "string" },
          name: { type: "string" },
          plugin: { type: "string" },
          range: { type: "string" },
          unversioned: { type: "boolean" },
        }),
      ],
    }),
  });
}

function allowedToolsSchema(): SchemaJsonRecord {
  const value = {
    anyOf: [
      { const: false },
      nonEmptyStringSchema(),
      arraySchema(nonEmptyStringSchema(), { minItems: 1 }),
    ],
  };
  return {
    anyOf: [
      ...value.anyOf,
      strictObjectSchema({
        claude: value,
        codex: value,
      }),
    ],
  };
}

function implicitInvocationSchema(): SchemaJsonRecord {
  return {
    anyOf: [
      { type: "boolean" },
      strictObjectSchema({
        claude: { type: "boolean" },
        codex: { type: "boolean" },
      }),
    ],
  };
}

function targetFeatureSchema(): SchemaJsonRecord {
  return {
    anyOf: [
      { const: false },
      { type: "object" },
    ],
  };
}

function targetOverrideSchema(): SchemaJsonRecord {
  return {
    anyOf: [
      { type: "boolean" },
      { type: "object" },
    ],
  };
}

function semverStringSchema(): SchemaJsonRecord {
  return { pattern: SEMVER_PATTERN, type: "string" };
}

function nonEmptyStringSchema(): SchemaJsonRecord {
  return { minLength: 1, type: "string" };
}

function strictObjectSchema(properties: Record<string, SchemaJsonRecord>): SchemaJsonRecord {
  return {
    additionalProperties: false,
    properties,
    type: "object",
  };
}

function arraySchema(items: SchemaJsonRecord, extras: SchemaJsonRecord = {}): SchemaJsonRecord {
  return {
    items,
    type: "array",
    ...extras,
  };
}

function enumSchema(values: readonly string[]): SchemaJsonRecord {
  return {
    enum: [...values],
    type: "string",
  };
}
