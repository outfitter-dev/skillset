import { describe, expect, it } from "bun:test";

import {
  PROVIDER_DESTINATION_FORMAT_SNAPSHOT_SCHEMA,
  getProviderDestinationFormatSnapshot,
  hashProviderDestinationFormatSnapshot,
  listProviderDestinationFormatSnapshots,
  normalizeProviderDestinationFormatSnapshot,
  providerDestinationFormatSnapshots,
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
    expect(codexPlugin?.format).toMatchObject({
      components: expect.arrayContaining([
        expect.objectContaining({ kind: "agents", status: "unsupported" }),
        expect.objectContaining({ kind: "bin", status: "unsupported" }),
      ]),
    });
  });
});
