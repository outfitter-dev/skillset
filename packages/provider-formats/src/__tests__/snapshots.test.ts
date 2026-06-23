import { describe, expect, it } from "bun:test";

import {
  PROVIDER_DESTINATION_FORMAT_SNAPSHOT_SCHEMA,
  PROVIDER_SCHEMA_SNAPSHOT_SCHEMA,
  assertProviderSchemaSnapshots,
  getProviderDestinationFormatSnapshot,
  getProviderSchemaSnapshot,
  hashProviderDestinationFormatSnapshot,
  hashProviderSchemaSnapshot,
  listProviderDestinationFormatSnapshots,
  listProviderSchemaSnapshots,
  normalizeProviderDestinationFormatSnapshot,
  normalizeProviderSchemaSnapshot,
  providerDestinationFormatSnapshots,
  providerSchemaManualOverlays,
  providerSchemaSnapshots,
} from "../index";

describe("@skillset/provider-formats snapshots", () => {
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
    ]);

    for (const snapshot of providerDestinationFormatSnapshots) {
      expect(snapshot.schema).toBe(PROVIDER_DESTINATION_FORMAT_SNAPSHOT_SCHEMA);
      expect(snapshot.provenance.fetchedAt).toBe("2026-06-23T09:31:27-04:00");
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
});

describe("@skillset/provider-formats schema snapshots", () => {
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
    ]);

    assertProviderSchemaSnapshots(providerSchemaSnapshots);
    for (const snapshot of providerSchemaSnapshots) {
      expect(snapshot.schema).toBe(PROVIDER_SCHEMA_SNAPSHOT_SCHEMA);
      expect(snapshot.provenance.fetchedAt).toBe("2026-06-23T09:51:15-04:00");
      expect(snapshot.provenance.rollingLatest).toBe(true);
      expect(snapshot.provenance.sources.length).toBeGreaterThan(0);
      expect(snapshot.provenance.contentHash).toBe(hashProviderSchemaSnapshot(snapshot));
      expect(normalizeProviderSchemaSnapshot(snapshot)).toEndWith("\n");
    }
  });

  it("records the known rolling-latest schema source URLs", () => {
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
    ]));
  });

  it("captures Codex hook event schema inventory as a schema set", () => {
    const codexHookEvents = getProviderSchemaSnapshot("codex-hook-event-schemas");

    expect(codexHookEvents).toBeDefined();
    expect(codexHookEvents?.summary).toMatchObject({
      schemaCount: 20,
    });
    expect(codexHookEvents?.summary).toMatchObject({
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
