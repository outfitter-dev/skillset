import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { importSource } from "../import";

async function roots(): Promise<{ external: string; root: string }> {
  return {
    external: await mkdtemp(join(tmpdir(), "skillset-mcp-import-source-")),
    root: await mkdtemp(join(tmpdir(), "skillset-mcp-import-root-")),
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe("portable MCP import", () => {
  test("rewrites Claude placeholders and transport spelling", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, ".claude-plugin/plugin.json"), {
      description: "Demo",
      name: "demo",
    });
    await writeJson(join(external, ".mcp.json"), {
      mcpServers: {
        local: {
          args: [
            "${CLAUDE_PLUGIN_ROOT}/scripts/server.js",
            "${CLAUDE_PLUGIN_DATA}/state",
          ],
          command: "node",
          cwd: "${CLAUDE_PLUGIN_ROOT}/scripts",
          env: { CACHE: "${CLAUDE_PLUGIN_DATA}/cache" },
        },
        remote: {
          type: "http",
          url: "https://example.com/mcp",
        },
      },
    });
    await mkdir(join(external, "scripts"), { recursive: true });
    await Bun.write(join(external, "scripts/server.js"), "export {};\n");

    const report = await importSource({
      kind: "plugin",
      provider: "claude",
      rootPath: root,
      sourcePath: external,
    });

    const source = JSON.parse(
      await readFile(join(report.targetPath, ".mcp.json"), "utf-8")
    );
    expect(source).toEqual({
      mcpServers: {
        local: {
          args: ["${PLUGIN_ROOT}/scripts/server.js", "${PLUGIN_DATA}/state"],
          command: "node",
          cwd: "${PLUGIN_ROOT}/scripts",
          env: { CACHE: "${PLUGIN_DATA}/cache" },
        },
        remote: {
          type: "streamable-http",
          url: "https://example.com/mcp",
        },
      },
    });
    expect(report.copiedFiles).toContain(".mcp.json");
  });

  test.each([
    {
      expected: {
        mcpServers: {
          remote: {
            headers: { "X-Tenant": "public" },
            type: "streamable-http",
            url: "https://example.com/mcp",
          },
        },
      },
      manifest: ".codex-plugin/plugin.json",
      provider: "codex" as const,
      sourceName: ".mcp.json",
      value: {
        mcpServers: {
          remote: {
            http_headers: { "X-Tenant": "public" },
            url: "https://example.com/mcp",
          },
        },
      },
    },
    {
      expected: {
        mcpServers: {
          remote: {
            type: "streamable-http",
            url: "https://example.com/mcp",
          },
        },
      },
      manifest: ".cursor-plugin/plugin.json",
      provider: "cursor" as const,
      sourceName: "mcp.json",
      value: {
        mcpServers: {
          remote: { url: "https://example.com/mcp" },
        },
      },
    },
  ])(
    "rewrites $provider native MCP into .mcp.json",
    async ({ expected, manifest, provider, sourceName, value }) => {
      const { external, root } = await roots();
      await writeJson(join(external, manifest), {
        description: "Demo",
        name: "demo",
      });
      await writeJson(join(external, sourceName), value);

      const report = await importSource({
        kind: "plugin",
        provider,
        rootPath: root,
        sourcePath: external,
      });

      expect(
        JSON.parse(
          await readFile(join(report.targetPath, ".mcp.json"), "utf-8")
        )
      ).toEqual(expected);
      expect(await Bun.file(join(report.targetPath, "mcp.json")).exists()).toBe(
        false
      );
    }
  );

  test("relocates a provider manifest's custom local MCP source", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, ".cursor-plugin/plugin.json"), {
      description: "Demo",
      mcpServers: "./config/tools.json",
      name: "demo",
    });
    await writeJson(join(external, "config/tools.json"), {
      mcpServers: {
        remote: { url: "https://example.com/mcp" },
      },
    });

    const report = await importSource({
      kind: "plugin",
      provider: "cursor",
      rootPath: root,
      sourcePath: external,
    });

    expect(
      JSON.parse(await readFile(join(report.targetPath, ".mcp.json"), "utf-8"))
    ).toEqual({
      mcpServers: {
        remote: {
          type: "streamable-http",
          url: "https://example.com/mcp",
        },
      },
    });
    expect(report.copiedFiles).not.toContain("config/tools.json");
    expect(
      await Bun.file(join(report.targetPath, "config/tools.json")).exists()
    ).toBe(false);
  });

  test("preserves provider credential placeholders as whole unsupported entries", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, ".cursor-plugin/plugin.json"), {
      description: "Demo",
      name: "demo",
    });
    await writeJson(join(external, "mcp.json"), {
      mcpServers: {
        authenticated: {
          headers: { Authorization: "Bearer ${API_TOKEN}" },
          url: "https://secure.example.com/mcp",
        },
      },
    });

    const report = await importSource({
      kind: "plugin",
      provider: "cursor",
      rootPath: root,
      sourcePath: external,
    });

    expect(
      JSON.parse(await readFile(join(report.targetPath, ".mcp.json"), "utf-8"))
    ).toEqual({
      mcpServers: {
        authenticated: {
          headers: { Authorization: "Bearer ${API_TOKEN}" },
          type: "streamable-http",
          url: "https://secure.example.com/mcp",
        },
      },
    });
  });

  test("fails atomically when a native MCP manifest reference is not local", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, ".cursor-plugin/plugin.json"), {
      description: "Demo",
      mcpServers: "https://example.com/mcp.json",
      name: "demo",
    });

    await expect(
      importSource({
        kind: "plugin",
        provider: "cursor",
        rootPath: root,
        sourcePath: external,
      })
    ).rejects.toThrow("must be one local ./ path");
    expect(await Bun.file(join(root, ".skillset/plugins/demo")).exists()).toBe(
      false
    );
  });

  test("does not rewrite provider vocabulary when importing canonical Agent Plugins MCP", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, "skillset.yaml"), {
      skillset: { name: "demo" },
    });
    await writeJson(join(external, ".mcp.json"), {
      mcpServers: {
        remote: { type: "http", url: "https://example.com/mcp" },
      },
    });

    await expect(
      importSource({
        kind: "plugin",
        provider: "agents",
        rootPath: root,
        sourcePath: external,
      })
    ).rejects.toThrow('replace provider transport "http"');
    expect(await Bun.file(join(root, ".skillset/plugins/demo")).exists()).toBe(
      false
    );
  });

  test("fails visibly on unmappable root extensions without committing", async () => {
    const { external, root } = await roots();
    await writeJson(join(external, ".claude-plugin/plugin.json"), {
      description: "Demo",
      name: "demo",
    });
    await writeJson(join(external, ".mcp.json"), {
      extension: { provider: true },
      mcpServers: {},
    });

    await expect(
      importSource({
        kind: "plugin",
        provider: "claude",
        rootPath: root,
        sourcePath: external,
      })
    ).rejects.toThrow("unmappable root fields: extension");
    expect(await Bun.file(join(root, ".skillset/plugins/demo")).exists()).toBe(
      false
    );
  });
});
