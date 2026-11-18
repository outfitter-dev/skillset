import { expect, test } from "bun:test";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { stringifyJson } from "@skillset/core/internal/yaml";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { importSource } from "../import";
import { persistImportReceipt } from "../operation-receipt";

for (const prefix of ["", "section/", "section~"]) {
  test(`receipt redacts credential-shaped pointer keys after ${JSON.stringify(prefix)} escaping`, async () => {
    const root = await createTestFixtureRoot("skillset-safe-normalization-");
    const sourcePath = join(root, "original");
    const fakeCredential = "ghp_" + "A".repeat(20);
    await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"demo"}');
    await Bun.write(join(sourcePath, ".mcp.json"), stringifyJson({ mcpServers: { [`${prefix}${fakeCredential}`]: { type: "http", url: "https://example.invalid/mcp" } } }));
    const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
    const receipt = await persistImportReceipt({ failed: false, imports: [report], rootPath: root, kind: "plugin", provider: "claude" });
    for (const file of ["report.json", "report.md"]) {
      const saved = await readFile(join(receipt.path, file), "utf8");
      expect(saved.includes(fakeCredential)).toBe(false);
      expect(saved).toContain("[REDACTED]");
    }
  });
}

test("canonical JSON with only a transport edit does not claim a formatting change", async () => {
  const root = await createTestFixtureRoot("skillset-normalization-format-");
  const sourcePath = join(root, "original");
  await Bun.write(join(sourcePath, ".claude-plugin/plugin.json"), '{"name":"demo"}');
  await Bun.write(join(sourcePath, ".mcp.json"), stringifyJson({ mcpServers: { demo: { type: "http", url: "https://example.invalid/mcp" } } }));
  const report = await importSource({ rootPath: root, sourcePath, kind: "plugin", provider: "claude" });
  expect(report.normalizations?.filter((entry) => entry.code.startsWith("mcp.")).map((entry) => entry.code)).toEqual(["mcp.claude-http-transport"]);
});
