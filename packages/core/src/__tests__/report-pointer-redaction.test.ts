import { expect, test } from "bun:test";
import { containsSensitiveReportContent, sanitizeAndValidateSkillsetReport, serializeSkillsetReport, renderSkillsetReportMarkdown } from "../report";

function report(pointer: string) {
  return { createdAt: "2026-10-30T00:00:00.000Z", id: "6ba7b810-9dad-4c8e-8a46-7e8dd6f4e6d5", kind: "import", schemaVersion: "skillset.report@1", skillset: { version: "0.1.1" }, workspace: { id: "workspace--local-12abcdef3456" }, result: { command: "import", exitCode: 0, ok: true }, payload: {
    destinations: [".skillset/plugins/demo"], diagnosticCodes: [], fields: { inferred: 0, preserved: 0, unsupported: 0 }, fileCount: 1, importedUnitIds: ["plugin:demo"], listCounts: { destinations: 1, importedUnitIds: 1 }, partial: false, requestedKind: "plugin", requestedProvider: "claude", warningCodes: [], renderResults: { failed: 0, rendered: 0, skipped: 0, unsupported: 0 }, normalizations: [{ code: "mcp.claude-http-transport", dialect: "claude", source: { path: ".mcp.json", pointer }, destination: { path: ".skillset/plugins/demo/.mcp.json", pointer }, occurrences: 1, fidelity: "unknown", evidence: ["Observed conversion"] }],
  } };
}

for (const key of ["ghp_" + "A".repeat(20), "section/ghp_" + "A".repeat(20), "section~ghp_" + "A".repeat(20)]) {
  test("redaction and final scanning recognize decoded credential-shaped pointer segments", () => {
    const pointer = "/mcpServers/" + key.replaceAll("~", "~0").replaceAll("/", "~1") + "/type";
    const input = report(pointer);
    expect(containsSensitiveReportContent(JSON.stringify(input))).toBe(true);
    const sanitized = sanitizeAndValidateSkillsetReport(input);
    const output = serializeSkillsetReport(sanitized) + renderSkillsetReportMarkdown(sanitized);
    expect(output.includes("ghp_" + "A".repeat(20))).toBe(false);
    expect(output).toContain("[REDACTED]");
    expect(input.payload.normalizations[0]?.source.pointer).toBe(pointer);
  });
}

test("decoded sentinels are removed and ordinary escaped keys retain exact locations", () => {
  const sentinel = "private/marker~value";
  const pointer = "/mcpServers/private~1marker~0value/type";
  expect(containsSensitiveReportContent(JSON.stringify(report(pointer)), [sentinel])).toBe(true);
  const sanitized = sanitizeAndValidateSkillsetReport(report(pointer), [sentinel]);
  expect(serializeSkillsetReport(sanitized)).toContain("/mcpServers/[REDACTED]/type");
  const ordinary = "/mcpServers/section~1ordinary~0key/type";
  const exact = sanitizeAndValidateSkillsetReport(report(ordinary));
  expect(serializeSkillsetReport(exact)).toContain(ordinary);
  expect(containsSensitiveReportContent(serializeSkillsetReport(exact))).toBe(false);
});

test("bundle reads reject escaped credentials even when JSON and Markdown agree", async () => {
  const { join } = await import("node:path");
  const { writeFile } = await import("node:fs/promises");
  const { createTestFixtureRoot } = await import("../../../../scripts/test-helpers/fixture-root");
  const { createReportBundle, readReportBundleAtBoundary } = await import("../report-store");
  const root = await createTestFixtureRoot("skillset-pointer-read-");
  const boundary = { reportRoot: join(root, "reports"), trustedBase: root };
  const safe = sanitizeAndValidateSkillsetReport(report("/mcpServers/ordinary/type"));
  const stored = await createReportBundle(safe, { boundary });
  const pointer = "/mcpServers/section~1ghp_" + "A".repeat(20) + "/type";
  const unsafe = { ...safe, payload: report(pointer).payload } as typeof safe;
  await writeFile(join(stored.resolvedPath, "report.json"), serializeSkillsetReport(unsafe));
  await writeFile(join(stored.resolvedPath, "report.md"), renderSkillsetReportMarkdown(unsafe));
  await expect(readReportBundleAtBoundary(safe.id, { boundary })).rejects.toThrow("sensitive");
});
