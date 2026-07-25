import { describe, expect, test } from "bun:test";

import {
  assertProviderActivationDescriptors,
  defineProviderActivationDescriptors,
  getProviderActivationDescriptor,
  listProviderActivationDescriptors,
  normalizeProviderActivationDescriptors,
  PROVIDER_ACTIVATION_CAPABILITIES,
} from "../activation-policy";
import type { ProviderActivationDescriptor } from "../activation-policy";
import { PROVIDER_SCHEMA_TARGETS } from "@skillset/registry";

describe("SET-390 provider activation policy", () => {
  test("covers every provider and activation capability exactly once", () => {
    const entries = listProviderActivationDescriptors();

    expect(entries).toHaveLength(
      PROVIDER_SCHEMA_TARGETS.length * PROVIDER_ACTIVATION_CAPABILITIES.length
    );
    expect(entries.map(({ id }) => id)).toEqual([
      "claude:app",
      "claude:mcp-server",
      "claude:plugin-dependency",
      "codex:app",
      "codex:mcp-server",
      "codex:plugin-dependency",
      "cursor:app",
      "cursor:mcp-server",
      "cursor:plugin-dependency",
    ]);
  });

  test("records the exact allowlisted provider inspection surfaces", () => {
    expect(commandSurfaces()).toEqual([
      {
        allowedClaims: ["connected", "discoverable"],
        argv: ["claude", "mcp", "list"],
        effect: "active",
        id: "claude.mcp.list",
        output: "text",
        versionArgv: ["claude", "--version"],
      },
      {
        allowedClaims: ["discoverable", "enabled"],
        argv: ["claude", "plugin", "list", "--json"],
        effect: "passive",
        id: "claude.plugin.list",
        output: "json",
        versionArgv: ["claude", "--version"],
      },
      {
        allowedClaims: ["discoverable"],
        argv: ["codex", "mcp", "list", "--json"],
        effect: "passive",
        id: "codex.mcp.list",
        output: "json",
        versionArgv: ["codex", "--version"],
      },
      {
        allowedClaims: ["discoverable", "enabled"],
        argv: ["codex", "plugin", "list", "--json"],
        effect: "passive",
        id: "codex.plugin.list",
        output: "json",
        versionArgv: ["codex", "--version"],
      },
      {
        allowedClaims: ["connected", "discoverable"],
        argv: ["cursor-agent", "mcp", "list"],
        effect: "active",
        id: "cursor.mcp.list",
        output: "text",
        versionArgv: ["cursor-agent", "--version"],
      },
    ]);
  });

  test("owns the canonical requirement stages for each capability", () => {
    expect(
      getProviderActivationDescriptor("claude", "plugin-dependency").stages
    ).toEqual(["declared", "rendered", "discoverable", "enabled", "proven"]);
    expect(
      getProviderActivationDescriptor("codex", "mcp-server").stages
    ).toEqual([
      "declared",
      "rendered",
      "discoverable",
      "authenticated",
      "connected",
      "proven",
    ]);
    expect(getProviderActivationDescriptor("cursor", "app").stages).toEqual([
      "declared",
      "rendered",
      "discoverable",
      "enabled",
      "authenticated",
      "proven",
    ]);
  });

  test("keeps unavailable surfaces explicit and incapable of claims", () => {
    const unavailable = listProviderActivationDescriptors()
      .flatMap(({ inspectors }) => inspectors)
      .filter(({ surface }) => surface.kind === "unavailable");

    expect(unavailable.map(({ id }) => id)).toEqual([
      "claude.app.unavailable",
      "codex.app.unavailable",
      "cursor.app.unavailable",
      "cursor.plugin-dependency.unavailable",
    ]);
    for (const inspector of unavailable) {
      expect(inspector.effect).toBe("none");
      expect(inspector.allowedClaims).toEqual([]);
    }
  });

  test("returns frozen canonical descriptors with dated provider evidence", () => {
    const descriptor = getProviderActivationDescriptor("cursor", "mcp-server");

    expect(descriptor.evidence).toMatchObject({
      providerName: "Cursor Agent",
      providerVersion: "2026.07.23-e383d2b",
      verifiedAt: "2026-07-24",
    });
    expect(descriptor.observationFallback).toBe("unverified");
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.inspectors)).toBe(true);
    expect(Object.isFrozen(descriptor.inspectors[0]?.surface)).toBe(true);
  });

  test("distinguishes review guidance from provider-state mutations", () => {
    expect(getProviderActivationDescriptor("claude", "app").actions).toEqual([
      expect.objectContaining({
        code: "claude.app.review-activation",
        mutatesProviderState: false,
      }),
    ]);
    expect(
      getProviderActivationDescriptor("claude", "plugin-dependency").actions
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "claude.plugin.install-or-enable",
          mutatesProviderState: true,
        }),
        expect.objectContaining({
          code: "claude.plugin.enable",
          mutatesProviderState: true,
        }),
      ])
    );
  });

  test("normalizes input and output deterministically", () => {
    const entries = listProviderActivationDescriptors();
    const reversed = entries.map(reverseNested).toReversed();
    const normalized = defineProviderActivationDescriptors(reversed);

    expect(normalizeProviderActivationDescriptors(normalized)).toBe(
      normalizeProviderActivationDescriptors(entries)
    );
    expect(normalized.map(({ id }) => id)).toEqual(entries.map(({ id }) => id));
  });

  test("rejects duplicate, incomplete, or contradictory registries", () => {
    const entries = listProviderActivationDescriptors();
    expect(() =>
      assertProviderActivationDescriptors([...entries, entries[0]!])
    ).toThrow("duplicate provider activation descriptor claude:app");

    expect(() => assertProviderActivationDescriptors(entries.slice(1))).toThrow(
      "missing provider activation descriptor claude:app"
    );

    const contradictory = replaceDescriptor(entries, "codex:mcp-server", {
      allowedClaims: ["connected", "discoverable"],
    });
    expect(() => assertProviderActivationDescriptors(contradictory)).toThrow(
      "codex:mcp-server both allows and forbids claim connected"
    );

    const repeatedClaim = replaceDescriptor(entries, "codex:mcp-server", {
      allowedClaims: ["discoverable", "discoverable"],
    });
    expect(() => defineProviderActivationDescriptors(repeatedClaim)).toThrow(
      "codex:mcp-server repeats allowed claim discoverable"
    );

    const crossDescriptorReason = replaceDescriptor(
      entries,
      "codex:mcp-server",
      {
        actions: [
          {
            ...getProviderActivationDescriptor("codex", "mcp-server")
              .actions[0]!,
            reasonCode: "claude.plugin.not-discoverable",
          },
        ],
      }
    );
    expect(() =>
      assertProviderActivationDescriptors(crossDescriptorReason)
    ).toThrow(
      "codex.mcp.configure references unknown reason claude.plugin.not-discoverable"
    );
  });

  test("rejects duplicate inspectors and unsafe command surfaces", () => {
    const entries = listProviderActivationDescriptors();
    const duplicateInspector = replaceDescriptor(entries, "codex:mcp-server", {
      inspectors: [
        {
          ...getProviderActivationDescriptor("claude", "mcp-server")
            .inspectors[0]!,
        },
      ],
    });
    expect(() =>
      assertProviderActivationDescriptors(duplicateInspector)
    ).toThrow("duplicate provider activation inspector claude.mcp.list");

    const unsafe = replaceDescriptor(entries, "codex:mcp-server", {
      inspectors: [
        {
          ...getProviderActivationDescriptor("codex", "mcp-server")
            .inspectors[0]!,
          surface: {
            argv: ["sh", "-c", "codex mcp list --json"],
            kind: "command",
            output: "json",
            versionArgv: ["sh", "--version"],
          },
        },
      ],
    });
    expect(() => assertProviderActivationDescriptors(unsafe)).toThrow(
      "must use a fixed provider executable"
    );
  });
});

function commandSurfaces(): readonly Record<string, unknown>[] {
  return listProviderActivationDescriptors()
    .flatMap(({ inspectors }) => inspectors)
    .flatMap((inspector) =>
      inspector.surface.kind === "command"
        ? [
            {
              allowedClaims: inspector.allowedClaims,
              argv: inspector.surface.argv,
              effect: inspector.effect,
              id: inspector.id,
              output: inspector.surface.output,
              versionArgv: inspector.surface.versionArgv,
            },
          ]
        : []
    )
    .toSorted((left, right) => {
      const leftId = String(left.id);
      const rightId = String(right.id);
      if (leftId < rightId) {
        return -1;
      }
      if (leftId > rightId) {
        return 1;
      }
      return 0;
    });
}

function reverseNested(
  entry: ProviderActivationDescriptor
): ProviderActivationDescriptor {
  return {
    ...entry,
    actions: [...entry.actions].toReversed(),
    allowedClaims: [...entry.allowedClaims].toReversed(),
    evidence: {
      ...entry.evidence,
      sources: [...entry.evidence.sources].toReversed(),
    },
    forbiddenClaims: [...entry.forbiddenClaims].toReversed(),
    inspectors: [...entry.inspectors].toReversed().map((inspector) => ({
      ...inspector,
      allowedClaims: [...inspector.allowedClaims].toReversed(),
      forbiddenClaims: [...inspector.forbiddenClaims].toReversed(),
    })),
    reasons: [...entry.reasons].toReversed(),
  };
}

function replaceDescriptor(
  entries: readonly ProviderActivationDescriptor[],
  id: string,
  patch: Partial<ProviderActivationDescriptor>
): readonly ProviderActivationDescriptor[] {
  return entries.map((entry) =>
    entry.id === id ? { ...entry, ...patch } : entry
  );
}
