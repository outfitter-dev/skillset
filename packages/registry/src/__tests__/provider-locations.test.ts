import { describe, expect, test } from "bun:test";

import {
  defineProviderLocationEvidence,
  listProviderLocationEvidence,
  PROVIDER_LOCATION_CONSUMERS,
  selectProviderLocationEvidence,
  type ProviderLocationEvidence,
} from "../provider-locations";

describe("SET-524 provider-location evidence", () => {
  test("selects exact provider versions and exposes provenance", () => {
    const selection = selectProviderLocationEvidence({
      providerVersion: "0.154.0",
      surface: "codex-cli",
      target: "codex",
    });

    expect(selection).toMatchObject({
      evidence: {
        providerVersion: "0.154.0",
        surface: "codex-cli",
        verifiedAt: "2026-09-11",
      },
      kind: "matched",
    });
    if (selection.kind !== "matched")
      throw new Error("expected matched evidence");
    expect(selection.evidence.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: expect.stringContaining("/core-plugins/src/store.rs"),
        }),
      ])
    );
    expect(selection.evidence.facts).toContainEqual({
      kind: "plugin-storage",
      path: "${CODEX_HOME}/plugins/cache/<marketplace>/<plugin>/<version>",
      status: "verified",
    });
  });

  test("returns an explicit unknown for an unregistered version", () => {
    expect(
      selectProviderLocationEvidence({
        providerVersion: "0.148.0",
        surface: "codex-cli",
        target: "codex",
      })
    ).toEqual({
      kind: "unknown",
      providerVersion: "0.148.0",
      reason:
        "No provider-location evidence is registered for codex codex-cli at version 0.148.0.",
      surface: "codex-cli",
      target: "codex",
    });
  });

  test("keeps CLI, IDE, desktop, web, and cloud surfaces distinct", () => {
    const entries = listProviderLocationEvidence();
    const surfaces = entries.map((entry) => entry.surface);

    expect(surfaces).toEqual(
      expect.arrayContaining([
        "chatgpt-desktop",
        "chatgpt-web",
        "claude-code-cli",
        "claude-code-cloud",
        "codex-cli",
        "codex-cloud",
        "codex-ide",
        "cursor-agent-cli",
        "cursor-cloud",
        "cursor-ide",
      ])
    );
    expect(
      new Set(
        entries.map(
          (entry) => `${entry.target}:${entry.surface}:${entry.providerVersion}`
        )
      ).size
    ).toBe(entries.length);
  });

  test("names the future read-only consumers without implementing them", () => {
    expect(PROVIDER_LOCATION_CONSUMERS).toEqual([
      "doctor",
      "install-verification",
      "router-preflight",
    ]);
  });

  test("records unknown locations instead of inventing provider paths", () => {
    const cursorIde = selectProviderLocationEvidence({
      providerVersion: "3.17.8",
      surface: "cursor-ide",
      target: "cursor",
    });
    const chatgpt = selectProviderLocationEvidence({
      providerVersion: "unversioned@2026-09-11",
      surface: "chatgpt-web",
      target: "codex",
    });
    const codexIde = selectProviderLocationEvidence({
      providerVersion: "unversioned@2026-09-11",
      surface: "codex-ide",
      target: "codex",
    });

    expect(cursorIde).toMatchObject({ kind: "matched" });
    expect(chatgpt).toMatchObject({ kind: "matched" });
    expect(codexIde).toMatchObject({ kind: "matched" });
    if (
      cursorIde.kind !== "matched" ||
      chatgpt.kind !== "matched" ||
      codexIde.kind !== "matched"
    )
      throw new Error("expected matched evidence rows");
    expect(cursorIde.evidence.facts).toContainEqual(
      expect.objectContaining({
        kind: "marketplace",
        status: "unknown",
      })
    );
    expect(
      chatgpt.evidence.facts.every((fact) => fact.status === "unknown")
    ).toBe(true);
    expect(
      codexIde.evidence.facts.every((fact) => fact.status === "unknown")
    ).toBe(true);
  });

  test("rejects unsupported and cross-provider surfaces", () => {
    expect(() =>
      defineProviderLocationEvidence([
        validEvidence({
          surface: "not-a-surface" as ProviderLocationEvidence["surface"],
        }),
      ])
    ).toThrow("unsupported provider-location surface not-a-surface");

    expect(() =>
      defineProviderLocationEvidence([
        validEvidence({ surface: "cursor-ide", target: "claude" }),
      ])
    ).toThrow(
      "provider-location surface cursor-ide belongs to cursor, not claude"
    );
  });

  test("rejects unknown status vocabulary and impossible calendar dates", () => {
    expect(() =>
      defineProviderLocationEvidence([
        validEvidence({
          facts: [
            {
              kind: "config",
              status: "bogus",
            } as unknown as ProviderLocationEvidence["facts"][number],
          ],
        }),
      ])
    ).toThrow("unsupported provider-location status bogus");

    expect(() =>
      defineProviderLocationEvidence([
        validEvidence({ verifiedAt: "2026-99-99" }),
      ])
    ).toThrow("invalid verification date 2026-99-99");
  });

  test("ties Cursor 3.17.8 paths to installed-app metadata and rolling docs", () => {
    const selection = selectProviderLocationEvidence({
      providerVersion: "3.17.8",
      surface: "cursor-ide",
      target: "cursor",
    });

    if (selection.kind !== "matched")
      throw new Error("expected matched evidence");
    expect(selection.evidence.observations).toContainEqual({
      fields: {
        CFBundleShortVersionString: "3.17.8",
        CFBundleVersion: "3.17.8",
      },
      kind: "installed-app-metadata",
      observedAt: "2026-09-11",
      path: "/Applications/Cursor.app/Contents/Info.plist",
    });
    expect(
      selection.evidence.sources.every((source) =>
        source.note?.includes("does not pin Cursor 3.17.8")
      )
    ).toBe(true);
  });
});

function validEvidence(
  overrides: Partial<ProviderLocationEvidence> = {}
): ProviderLocationEvidence {
  return {
    facts: [{ kind: "config", path: "/tmp/config", status: "verified" }],
    providerName: "Codex",
    providerVersion: "0.154.0",
    sources: [{ url: "https://example.com/evidence" }],
    surface: "codex-cli",
    target: "codex",
    verifiedAt: "2026-09-11",
    ...overrides,
  };
}
