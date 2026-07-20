import { describe, expect, it } from "bun:test";

import {
  SKILLSET_SCHEMA_VERSION,
  agentFrontmatterContract,
  adaptiveHookContract,
  changeEntryContract,
  deriveSkillsetExampleArtifacts,
  deriveSkillsetJsonSchemaArtifacts,
  instructionFrontmatterContract,
  PLUGIN_CONFIG_KEYS,
  ROOT_SOURCE_MANIFEST_KEYS,
  SINGLE_FILE_ROOT_CONFIG_KEYS,
  SPLIT_WORKSPACE_CONFIG_KEYS,
  skillFrontmatterContract,
  skillsetSchemaContracts,
  sourceMetadataContract,
  validateAgentFrontmatter,
  validateAdaptiveHookUnitSource,
  validateChangeEntryFrontmatter,
  validateHookDefinitionSource,
  validateHookAttachmentsSource,
  validateInstructionFrontmatter,
  validatePluginConfig,
  validateRootSourceManifest,
  validateSkillFrontmatter,
  validateSingleFileRootConfig,
  validateSourceMetadata,
  validateSplitWorkspaceConfig,
  validateTestDeclaration,
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
      "adaptive-hook",
      "change-entry",
      "test-declaration",
    ]);
    expect(workspaceConfigContract.schema.$id).toBe("https://raw.githubusercontent.com/outfitter-dev/skillset/main/docs/reference/schemas/0.1.0/workspace-config.schema.json");
    expect(adaptiveHookContract.schema.$id).toBe("https://raw.githubusercontent.com/outfitter-dev/skillset/main/docs/reference/schemas/0.1.0/adaptive-hook.schema.json");
  });

  it("derives deterministic JSON Schema artifacts", () => {
    const artifacts = deriveSkillsetJsonSchemaArtifacts();
    expect(artifacts.map((artifact) => artifact.path)).toEqual([
      "docs/reference/schemas/0.1.0/skillset.schema.json",
      "docs/reference/schemas/0.1.0/workspace-config.schema.json",
      "docs/reference/schemas/0.1.0/source-metadata.schema.json",
      "docs/reference/schemas/0.1.0/skill-frontmatter.schema.json",
      "docs/reference/schemas/0.1.0/agent-frontmatter.schema.json",
      "docs/reference/schemas/0.1.0/instruction-frontmatter.schema.json",
      "docs/reference/schemas/0.1.0/hook.schema.json",
      "docs/reference/schemas/0.1.0/adaptive-hook.schema.json",
      "docs/reference/schemas/0.1.0/change-entry.schema.json",
      "docs/reference/schemas/0.1.0/test-declaration.schema.json",
      "docs/reference/schemas/0.1.0/cli-result.schema.json",
      "docs/reference/schemas/0.1.0/cli-event.schema.json",
    ]);

    const combined = artifacts[0]?.schema;
    expect(combined).toMatchObject({
      $id: "https://raw.githubusercontent.com/outfitter-dev/skillset/main/docs/reference/schemas/0.1.0/skillset.schema.json",
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Skillset Source Contracts",
    });
    expect(combined?.oneOf).toEqual([
      { $ref: "#/$defs/workspace-config" },
      { $ref: "#/$defs/source-metadata" },
      { $ref: "#/$defs/skill-frontmatter" },
      { $ref: "#/$defs/agent-frontmatter" },
      { $ref: "#/$defs/instruction-frontmatter" },
      { $ref: "#/$defs/hook" },
      { $ref: "#/$defs/adaptive-hook" },
      { $ref: "#/$defs/change-entry" },
      { $ref: "#/$defs/test-declaration" },
    ]);
    const defs = combined?.$defs as Record<string, Record<string, unknown>>;
    expect(Object.keys(defs).sort()).toEqual([
      "adaptive-hook",
      "agent-frontmatter",
      "change-entry",
      "hook",
      "instruction-frontmatter",
      "skill-frontmatter",
      "source-metadata",
      "test-declaration",
      "workspace-config",
    ]);
    expect(defs["workspace-config"]).not.toHaveProperty("$id");
    expect(defs["workspace-config"]).not.toHaveProperty("$schema");
  });

  it("derives maximal examples that validate against structural contracts", () => {
    const examples = deriveSkillsetExampleArtifacts();
    expect(examples.map((example) => example.path)).toEqual([
      "docs/reference/examples/workspace-config.yaml",
      "docs/reference/examples/source-metadata.yaml",
      "docs/reference/examples/skill-frontmatter.yaml",
      "docs/reference/examples/agent-frontmatter.yaml",
      "docs/reference/examples/instruction-frontmatter.yaml",
      "docs/reference/examples/hook.yaml",
      "docs/reference/examples/adaptive-hook.yaml",
      "docs/reference/examples/change-entry.yaml",
      "docs/reference/examples/test-declaration.yaml",
    ]);

    const byId = Object.fromEntries(examples.map((example) => [example.contractId, example.value]));
    expect(validateWorkspaceConfig(byId["workspace-config"]).diagnostics).toEqual([]);
    expect(validateSourceMetadata(byId["source-metadata"]).diagnostics).toEqual([]);
    expect(validateSkillFrontmatter(byId["skill-frontmatter"]).diagnostics).toEqual([]);
    expect(validateAgentFrontmatter(byId["agent-frontmatter"]).diagnostics).toEqual([]);
    expect(validateInstructionFrontmatter(byId["instruction-frontmatter"]).diagnostics).toEqual([]);
    expect(validateHookDefinitionSource(byId.hook).diagnostics).toEqual([]);
    expect(validateAdaptiveHookUnitSource(byId["adaptive-hook"]).diagnostics).toEqual([]);
    expect(validateChangeEntryFrontmatter(byId["change-entry"]).diagnostics).toEqual([]);
  });

  it("keeps descriptors aligned with active workspace and change contracts", () => {
    const workspaceProperties = workspaceConfigContract.schema.properties as Record<string, unknown>;
    expect(Object.keys(workspaceProperties).sort()).toEqual([
      "agents",
      "changes",
      "claude",
      "codex",
      "compile",
      "cursor",
      "defaults",
      "dependencies",
      "distributions",
      "marketplaces",
      "skillset",
      "supports",
      "workspace",
    ]);

    const compile = workspaceProperties.compile as { properties: Record<string, unknown> };
    expect(compile).toHaveProperty("additionalProperties", false);
    expect(compile.properties.unsupportedDestination).toEqual({
      enum: ["error", "warn", "skip", "force"],
      type: "string",
    });
    expect(workspaceProperties.claude).toEqual({
      anyOf: [
        { type: "boolean" },
        { type: "object" },
      ],
    });
    expect(workspaceProperties.codex).toEqual(workspaceProperties.claude);
    expect(workspaceProperties.cursor).toEqual(workspaceProperties.claude);

    const sourceMetadataProperties = sourceMetadataContract.schema.properties as Record<string, unknown>;
    expect(sourceMetadataProperties.schema).toEqual({
      const: 1,
      type: "integer",
    });
    expect(sourceMetadataProperties.license).toEqual({
      enum: ["Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MIT", "MPL-2.0", "none"],
      type: "string",
    });
    expect(Object.keys(sourceMetadataProperties).sort()).toEqual([
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
    const marketplaces = workspaceProperties.marketplaces as Record<string, unknown>;
    expect(marketplaces).toMatchObject({
      propertyNames: { pattern: "^[a-z0-9][a-z0-9._-]*$" },
      type: "object",
    });
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

    expect(skillFrontmatterContract.schema).toHaveProperty("additionalProperties", true);
    expect(agentFrontmatterContract.schema).toHaveProperty("additionalProperties", false);
    expect(instructionFrontmatterContract.schema).toHaveProperty("additionalProperties", true);

    const changeProperties = changeEntryContract.schema.properties as Record<string, unknown>;
    expect(Object.keys(changeProperties).sort()).toEqual([
      "bump",
      "evidence",
      "external",
      "group",
      "id",
      "ignored",
      "scope",
      "scopes",
    ]);
    expect(changeEntryContract.schema.required).toEqual(["bump"]);
    expect(changeEntryContract.schema.anyOf).toEqual([{ required: ["scope"] }, { required: ["scopes"] }]);
    expect(changeProperties.scope).toEqual({ minLength: 1, type: "string" });
    expect(changeProperties.scopes).toEqual({
      items: { minLength: 1, type: "string" },
      type: "array",
    });
    expect(changeProperties.group).toMatchObject({
      anyOf: [
        { minLength: 1, type: "string" },
        { required: ["id"] },
      ],
    });
  });

  it("validates adaptive hook unit source", () => {
    expect(validateAdaptiveHookUnitSource({
      events: ["PreToolUse"],
      match: { tool: ["Bash"] },
      providers: ["claude", "codex"],
      context: {
        env: ["provider", "hook.event", "session.id"],
        strategy: "inline",
      },
      run: {
        args: ["--check"],
        env: { HOOK: "shell-policy" },
        script: "./check.js",
      },
      status: "Checking command",
    }).diagnostics).toEqual([]);

    expect(validateAdaptiveHookUnitSource({
      claude: {
        context: null,
        events: ["PreToolUse"],
        match: null,
        run: { command: "echo claude" },
      },
      events: ["SessionStart"],
      providers: ["claude"],
      run: { command: "echo base" },
    }).diagnostics).toEqual([]);

    expect(validateAdaptiveHookUnitSource({
      claude: {
        description: "not an override field",
        events: [],
        match: 1,
        run: { env: { INVALID: 1 } },
      },
      events: ["SessionStart"],
      providers: ["codex"],
      run: { command: "echo base" },
    }).diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "schema/adaptive-hook/provider-override-key",
      "schema/adaptive-hook/provider-override-provider",
      "schema/adaptive-hook/events",
      "schema/adaptive-hook/match",
      "schema/adaptive-hook/run-env",
      "schema/adaptive-hook/run-handler",
    ]));

    expect(validateAdaptiveHookUnitSource({
      events: ["PreToolUse", "PreToolUse", ""],
      providers: ["claude", "bad", "claude"],
      context: {
        env: ["provider", "unknown", "provider"],
        strategy: "later",
      },
      run: {
        args: ["ok", 1],
        command: "",
        cwd: "../outside",
        env: { OK: 1 },
        script: "/tmp/check.js",
      },
    }).diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "schema/adaptive-hook/events",
      "schema/adaptive-hook/events-duplicate",
      "schema/adaptive-hook/providers",
      "schema/adaptive-hook/providers-duplicate",
      "schema/adaptive-hook/context-strategy",
      "schema/adaptive-hook/context-env",
      "schema/adaptive-hook/context-env-duplicate",
      "schema/adaptive-hook/run-args",
      "schema/adaptive-hook/run-command",
      "schema/adaptive-hook/run-env",
      "schema/adaptive-hook/path",
      "schema/adaptive-hook/runtime-path-proof",
    ]));
  });

  it("validates reusable adaptive hook attachments", () => {
    expect(validateHookAttachmentsSource({
      auto: [{ hook: "shell-policy", providers: ["claude", "codex"] }],
    }).diagnostics).toEqual([]);
    expect(validateHookAttachmentsSource({
      auto: [{ hook: "", providers: ["bad"] }],
    }).diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "schema/hook-attachments",
      "schema/hook-attachments",
    ]);
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
      codex: { plugins: { path: "generated/codex" } },
      skillset: {
        author: { name: "Outfitter" },
        category: "Developer Tools",
        license: "MIT",
        marketplace: { name: "demo-market" },
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

  it("owns distinct root, split workspace, source manifest, and plugin key contracts", () => {
    expect(SINGLE_FILE_ROOT_CONFIG_KEYS).toEqual([
      "agents", "changes", "claude", "codex", "cursor", "defaults", "dependencies",
      "skillset", "supports", "compile", "distributions", "marketplaces", "workspace",
    ]);
    expect(SPLIT_WORKSPACE_CONFIG_KEYS).toEqual([
      "agents", "changes", "claude", "codex", "cursor", "compile", "defaults",
      "dependencies", "distributions", "marketplaces", "workspace",
    ]);
    expect(ROOT_SOURCE_MANIFEST_KEYS).toEqual(["dependencies", "skillset", "supports"]);
    expect(PLUGIN_CONFIG_KEYS).toEqual([
      "agents", "changes", "claude", "codex", "cursor", "defaults", "dependencies",
      "skillset", "supports", "bin", "hooks", "mcp",
    ]);

    expect(validateSingleFileRootConfig({
      compile: { targets: ["cursor"] },
      skillset: { name: "root" },
      supports: ["bun >=1.0.0"],
    }).diagnostics).toEqual([]);
    expect(validateSplitWorkspaceConfig({ skillset: { name: "wrong-context" } }).diagnostics).toContainEqual({
      code: "schema/split-workspace-config/key",
      message: "unsupported key skillset",
      path: "$.skillset",
    });
    expect(validateRootSourceManifest({ skillset: { name: "root" }, supports: [] }).diagnostics).toEqual([]);
    expect(validateRootSourceManifest({ compile: { targets: ["claude"] } }).diagnostics).toContainEqual({
      code: "schema/root-source-manifest/key",
      message: "unsupported key compile",
      path: "$.compile",
    });
    expect(validatePluginConfig({ bin: true, hooks: { Stop: ["shell-policy"] }, mcp: true, skillset: { name: "demo" } }).diagnostics).toEqual([]);
    expect(validatePluginConfig({ compile: {} }).diagnostics).toContainEqual({
      code: "schema/plugin-config/key",
      message: "unsupported key compile",
      path: "$.compile",
    });
  });

  it("validates declared runtime test structure", () => {
    expect(validateTestDeclaration({
      activation: [{
        expect: { skill: "demo" },
        prompt: "Inspect demo.",
        runtime: { expect: { contains: "demo" }, timeoutMs: 30_000 },
        targets: ["codex"],
      }],
      checks: { projection: true },
    }).diagnostics).toEqual([]);
    expect(validateTestDeclaration({
      activation: [{
        expect: { skill: "demo" },
        promptFile: "../outside.md",
        runtime: { expect: {}, timeoutMs: 0 },
      }],
      checks: { projection: true },
    }).diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "schema/test-declaration/prompt-file",
      "schema/test-declaration/runtime-expect",
      "schema/test-declaration/runtime-timeout",
    ]);
    expect(validateTestDeclaration({
      checks: { projection: true },
      output: { kind: "isolated" },
    }).diagnostics).toContainEqual({
      code: "schema/test-declaration/key",
      message: "unsupported key output",
      path: "$.output",
    });
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
    expect(validateWorkspaceConfig({ compile: { unsupportedDestination: "skip" } }).diagnostics).toEqual([]);
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

  it("keeps marketplace repository and revision policy structurally safe", () => {
    expect(validateWorkspaceConfig({
      marketplaces: {
        outfitter: {
          plugins: [
            { plugin: "github", repo: "github:outfitter-dev/skillset", sha: "a".repeat(40) },
            { plugin: "https", ref: "release/1.0", repo: "https://git.example:8443/acme/plugin.git" },
            { plugin: "ssh", repo: "ssh://git@git.example/acme/plugin.git", version: "1.2.3" },
            { channel: "latest", plugin: "scp", repo: "git@git.example:acme/plugin.git" },
          ],
        },
      },
    }).diagnostics).toEqual([]);

    const invalid = validateWorkspaceConfig({
      marketplaces: {
        outfitter: {
          plugins: [
            {
              channel: "nightly",
              plugin: "bad",
              ref: "../main",
              repo: "https://user:SENTINEL@git.example:443/acme/plugin.git",
              sha: "deadbeef",
              version: "next",
            },
          ],
        },
      },
    });
    expect(invalid.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "schema/workspace-config/marketplace-plugin-channel",
      "schema/workspace-config/marketplace-plugin-policy",
      "schema/workspace-config/marketplace-plugin-ref",
      "schema/workspace-config/marketplace-plugin-repo",
      "schema/workspace-config/marketplace-plugin-sha",
      "schema/workspace-config/marketplace-plugin-version",
    ]));
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
    expect(validateSourceMetadata({ license: "GPL-3.0-only" }).diagnostics).toContainEqual({
      code: "schema/source-metadata/license",
      message: "$.license must be one of Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MIT, MPL-2.0, none",
      path: "$.license",
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
      hooks: {
        PreToolUse: ["shell-policy"],
        Stop: [
          {
            hook: "source-change-guard",
            match: { tool: ["Bash"] },
            providers: ["claude", "codex"],
            status: "Checking shell changes",
          },
        ],
        auto: ["session-metadata"],
      },
      implicit_invocation: true,
      mcp: { source: "repo:.mcp.json" },
      metadata: { generated: "skillset@0.1.0", version: "1.0.0" },
      model: "gpt-5.4",
      name: "demo",
      resources: {},
      schema: "schema@0.1.0",
      supports: "@acme/docs-cli ^2.4.0",
      title: "Demo Skill",
      tools: { read: true, search: true, write: false },
      version: "1.0.0",
    }).ok).toBe(true);

    expect(validateAgentFrontmatter({
      description: "Demo agent.",
      hooks: { auto: ["session-metadata"] },
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
      dialect: "codex",
      targets: ["claude"],
      title: 1,
      tool_intent: "bad",
      tools: {
        allow: ["Read"],
        mcp: {
          "*": true,
        },
        read: "bad",
      },
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
      "schema/skill-frontmatter/dialect",
      "schema/skill-frontmatter/mcp",
      "schema/skill-frontmatter/metadata",
      "schema/skill-frontmatter/model",
      "schema/skill-frontmatter/target",
      "schema/skill-frontmatter/title",
      "schema/skill-frontmatter/tool-intent-retired",
      "schema/skill-frontmatter/tools-bool",
      "schema/skill-frontmatter/tools-key",
      "schema/skill-frontmatter/tools-mcp-server",
      "schema/skill-frontmatter/tools-native",
      "schema/skill-frontmatter/version",
    ]));
    expect(validateSkillFrontmatter({
      hooks: {
        "": [""],
        PreToolUse: [
          "",
          { hook: "", match: "", providers: ["claude", "bad", "claude"], status: "" },
          { hook: "ok", unknown: true },
        ],
        Stop: "bad",
      },
    }).diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "schema/skill-frontmatter/hooks",
      "schema/skill-frontmatter/hooks-duplicate",
      "schema/skill-frontmatter/hooks-key",
    ]));
    expect(validateSkillFrontmatter({ dependencies: { plugins: [{ name: 1, unknown: true }] } }).diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "schema/skill-frontmatter/dependencies-name",
      "schema/skill-frontmatter/dependencies-plugin-key",
    ]));
    expect(validateSkillFrontmatter({ metadata: { generated: 1, version: "nope", extra: true } }).diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "schema/skill-frontmatter/metadata-generated",
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
    expect(validateAgentFrontmatter({ description: "Demo agent.", hooks: { auto: [{ hook: "", providers: [] }] } }).diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "schema/agent-frontmatter/hooks",
    ]));
    expect(validateAgentFrontmatter({ name: "missing-description", skills: ["one", 2] }).diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "schema/agent-frontmatter/description",
      "schema/agent-frontmatter/skills",
    ]);
    expect(validateSkillFrontmatter({ arbitrary_context: { count: 2 }, schema: 1 }).diagnostics).toEqual([]);
    expect(validateInstructionFrontmatter({ dialect: "codex" }).diagnostics).toContainEqual({
      code: "schema/instruction-frontmatter/dialect",
      message: "$.dialect must be claude when present",
      path: "$.dialect",
    });
    expect(validateInstructionFrontmatter({ paths: [1] }).diagnostics).toContainEqual({
      code: "schema/instruction-frontmatter/paths",
      message: "$.paths entries must be strings",
      path: "$.paths[0]",
    });
    expect(validateInstructionFrontmatter({ codex: { mode: "symlink" } }).diagnostics).toContainEqual({
      code: "schema/instruction-frontmatter/codex-mode",
      message: "Codex instruction mode symlink is unsupported; use codex: true or codex: false",
      path: "$.codex.mode",
    });
    expect(validateHookDefinitionSource({
      hooks: {
        Stop: [{ hooks: [{ type: "" }, "bad"] }],
        SessionStart: { hooks: [] },
      },
    }).diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "schema/hook/event",
      "schema/hook/handler",
      "schema/hook/handler-type",
    ]));
    expect(validateChangeEntryFrontmatter({
      bump: "oops",
      external: ["SET-185"],
      group: { provider: 1 },
      id: "ABC",
      ignored: "yes",
      scopes: [1],
    }).diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "schema/change-entry/bump",
      "schema/change-entry/external",
      "schema/change-entry/group",
      "schema/change-entry/group-provider",
      "schema/change-entry/id",
      "schema/change-entry/ignored",
      "schema/change-entry/scopes",
    ]));
  });
});
