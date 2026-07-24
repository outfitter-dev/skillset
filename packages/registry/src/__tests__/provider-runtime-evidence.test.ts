import { describe, expect, test } from "bun:test";

import {
  getProviderRuntimeEvidence,
  getProviderRuntimeInspectorEvidence,
  listProviderRuntimeEvidence,
  normalizeProviderRuntimeEvidence,
} from "../provider-runtime-evidence";

describe("SET-390 provider runtime evidence", () => {
  test("records deterministic provider facts without Skillset policy", () => {
    const entries = listProviderRuntimeEvidence();

    expect(entries.map(({ target }) => target)).toEqual([
      "claude",
      "codex",
      "cursor",
    ]);
    expect(normalizeProviderRuntimeEvidence(entries.toReversed())).not.toBe(
      normalizeProviderRuntimeEvidence(entries)
    );
    expect(
      normalizeProviderRuntimeEvidence(
        entries
          .toReversed()
          .toSorted((left, right) => left.target.localeCompare(right.target))
      )
    ).toBe(normalizeProviderRuntimeEvidence(entries));

    for (const entry of entries) {
      expect(entry).not.toHaveProperty("actions");
      expect(entry).not.toHaveProperty("allowedClaims");
      expect(entry).not.toHaveProperty("reasons");
      expect(entry).not.toHaveProperty("stages");
    }
  });

  test("keeps fixed inspection commands and observed fields in evidence", () => {
    expect(getProviderRuntimeInspectorEvidence("claude.plugin.list")).toEqual({
      effect: "passive",
      fields: ["plugin.enabled", "plugin.name"],
      id: "claude.plugin.list",
      surface: {
        argv: ["claude", "plugin", "list", "--json"],
        kind: "command",
        output: "json",
        versionArgv: ["claude", "--version"],
      },
    });
    expect(getProviderRuntimeEvidence("cursor")).toMatchObject({
      providerName: "Cursor Agent",
      providerVersion: "2026.07.23-e383d2b",
      verifiedAt: "2026-07-24",
    });
  });
});
