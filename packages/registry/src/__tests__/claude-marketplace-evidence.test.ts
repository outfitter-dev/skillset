import { getProviderSchemaSnapshot, hashProviderSchemaSnapshot } from "../schema-snapshots";
import { runProviderMaintenance } from "../provider-maintenance";
import { renderProviderMaintenanceReport } from "../../../../scripts/provider-maintenance";
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  CLAUDE_MARKETPLACE_EVIDENCE,
  assertClaudeMarketplaceEvidence,
  inspectClaudeMarketplaceEvidence,
  type ClaudeMarketplaceEvidence,
} from "../claude-marketplace-evidence";

const hash = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const body = JSON.stringify({ properties: { owner: { type: "object" } } });
const example: ClaudeMarketplaceEvidence = {
  id: "claude-marketplace-extensions", target: "claude", schemaSnapshotId: "claude-marketplace-schema",
  reviewedAt: "2026-10-31", source: { url: "https://example.com/marketplace.json", contentHash: hash(body) },
  rules: [{ id: "owner.object", owners: ["checkClaudeMarketplace"], predicate: "owner is an object",
    qualification: "Synthetic test evidence only.", schema: [{ pointer: "/properties/owner/type", value: "object" }] },
    { id: "owner.closed", owners: ["checkClaudeMarketplace"], predicate: "owner fields are closed",
      qualification: "No external source establishes this restriction.", schema: [] }],
};

describe("SET-488 Claude marketplace evidence", () => {
  test("has an explicit marketplace identity and qualified rule owners", () => {
    expect(() => assertClaudeMarketplaceEvidence(CLAUDE_MARKETPLACE_EVIDENCE)).not.toThrow();
    expect(CLAUDE_MARKETPLACE_EVIDENCE.rules.some((rule) => rule.schema.length > 0)).toBe(true);
    expect(CLAUDE_MARKETPLACE_EVIDENCE.rules.some((rule) => rule.schema.length === 0)).toBe(true);
  });
  test.each([
    ["wrong target", { target: "cursor" }],
    ["wrong schema", { schemaSnapshotId: "claude-plugin-manifest-schema" }],
    ["missing source", { source: undefined }],
    ["missing rules", { rules: [] }],
    ["duplicate ID", { rules: [example.rules[0], example.rules[0]] }],
    ["missing owner", { rules: [{ ...example.rules[0], owners: [] }] }],
    ["missing qualification", { rules: [{ ...example.rules[0], qualification: "" }] }],
    ["invalid pointer", { rules: [{ ...example.rules[0], schema: [{ pointer: "properties", value: "object" }] }] }],
  ])("rejects %s", (_label, patch) => {
    expect(() => assertClaudeMarketplaceEvidence({ ...example, ...patch } as ClaudeMarketplaceEvidence)).toThrow();
  });
  test("matching schema leaves unresolved rules explicitly manual", () => {
    const result = inspectClaudeMarketplaceEvidence(example, body);
    expect(result.status).toBe("matched");
    expect(result.changedRuleIds).toEqual([]);
    expect(result.unresolvedRuleIds).toEqual(["owner.closed"]);
  });
  test("a nested change is attributed even when root properties stay the same", () => {
    const changed = inspectClaudeMarketplaceEvidence(example, body.replace('"object"', '"string"'));
    expect(changed.status).toBe("changed");
    expect(changed.changedRuleIds).toEqual(["owner.object"]);
    expect(changed.sourceChanged).toBe(true);
  });
  test("wrong or missing pointers fail even when source bytes match", () => {
    const wrong = { ...example, rules: [{ ...example.rules[0]!, schema: [{ pointer: "/properties/missing", value: "object" }] }] };
    expect(inspectClaudeMarketplaceEvidence(wrong, body).changedRuleIds).toEqual(["owner.object"]);
  });
  test("unrelated source drift still requires review of schema-backed rules", () => {
    const result = inspectClaudeMarketplaceEvidence(example, `${body}\n`);
    expect(result.status).toBe("changed");
    expect(result.changedRuleIds).toEqual([]);
    expect(result.schemaRuleIds).toEqual(["owner.object"]);
    expect(result.sourceChanged).toBe(true);
  });
  test("a failed fetch or invalid JSON cannot look matched", () => {
    expect(inspectClaudeMarketplaceEvidence(example, undefined).status).toBe("unavailable");
    expect(inspectClaudeMarketplaceEvidence(example, "{").status).toBe("unavailable");
  });
});


test("SET-488: maintenance exposes nested and independent evidence drift", async () => {
  const pinned = getProviderSchemaSnapshot("claude-marketplace-schema")!;
  const changedBody = body.replace('"object"', '"string"');
  // The general schema pin has already been refreshed, but evidence review has not.
  const refreshed = { ...pinned, summary: { schemaUri: "", properties: ["owner"] },
    provenance: { ...pinned.provenance, sources: [{ ...example.source, contentHash: hash(changedBody) }] } };
  const snapshot = { ...refreshed, provenance: { ...refreshed.provenance, contentHash: hashProviderSchemaSnapshot(refreshed) } };
  let fetches = 0;
  const report = await runProviderMaintenance("/unused", "check", {
    destinationSnapshots: [], schemaSnapshots: [snapshot], marketplaceEvidence: example,
    fetcher: async () => { fetches++; return { ok: true, status: 200, statusText: "OK", text: async () => changedBody }; },
  });
  expect(fetches).toBe(1);
  expect(report.schemaChanged).toBe(0);
  expect(report.ok).toBe(false);
  expect(report.marketplaceReviews[0]?.changedRuleIds).toEqual(["owner.object"]);
  expect(report.marketplaceReviews[0]?.unresolvedRuleIds).toEqual(["owner.closed"]);
  const text = renderProviderMaintenanceReport({ ...report, command: "diff" });
  expect(text).toContain("owner.object");
  expect(text).toContain("owner.closed");
  expect(text).toContain("manual review");
});

test("SET-488: unrelated schema selections do not pretend marketplace was fetched", async () => {
  const report = await runProviderMaintenance("/unused", "check", {
    destinationSnapshots: [], schemaSnapshots: [], fetcher: async () => { throw new Error("unexpected fetch"); },
  });
  expect(report.marketplaceReviews).toEqual([]);
  expect(report.ok).toBe(true);
});

test("SET-488: production marketplace source pin matches its schema snapshot", () => {
  const snapshot = getProviderSchemaSnapshot(CLAUDE_MARKETPLACE_EVIDENCE.schemaSnapshotId)!;
  expect(snapshot.target).toBe(CLAUDE_MARKETPLACE_EVIDENCE.target);
  expect(snapshot.provenance.sources).toContainEqual(expect.objectContaining(CLAUDE_MARKETPLACE_EVIDENCE.source));
});
