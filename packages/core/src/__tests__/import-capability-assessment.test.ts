import { expect, test } from "bun:test";
import { assessImportedCapability, assessImportedCapabilityCandidate, assessImportedFrontmatter, assessImportedHookRuntime, assessImportedNormalizations } from "../import-capability-assessment";
import { compareCapability, findCapabilities } from "../capability-crosswalk";
import { validateImportCapabilityAssessments } from "@skillset/schema";
import { targetNames } from "../targets";

const request = { construct: "native-skill-frontmatter" as const, source: { path: ".skillset/skills/demo/SKILL.md", pointer: "/claude/frontmatter/disable-model-invocation" }, sourceProvider: "claude" as const, capabilityQuery: "disable-model-invocation" };

test("current canonical positive judgment is queried but does not apply to native overrides", () => {
  const definition = findCapabilities("skill-invocation")[0]!;
  const canonical = compareCapability(definition, ["codex"])[0]!;
  expect(canonical).toMatchObject({ fidelity: "exact", evidenceStatus: "current" });
  const imported = assessImportedCapability(request);
  expect(imported.find((row) => row.candidateTarget === "codex")).toMatchObject({ fidelity: "unknown", eligibility: "scope-mismatch", authorityHash: canonical.authorityHash, judgmentScope: canonical.semanticScope });
  expect(validateImportCapabilityAssessments(imported).ok).toBe(true);
});

test("stale candidate evidence cannot inherit its former judgment", () => {
  const row = compareCapability(findCapabilities("skill-invocation")[0]!, ["codex"])[0]!;
  expect(assessImportedCapabilityCandidate(request, "codex", { ...row, fidelity: "unknown", evidenceStatus: "stale" })).toMatchObject({ fidelity: "unknown", eligibility: "stale-evidence" });
});

test("unknown attribution, absent capability and absent judgment remain distinct", () => {
  expect(assessImportedFrontmatter({ path: "SKILL.md", providers: [], fields: ["disable-model-invocation"] }).every((entry) => entry.eligibility === "unknown-source" && entry.sourceProvider === undefined)).toBe(true);
  expect(assessImportedFrontmatter({ path: "SKILL.md", providers: ["claude"], fields: ["allowed-tools", "user-invocable", "unknown-field"] }).every((entry) => entry.eligibility === "no-capability")).toBe(true);
  expect(assessImportedCapability({ ...request, construct: "mcp-conversion", capabilityQuery: "plugin-mcp" }).every((entry) => entry.eligibility === "no-judgment")).toBe(true);
});

test("hook runtime cannot inherit declaration-only provider semantics", () => {
  const rows = assessImportedHookRuntime({ path: ".skillset/plugins/demo/_claude/hooks/hooks.json", targets: ["claude"], providers: ["claude"], pointers: ["/hooks/0"] });
  expect(rows).toHaveLength(targetNames().length);
  expect(rows.find((row) => row.candidateTarget === "claude")).toMatchObject({ fidelity: "unknown", eligibility: "scope-mismatch" });
  expect(rows.find((row) => row.candidateTarget === "codex")).toMatchObject({ fidelity: "unknown", eligibility: "no-judgment" });
  expect(assessImportedHookRuntime({ path: "hooks.json", targets: [] }).every((row) => row.eligibility === "unknown-source")).toBe(true);
});

test("field locations are exact, deterministic and value-free", () => {
  const first = assessImportedFrontmatter({ path: "SKILL.md", providers: ["cursor", "claude", "claude"], fields: ["x/y~z", "context"] });
  const second = assessImportedFrontmatter({ path: "SKILL.md", providers: ["claude", "cursor"], fields: ["context", "x/y~z", "context"] });
  expect(first).toEqual(second);
  expect(first.some((entry) => entry.source.pointer === "/claude/frontmatter/x~1y~0z")).toBe(true);
  expect(validateImportCapabilityAssessments(first).ok).toBe(true);
});

test("observed MCP conversion remains separate from an absent target semantic judgment", () => {
  const rows = assessImportedNormalizations([{ code: "mcp.claude-root-token", dialect: "claude", source: { path: ".mcp.json", pointer: "/mcpServers/demo/command" }, destination: { path: ".skillset/plugins/demo/.mcp.json", pointer: "/mcpServers/demo/command" }, occurrences: 1, fidelity: "unknown", evidence: ["observed"] }]);
  expect(rows).toHaveLength(targetNames().length);
  expect(rows.every((entry) => entry.eligibility === "no-judgment" && entry.fidelity === "unknown")).toBe(true);
});

test("report contract rejects forged fidelity, fields, paths and evidence", () => {
  const row = assessImportedCapability(request)[0]!;
  for (const patch of [{ fidelity: "exact" }, { eligibility: "eligible" }, { candidateTarget: "fake" }, { sourceProvider: "fake" }, { source: { path: "../escape", pointer: "" } }, { source: { path: "SKILL.md", pointer: "/bad~escape" } }, { reasons: [] }, { evidence: [] }, { authorityHash: "stale" }, { rawValue: "secret" }]) {
    expect(validateImportCapabilityAssessments([{ ...row, ...patch }]).ok).toBe(false);
  }
});

test("candidate Markdown cannot activate schema-provided identifiers or multiline reasons", async () => {
  const { renderImportCapabilityAssessments } = await import("../import-capability-report");
  const row = assessImportedCapability(request)[0]!;
  const hostile = "<img src=x> [link](https://example.invalid) ``ticks``\n\n# forged heading";
  const markdown = renderImportCapabilityAssessments([{ ...row, capabilityId: hostile, featureId: hostile, reasons: [hostile], source: { path: row.source.path, pointer: "/" + hostile } }]).join("\n");
  expect(markdown).not.toContain("\n\n# forged heading");
  expect(markdown).toContain("\\n\\n# forged heading");
  expect(markdown).toContain("```" + hostile.replaceAll("\n", "\\n") + "```");
});


test("global receipt field locators retain only approved public spellings and source layouts", async () => {
  const { sanitizeImportCapabilityAssessments } = await import("../import-capability-report");
  const row = assessImportedCapability(request)[0]!;
  const entries = [row,
    { ...row, source: { ...row.source, pointer: "/claude/frontmatter/private_customer_key" } },
    { ...row, source: { ...row.source, pointer: "/private_customer_key/disable-model-invocation" } },
    { ...row, source: { ...row.source, pointer: "/claude/frontmatter/private~1customer~0key" } },
  ];
  const sanitized = sanitizeImportCapabilityAssessments(entries);
  expect(sanitized[0]).toEqual(row);
  expect(sanitized.slice(1).every((entry) => entry.source.pointer === "/[REDACTED]")).toBe(true);
  expect(entries[1]?.source.pointer).toContain("private_customer_key");
  expect(sanitizeImportCapabilityAssessments(sanitized)).toEqual(sanitized);
});
