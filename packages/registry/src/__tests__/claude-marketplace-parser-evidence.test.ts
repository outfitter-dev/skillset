import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  CLAUDE_MARKETPLACE_PARSER_EVIDENCE,
  assertClaudeMarketplaceParserEvidence,
  inspectClaudeMarketplaceParserPin,
  verifyClaudeMarketplaceParserMember,
  type ClaudeMarketplaceParserEvidence,
} from "../claude-marketplace-parser-evidence";
import { getProviderValidationLane } from "../provider-validation";
import { CLAUDE_MARKETPLACE_EVIDENCE, assertClaudeMarketplaceEvidence, inspectClaudeMarketplaceEvidence } from "../claude-marketplace-evidence";
import { renderProviderMaintenanceReport } from "../../../../scripts/provider-maintenance";

const hash = (value: Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const source = CLAUDE_MARKETPLACE_PARSER_EVIDENCE;
const lane = getProviderValidationLane("claude-product");

describe("SET-488 immutable static parser qualification", () => {
  test("qualifies only the twenty inspected predicate groups, without claiming runtime acceptance", () => {
    expect(() => assertClaudeMarketplaceParserEvidence(source)).not.toThrow();
    expect(source.authority).toBe("static-parser-inspection");
    expect(inspectClaudeMarketplaceParserPin(source, lane).status).toBe("pin-matched");
    const parserRules = CLAUDE_MARKETPLACE_EVIDENCE.rules.filter((rule) => rule.parser !== undefined);
    expect(parserRules.map(({ id }) => id).sort()).toEqual(["marketplace.channels.shape", "marketplace.commands.object", "marketplace.commands.source", "marketplace.components.mcp_reference", "marketplace.entry.name.pattern", "marketplace.entry.name.unique", "marketplace.headers.helper_strict", "marketplace.headers.restricted", "marketplace.headers.shape", "marketplace.headers.source_digest", "marketplace.mcp.oauth.fields", "marketplace.mcp.oauth.values", "marketplace.mcp.records", "marketplace.mcp.variants", "marketplace.metadata.closed", "marketplace.renames.values", "marketplace.source.archive.digest", "marketplace.source.command.limits", "marketplace.userconfig.closed", "marketplace.userconfig.types"]);
    expect(parserRules.every(({ schema }) => schema.length === 0)).toBe(true);
  });
  test("keeps strict warnings distinct from schema predicates", () => {
    expect(source.predicates["entry-name-strict"].stage).toBe("strict-warning");
    expect(source.predicates["entry-name-unique"].stage).toBe("validator-error");
    expect(source.predicates["metadata-closed-strict"].stage).toBe("strict-warning");
    expect(source.predicates["rename-values"].stage).toBe("validator-error");
    for (const id of ["archive-digest", "command-limits"] as const) {
      expect(source.predicates[id].stage).toBe("schema-predicate");
    }
    const predicates = { ...source.predicates, "entry-name-strict": { ...source.predicates["entry-name-strict"], stage: "schema-predicate" as const } };
    expect(() => assertClaudeMarketplaceParserEvidence({ ...source, predicates })).toThrow();
  });
  test.each([
    ["version", { ...lane, version: "2.1.270" }],
    ["target", { ...lane, targets: ["cursor"] }],
    ["archive integrity", { ...lane, acquisitions: lane.acquisitions.map((item) => ({ ...item, integrity: "sha512-changed" })) }],
    ["archive URL", { ...lane, acquisitions: [] }],
    ["authority", { ...lane, authority: "provider-source" }],
  ])("reports %s pin drift", (_name, changed) => {
    expect(inspectClaudeMarketplaceParserPin(source, changed as typeof lane).status).toBe("pin-changed");
  });
  test("rejects nonexistent or wrong-rule parser references", () => {
    const rule = CLAUDE_MARKETPLACE_EVIDENCE.rules.find(({ id }) => id === "marketplace.source.archive.digest")!;
    for (const parser of ["missing", "command-limits"]) {
      expect(() => assertClaudeMarketplaceEvidence({ ...CLAUDE_MARKETPLACE_EVIDENCE, rules: [{ ...rule, parser } as typeof rule] })).toThrow();
    }
  });
  test.each([
    ["empty windows", { windows: [] }],
    ["wrong target", { target: "cursor" }],
    ["wrong schema", { schemaSnapshotId: "claude-plugin-manifest-schema" }],
    ["bad member digest", { member: { ...source.member, contentHash: "sha256:no" } }],
    ["out-of-range window", { windows: [{ ...source.windows[0], end: source.member.bytes + 1 }] }],
    ["duplicate window", { windows: [source.windows[0], source.windows[0]] }],
  ])("rejects %s evidence", (_name, patch) => {
    expect(() => assertClaudeMarketplaceParserEvidence({ ...source, ...patch } as ClaudeMarketplaceParserEvidence)).toThrow();
  });
  test("verifies exact member and window bytes without executing them", () => {
    const bytes = new TextEncoder().encode("synthetic static parser fixture");
    const fixture = { ...source, member: { ...source.member, bytes: bytes.length, contentHash: hash(bytes) },
      windows: source.windows.map((window) => ({ ...window, start: 0, end: 9, contentHash: hash(bytes.subarray(0, 9)) })) };
    expect(verifyClaudeMarketplaceParserMember(bytes, fixture)).toEqual({ ok: true, problems: [] });
    const corrupt = bytes.slice(); corrupt[0] = 0;
    expect(verifyClaudeMarketplaceParserMember(corrupt, fixture).ok).toBe(false);
    expect(verifyClaudeMarketplaceParserMember(bytes.subarray(1), fixture).ok).toBe(false);
    const wrongWindow = { ...fixture, windows: fixture.windows.map((window) => ({ ...window, contentHash: hash(bytes) })) };
    expect(verifyClaudeMarketplaceParserMember(bytes, wrongWindow).problems.some((problem) => problem.includes("window"))).toBe(true);
  });
  test("separates static review from unresolved authority and reports pin drift", () => {
    const body = "{}";
    const evidence = { ...CLAUDE_MARKETPLACE_EVIDENCE, source: { ...CLAUDE_MARKETPLACE_EVIDENCE.source, contentHash: hash(new TextEncoder().encode(body)) },
      rules: CLAUDE_MARKETPLACE_EVIDENCE.rules.filter((rule) => rule.parser !== undefined || rule.id === "marketplace.source.archive.url") };
    const matched = inspectClaudeMarketplaceEvidence(evidence, body);
    expect(matched.status).toBe("matched");
    expect(matched.parserRuleIds).toHaveLength(20);
    expect(matched.unresolvedRuleIds).toEqual(["marketplace.source.archive.url"]);
    expect(matched.parserReview?.status).toBe("pin-matched");
    const changed = inspectClaudeMarketplaceEvidence(evidence, body, { ...lane, version: "changed" });
    expect(changed.status).toBe("changed");
    expect(changed.parserReview?.status).toBe("pin-changed");
    const text = renderProviderMaintenanceReport({ command: "diff", destinationReviews: [], marketplaceReviews: [changed], errors: 0, ok: true, schemaChanged: 0, schemaMatched: 0, schemaPath: "/unused", schemaResults: [], wrote: false });
    expect(text).toContain("static parser");
    expect(text).toContain("pin-changed");
    expect(text).toContain("not runtime acceptance");
  });
});
