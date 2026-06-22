import { describe, expect, it } from "bun:test";

import {
  SKILLSET_SCHEMA_VERSION,
  agentFrontmatterContract,
  changeEntryContract,
  instructionFrontmatterContract,
  skillFrontmatterContract,
  skillsetSchemaContracts,
  sourceMetadataContract,
  validateAgentFrontmatter,
  validateInstructionFrontmatter,
  validateSkillFrontmatter,
  validateSourceMetadata,
  validateWorkspaceConfig,
  workspaceConfigContract,
} from "../index";

describe("@skillset/schema contracts", () => {
  it("exports stable contract descriptors", () => {
    expect(SKILLSET_SCHEMA_VERSION).toBe("0.1.0");
    expect(skillsetSchemaContracts.map((contract) => contract.id)).toEqual([
      "workspace-config",
      "source-metadata",
      "skill-frontmatter",
      "agent-frontmatter",
      "instruction-frontmatter",
      "hook",
      "change-entry",
    ]);
    expect(workspaceConfigContract.schema.$id).toBe("https://schemas.skillset.dev/0.1.0/workspace-config.schema.json");
  });

  it("keeps descriptors aligned with active workspace and change contracts", () => {
    const workspaceProperties = workspaceConfigContract.schema.properties as Record<string, unknown>;
    expect(Object.keys(workspaceProperties).sort()).toEqual([
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
    ]);

    const compile = workspaceProperties.compile as { properties: Record<string, unknown> };
    expect(compile).toHaveProperty("additionalProperties", false);
    expect(compile.properties.unsupportedDestination).toEqual({
      enum: ["error"],
      type: "string",
    });
    expect(workspaceProperties.claude).toEqual({
      anyOf: [
        { type: "boolean" },
        { type: "object" },
      ],
    });
    expect(workspaceProperties.codex).toEqual(workspaceProperties.claude);

    const sourceMetadataProperties = sourceMetadataContract.schema.properties as Record<string, unknown>;
    expect(sourceMetadataProperties.schema).toEqual({
      const: 1,
      type: "integer",
    });
    expect(Object.keys(sourceMetadataProperties).sort()).toEqual([
      "author",
      "category",
      "description",
      "homepage",
      "keywords",
      "license",
      "manifest",
      "name",
      "origin",
      "outputs",
      "owner",
      "preprocess",
      "presentation",
      "repository",
      "schema",
      "strict",
      "summary",
      "title",
      "version",
    ]);

    const supports = workspaceProperties.supports as { anyOf: Array<Record<string, unknown>> };
    const objectSupports = supports.anyOf.find((variant) => variant.type === "object");
    expect(objectSupports).toMatchObject({
      additionalProperties: false,
      required: ["packages"],
    });
    const origin = sourceMetadataProperties.origin as Record<string, unknown>;
    expect(origin).toMatchObject({
      additionalProperties: false,
      dependentRequired: { ref: ["repo"], repo: ["ref"] },
      required: ["path"],
    });

    expect(skillFrontmatterContract.schema).toHaveProperty("additionalProperties", false);
    expect(agentFrontmatterContract.schema).toHaveProperty("additionalProperties", false);
    expect(instructionFrontmatterContract.schema).toHaveProperty("additionalProperties", false);

    const changeProperties = changeEntryContract.schema.properties as Record<string, unknown>;
    expect(Object.keys(changeProperties).sort()).toEqual([
      "bump",
      "evidence",
      "group",
      "id",
      "ignored",
      "scope",
      "scopes",
    ]);
    expect(changeEntryContract.schema.required).toEqual(["bump"]);
    expect(changeEntryContract.schema.anyOf).toEqual([{ required: ["scope"] }, { required: ["scopes"] }]);
  });

  it("validates workspace config structure", () => {
    const valid = validateWorkspaceConfig({
      compile: {
        build: "updated",
        features: { promptArguments: true },
        skillset: { metadata: false },
        targets: ["claude", "codex"],
        unsupportedDestination: "error",
      },
      claude: true,
      codex: { plugins: { path: "plugins-codex" } },
      skillset: {
        author: { name: "Outfitter" },
        category: "Developer Tools",
        license: "MIT",
        name: "demo",
        owner: { name: "Outfitter" },
        presentation: {
          capabilities: ["Read", "Write"],
        },
        schema: 1,
        strict: true,
        summary: "Demo workspace.",
        title: "Demo",
        version: "0.1.0",
      },
      supports: {
        packages: [
          "@acme/docs-cli >=2.4.0 <3.0.0",
          { name: "@acme/api", onMismatch: "warn", range: "^1.0.0", source: "repo:package.json" },
        ],
      },
      workspace: { cacheKey: "outfitter--skillset" },
    });

    expect(valid).toEqual({ diagnostics: [], ok: true });
  });

  it("reports invalid workspace config structure without raw schema noise", () => {
    const invalid = validateWorkspaceConfig({
      compile: {
        build: "recent",
        features: { promptArguments: "yes" },
        targets: ["claude", "claude", "gemini"],
        unsupportedDestination: "loudly",
      },
      targets: ["claude"],
      tests: true,
      workspace: { cacheKey: "Bad Key" },
    });

    expect(invalid.ok).toBe(false);
    expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toContain("schema/workspace-config/key");
    expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toContain("schema/workspace-config/targets");
    expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toContain("schema/workspace-config/compile-build");
    expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toContain("schema/workspace-config/unsupported-destination");
    expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toContain("schema/workspace-config/target-duplicate");
    expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toContain("schema/workspace-config/cache-key");
    expect(validateWorkspaceConfig({ claude: "bad" }).diagnostics).toContainEqual({
      code: "schema/workspace-config/target",
      message: "$.claude must be true, false, or an object",
      path: "$.claude",
    });
    expect(validateWorkspaceConfig({ compile: { unsupportedDestination: "skip" } }).diagnostics).toContainEqual({
      code: "schema/workspace-config/unsupported-destination",
      message: "compile.unsupportedDestination must be error",
      path: "$.compile.unsupportedDestination",
    });
    expect(validateWorkspaceConfig({ supports: {} }).diagnostics).toContainEqual({
      code: "schema/supports/packages",
      message: "supports.packages must be an array",
      path: "$.supports.packages",
    });
    expect(validateWorkspaceConfig({ supports: { tools: [] } }).diagnostics).toContainEqual({
      code: "schema/supports/key",
      message: "unsupported key tools",
      path: "$.supports.tools",
    });
  });

  it("validates shared source metadata and frontmatter", () => {
    expect(validateSourceMetadata({
      author: { name: "Outfitter" },
      category: "Developer Tools",
      homepage: "https://example.com",
      keywords: ["docs", "agents"],
      license: "Apache-2.0",
      manifest: {},
      name: "demo",
      origin: { path: "skills/demo/SKILL.md" },
      outputs: {},
      owner: { name: "Outfitter" },
      presentation: { capabilities: ["Read"] },
      preprocess: false,
      repository: "https://github.com/example/demo",
      schema: 1,
      strict: true,
      summary: "Demo metadata.",
      title: "Demo",
      version: "1.0.0",
    }).ok).toBe(true);
    expect(validateSourceMetadata({ schema: "schema@0.1.0" }).diagnostics).toContainEqual({
      code: "schema/source-metadata/schema",
      message: "$.schema must be a positive integer",
      path: "$.schema",
    });
    expect(validateSourceMetadata({ schema: 0 }).diagnostics).toContainEqual({
      code: "schema/source-metadata/schema",
      message: "$.schema must be a positive integer",
      path: "$.schema",
    });
    expect(validateSourceMetadata({ schema: 2 }).diagnostics).toContainEqual({
      code: "schema/source-metadata/schema",
      message: "$.schema must be 1",
      path: "$.schema",
    });
    expect(validateSourceMetadata({ version: 1 }).diagnostics).toContainEqual({
      code: "schema/source-metadata/version",
      message: "$.version must be a semantic version string",
      path: "$.version",
    });
    expect(validateSourceMetadata({ origin: { path: "x", repo: "https://example.com/repo.git" } }).diagnostics).toContainEqual({
      code: "schema/source-metadata/origin",
      message: "$.origin must set repo and ref together",
      path: "$.origin",
    });
    expect(validateSourceMetadata({
      author: 1,
      homepage: true,
      manifest: "bad",
      origin: { path: "" },
      owner: "bad",
      outputs: "bad",
      presentation: "bad",
      preprocess: "no",
      repository: 2,
      strict: "yes",
    }).diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "schema/source-metadata/author",
      "schema/source-metadata/homepage",
      "schema/source-metadata/manifest",
      "schema/source-metadata/origin",
      "schema/source-metadata/owner",
      "schema/source-metadata/outputs",
      "schema/source-metadata/presentation",
      "schema/source-metadata/preprocess",
      "schema/source-metadata/repository",
      "schema/source-metadata/strict",
    ]));

    expect(validateSkillFrontmatter({
      allowed_tools: ["Read", "Write"],
      bin: false,
      dependencies: { plugins: ["plugin:base"] },
      description: "Demo skill.",
      implicit_invocation: true,
      mcp: { source: "repo:.mcp.json" },
      metadata: { generated: "skillset@0.1.0", version: "1.0.0" },
      model: "gpt-5.4",
      name: "demo",
      resources: {},
      schema: "schema@0.1.0",
      supports: "@acme/docs-cli ^2.4.0",
      title: "Demo Skill",
      tool_intent: { allow: { read: true } },
      version: "1.0.0",
    }).ok).toBe(true);

    expect(validateAgentFrontmatter({
      description: "Demo agent.",
      initialPrompt: "{{partials.prompts.demo}}",
      model: "sonnet",
      name: "demo",
      skillset: { origin: { path: "agents/demo.md" } },
      skills: ["demo"],
    }).ok).toBe(true);

    expect(validateInstructionFrontmatter({
      dialect: "claude",
      name: "root",
      skillset: { origin: { path: "CLAUDE.md" } },
    }).ok).toBe(true);
  });

  it("reports invalid frontmatter fields", () => {
    const skillDiagnostics = validateSkillFrontmatter({
      allowed_tools: true,
      bin: "bad",
      claude: "bad",
      dependencies: "bad",
      description: "",
      mcp: "bad",
      metadata: "bad",
      model: 1,
      resources: "bad",
      schema: 1,
      targets: ["claude"],
      title: 1,
      tool_intent: "bad",
      version: 1,
    }).diagnostics;
    expect(skillDiagnostics).toContainEqual({
      code: "schema/skill-frontmatter/key",
      message: "unsupported key targets",
      path: "$.targets",
    });
    expect(skillDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "schema/skill-frontmatter/allowed-tools",
      "schema/skill-frontmatter/bin",
      "schema/skill-frontmatter/dependencies",
      "schema/skill-frontmatter/description",
      "schema/skill-frontmatter/mcp",
      "schema/skill-frontmatter/metadata",
      "schema/skill-frontmatter/model",
      "schema/skill-frontmatter/resources",
      "schema/skill-frontmatter/schema",
      "schema/skill-frontmatter/target",
      "schema/skill-frontmatter/title",
      "schema/skill-frontmatter/tool-intent",
      "schema/skill-frontmatter/version",
    ]));
    expect(validateSkillFrontmatter({ dependencies: { plugins: [{ name: 1, unknown: true }] } }).diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "schema/skill-frontmatter/dependencies-name",
      "schema/skill-frontmatter/dependencies-plugin-key",
    ]));
    expect(validateSkillFrontmatter({ metadata: { generated: 1, version: "nope", extra: true } }).diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "schema/skill-frontmatter/metadata-generated",
      "schema/skill-frontmatter/metadata-key",
      "schema/skill-frontmatter/metadata-version",
    ]));
    expect(validateSkillFrontmatter({ allowed_tools: "" }).diagnostics).toContainEqual({
      code: "schema/skill-frontmatter/allowed-tools",
      message: "$.allowed_tools must be a non-empty string",
      path: "$.allowed_tools",
    });
    expect(validateSkillFrontmatter({ allowed_tools: { claude: "" } }).diagnostics).toContainEqual({
      code: "schema/skill-frontmatter/allowed-tools",
      message: "$.allowed_tools.claude must be a non-empty string",
      path: "$.allowed_tools.claude",
    });
    expect(validateSkillFrontmatter({ allowed_tools: [] }).diagnostics).toContainEqual({
      code: "schema/skill-frontmatter/allowed-tools",
      message: "$.allowed_tools must be false, a string, a string array, or a target map",
      path: "$.allowed_tools",
    });
    expect(validateSkillFrontmatter({ allowed_tools: { claude: [] } }).diagnostics).toContainEqual({
      code: "schema/skill-frontmatter/allowed-tools",
      message: "$.allowed_tools.claude must be false, a string, or a string array",
      path: "$.allowed_tools.claude",
    });
    expect(validateAgentFrontmatter({ claude: "bad", description: "", initialPrompt: "", name: "missing-description", skills: ["one", ""] }).diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "schema/agent-frontmatter/description",
      "schema/agent-frontmatter/initialPrompt",
      "schema/agent-frontmatter/skills",
      "schema/agent-frontmatter/target",
    ]));
    expect(validateAgentFrontmatter({ name: "missing-description", skills: ["one", 2] }).diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "schema/agent-frontmatter/description",
      "schema/agent-frontmatter/skills",
    ]);
    expect(validateInstructionFrontmatter({ dialect: "codex" }).diagnostics).toContainEqual({
      code: "schema/instruction-frontmatter/dialect",
      message: "$.dialect must be claude when present",
      path: "$.dialect",
    });
  });
});
