import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";

import type { MarketplaceUpdateReport } from "@skillset/core";

import {
  renderMarketplaceUpdate,
  runMarketplaceCommand,
  type MarketplaceCommandContext,
  type MarketplaceCommandRequest,
} from "../distribution-cli";
import {
  createInteractiveSession,
  type InteractiveSession,
} from "../interactive-session";
import {
  PromptCancelledError,
  type PromptAdapter,
  ScriptedPromptAdapter,
} from "../prompt-adapter";

const ttyInput = (): PassThrough & { isTTY: true } =>
  Object.assign(new PassThrough(), { isTTY: true as const });
const ttyOutput = (): PassThrough & { isTTY: true } =>
  Object.assign(new PassThrough(), { isTTY: true as const });

function request(
  overrides: Partial<MarketplaceCommandRequest> = {}
): MarketplaceCommandRequest {
  return {
    jsonOutput: false,
    marketplaceName: undefined,
    marketplaceSubcommand: "update",
    options: {},
    rootPath: "/workspace",
    yes: false,
    ...overrides,
  };
}

function report(
  catalog: string | undefined,
  write = false
): MarketplaceUpdateReport {
  const files =
    catalog === undefined
      ? []
      : [
          {
            catalog,
            path: ".claude-plugin/marketplace.json",
            target: "claude" as const,
          },
        ];
  return {
    check: {
      entries: [],
      marketplaces: catalog === undefined ? [] : [catalog],
      ok: true,
    },
    files,
    lockPath: "skillset.lock",
    ok: true,
    planHash: `sha256:${catalog ?? "none"}`,
    writtenPaths: write ? files.map((file) => file.path) : [],
    write,
  };
}

function scriptedSession(
  answers: ConstructorParameters<typeof ScriptedPromptAdapter>[0]
): {
  readonly adapter: ScriptedPromptAdapter;
  readonly session: InteractiveSession;
} {
  const adapter = new ScriptedPromptAdapter(answers);
  const session = createInteractiveSession({
    adapter,
    env: { CI: "false" },
    input: ttyInput(),
    output: ttyOutput(),
  });
  if (session === undefined) throw new Error("expected interactive session");
  return { adapter, session };
}

function operations(catalogs: readonly string[]): {
  readonly calls: Array<{
    readonly expectedPlanHash: string | undefined;
    readonly name: string | undefined;
    readonly write: boolean | undefined;
  }>;
  readonly context: MarketplaceCommandContext;
  readonly listCalls: string[];
} {
  const calls: Array<{
    expectedPlanHash: string | undefined;
    name: string | undefined;
    write: boolean | undefined;
  }> = [];
  const listCalls: string[] = [];
  return {
    calls,
    context: {
      listCatalogs: async (rootPath) => {
        listCalls.push(rootPath);
        return catalogs;
      },
      update: async (_rootPath, options = {}) => {
        calls.push({
          expectedPlanHash: options.expectedPlanHash,
          name: options.name,
          write: options.write,
        });
        return report(options.name, options.write);
      },
    },
    listCalls,
  };
}

describe("SET-297 derived interactive marketplace update", () => {
  test("zero catalogs renders the canonical empty report without prompting", async () => {
    const { adapter, session } = scriptedSession([]);
    const fake = operations([]);
    let output = "";

    await runMarketplaceCommand(request(), {
      ...fake.context,
      interactiveSession: session,
      write: (value) => {
        output += value;
      },
    });

    adapter.assertComplete();
    expect(adapter.prompts).toEqual([]);
    expect(fake.listCalls).toEqual(["/workspace"]);
    expect(fake.calls).toEqual([
      {
        expectedPlanHash: undefined,
        name: undefined,
        write: false,
      },
    ]);
    expect(output).toBe("skillset: no marketplaces configured\n");
  });

  test("one catalog skips selection and default-No preserves preview-only behavior", async () => {
    const { adapter, session } = scriptedSession([
      { kind: "confirm", value: false },
    ]);
    const fake = operations(["solo"]);
    let output = "";

    await runMarketplaceCommand(request(), {
      ...fake.context,
      interactiveSession: session,
      write: (value) => {
        output += value;
      },
    });

    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual(["confirm"]);
    expect(fake.calls).toEqual([
      {
        expectedPlanHash: undefined,
        name: "solo",
        write: false,
      },
    ]);
    expect(output).toContain(
      "would write: .claude-plugin/marketplace.json (solo claude)"
    );
    expect(output).toContain("would write: skillset.lock");
  });

  test("many catalogs select one before the canonical preview", async () => {
    const { adapter, session } = scriptedSession([
      { kind: "select", value: "beta" },
      { kind: "confirm", value: false },
    ]);
    const fake = operations(["alpha", "beta"]);

    await runMarketplaceCommand(request(), {
      ...fake.context,
      interactiveSession: session,
      write: () => undefined,
    });

    adapter.assertComplete();
    expect(adapter.prompts.map((prompt) => prompt.kind)).toEqual([
      "select",
      "confirm",
    ]);
    expect(fake.calls).toEqual([
      {
        expectedPlanHash: undefined,
        name: "beta",
        write: false,
      },
    ]);
  });

  test("an explicit catalog bypasses listing but still previews and confirms", async () => {
    const { adapter, session } = scriptedSession([
      { kind: "confirm", value: false },
    ]);
    const fake = operations(["unused"]);

    await runMarketplaceCommand(request({ marketplaceName: "explicit" }), {
      ...fake.context,
      interactiveSession: session,
      write: () => undefined,
    });

    adapter.assertComplete();
    expect(fake.listCalls).toEqual([]);
    expect(fake.calls).toEqual([
      {
        expectedPlanHash: undefined,
        name: "explicit",
        write: false,
      },
    ]);
  });

  test("a blocked canonical preview returns before confirmation or writes", async () => {
    const { adapter, session } = scriptedSession([]);
    const fake = operations(["blocked"]);
    let output = "";
    const previousExitCode = process.exitCode;

    try {
      await runMarketplaceCommand(request(), {
        ...fake.context,
        interactiveSession: session,
        update: async (_rootPath, options = {}) => {
          fake.calls.push({
            expectedPlanHash: options.expectedPlanHash,
            name: options.name,
            write: options.write,
          });
          const preview = report(options.name);
          return {
            ...preview,
            check: { ...preview.check, ok: false },
            files: [],
            ok: false,
          };
        },
        write: (value) => {
          output += value;
        },
      });
    } finally {
      process.exitCode = previousExitCode ?? 0;
    }

    adapter.assertComplete();
    expect(adapter.prompts).toEqual([]);
    expect(fake.calls).toEqual([
      {
        expectedPlanHash: undefined,
        name: "blocked",
        write: false,
      },
    ]);
    expect(output).toContain("skillset: marketplace update failed");
  });

  test("confirmation invokes the same update operation with writes enabled", async () => {
    const { adapter, session } = scriptedSession([
      { kind: "confirm", value: true },
    ]);
    const fake = operations(["solo"]);
    let output = "";

    await runMarketplaceCommand(request(), {
      ...fake.context,
      interactiveSession: session,
      write: (value) => {
        output += value;
      },
    });

    adapter.assertComplete();
    expect(fake.calls).toEqual([
      {
        expectedPlanHash: undefined,
        name: "solo",
        write: false,
      },
      {
        expectedPlanHash: "sha256:solo",
        name: "solo",
        write: true,
      },
    ]);
    expect(output).toContain(
      "wrote: .claude-plugin/marketplace.json (solo claude)"
    );
    expect(output).toContain("wrote: skillset.lock");
  });

  test("changed-plan refusal retains fresh canonical check diagnostics", () => {
    const changed: MarketplaceUpdateReport = {
      ...report("solo", true),
      check: {
        entries: [
          {
            catalog: "solo",
            entryId: "remote-tools",
            generatedPath:
              "plugins/remote-tools/claude/.claude-plugin/plugin.json",
            generatedPaths: [
              "plugins/remote-tools/claude/.claude-plugin/plugin.json",
            ],
            lock: {
              path: "skillset.lock",
              policy: "ref",
              reason: "resolved ref changed",
              state: "stale",
            },
            plugin: "remote-tools",
            provenance: {
              catalog: "solo",
              entryId: "remote-tools",
              generatedPath:
                "plugins/remote-tools/claude/.claude-plugin/plugin.json",
              generatedPaths: [
                "plugins/remote-tools/claude/.claude-plugin/plugin.json",
              ],
              plugin: "remote-tools",
              providerSource: "./plugins/remote-tools/claude",
              readiness: "not-ready",
              repo: "https://git.example/acme/remote-tools",
              requested: { kind: "ref", ref: "main" },
              requestedTarget: "claude",
              resolved: {
                generatedPath:
                  "plugins/remote-tools/claude/.claude-plugin/plugin.json",
                generatedPaths: [
                  "plugins/remote-tools/claude/.claude-plugin/plugin.json",
                ],
                pluginVersion: "2.0.0",
                providerSource: "./plugins/remote-tools/claude",
                ref: "main",
                repository: "https://git.example/acme/remote-tools",
                sha: "b".repeat(40),
                sourceKind: "external",
              },
            },
            providerSource: "./plugins/remote-tools/claude",
            readiness: "not-ready",
            reason: "version drift after floating ref advanced",
            repo: "https://git.example/acme/remote-tools",
            requestedTarget: "claude",
            resolvedTargetSupport: true,
            source: {
              kind: "remote-cache",
              repository: "https://git.example/acme/remote-tools",
            },
            states: [
              "declared",
              "floating",
              "resolved",
              "renderable",
              "generated",
              "verified",
              "stale",
              "not-ready",
            ],
          },
        ],
        marketplaces: ["solo"],
        ok: false,
      },
      ok: false,
      reason:
        "marketplace update changed after preview; review the latest plan before writing",
      writtenPaths: [],
    };

    const output = renderMarketplaceUpdate(changed);

    expect(output).toContain("marketplace update changed after preview");
    expect(output).toContain("not-ready: solo/remote-tools claude");
    expect(output).toContain("version drift after floating ref advanced");
    expect(output).toContain("lock: stale ref (resolved ref changed)");
  });

  test("cancellation exits 130 before planning or writes", async () => {
    const prompts = new ScriptedPromptAdapter([]);
    const cancelled: PromptAdapter = {
      checkbox: prompts.checkbox.bind(prompts),
      confirm: prompts.confirm.bind(prompts),
      groupedCheckbox: prompts.groupedCheckbox.bind(prompts),
      input: prompts.input.bind(prompts),
      search: prompts.search.bind(prompts),
      searchCheckbox: prompts.searchCheckbox.bind(prompts),
      select: async () => {
        throw new PromptCancelledError();
      },
    };
    const session = createInteractiveSession({
      adapter: cancelled,
      env: { CI: "false" },
      input: ttyInput(),
      output: ttyOutput(),
    });
    if (session === undefined) throw new Error("expected interactive session");
    const fake = operations(["alpha", "beta"]);

    const result = runMarketplaceCommand(request(), {
      ...fake.context,
      interactiveSession: session,
    });

    await expect(result).rejects.toMatchObject({ exitCode: 130 });
    expect(fake.calls).toEqual([]);
  });

  test("JSON and confirmed requests bypass listing and every prompt", async () => {
    for (const overrides of [
      { jsonOutput: true, yes: false },
      { jsonOutput: false, yes: true },
    ]) {
      const { adapter, session } = scriptedSession([]);
      const fake = operations(["unused"]);

      await runMarketplaceCommand(
        request({
          ...overrides,
          marketplaceName: "explicit",
        }),
        {
          ...fake.context,
          interactiveSession: session,
          write: () => undefined,
        }
      );

      adapter.assertComplete();
      expect(adapter.prompts).toEqual([]);
      expect(fake.listCalls).toEqual([]);
      expect(fake.calls).toEqual([
        {
          expectedPlanHash: undefined,
          name: "explicit",
          write: overrides.yes,
        },
      ]);
    }
  });
});
