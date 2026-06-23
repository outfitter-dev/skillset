import { describe, expect, it } from "bun:test";

import {
  assertProviderFormatMigrations,
  defineProviderFormatMigrations,
  listProviderFormatMigrations,
  PROVIDER_FORMAT_MIGRATION_SAFETY_VALUES,
  providerFormatMigrations,
  selectProviderFormatMigration,
  type ProviderFormatMigrationEntry,
} from "../index";

describe("@skillset/provider-formats migrations", () => {
  it("defines the destination-format update classifications", () => {
    expect(PROVIDER_FORMAT_MIGRATION_SAFETY_VALUES).toEqual([
      "compatible",
      "adapter-only",
      "source-migration",
      "unsupported-drift",
      "manual-review",
    ]);
  });

  it("exports deterministic safe update registry entries", () => {
    expect(listProviderFormatMigrations()).toBe(providerFormatMigrations);
    expect(providerFormatMigrations.map((entry) => entry.id)).toEqual([
      "claude-skill-2026-06-23-compatible",
      "codex-plugin-component-paths-adapter-update",
      "codex-subagent-toml-manual-review",
    ]);
    expect(providerFormatMigrations.map((entry) => `${entry.provider}:${entry.surface}:${entry.safety}`)).toEqual([
      "claude:skill:compatible",
      "codex:plugin:adapter-only",
      "codex:agent:manual-review",
    ]);
  });

  it("selects compatible no-op and mechanical safe updates", () => {
    const compatible = selectProviderFormatMigration({
      from: "2026-06-23T09:31:27-04:00",
      provider: "claude",
      snapshotId: "claude-skill",
      surface: "skill",
      to: "2026-06-23T09:31:27-04:00",
    });

    expect(compatible).toMatchObject({
      entry: {
        previewable: true,
        requiresConfirmation: false,
        safe: true,
        safety: "compatible",
        updatePath: "none",
      },
      kind: "matched",
    });

    const mechanical = selectProviderFormatMigration({
      from: "2026-06-23T09:31:27-04:00",
      provider: "codex",
      snapshotId: "codex-plugin",
      surface: "plugin",
      to: "2026-06-23T09:31:27-04:00+adapter-paths",
    });

    expect(mechanical).toMatchObject({
      entry: {
        previewable: true,
        requiresConfirmation: false,
        safe: true,
        safety: "adapter-only",
        sourcePreserving: true,
        updatePath: "adapter",
      },
      kind: "matched",
    });
  });

  it("routes unsupported drift to manual review instead of a rewrite", () => {
    const selection = selectProviderFormatMigration({
      from: "2026-06-23T09:31:27-04:00",
      provider: "codex",
      snapshotId: "codex-skill",
      surface: "skill",
      to: "unreviewed-upstream-change",
    });

    expect(selection).toEqual({
      kind: "manual-review",
      previewable: false,
      reason: "No safe migration is registered for codex skill from 2026-06-23T09:31:27-04:00 to unreviewed-upstream-change.",
      requiresConfirmation: true,
      safe: false,
      safety: "manual-review",
      sourcePreserving: true,
      updatePath: "manual",
    });
  });

  it("guards contradictory registry entries", () => {
    const validManualReview = providerFormatMigrations.find((entry) => entry.id === "codex-subagent-toml-manual-review");

    expect(validManualReview).toMatchObject({
      previewable: true,
      requiresConfirmation: true,
      safe: false,
      safety: "manual-review",
      updatePath: "manual",
    });
    expect(() =>
      defineProviderFormatMigrations([
        {
          ...entryFixture,
          id: "bad-compatible-rewrite",
          safety: "compatible",
          updatePath: "source",
        },
      ])
    ).toThrow("compatible provider format migration bad-compatible-rewrite must not rewrite anything");
    expect(() =>
      assertProviderFormatMigrations([
        {
          ...entryFixture,
          appliesTo: ["claude-skill"],
          id: "bad-snapshot-surface",
        },
      ])
    ).toThrow("provider format migration bad-snapshot-surface snapshot claude-skill is claude:skill, not codex:plugin");
    expect(() =>
      assertProviderFormatMigrations([
        entryFixture,
        {
          ...entryFixture,
          id: "duplicate-selection",
        },
      ])
    ).toThrow("duplicate provider format migration selection key for codex plugin codex-plugin from -> to");
    expect(() =>
      assertProviderFormatMigrations([
        {
          ...entryFixture,
          id: "bad-safe-manual-review",
          safe: true,
          safety: "manual-review",
        },
      ])
    ).toThrow("manual provider format migration bad-safe-manual-review must be unsafe, confirmation-required, and manual-scoped");
    expect(() =>
      assertProviderFormatMigrations([
        {
          ...entryFixture,
          id: "bad-safe-without-preview",
          previewable: false,
        },
      ])
    ).toThrow("adapter-only provider format migration bad-safe-without-preview must be safe, previewable, source-preserving, confirmation-free, and adapter-scoped");
    expect(() =>
      assertProviderFormatMigrations([
        {
          ...entryFixture,
          id: "bad-adapter-source-path",
          updatePath: "source",
        },
      ])
    ).toThrow("adapter-only provider format migration bad-adapter-source-path must be safe, previewable, source-preserving, confirmation-free, and adapter-scoped");
    expect(() =>
      assertProviderFormatMigrations([
        {
          ...entryFixture,
          id: "bad-manual-auto-safe",
          requiresConfirmation: false,
          safe: true,
          safety: "unsupported-drift",
          updatePath: "adapter",
        },
      ])
    ).toThrow("manual provider format migration bad-manual-auto-safe must be unsafe, confirmation-required, and manual-scoped");
    expect(() =>
      assertProviderFormatMigrations([
        {
          ...entryFixture,
          id: "safe-confirmed-source-migration",
          requiresConfirmation: true,
          safety: "source-migration",
          updatePath: "source",
        },
      ])
    ).not.toThrow();
  });
});

const entryFixture: ProviderFormatMigrationEntry = {
  appliesTo: ["codex-plugin"],
  description: "Fixture entry.",
  from: "from",
  id: "fixture",
  previewable: true,
  provider: "codex",
  requiresConfirmation: false,
  safe: true,
  safety: "adapter-only",
  sourcePreserving: true,
  surface: "plugin",
  to: "to",
  updatePath: "adapter",
};
