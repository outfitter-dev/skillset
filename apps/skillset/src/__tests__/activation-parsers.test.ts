import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { parseActivationInspectorOutput } from "../activation-parsers";

describe("activation provider output parsers", () => {
  test("keeps dated provider fixtures for every allowlisted inspector", async () => {
    const captured = (await Bun.file(
      join(import.meta.dir, "fixtures/activation/provider-outputs.json")
    ).json()) as {
      captureEnvironment: string;
      capturedAt: string;
      fixtures: Array<{
        command: string[];
        id: string;
        output: string;
        providerVersion: string;
        source: string;
      }>;
    };

    expect(captured.captureEnvironment).toBe(
      "installed provider binary with isolated empty HOME and XDG roots"
    );
    expect(captured.capturedAt).toBe("2026-07-24");
    expect(captured.fixtures.map(({ id }) => id).toSorted()).toEqual([
      "claude-mcp-list",
      "claude-plugin-list",
      "codex-mcp-list",
      "codex-plugin-list",
      "cursor-mcp-list",
      "cursor-status",
    ]);
    for (const fixture of captured.fixtures) {
      expect(fixture.command.length).toBeGreaterThan(1);
      expect(fixture.output.length).toBeGreaterThan(0);
      expect(fixture.providerVersion.length).toBeGreaterThan(0);
      expect(fixture.source).toStartWith("https://");
    }
  });

  test("Claude plugin inventory reports discoverable and persisted enabled state", () => {
    const result = parseActivationInspectorOutput({
      capability: "plugin-dependency",
      inspectorId: "claude.plugin.list",
      stdout: JSON.stringify([
        { enabled: true, marketplace: "outfitter", name: "trails" },
        { enabled: false, marketplace: "outfitter", name: "ranger" },
      ]),
      subjects: ["outfitter/trails", "outfitter/ranger", "outfitter/missing"],
    });

    expect(result).toMatchObject({
      outcome: "ran",
      facts: [
        {
          claim: "discoverable",
          state: "satisfied",
          subject: "outfitter/trails",
        },
        { claim: "enabled", state: "satisfied", subject: "outfitter/trails" },
        {
          claim: "discoverable",
          state: "satisfied",
          subject: "outfitter/ranger",
        },
        { claim: "enabled", state: "missing", subject: "outfitter/ranger" },
        {
          claim: "discoverable",
          state: "missing",
          subject: "outfitter/missing",
        },
      ],
    });
  });

  test("Codex inventories accept only allowlisted names and enabled state", () => {
    const plugins = parseActivationInspectorOutput({
      capability: "plugin-dependency",
      inspectorId: "codex.plugin.list",
      stdout: JSON.stringify({
        installed: [
          {
            authPolicy: { token: "must-not-survive" },
            enabled: true,
            marketplaceName: "outfitter",
            name: "trails",
            pluginId: "trails@outfitter",
          },
        ],
      }),
      subjects: ["trails@outfitter"],
    });
    const mcp = parseActivationInspectorOutput({
      capability: "mcp-server",
      inspectorId: "codex.mcp.list",
      stdout: JSON.stringify([
        { bearerToken: "must-not-survive", enabled: true, name: "github" },
      ]),
      subjects: ["github", "linear"],
    });

    expect(plugins.facts).toEqual([
      expect.objectContaining({ claim: "discoverable", state: "satisfied" }),
      expect.objectContaining({ claim: "enabled", state: "satisfied" }),
    ]);
    expect(mcp.facts).toEqual([
      expect.objectContaining({
        claim: "discoverable",
        state: "satisfied",
        subject: "github",
      }),
      expect.objectContaining({
        claim: "discoverable",
        state: "missing",
        subject: "linear",
      }),
    ]);
    expect(JSON.stringify([plugins, mcp])).not.toContain("must-not-survive");
  });

  test("plugin inventories without allowlisted identifiers are malformed", () => {
    for (const stdout of [
      JSON.stringify([{ enabled: true }]),
      JSON.stringify({ installed: [{ displayName: "trails" }] }),
      JSON.stringify({ plugins: [{ marketplace: "outfitter" }] }),
    ]) {
      expect(
        parseActivationInspectorOutput({
          capability: "plugin-dependency",
          inspectorId: "codex.plugin.list",
          stdout,
          subjects: ["trails"],
        })
      ).toMatchObject({
        facts: [],
        outcome: "malformed",
        summary: "provider plugin inventory used an unknown shape",
      });
    }
  });

  test("Claude and Cursor MCP text can claim only discovery and explicit connection", () => {
    const claude = parseActivationInspectorOutput({
      capability: "mcp-server",
      inspectorId: "claude.mcp.list",
      stdout: "github: ✓ Connected\nlinear: ✗ Failed\n",
      subjects: ["github", "linear", "missing"],
    });
    const cursor = parseActivationInspectorOutput({
      capability: "mcp-server",
      inspectorId: "cursor.mcp.list",
      stdout: "● github - ready\n○ linear - disabled\n",
      subjects: ["github", "linear"],
    });

    expect(
      claude.facts.map(({ claim, state, subject }) => ({
        claim,
        state,
        subject,
      }))
    ).toEqual([
      { claim: "discoverable", state: "satisfied", subject: "github" },
      { claim: "connected", state: "satisfied", subject: "github" },
      { claim: "discoverable", state: "satisfied", subject: "linear" },
      { claim: "connected", state: "missing", subject: "linear" },
      { claim: "discoverable", state: "missing", subject: "missing" },
    ]);
    expect(cursor.facts.some((fact) => fact.claim === "authenticated")).toBe(
      false
    );
    expect(
      cursor.facts.some(
        (fact) => fact.claim === "connected" && fact.state === "satisfied"
      )
    ).toBe(true);
  });

  test("valid unrelated MCP inventory reports requested subjects missing", () => {
    const result = parseActivationInspectorOutput({
      capability: "mcp-server",
      inspectorId: "claude.mcp.list",
      stdout: "other: connected\n",
      subjects: ["github"],
    });

    expect(result).toMatchObject({
      facts: [
        { claim: "discoverable", state: "missing", subject: "github" },
      ],
      outcome: "ran",
    });
  });

  test("connection parsing excludes the MCP server name", () => {
    const result = parseActivationInspectorOutput({
      capability: "mcp-server",
      inspectorId: "claude.mcp.list",
      stdout: "error-tracker: connected\n",
      subjects: ["error-tracker"],
    });

    expect(result).toMatchObject({
      facts: [
        {
          claim: "discoverable",
          state: "satisfied",
          subject: "error-tracker",
        },
        {
          claim: "connected",
          state: "satisfied",
          subject: "error-tracker",
        },
      ],
      outcome: "ran",
    });
  });

  test("recognizes only the provider empty MCP inventory phrase", () => {
    const empty = parseActivationInspectorOutput({
      capability: "mcp-server",
      inspectorId: "claude.mcp.list",
      stdout: "No MCP servers configured. Use `claude mcp add` to add one.\n",
      subjects: ["github", "linear"],
    });
    const unrelated = parseActivationInspectorOutput({
      capability: "mcp-server",
      inspectorId: "claude.mcp.list",
      stdout: "No configured servers were returned by another subsystem.\n",
      subjects: ["github"],
    });
    const cursorEmpty = parseActivationInspectorOutput({
      capability: "mcp-server",
      inspectorId: "cursor.mcp.list",
      stdout:
        "No MCP servers configured (expected in .cursor/mcp.json or ~/.cursor/mcp.json)\n",
      subjects: ["github"],
    });

    expect(empty).toMatchObject({
      facts: [
        { claim: "discoverable", state: "missing", subject: "github" },
        { claim: "discoverable", state: "missing", subject: "linear" },
      ],
      outcome: "ran",
    });
    expect(cursorEmpty).toMatchObject({
      facts: [
        { claim: "discoverable", state: "missing", subject: "github" },
      ],
      outcome: "ran",
    });
    expect(unrelated).toMatchObject({ facts: [], outcome: "malformed" });
  });

  test("negative connection phrases cannot satisfy a connection claim", () => {
    for (const output of [
      "github: not connected",
      "github: not ready",
      "github: not healthy",
      "github: not running",
    ]) {
      const result = parseActivationInspectorOutput({
        capability: "mcp-server",
        inspectorId: "claude.mcp.list",
        stdout: output,
        subjects: ["github"],
      });

      expect(result.facts).toContainEqual(
        expect.objectContaining({
          claim: "connected",
          state: "missing",
          subject: "github",
        })
      );
    }
  });

  test("text MCP subjects require an exact server name", () => {
    for (const output of ["github-enterprise: connected"]) {
      const result = parseActivationInspectorOutput({
        capability: "mcp-server",
        inspectorId: "claude.mcp.list",
        stdout: output,
        subjects: ["github"],
      });

      expect(result.facts).toEqual([
        expect.objectContaining({
          claim: "discoverable",
          state: "missing",
          subject: "github",
        }),
      ]);
      expect(result.outcome).toBe("ran");
    }

    for (const output of [
      "github enterprise: connected",
      "github connected",
    ]) {
      const result = parseActivationInspectorOutput({
        capability: "mcp-server",
        inspectorId: "claude.mcp.list",
        stdout: output,
        subjects: ["github"],
      });

      expect(result.facts).toEqual([]);
      expect(result.outcome).toBe("malformed");
    }

    const exact = parseActivationInspectorOutput({
      capability: "mcp-server",
      inspectorId: "claude.mcp.list",
      stdout: "github-enterprise: connected\n● github - ready",
      subjects: ["github", "github-enterprise"],
    });
    expect(exact.facts).toContainEqual(
      expect.objectContaining({
        claim: "connected",
        state: "satisfied",
        subject: "github",
      })
    );
    expect(exact.facts).toContainEqual(
      expect.objectContaining({
        claim: "connected",
        state: "satisfied",
        subject: "github-enterprise",
      })
    );
  });

  test("Cursor auth fans one provider fact out to each requested MCP subject", () => {
    const result = parseActivationInspectorOutput({
      capability: "mcp-server",
      inspectorId: "cursor.status",
      stdout: JSON.stringify({
        authenticated: true,
        email: "private@example.com",
        token: "secret",
      }),
      subjects: ["github", "linear"],
    });

    expect(result.facts).toEqual([
      expect.objectContaining({ claim: "authenticated", subject: "github" }),
      expect.objectContaining({ claim: "authenticated", subject: "linear" }),
    ]);
    expect(JSON.stringify(result)).not.toContain("private@example.com");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("Cursor unauthenticated status emits bounded missing facts", () => {
    const result = parseActivationInspectorOutput({
      capability: "mcp-server",
      inspectorId: "cursor.status",
      stdout: JSON.stringify({
        email: "private@example.com",
        isAuthenticated: false,
      }),
      subjects: ["github", "linear"],
    });

    expect(result).toMatchObject({
      facts: [
        { claim: "authenticated", state: "missing", subject: "github" },
        { claim: "authenticated", state: "missing", subject: "linear" },
      ],
      outcome: "ran",
    });
    expect(JSON.stringify(result)).not.toContain("private@example.com");
  });

  test("unknown, malformed, and unauthenticated output produce no positive facts", () => {
    const cases = [
      parseActivationInspectorOutput({
        capability: "plugin-dependency",
        inspectorId: "codex.plugin.list",
        stdout: '{"unexpected":true}',
        subjects: ["demo"],
      }),
      parseActivationInspectorOutput({
        capability: "mcp-server",
        inspectorId: "codex.mcp.list",
        stdout: "not json",
        subjects: ["demo"],
      }),
      parseActivationInspectorOutput({
        capability: "mcp-server",
        inspectorId: "cursor.status",
        stdout: '{"authenticated":false}',
        subjects: ["demo"],
      }),
      parseActivationInspectorOutput({
        capability: "mcp-server",
        inspectorId: "claude.mcp.list",
        stdout: "Provider changed its output completely.",
        subjects: ["demo"],
      }),
    ];

    expect(cases.map((entry) => entry.facts)).toEqual([
      [],
      [],
      [
        {
          claim: "authenticated",
          stage: "authenticated",
          state: "missing",
          subject: "demo",
        },
      ],
      [],
    ]);
    expect(cases.map((entry) => entry.outcome)).toEqual([
      "malformed",
      "malformed",
      "ran",
      "malformed",
    ]);
  });
});
