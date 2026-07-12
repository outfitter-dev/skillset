import { sortSchemaRecord } from "./json";
import type { SchemaJsonRecord, SkillsetSchemaContract } from "./types";

export const SKILLSET_SCHEMA_VERSION = "0.1.0";
export const SKILLSET_SCHEMA_URI_BASE = "https://raw.githubusercontent.com/outfitter-dev/skillset/main/docs/reference/schemas";
export const CLI_RESULT_SCHEMA_VERSION = "skillset.cli.result@1";
export const CLI_EVENT_SCHEMA_VERSION = "skillset.cli.event@1";
const SEMVER_PATTERN =
  "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9]\\d*|[A-Za-z-][0-9A-Za-z-]*))*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$";

export const TARGET_NAMES = ["claude", "codex", "cursor"] as const;
export const DEFAULT_TARGET_NAMES = TARGET_NAMES;
export const COMPILE_BUILD_MODES = ["all", "updated"] as const;
export const UNSUPPORTED_DESTINATION_POLICIES = ["error", "warn", "skip", "force"] as const;
export const SOURCE_LICENSE_IDS = [
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
  "MPL-2.0",
] as const;
export const SOURCE_LICENSE_NONE = "none";

export const WORKSPACE_CONFIG_KEYS = [
  "agents",
  "changes",
  "claude",
  "codex",
  "cursor",
  "compile",
  "defaults",
  "dependencies",
  "distributions",
  "marketplaces",
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
  "cursor",
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
  "tools",
  "version",
] as const;

export const AGENT_FRONTMATTER_KEYS = [
  "claude",
  "codex",
  "cursor",
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
  "cursor",
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
    cursor: targetOverrideSchema(),
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
    marketplaces: marketplaceCatalogsSchema(),
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
    cursor: targetOverrideSchema(),
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
    tools: toolsPolicySchema(),
    version: semverStringSchema(),
  },
  type: "object",
});

export const agentFrontmatterContract = contract("agent-frontmatter", "Agent Frontmatter", "Adaptive Skillset agent frontmatter.", {
  additionalProperties: false,
  properties: {
    claude: targetOverrideSchema(),
    codex: targetOverrideSchema(),
    cursor: targetOverrideSchema(),
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
    cursor: targetOverrideSchema(),
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
    cursor: { type: "object" },
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

export const changeEntryContract = contract("change-entry", "Change Entry", "Compatibility-only legacy pending change-entry frontmatter contract.", {
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

export const testDeclarationContract = contract("test-declaration", "Test Declaration", "A deterministic Skillset test with optional explicit live-runtime activation assertions.", {
  additionalProperties: false,
  properties: {
    activation: arraySchema({
      additionalProperties: false,
      allOf: [
        { oneOf: [{ required: ["prompt"] }, { required: ["promptFile"] }] },
      ],
      properties: {
        expect: {
          additionalProperties: false,
          oneOf: [
            { required: ["agent"] },
            { required: ["plugin"] },
            { required: ["skill"] },
          ],
          properties: {
            agent: nonEmptyStringSchema(),
            plugin: nonEmptyStringSchema(),
            skill: nonEmptyStringSchema(),
          },
          type: "object",
        },
        name: nonEmptyStringSchema(),
        prompt: nonEmptyStringSchema(),
        promptFile: nonEmptyStringSchema(),
        runtime: {
          ...strictObjectSchema({
            claude: {
              ...strictObjectSchema({ settingSources: enumSchema(["isolated", "local", "project", "user"]) }),
              required: ["settingSources"],
            },
            expect: {
              ...strictObjectSchema({
                contains: nonEmptyStringSchema(),
                notContains: nonEmptyStringSchema(),
              }),
              anyOf: [{ required: ["contains"] }, { required: ["notContains"] }],
            },
            timeoutMs: { minimum: 1, type: "integer" },
          }),
          required: ["expect"],
        },
        targets: arraySchema(enumSchema(TARGET_NAMES), { minItems: 1, uniqueItems: true }),
      },
      required: ["expect"],
      type: "object",
    }),
    checks: {
      ...strictObjectSchema({
        files: arraySchema({
          ...strictObjectSchema({
            contains: nonEmptyStringSchema(),
            path: nonEmptyStringSchema(),
          }),
          required: ["path"],
        }, { minItems: 1 }),
        pluginManifests: { type: "boolean" },
        projection: { type: "boolean" },
      }),
      anyOf: [
        { required: ["files"] },
        { properties: { pluginManifests: { const: true } }, required: ["pluginManifests"] },
        { properties: { projection: { const: true } }, required: ["projection"] },
      ],
    },
    output: {
      ...strictObjectSchema({ kind: { const: "isolated", type: "string" } }),
    },
    select: {
      ...strictObjectSchema({
        agents: selectorSchema(),
        plugins: {
          anyOf: [
            selectorSchema(),
            {
              ...strictObjectSchema({
                include: selectorSchema(),
                skills: selectorSchema(),
              }),
              minProperties: 1,
            },
          ],
        },
        skills: {
          anyOf: [
            selectorSchema(),
            {
              ...strictObjectSchema({
                plugin: {
                  anyOf: [
                    selectorSchema(),
                    { additionalProperties: selectorSchema(), minProperties: 1, type: "object" },
                  ],
                },
                primary: selectorSchema(),
              }),
              minProperties: 1,
            },
          ],
        },
      }),
      minProperties: 1,
    },
    targets: arraySchema(enumSchema(TARGET_NAMES), { minItems: 1, uniqueItems: true }),
  },
  required: ["checks"],
  type: "object",
});

export const cliResultContract = contract("cli-result", "Skillset CLI Result", "Finite machine-readable result emitted by a Skillset CLI command.", {
  additionalProperties: false,
  properties: {
    changes: { items: { ...strictObjectSchema({ action: enumSchema(["create", "delete", "move", "update"]), path: nonEmptyStringSchema(), reason: nonEmptyStringSchema(), state: enumSchema(["planned", "refused", "skipped", "written"]) }), required: ["action", "path", "state"] }, type: "array" },
    command: nonEmptyStringSchema(),
    data: { type: "object" },
    diagnostics: { items: { ...strictObjectSchema({ code: nonEmptyStringSchema(), column: { minimum: 1, type: "integer" }, help: nonEmptyStringSchema(), line: { minimum: 1, type: "integer" }, message: nonEmptyStringSchema(), path: nonEmptyStringSchema(), severity: enumSchema(["error", "info", "warning"]) }), required: ["code", "message", "severity"] }, type: "array" },
    exitCode: { minimum: 0, type: "integer" },
    kind: nonEmptyStringSchema(),
    meta: { type: "object" },
    ok: { type: "boolean" },
    schemaVersion: { const: CLI_RESULT_SCHEMA_VERSION, type: "string" },
  },
  required: ["changes", "command", "data", "diagnostics", "exitCode", "kind", "meta", "ok", "schemaVersion"],
  type: "object",
});

export const cliEventContract = contract("cli-event", "Skillset CLI Event", "One machine-readable event in a Skillset CLI JSONL stream.", {
  additionalProperties: false,
  properties: { command: nonEmptyStringSchema(), data: { type: "object" }, event: nonEmptyStringSchema(), schemaVersion: { const: CLI_EVENT_SCHEMA_VERSION, type: "string" }, sequence: { minimum: 1, type: "integer" } },
  required: ["command", "data", "event", "schemaVersion", "sequence"],
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
  testDeclarationContract,
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
    license: enumSchema([...SOURCE_LICENSE_IDS, SOURCE_LICENSE_NONE]),
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

function marketplaceCatalogsSchema(): SchemaJsonRecord {
  return {
    additionalProperties: {
      ...strictObjectSchema({
        description: nonEmptyStringSchema(),
        plugins: arraySchema(marketplacePluginEntrySchema(), { minItems: 1 }),
        targets: arraySchema(enumSchema(TARGET_NAMES), { minItems: 1, uniqueItems: true }),
        title: nonEmptyStringSchema(),
      }),
      required: ["plugins"],
    },
    propertyNames: { pattern: "^[a-z0-9][a-z0-9._-]*$" },
    type: "object",
  };
}

function marketplacePluginEntrySchema(): SchemaJsonRecord {
  return {
    ...strictObjectSchema({
      channel: { const: "latest", type: "string" },
      id: { pattern: "^[a-z0-9][a-z0-9-]*$", type: "string" },
      plugin: { pattern: "^[a-z0-9][a-z0-9-]*$", type: "string" },
      ref: {
        pattern: "^(?!.*(?:\\.\\.|//|@\\{|\\.lock$))[A-Za-z0-9][A-Za-z0-9._/-]*(?<![./])$",
        type: "string",
      },
      repo: {
        pattern: "^(?:github:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\\.git)?|[^:@/\\s]+@[^:\\s/]+:[^\\s]+|https://(?![^/]*@)[^\\s/?#]+/[^\\s?#]+|ssh://(?:[^:@\\s]+@)?[^\\s/?#]+/[^\\s?#]+)$",
        type: "string",
      },
      sha: { pattern: "^[0-9a-f]{40}$", type: "string" },
      targets: arraySchema(enumSchema(TARGET_NAMES), { minItems: 1, uniqueItems: true }),
      version: semverStringSchema(),
    }),
    allOf: [
      ["channel", "ref"],
      ["channel", "sha"],
      ["channel", "version"],
      ["ref", "sha"],
      ["ref", "version"],
      ["sha", "version"],
    ].map((required) => ({ not: { required } })),
    required: ["plugin"],
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
        cursor: value,
      }),
    ],
  };
}

function toolsPolicySchema(): SchemaJsonRecord {
  return {
    anyOf: [
      { const: "readonly" },
      { type: "object" },
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
        cursor: { type: "boolean" },
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

function selectorSchema(): SchemaJsonRecord {
  return {
    anyOf: [
      { const: true, type: "boolean" },
      arraySchema(nonEmptyStringSchema(), { minItems: 1, uniqueItems: true }),
    ],
  };
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
