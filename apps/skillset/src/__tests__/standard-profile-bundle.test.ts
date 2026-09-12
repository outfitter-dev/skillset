import { expect, test } from "bun:test";
import { join } from "node:path";

test("SET-397: the public Bun CLI bundle embeds standard schemas without repository reads", async () => {
  const root = join(import.meta.dir, "../../../..");
  const result = await Bun.build({
    entrypoints: [join(root, "apps/skillset/src/cli.ts")],
    target: "bun",
  });

  expect(result.success).toBe(true);
  const artifact = (
    await Promise.all(result.outputs.map((output) => output.text()))
  ).join("\n");
  expect(artifact).toContain(
    "raw.githubusercontent.com/agentplugins/agent-plugins-spec/1fc1b6270e3cc492ec2d24ad7a34277c6d53b9c1/schemas/1.0.0/plugin.schema.json"
  );
  expect(artifact).toContain(
    "raw.githubusercontent.com/agentplugins/agent-plugins-spec/1fc1b6270e3cc492ec2d24ad7a34277c6d53b9c1/schemas/1.0.0/mcp.schema.json"
  );
  expect(artifact).toContain("AGENT_PLUGINS_PLUGIN_SCHEMA");
  expect(artifact).toContain("AGENT_PLUGINS_MCP_SCHEMA");
  expect(artifact).not.toContain("import.meta.dir");
});
