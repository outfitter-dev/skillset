/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- The fixture helper stays below the tests so the behavioral contract leads the file. */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  runAgentPluginsProbe,
  validateAgentPluginsSchemas,
} from "../agent-plugins";

const PLUGIN_SCHEMA =
  "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

describe("SET-411 Agent Plugins candidate conformance", () => {
  test("validates pinned schemas and lists an exact pure package through isolated Codex", async () => {
    const packageRoot = await fixturePackage();
    const codexBin = path.join(packageRoot, "..", "fake-codex");
    await writeFile(
      codexBin,
      `#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  console.log("codex-cli 0.154.0");
  process.exit(0);
}
if (!args.includes("--available") || !args.includes("--json")) {
  console.error("missing read-only listing arguments");
  process.exit(2);
}
if (args.includes("install") || args.includes("add") || args.slice(0, 2).join(" ") === "plugin enable") {
  console.error("mutating plugin command requested");
  process.exit(3);
}
for (const key of ["CODEX_HOME", "HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]) {
  if (!process.env[key]?.includes("skillset-agent-plugins-conformance-")) {
    console.error(\`unisolated environment: \${key}\`);
    process.exit(4);
  }
}
const sourceArg = args.find((arg) => arg.startsWith("marketplaces.skillset_conformance.source="));
if (sourceArg === undefined) process.exit(5);
const marketplaceRoot = JSON.parse(sourceArg.slice(sourceArg.indexOf("=") + 1));
const catalog = JSON.parse(await readFile(join(marketplaceRoot, ".agents/plugins/marketplace.json"), "utf-8"));
if (catalog.plugins[0].source.path !== "./plugins/candidate-plugin") process.exit(6);
const packagePath = join(marketplaceRoot, catalog.plugins[0].source.path);
if (packagePath.endsWith("/agents")) process.exit(7);
const manifest = JSON.parse(await readFile(join(packagePath, "plugin.json"), "utf-8"));
await readFile(join(packagePath, "mcp.json"), "utf-8");
console.log(JSON.stringify({ available: [{ pluginId: manifest.name + "@" + catalog.name }], installed: [] }));
`
    );
    await chmod(codexBin, 0o755);
    const before = await readFile(
      path.join(packageRoot, "plugin.json"),
      "utf-8"
    );

    const codex = {
      binaryPath: codexBin,
      sha256: hash(await readFile(codexBin)),
      version: "0.154.0",
    } as const;
    const evidence = await runAgentPluginsProbe({ codex, packageRoot });

    expect(evidence.profile).toBe("agent-plugins-1.0");
    expect(evidence.schemas).toHaveLength(2);
    expect(evidence.schemas.map(({ schemaId }) => schemaId).toSorted()).toEqual(
      [MCP_SCHEMA, PLUGIN_SCHEMA].toSorted()
    );
    expect(
      evidence.schemas.every(
        ({ negativeCanary, valid, validator }) =>
          valid &&
          negativeCanary.rejected &&
          negativeCanary.diagnostic.includes("additional properties") &&
          validator.ajv === "8.20.0" &&
          validator.ajvFormats === "3.0.1" &&
          validator.draft === "2020-12"
      )
    ).toBe(true);
    expect(evidence.marketplace).toMatchObject({
      availablePluginIds: [
        "candidate-plugin@skillset-agent-plugins-conformance",
      ],
      codexBinaryHash: codex.sha256,
      codexVersion: "codex-cli 0.154.0",
      expectedPluginId: "candidate-plugin@skillset-agent-plugins-conformance",
      isolatedState: true,
      pin: codex,
      readOnly: true,
    });
    expect(evidence.marketplace.packageCopyHash).toBe(
      evidence.package.treeHash
    );
    expect(await readFile(path.join(packageRoot, "plugin.json"), "utf-8")).toBe(
      before
    );
  });

  test("rejects a whole-document MCP schema violation", async () => {
    const packageRoot = await fixturePackage();
    const mcpPath = path.join(packageRoot, "mcp.json");
    const mcp = JSON.parse(await readFile(mcpPath, "utf-8"));
    mcp.mcpServers.demo.env = { PLUGIN_ROOT: "forbidden" };
    await writeFile(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`);

    await expect(validateAgentPluginsSchemas(packageRoot)).rejects.toThrow(
      "mcp.json failed pinned Agent Plugins schema validation"
    );
  });

  test("rejects symlinks in the exact package tree", async () => {
    const packageRoot = await fixturePackage();
    await symlink(
      path.join(packageRoot, "plugin.json"),
      path.join(packageRoot, "linked-plugin.json")
    );
    const codexBin = path.join(packageRoot, "..", "unused-codex");

    await expect(
      runAgentPluginsProbe({
        codex: {
          binaryPath: codexBin,
          sha256: `sha256:${"0".repeat(64)}`,
          version: "0.154.0",
        },
        packageRoot,
      })
    ).rejects.toThrow("rejects symlink linked-plugin.json");
  });

  test("rejects a selected root that only contains an obsolete agents package", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "skillset-agent-plugins-test-")
    );
    const packageRoot = path.join(root, "plugins", "candidate-plugin");
    const obsoleteRoot = path.join(packageRoot, "agents");
    await mkdir(obsoleteRoot, { recursive: true });
    await writeFile(path.join(obsoleteRoot, "plugin.json"), "{}\n");
    await writeFile(path.join(obsoleteRoot, "mcp.json"), "{}\n");

    await expect(
      runAgentPluginsProbe({
        codex: {
          binaryPath: path.join(root, "unused-codex"),
          sha256: `sha256:${"0".repeat(64)}`,
          version: "0.154.0",
        },
        packageRoot,
      })
    ).rejects.toThrow(
      "Agent Plugins probe package is missing plugin.json, mcp.json"
    );
  });

  test("rejects a Codex executable whose bytes do not match the pin", async () => {
    const packageRoot = await fixturePackage();
    const codexBin = path.join(packageRoot, "..", "fake-codex");
    await writeFile(codexBin, "#!/bin/sh\nexit 0\n");
    await chmod(codexBin, 0o755);

    await expect(
      runAgentPluginsProbe({
        codex: {
          binaryPath: codexBin,
          sha256: `sha256:${"0".repeat(64)}`,
          version: "0.154.0",
        },
        packageRoot,
      })
    ).rejects.toThrow("Codex binary integrity mismatch");
  });
});

async function fixturePackage(): Promise<string> {
  const root = await mkdtemp(
    path.join(tmpdir(), "skillset-agent-plugins-test-")
  );
  const packageRoot = path.join(root, "plugins", "candidate-plugin");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    path.join(packageRoot, "plugin.json"),
    `${JSON.stringify(
      {
        $schema: PLUGIN_SCHEMA,
        description: "Candidate Agent Plugins package",
        name: "candidate-plugin",
        version: "0.1.0",
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    path.join(packageRoot, "mcp.json"),
    `${JSON.stringify(
      {
        $schema: MCP_SCHEMA,
        mcpServers: {
          demo: {
            args: ["./scripts/server.ts"],
            command: "bun",
            type: "stdio",
          },
        },
      },
      null,
      2
    )}\n`
  );
  await mkdir(path.join(packageRoot, "scripts"));
  await writeFile(
    path.join(packageRoot, "scripts", "server.ts"),
    "export {};\n"
  );
  return packageRoot;
}

function hash(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
