import { describe, expect, it } from "bun:test";

import {
  PROVIDER_DESTINATION_FORMAT_SNAPSHOT_SCHEMA,
  PROVIDER_SCHEMA_SNAPSHOT_SCHEMA,
  assertProviderSchemaSnapshots,
  getProviderDestinationFormatSnapshot,
  getProviderHookEvidence,
  getProviderSchemaSnapshot,
  hashProviderDestinationFormatSnapshot,
  hashProviderSchemaSnapshot,
  listProviderHookEvidence,
  listProviderDestinationFormatSnapshots,
  listProviderPluginComponentManifestFields,
  listProviderSchemaSnapshots,
  normalizeProviderDestinationFormatSnapshot,
  normalizeProviderSchemaSnapshot,
  providerDestinationFormatSnapshots,
  providerSchemaManualOverlays,
  providerSchemaSnapshots,
} from "../index";

describe("@skillset/registry snapshots", () => {
  it("exports deterministic adopted provider destination formats", () => {
    expect(listProviderDestinationFormatSnapshots()).toBe(providerDestinationFormatSnapshots);
    expect(providerDestinationFormatSnapshots.map((snapshot) => snapshot.id)).toEqual([
      "claude-hooks",
      "claude-plugin",
      "claude-skill",
      "claude-subagent",
      "codex-agents-md",
      "codex-plugin",
      "codex-skill",
      "codex-subagent",
      "cursor-agent",
      "cursor-hooks",
      "cursor-plugin",
      "cursor-rules",
      "cursor-skill",
    ]);
    expect(providerDestinationFormatSnapshots.map((snapshot) => `${snapshot.target}:${snapshot.destination}`)).toEqual([
      "claude:hooks",
      "claude:plugin",
      "claude:skill",
      "claude:agent",
      "codex:instructions",
      "codex:plugin",
      "codex:skill",
      "codex:agent",
      "cursor:agent",
      "cursor:hooks",
      "cursor:plugin",
      "cursor:instructions",
      "cursor:skill",
    ]);

    for (const snapshot of providerDestinationFormatSnapshots) {
      expect(snapshot.schema).toBe(PROVIDER_DESTINATION_FORMAT_SNAPSHOT_SCHEMA);
      expect(snapshot.provenance.fetchedAt).toMatch(/^2026-(?:06-23|08-14)T/u);
      expect(snapshot.provenance.sources.length).toBeGreaterThan(0);
      expect(snapshot.provenance.contentHash).toBe(hashProviderDestinationFormatSnapshot(snapshot));
      expect(normalizeProviderDestinationFormatSnapshot(snapshot)).toEndWith("\n");
    }
  });

  it("captures current unsupported destination facts for Codex plugin components", () => {
    const codexPlugin = getProviderDestinationFormatSnapshot("codex-plugin");
    const components = ((codexPlugin?.format as { readonly components?: readonly { readonly kind?: string; readonly status?: string }[] })?.components ?? []);

    expect(codexPlugin).toBeDefined();
    expect(() => (components as { kind: string; status: string }[]).push({ kind: "mutated", status: "native" })).toThrow();
    expect(components.some((component) => component.kind === "agents" && component.status === "unsupported")).toBe(true);
    expect(components.some((component) => component.kind === "bin" && component.status === "unsupported")).toBe(true);
  });

  it("separates Codex runtime-loader evidence from creator-preflight evidence", () => {
    const codexPlugin = getProviderDestinationFormatSnapshot("codex-plugin");
    const manifest = (codexPlugin?.format as {
      readonly manifest?: {
        readonly optionalFields?: readonly string[];
        readonly requiredFields?: readonly string[];
      };
    }).manifest;

    expect(manifest?.requiredFields).toEqual(["name"]);
    expect(manifest?.optionalFields).toEqual(
      expect.arrayContaining(["author", "hooks"])
    );
    expect(codexPlugin?.provenance.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          note: expect.stringContaining("runtime manifest parser"),
          url: expect.stringContaining("/codex-rs/core-plugins/src/manifest.rs"),
        }),
        expect.objectContaining({
          note: expect.stringContaining("runtime loader regressions"),
          url: expect.stringContaining("/codex-rs/core-plugins/src/loader_tests.rs"),
        }),
        expect.objectContaining({
          note: expect.stringContaining("plugin-creator handoff preflight"),
          url: expect.stringContaining("/plugin-creator/scripts/validate_plugin.py"),
        }),
      ])
    );
  });

  it("derives compiler-owned plugin component manifest fields from provider snapshots", () => {
    expect(listProviderPluginComponentManifestFields("claude")).toEqual([
      "agents",
      "commands",
      "experimental.monitors",
      "experimental.themes",
      "hooks",
      "lspServers",
      "mcpServers",
      "outputStyles",
      "skills",
    ]);
    expect(listProviderPluginComponentManifestFields("codex")).toEqual([
      "apps",
      "hooks",
      "mcpServers",
      "skills",
    ]);
    expect(listProviderPluginComponentManifestFields("cursor")).toEqual([
      "agents",
      "commands",
      "hooks",
      "mcpServers",
      "rules",
      "skills",
    ]);
  });
});

describe("@skillset/registry schema snapshots", () => {
  it("exports deterministic adopted provider schema snapshots", () => {
    expect(listProviderSchemaSnapshots()).toBe(providerSchemaSnapshots);
    expect(providerSchemaSnapshots.map((snapshot) => snapshot.id)).toEqual([
      "claude-keybindings-schema",
      "claude-marketplace-schema",
      "claude-plugin-manifest-schema",
      "claude-settings-schema",
      "codex-config-schema",
      "codex-hook-event-schemas",
      "codex-hooks-schema",
      "codex-skill-metadata-schema",
      "cursor-marketplace-schema",
      "cursor-plugin-schema",
    ]);
    expect(providerSchemaSnapshots.map((snapshot) => `${snapshot.target}:${snapshot.destination}`)).toEqual([
      "claude:keybindings",
      "claude:marketplace",
      "claude:plugin-manifest",
      "claude:settings",
      "codex:config",
      "codex:hook-events",
      "codex:hooks",
      "codex:skill-metadata",
      "cursor:marketplace",
      "cursor:plugin-manifest",
    ]);

    assertProviderSchemaSnapshots(providerSchemaSnapshots);
    for (const snapshot of providerSchemaSnapshots) {
      expect(snapshot.schema).toBe(PROVIDER_SCHEMA_SNAPSHOT_SCHEMA);
      expect(snapshot.provenance.fetchedAt).toMatch(/^2026-(?:06-23|08-14)T/u);
      expect(snapshot.provenance.sources.length).toBeGreaterThan(0);
      expect(snapshot.provenance.contentHash).toBe(hashProviderSchemaSnapshot(snapshot));
      expect(normalizeProviderSchemaSnapshot(snapshot)).toEndWith("\n");
    }
  });

  it("records the known schema source URLs", () => {
    const urls = new Set(providerSchemaSnapshots.flatMap((snapshot) => snapshot.provenance.sources.map((source) => source.url)));

    expect(urls).toEqual(new Set([
      "https://developers.openai.com/codex/config-schema.json",
      "https://api.github.com/repos/openai/codex/contents/codex-rs/hooks/schema/generated",
      "https://json.schemastore.org/claude-code-keybindings.json",
      "https://json.schemastore.org/claude-code-marketplace.json",
      "https://json.schemastore.org/claude-code-plugin-manifest.json",
      "https://json.schemastore.org/claude-code-settings.json",
      "https://json.schemastore.org/codex-hooks.json",
      "https://json.schemastore.org/codex-skill-metadata.json",
      "https://raw.githubusercontent.com/cursor/plugins/2a8044425c7bddf429c3bdedf3ab61e791d34d65/schemas/marketplace.schema.json",
      "https://raw.githubusercontent.com/cursor/plugins/2a8044425c7bddf429c3bdedf3ab61e791d34d65/schemas/plugin.schema.json",
    ]));
  });

  it("records Cursor schemas as immutable pinned evidence", () => {
    const marketplace = getProviderSchemaSnapshot("cursor-marketplace-schema");
    const plugin = getProviderSchemaSnapshot("cursor-plugin-schema");

    expect(marketplace?.provenance).toMatchObject({
      contentHash: "sha256:a7b7f1c5cc6f6af685d2d1d9b1787d555b20666a8826050b5b3b9fe86f2b6bf7",
      rollingLatest: false,
      sources: [{ contentHash: "sha256:1aae96a24c2796419933bc8bfe3a1255394e7199c35740b36325e0ce6dbc253d" }],
    });
    expect(marketplace?.summary).toEqual({
      definitions: ["minClientVersions", "owner", "pluginEntry", "semver"],
      id: "https://cursor.com/schemas/cursor-plugin/marketplace.json",
      properties: ["metadata", "name", "owner", "plugins"],
      required: ["name", "plugins"],
      schemaUri: "http://json-schema.org/draft-07/schema#",
      title: "Cursor Plugin Marketplace",
      topLevelType: "object",
    });
    expect(plugin?.provenance).toMatchObject({
      contentHash: "sha256:f0b6bf41741bdb523ee0571b42e577deea9eba178691b2843a4b1dafe8947396",
      rollingLatest: false,
      sources: [{ contentHash: "sha256:a393b758901803fcf5cfe0d77bda8a83e987d32c3377dfce2d9edf445af884ed" }],
    });
    expect(plugin?.summary).toEqual({
      definitions: ["author", "mcpServers", "minClientVersions", "semver", "stringOrStringArray"],
      id: "https://cursor.com/schemas/cursor-plugin/plugin.json",
      properties: [
        "agents",
        "author",
        "category",
        "commands",
        "description",
        "displayName",
        "homepage",
        "hooks",
        "keywords",
        "license",
        "logo",
        "mcpServers",
        "minClientVersions",
        "name",
        "publisher",
        "repository",
        "rules",
        "skills",
        "tags",
        "variables",
        "version",
      ],
      required: ["name"],
      schemaUri: "http://json-schema.org/draft-07/schema#",
      title: "Cursor Plugin Manifest",
      topLevelType: "object",
    });
  });

  it("captures Codex hook event schema inventory as a schema set", () => {
    const codexHookEvents = getProviderSchemaSnapshot("codex-hook-event-schemas");
    const summary = structuredClone(codexHookEvents?.summary);

    expect(codexHookEvents).toBeDefined();
    expect(summary).toMatchObject({
      schemaCount: 20,
    });
    expect(summary).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({
          name: "stop.command.input.schema.json",
          required: expect.arrayContaining(["hook_event_name", "stop_hook_active"]),
        }),
        expect.objectContaining({
          name: "pre-tool-use.command.output.schema.json",
          properties: expect.arrayContaining(["decision", "hookSpecificOutput"]),
        }),
      ]),
    });
  });

  it("documents current docs-only schema gaps as manual overlays", () => {
    expect(providerSchemaManualOverlays.map((overlay) => overlay.id)).toEqual([
      "claude-hooks-overlay",
      "claude-skill-frontmatter-overlay",
      "claude-subagent-frontmatter-overlay",
      "codex-plugin-manifest-overlay",
      "codex-subagent-toml-overlay",
      "codex-agents-md-overlay",
    ]);
    expect(providerSchemaManualOverlays).toContainEqual(expect.objectContaining({
      formatSnapshotId: "codex-plugin",
      note: expect.stringContaining("no adopted JSON Schema source"),
    }));
  });
});

describe("@skillset/registry hook evidence", () => {
  it("exports provider hook evidence for Claude overlays, Codex schemas, and Cursor docs", () => {
    expect(listProviderHookEvidence().map((evidence) => `${evidence.target}:${evidence.evidenceKind}:${evidence.providerRef}`)).toEqual([
      "claude:docs-backed-overlay:claude-hooks-overlay",
      "codex:schema-backed:codex-hooks-schema",
      "cursor:docs-backed-overlay:cursor-hooks-docs",
    ]);

    const claude = getProviderHookEvidence("claude");
    const codex = getProviderHookEvidence("codex");
    const cursor = getProviderHookEvidence("cursor");
    const claudePreToolUse = claude.events.find((event) => event.name === "PreToolUse");
    const claudeStopFailure = claude.events.find((event) => event.name === "StopFailure");
    const codexPreCompact = codex.events.find((event) => event.name === "PreCompact");
    const codexSessionStart = codex.events.find((event) => event.name === "SessionStart");
    const codexPreToolUse = codex.events.find((event) => event.name === "PreToolUse");
    const cursorBeforeSubmitPrompt = cursor.events.find((event) => event.name === "BeforeSubmitPrompt");
    const cursorSessionStart = cursor.events.find((event) => event.name === "SessionStart");

    expect(claudePreToolUse).toMatchObject({
      canBlock: true,
      evidenceKind: "docs-backed-overlay",
      matcherEvaluation: "exact-list-or-regex",
      matcherKind: "tool",
      providerRef: "claude-hooks-overlay",
    });
    expect(claudePreToolUse?.inputFields.map((field) => field.name)).toEqual(expect.arrayContaining(["tool_input", "tool_name"]));
    expect(claudePreToolUse?.outputFields).toEqual(expect.arrayContaining(["permissionDecision", "permissionDecisionReason"]));
    expect(claudeStopFailure).toMatchObject({
      outputFields: [],
      rawOutputFields: expect.arrayContaining(["continue", "stopReason", "systemMessage"]),
      runtimeNotes: ["output-and-exit-code-ignored"],
      unsupportedOutputFields: expect.arrayContaining(["continue", "stopReason", "systemMessage"]),
    });
    expect(codexPreToolUse).toMatchObject({
      canBlock: true,
      evidenceKind: "schema-backed",
      matcherEvaluation: "provider-native",
      matcherKind: "tool",
      providerRef: "codex-hook-event-schemas",
    });
    expect(codexPreToolUse?.inputFields).toEqual(expect.arrayContaining([
      { name: "cwd", required: true },
      { name: "tool_name", required: true },
    ]));
    expect(codexPreToolUse?.outputFields).toEqual(["decision", "hookSpecificOutput", "reason", "systemMessage"]);
    expect(codexPreToolUse?.rawOutputFields).toEqual(expect.arrayContaining(["continue", "decision", "hookSpecificOutput", "stopReason", "suppressOutput"]));
    expect(codexPreToolUse?.unsupportedOutputFields).toEqual(["continue", "stopReason", "suppressOutput"]);
    expect(codexPreCompact?.matcherValues).toEqual(["manual", "auto"]);
    expect(codexSessionStart?.matcherValues).toEqual(["startup", "resume", "clear", "compact"]);
    expect(cursorBeforeSubmitPrompt).toMatchObject({
      canBlock: true,
      evidenceKind: "docs-backed-overlay",
      matcherKind: "ignored",
      providerRef: "cursor-hooks-docs",
    });
    expect(cursorSessionStart?.matcherValues).toEqual(["startup", "resume", "clear", "compact"]);
    expect(cursorSessionStart?.runtimeNotes).toContain("native-event-names-are-lower-camel");
  });
});
