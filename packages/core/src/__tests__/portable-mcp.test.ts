import { describe, expect, it } from "bun:test";
import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getProviderMcpEvidence } from "@skillset/registry";

import { buildSkillsetResult, diffSkillsetResult } from "../build";
import {
  AGENT_PLUGINS_MCP_SCHEMA,
  parsePortableMcpSource,
  PORTABLE_MCP_PROVIDER_EVIDENCE,
  renderAgentPluginsMcp,
  renderProviderMcp,
} from "../portable-mcp";
import { renderBuildGraph } from "../render";
import { collectRenderResults } from "../render-result-collector";
import { loadBuildGraph } from "../resolver";
import type { JsonRecord } from "../types";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

async function fixture(
  source: unknown,
  options: { readonly includeSchema?: boolean } = {}
): Promise<{ pluginRoot: string; sourcePath: string }> {
  const pluginRoot = await createTestFixtureRoot("skillset-portable-mcp-");
  const sourcePath = join(pluginRoot, ".mcp.json");
  const input =
    options.includeSchema === false ||
    typeof source !== "object" ||
    source === null ||
    Array.isArray(source)
      ? source
      : { $schema: AGENT_PLUGINS_MCP_SCHEMA, ...source };
  await writeFile(sourcePath, `${JSON.stringify(input, null, 2)}\n`);
  return { pluginRoot, sourcePath };
}

describe("portable MCP", () => {
  it("parses the portable union once and renders canonical Agent Plugins bytes", async () => {
    const input = await fixture({
      mcpServers: {
        explicit: {
          command: "node",
          cwd: "${PLUGIN_ROOT}",
          env: { CACHE: "${PLUGIN_DATA}/cache" },
          type: "stdio",
        },
        inferred: {
          args: ["${PLUGIN_ROOT}/scripts/server.js"],
          command: "node",
        },
        legacy: { type: "sse", url: "https://mcp.example.com/events" },
        remote: {
          headers: { "X-Tenant": "public" },
          type: "streamable-http",
          url: "https://mcp.example.com/rpc",
        },
      },
    });
    await mkdir(join(input.pluginRoot, "scripts"));
    await writeFile(join(input.pluginRoot, "scripts/server.js"), "");

    const model = await parsePortableMcpSource(input);
    expect(model.unsupported).toEqual([]);
    expect(model.providerUnsupported).toEqual([
      {
        evidence: PORTABLE_MCP_PROVIDER_EVIDENCE.claude,
        name: "explicit",
        raw: {
          command: "node",
          cwd: "${PLUGIN_ROOT}",
          env: { CACHE: "${PLUGIN_DATA}/cache" },
          type: "stdio",
        },
        reason: "Claude Code native MCP has no documented stdio cwd rendering",
        target: "claude",
      },
      {
        evidence: PORTABLE_MCP_PROVIDER_EVIDENCE.cursor,
        name: "explicit",
        raw: {
          command: "node",
          cwd: "${PLUGIN_ROOT}",
          env: { CACHE: "${PLUGIN_DATA}/cache" },
          type: "stdio",
        },
        reason:
          "Cursor native MCP has no documented persistent plugin-data placeholder rendering",
        target: "cursor",
      },
      {
        evidence: PORTABLE_MCP_PROVIDER_EVIDENCE.codex,
        name: "legacy",
        raw: { type: "sse", url: "https://mcp.example.com/events" },
        reason: "Codex 0.154.0 reports Agent Plugins SSE as unsupported",
        target: "codex",
      },
    ]);
    expect(model.servers.inferred).toEqual({
      args: ["${PLUGIN_ROOT}/scripts/server.js"],
      command: "node",
      type: "stdio",
    });
    expect(renderAgentPluginsMcp(model)).toEqual({
      $schema: AGENT_PLUGINS_MCP_SCHEMA,
      mcpServers: {
        explicit: {
          command: "node",
          cwd: "${PLUGIN_ROOT}",
          env: { CACHE: "${PLUGIN_DATA}/cache" },
          type: "stdio",
        },
        inferred: {
          args: ["${PLUGIN_ROOT}/scripts/server.js"],
          command: "node",
          type: "stdio",
        },
        legacy: { type: "sse", url: "https://mcp.example.com/events" },
        remote: {
          headers: { "X-Tenant": "public" },
          type: "streamable-http",
          url: "https://mcp.example.com/rpc",
        },
      },
    });
  });

  it("accepts an omitted source schema but rejects conflicting schemas and roots", async () => {
    const valid = await fixture({
      $schema: AGENT_PLUGINS_MCP_SCHEMA,
      mcpServers: {},
    });
    expect(await parsePortableMcpSource(valid)).toMatchObject({ servers: {} });

    const missingSchema = await fixture(
      { mcpServers: {} },
      { includeSchema: false }
    );
    expect(await parsePortableMcpSource(missingSchema)).toMatchObject({
      servers: {},
    });

    const wrongSchema = await fixture({
      $schema: "https://example.com/mcp.json",
      mcpServers: {},
    });
    await expect(parsePortableMcpSource(wrongSchema)).rejects.toThrow(
      "unsupported MCP schema"
    );

    const extra = await fixture({ extension: true, mcpServers: {} });
    await expect(parsePortableMcpSource(extra)).rejects.toThrow(
      "unknown root field extension"
    );
  });

  it("rejects ambiguous and provider-native transport spellings with fix-its", async () => {
    const ambiguous = await fixture({
      mcpServers: { remote: { url: "https://example.com" } },
    });
    await expect(parsePortableMcpSource(ambiguous)).rejects.toThrow(
      "URL entries must declare type: streamable-http or type: sse"
    );

    const provider = await fixture({
      mcpServers: { remote: { type: "http", url: "https://example.com" } },
    });
    await expect(parsePortableMcpSource(provider)).rejects.toThrow(
      'replace provider transport "http" with "streamable-http"'
    );

    const providerUnderscore = await fixture({
      mcpServers: {
        remote: { type: "streamable_http", url: "https://example.com" },
      },
    });
    await expect(parsePortableMcpSource(providerUnderscore)).rejects.toThrow(
      'replace provider transport "streamable_http" with "streamable-http"'
    );

    const providerHeaders = await fixture({
      mcpServers: {
        remote: {
          http_headers: { "X-Tenant": "public" },
          type: "streamable-http",
          url: "https://example.com",
        },
      },
    });
    await expect(parsePortableMcpSource(providerHeaders)).rejects.toThrow(
      "use headers instead of provider field http_headers"
    );
  });

  it("keeps unknown credential-dependent entries whole and out of standard output", async () => {
    const input = await fixture({
      mcpServers: {
        oauth: {
          oauth: { clientId: "example" },
          type: "streamable-http",
          url: "https://secure.example.com/mcp",
        },
        portable: { type: "streamable-http", url: "https://example.com/mcp" },
      },
    });
    const model = await parsePortableMcpSource(input);

    expect(model.unsupported).toEqual([
      {
        fields: ["oauth"],
        name: "oauth",
        raw: {
          oauth: { clientId: "example" },
          type: "streamable-http",
          url: "https://secure.example.com/mcp",
        },
        reason: "provider-only MCP fields are outside Agent Plugins 1.0",
      },
    ]);
    expect(renderAgentPluginsMcp(model)).toEqual({
      $schema: AGENT_PLUGINS_MCP_SCHEMA,
      mcpServers: {
        portable: { type: "streamable-http", url: "https://example.com/mcp" },
      },
    });
    expect(renderProviderMcp(model, "claude")).toEqual({
      mcpServers: {
        portable: { type: "http", url: "https://example.com/mcp" },
      },
    });
  });

  it("keeps provider credential placeholders whole instead of failing the source", async () => {
    const input = await fixture({
      mcpServers: {
        authenticated: {
          headers: { Authorization: "Bearer ${API_TOKEN}" },
          type: "streamable-http",
          url: "https://secure.example.com/mcp",
        },
        portable: { type: "streamable-http", url: "https://example.com/mcp" },
      },
    });
    const model = await parsePortableMcpSource(input);

    expect(model.unsupported).toEqual([
      {
        fields: ["headers"],
        name: "authenticated",
        raw: {
          headers: { Authorization: "Bearer ${API_TOKEN}" },
          type: "streamable-http",
          url: "https://secure.example.com/mcp",
        },
        reason:
          "provider credential placeholders are outside Agent Plugins 1.0",
      },
    ]);
    expect(renderAgentPluginsMcp(model)).toEqual({
      $schema: AGENT_PLUGINS_MCP_SCHEMA,
      mcpServers: {
        portable: { type: "streamable-http", url: "https://example.com/mcp" },
      },
    });
    expect(renderProviderMcp(model, "cursor")).toEqual({
      mcpServers: {
        portable: { url: "https://example.com/mcp" },
      },
    });
  });

  it("keeps inherited-looking server names as own entries", async () => {
    const servers = JSON.parse(`{
      "__proto__": { "command": "node" },
      "constructor": { "command": "node" },
      "toString": { "command": "node" }
    }`);
    const model = await parsePortableMcpSource(
      await fixture({ mcpServers: servers })
    );

    expect(Object.keys(model.servers)).toEqual([
      "__proto__",
      "constructor",
      "toString",
    ]);
    const standard = renderAgentPluginsMcp(model)?.mcpServers as JsonRecord;
    const provider = renderProviderMcp(model, "codex").mcpServers as JsonRecord;
    for (const name of Object.keys(servers)) {
      expect(Object.hasOwn(standard, name)).toBe(true);
      expect(Object.hasOwn(provider, name)).toBe(true);
    }
  });

  it("does not collect support paths from unsupported whole entries", async () => {
    const input = await fixture({
      mcpServers: {
        oauth: {
          command: "./bin/secret",
          oauth: { clientId: "example" },
          type: "stdio",
        },
      },
    });
    await mkdir(join(input.pluginRoot, "bin"));
    await writeFile(join(input.pluginRoot, "bin", "secret"), "secret\n");

    expect(await parsePortableMcpSource(input)).toMatchObject({
      servers: {},
      supportPaths: [],
      unsupported: [{ name: "oauth" }],
    });
  });

  it("renders canonical placeholders and transports into provider-native bytes", async () => {
    const input = await fixture({
      mcpServers: {
        legacy: { type: "sse", url: "https://example.com/events" },
        local: {
          args: ["${PLUGIN_ROOT}/scripts/server.js", "${PLUGIN_DATA}/state"],
          command: "node",
          env: { ROOT: "${PLUGIN_ROOT}" },
          type: "stdio",
        },
        remote: {
          headers: { "X-Tenant": "public" },
          type: "streamable-http",
          url: "https://example.com/mcp",
        },
      },
    });
    await mkdir(join(input.pluginRoot, "scripts"));
    await writeFile(join(input.pluginRoot, "scripts/server.js"), "");
    const model = await parsePortableMcpSource(input);

    for (const target of ["claude", "codex", "cursor"] as const) {
      expect(PORTABLE_MCP_PROVIDER_EVIDENCE[target]).toBe(
        getProviderMcpEvidence(target)
      );
    }

    expect(renderProviderMcp(model, "claude")).toEqual({
      mcpServers: {
        legacy: { type: "sse", url: "https://example.com/events" },
        local: {
          args: [
            "${CLAUDE_PLUGIN_ROOT}/scripts/server.js",
            "${CLAUDE_PLUGIN_DATA}/state",
          ],
          command: "node",
          env: { ROOT: "${CLAUDE_PLUGIN_ROOT}" },
        },
        remote: {
          headers: { "X-Tenant": "public" },
          type: "http",
          url: "https://example.com/mcp",
        },
      },
    });
    expect(renderProviderMcp(model, "codex")).toEqual({
      mcpServers: {
        local: {
          args: ["${PLUGIN_ROOT}/scripts/server.js", "${PLUGIN_DATA}/state"],
          command: "node",
          env: { ROOT: "${PLUGIN_ROOT}" },
        },
        remote: {
          http_headers: { "X-Tenant": "public" },
          url: "https://example.com/mcp",
        },
      },
    });
    expect(renderProviderMcp(model, "cursor")).toEqual({
      mcpServers: {
        legacy: { type: "sse", url: "https://example.com/events" },
        remote: {
          headers: { "X-Tenant": "public" },
          url: "https://example.com/mcp",
        },
      },
    });
  });

  it("cuts provider bundle bytes over from source copying to typed rendering", async () => {
    const root = await createTestFixtureRoot("skillset-portable-mcp-build-");
    const files: Readonly<Record<string, string>> = {
      ".skillset/plugins/tools/.mcp.json": JSON.stringify({
        $schema: AGENT_PLUGINS_MCP_SCHEMA,
        mcpServers: {
          local: {
            command: "./bin/server",
          },
          "local-with-arg": {
            args: ["${PLUGIN_ROOT}/bin/arg-server.js"],
            command: "node",
          },
          "local-with-cwd": {
            command: "node",
            cwd: "${PLUGIN_ROOT}/bin/work",
          },
          remote: {
            type: "streamable-http",
            url: "https://example.com/mcp",
            headers: { "X-Tenant": "public" },
          },
        },
      }),
      ".skillset/plugins/tools/skillset.yaml": `
skillset:
  name: tools
bin: false
mcp: true
`,
      "skillset.yaml": `
skillset:
  name: portable-mcp-build
claude: false
codex: true
cursor: false
`,
    };
    for (const [path, content] of Object.entries(files)) {
      const destination = join(root, path);
      await mkdir(join(destination, ".."), { recursive: true });
      await writeFile(destination, `${content.trim()}\n`);
    }
    await mkdir(join(root, ".skillset/plugins/tools/bin"));
    await mkdir(join(root, ".skillset/plugins/tools/bin/work"));
    await writeFile(
      join(root, ".skillset/plugins/tools/bin/server"),
      "#!/bin/sh\n"
    );
    await writeFile(
      join(root, ".skillset/plugins/tools/bin/arg-server.js"),
      "console.log('ready');\n"
    );
    await writeFile(
      join(root, ".skillset/plugins/tools/bin/unrelated"),
      "do not package\n"
    );
    await chmod(join(root, ".skillset/plugins/tools/bin/server"), 0o755);
    await writeFile(
      join(root, ".skillset/plugins/tools/bin/work/config.json"),
      "{}\n"
    );

    const loaded = await loadBuildGraph(root);
    const graph = {
      ...loaded,
      standardProjections: {
        adopted: ["agent-plugins-1.0" as const],
        adoptionReceiptHashes: {
          "agent-plugins-1.0": `sha256:${"a".repeat(64)}` as const,
        },
      },
    };
    const rendered = await renderBuildGraph(graph);
    const text = new TextDecoder();
    const output = (suffix: string) => {
      const file = rendered.find((candidate) =>
        candidate.path.endsWith(suffix)
      );
      expect(file).toBeDefined();
      return text.decode(file?.content);
    };
    expect(output("plugins/tools/mcp.json")).toContain('"headers"');
    expect(output("plugins/tools/mcp.json")).toContain(
      '"local-with-cwd"'
    );
    expect(output("plugins/tools/mcp.json")).toContain(
      '"type": "stdio"'
    );
    expect(output("plugins/tools/mcp.json")).toContain(
      '"${PLUGIN_ROOT}/bin/work"'
    );
    expect(
      rendered.find((file) =>
        file.path.endsWith("plugins/tools/bin/server")
      )?.sourcePath
    ).toBe(".skillset/plugins/tools/bin/server");

    expect(output("plugins/tools/mcp.json")).toContain(
      '"type": "streamable-http"'
    );
    expect(
      rendered.find((file) =>
        file.path.endsWith("plugins/tools/bin/server")
      )?.mode
    ).toBe(0o755);
    expect(output("plugins/tools/bin/work/config.json")).toBe("{}\n");
    expect(
      rendered.find((file) =>
        file.path.endsWith("plugins/tools/bin/arg-server.js")
      )?.sourcePath
    ).toBe(".skillset/plugins/tools/bin/arg-server.js");
    expect(
      rendered.some((file) =>
        file.path.endsWith("plugins/tools/bin/unrelated")
      )
    ).toBe(false);
    const lockFile = rendered.find(
      (file) => file.path === "plugins/skillset.lock"
    );
    expect(lockFile).toBeDefined();
    const lock = JSON.parse(text.decode(lockFile?.content)) as {
      readonly items: readonly {
        readonly consumers?: readonly unknown[];
        readonly feature?: string;
        readonly outputPath?: string;
        readonly owner?: unknown;
      }[];
    };
    const mcpItem = lock.items.find(
      (item) =>
        item.feature === "mcp" && item.outputPath === "tools/mcp.json"
    );
    expect(mcpItem).toMatchObject({
      consumers: [
        { phase: "baseline", standardProfile: "agent-plugins-1.0" },
        { phase: "delta", target: "codex" },
      ],
      owner: { standardProfile: "agent-plugins-1.0" },
    });
    expect(
      collectRenderResults(graph, rendered, {
        claudeMarketplacePlugins: [],
        includedPaths: new Set(rendered.map((file) => file.path)),
        scopes: ["plugins"],
      })
    ).toContainEqual(
      expect.objectContaining({
        featureId: "plugin-mcp",
        outputs: expect.arrayContaining([
          { kind: "plugin-feature", path: "plugins/tools/mcp.json" },
        ]),
        status: "target_native",
        target: "codex",
      })
    );
  });

  it("keeps standard support paths while omitting a provider-unsupported server", async () => {
    const root = await createTestFixtureRoot("skillset-portable-mcp-support-");
    await mkdir(join(root, ".skillset/plugins/tools/bin/work"), {
      recursive: true,
    });
    await writeFile(
      join(root, "skillset.yaml"),
      "skillset:\n  name: support\ncompile:\n  unsupportedDestination: warn\nclaude: true\ncodex: false\ncursor: false\n"
    );
    await writeFile(
      join(root, ".skillset/plugins/tools/skillset.yaml"),
      "skillset:\n  name: tools\nbin: false\nmcp: true\n"
    );
    await writeFile(
      join(root, ".skillset/plugins/tools/.mcp.json"),
      `${JSON.stringify({
        $schema: AGENT_PLUGINS_MCP_SCHEMA,
        mcpServers: {
          unsupported: {
            command: "node",
            cwd: "${PLUGIN_ROOT}/bin/work",
          },
        },
      })}\n`
    );
    await writeFile(
      join(root, ".skillset/plugins/tools/bin/work/config.json"),
      "{}\n"
    );

    const build = await buildSkillsetResult(root);
    expect(
      build.data.some((file) => file.path.includes("plugins/tools/bin/"))
    ).toBe(true);
    const mcp = build.data.find((file) =>
      file.path.endsWith("/tools/.mcp.json")
    );
    expect(new TextDecoder().decode(mcp?.content)).not.toContain("unsupported");
  });

  it("rejects plugin references outside the neutral support envelope", async () => {
    const root = await createTestFixtureRoot("skillset-portable-mcp-collision-");
    await mkdir(join(root, ".skillset/plugins/tools"), { recursive: true });
    await writeFile(
      join(root, "skillset.yaml"),
      "skillset:\n  name: collision\ncursor: true\n"
    );
    await writeFile(
      join(root, ".skillset/plugins/tools/skillset.yaml"),
      "skillset:\n  name: tools\nmcp: true\n"
    );
    await writeFile(
      join(root, ".skillset/plugins/tools/.mcp.json"),
      `${JSON.stringify({
        $schema: AGENT_PLUGINS_MCP_SCHEMA,
        mcpServers: { local: { command: "./mcp.json" } },
      })}\n`
    );
    await writeFile(
      join(root, ".skillset/plugins/tools/mcp.json"),
      "support bytes\n"
    );

    await expect(loadBuildGraph(root)).rejects.toThrow(
      "must reference assets/, bin/, scripts/, or src/"
    );
  });

  it("routes provider-unsupported servers through policy without erasing the standards baseline", async () => {
    const cases = [
      {
        server: { type: "sse", url: "https://example.com/events" },
        target: "codex",
      },
      {
        server: {
          oauth: { clientId: "example" },
          type: "streamable-http",
          url: "https://example.com/mcp",
        },
        target: "claude",
      },
    ] as const;

    for (const testCase of cases) {
      const targetConfig = (["claude", "codex", "cursor"] as const)
        .map((target) => `${target}: ${target === testCase.target}`)
        .join("\n");
      const root = await createTestFixtureRoot("skillset-portable-mcp-policy-");
      await mkdir(join(root, ".skillset/plugins/tools"), { recursive: true });
      await writeFile(
        join(root, "skillset.yaml"),
        `skillset:\n  name: policy\n${targetConfig}\n`
      );
      await writeFile(
        join(root, ".skillset/plugins/tools/skillset.yaml"),
        "skillset:\n  name: tools\nmcp: true\n"
      );
      await writeFile(
        join(root, ".skillset/plugins/tools/.mcp.json"),
        `${JSON.stringify({
          $schema: AGENT_PLUGINS_MCP_SCHEMA,
          mcpServers: { unsupported: testCase.server },
        })}\n`
      );

      await expect(buildSkillsetResult(root)).rejects.toThrow(
        "unsupported destination policy blocked"
      );
      const preview = await diffSkillsetResult(
        root,
        {},
        { enforceRenderPolicy: false }
      );
      const previewOutcome = preview.renderResults.find(
        (result) =>
          result.featureId === "plugin-mcp" &&
          result.target === testCase.target
      );
      expect(previewOutcome).toEqual(
        expect.objectContaining({
          destination: "mcp",
          featureId: "plugin-mcp",
          policy: "unsupported:error",
          reason: expect.stringContaining("MCP server unsupported"),
          sourceUnit: "plugin.tools.feature:mcp",
          status: "unsupported",
          target: testCase.target,
        })
      );
      expect(previewOutcome?.outputs).toBeUndefined();

      await writeFile(
        join(root, "skillset.yaml"),
        `skillset:\n  name: policy\ncompile:\n  unsupportedDestination: warn\n${targetConfig}\n`
      );
      const warned = await buildSkillsetResult(root);
      expect(warned.ok).toBe(true);
      const warnedOutcome = warned.renderResults.find(
        (result) =>
          result.featureId === "plugin-mcp" &&
          result.target === testCase.target
      );
      expect(warnedOutcome).toEqual(
        expect.objectContaining({
          destination: "mcp",
          featureId: "plugin-mcp",
          policy: "unsupported:warn",
          reason: previewOutcome?.reason,
          sourceUnit: "plugin.tools.feature:mcp",
          status: "unsupported",
          target: testCase.target,
        })
      );
      expect(warnedOutcome?.evidence).toEqual(previewOutcome?.evidence);
      expect(warnedOutcome?.outputs).toBeUndefined();
      expect(
        warned.diagnostics.filter(
          (diagnostic) =>
            diagnostic.code === "unsupported-destination-warn" &&
            diagnostic.featureId === "plugin-mcp" &&
            diagnostic.target === testCase.target
        )
      ).toEqual([
        {
          code: "unsupported-destination-warn",
          featureId: "plugin-mcp",
          message: `unsupported destination warning: ${testCase.target} mcp plugin-mcp unsupported; ${warnedOutcome?.reason}`,
          path: ".skillset/plugins/tools/.mcp.json",
          severity: "warning",
          sourceUnit: "plugin.tools.feature:mcp",
          target: testCase.target,
        },
      ]);

      const portableMcp = warned.data.find(
        (file) => file.path === "plugins/tools/mcp.json"
      );
      expect(
        warned.data.some((file) =>
          /^plugins\/tools\/(?:agents|chatgpt|claude|codex|cursor)\//u.test(
            file.path
          )
        )
      ).toBe(false);

      if (testCase.target === "codex") {
        expect(portableMcp).toBeDefined();
        expect(
          JSON.parse(new TextDecoder().decode(portableMcp?.content))
        ).toEqual({
          $schema: AGENT_PLUGINS_MCP_SCHEMA,
          mcpServers: { unsupported: testCase.server },
        });
      } else {
        const providerMcp = warned.data.find(
          (file) => file.path === "plugins/tools/.mcp.json"
        );
        expect(providerMcp).toBeDefined();
        expect(new TextDecoder().decode(providerMcp?.content)).not.toContain(
          "unsupported"
        );
        if (portableMcp !== undefined) {
          expect(
            JSON.parse(new TextDecoder().decode(portableMcp.content))
          ).toEqual({
            $schema: AGENT_PLUGINS_MCP_SCHEMA,
            mcpServers: { unsupported: testCase.server },
          });
        }
      }
    }
  });

  it("enforces placeholders, reserved env, URLs, and HTTP fields", async () => {
    const cases: readonly [unknown, string][] = [
      [
        {
          mcpServers: {
            x: { args: ["${CLAUDE_PLUGIN_ROOT}/x"], command: "node" },
          },
        },
        "use ${PLUGIN_ROOT}",
      ],
      [
        { mcpServers: { x: { args: ["$PLUGIN_ROOT/x"], command: "node" } } },
        "use ${PLUGIN_ROOT}",
      ],
      [
        { mcpServers: { x: { command: "${PLUGIN_ROOT}/bin/x" } } },
        "placeholders are not allowed in command",
      ],
      [
        { mcpServers: { x: { command: "node", env: { plugin_root: "x" } } } },
        "reserved variable PLUGIN_ROOT",
      ],
      [
        {
          mcpServers: {
            x: { type: "streamable-http", url: "http://example.com" },
          },
        },
        "non-loopback MCP endpoints must use HTTPS",
      ],
      [
        {
          mcpServers: {
            x: { type: "streamable-http", url: "https://u:p@example.com" },
          },
        },
        "must not contain user information or a fragment",
      ],
      [
        {
          mcpServers: {
            x: { type: "streamable-http", url: "https://example.com/#x" },
          },
        },
        "must not contain user information or a fragment",
      ],
      [
        {
          mcpServers: {
            x: {
              headers: { "X-Path": "${PLUGIN_ROOT}" },
              type: "streamable-http",
              url: "https://example.com",
            },
          },
        },
        "cannot contain placeholders",
      ],
      [
        {
          mcpServers: {
            x: {
              headers: { Authorization: "x" },
              type: "streamable-http",
              url: "https://example.com",
            },
          },
        },
        "client-owned header Authorization",
      ],
      [
        {
          mcpServers: {
            x: {
              headers: { A: "x", a: "y" },
              type: "streamable-http",
              url: "https://example.com",
            },
          },
        },
        "duplicate case-insensitive header a",
      ],
      [
        {
          mcpServers: {
            x: {
              headers: { "bad name": "x" },
              type: "streamable-http",
              url: "https://example.com",
            },
          },
        },
        "invalid HTTP header name",
      ],
    ];

    for (const [source, message] of cases) {
      const input = await fixture(source);
      await expect(parsePortableMcpSource(input)).rejects.toThrow(message);
    }
  });

  it("validates plugin-root command, arg, and cwd references through real paths", async () => {
    const input = await fixture({
      mcpServers: {
        local: { command: "./bin/server", cwd: "./bin/work" },
      },
    });
    await mkdir(join(input.pluginRoot, "bin"));
    await mkdir(join(input.pluginRoot, "bin/work"));
    await writeFile(join(input.pluginRoot, "bin", "server"), "#!/bin/sh\n");
    expect(await parsePortableMcpSource(input)).toMatchObject({
      servers: { local: { command: "./bin/server", cwd: "./bin/work" } },
    });

    await mkdir(join(input.pluginRoot, "bin/data"));
    await writeFile(join(input.pluginRoot, "bin/root-server"), "#!/bin/sh\n");
    await writeFile(
      input.sourcePath,
      JSON.stringify({
        $schema: AGENT_PLUGINS_MCP_SCHEMA,
        mcpServers: {
          local: {
            command: "./bin/../bin/root-server",
            cwd: "${PLUGIN_ROOT}/bin/work/../data",
          },
        },
      })
    );
    await expect(parsePortableMcpSource(input)).rejects.toThrow(
      "contained ./ path"
    );

    await writeFile(
      input.sourcePath,
      JSON.stringify({
        $schema: AGENT_PLUGINS_MCP_SCHEMA,
        mcpServers: {
          local: {
            command: "node",
            cwd: "${PLUGIN_ROOT}/bin/work/../data",
          },
        },
      })
    );
    await expect(parsePortableMcpSource(input)).rejects.toThrow(
      "cwd escapes the plugin root"
    );

    const missing = await fixture({
      mcpServers: { local: { command: "./bin/missing" } },
    });
    await expect(parsePortableMcpSource(missing)).rejects.toThrow(
      "does not exist"
    );

    const opaqueArg = await fixture({
      mcpServers: {
        local: {
          args: ["${PLUGIN_ROOT}/bin/missing.js"],
          command: "node",
        },
      },
    });
    await expect(parsePortableMcpSource(opaqueArg)).rejects.toThrow(
      "does not exist"
    );

    const outside = await createTestFixtureRoot("skillset-portable-mcp-outside-");
    const outsideFile = join(outside, "server.js");
    await writeFile(outsideFile, "");
    await symlink(outsideFile, join(input.pluginRoot, "bin/arg-escape.js"));
    await writeFile(
      input.sourcePath,
      JSON.stringify({
        $schema: AGENT_PLUGINS_MCP_SCHEMA,
        mcpServers: {
          local: {
            args: ["${PLUGIN_ROOT}/bin/arg-escape.js"],
            command: "node",
          },
        },
      })
    );
    await expect(parsePortableMcpSource(input)).rejects.toThrow(
      "resolves outside the plugin root"
    );

    await symlink(outside, join(input.pluginRoot, "bin/escape"));
    await writeFile(
      input.sourcePath,
      JSON.stringify({
        $schema: AGENT_PLUGINS_MCP_SCHEMA,
        mcpServers: { local: { command: "node", cwd: "./bin/escape" } },
      })
    );
    await expect(parsePortableMcpSource(input)).rejects.toThrow(
      "resolves outside the plugin root"
    );
  });

  it("collects plugin-root argument support paths deterministically", async () => {
    const input = await fixture({
      mcpServers: {
        local: {
          args: [
            "${PLUGIN_ROOT}/scripts/z.js",
            "${PLUGIN_ROOT}/bin/a.js",
            "${PLUGIN_ROOT}/scripts/z.js",
          ],
          command: "node",
        },
      },
    });
    await mkdir(join(input.pluginRoot, "bin"));
    await mkdir(join(input.pluginRoot, "scripts"));
    await writeFile(join(input.pluginRoot, "bin/a.js"), "");
    await writeFile(join(input.pluginRoot, "scripts/z.js"), "");

    expect((await parsePortableMcpSource(input)).supportPaths).toEqual([
      "bin/a.js",
      "scripts/z.js",
    ]);

    await writeFile(
      input.sourcePath,
      JSON.stringify({
        $schema: AGENT_PLUGINS_MCP_SCHEMA,
        mcpServers: {
          local: {
            args: ["--server=${PLUGIN_ROOT}/bin/a.js"],
            command: "node",
          },
        },
      })
    );
    await expect(parsePortableMcpSource(input)).rejects.toThrow(
      "must use a standalone ${PLUGIN_ROOT}/<path> reference"
    );
  });
});
