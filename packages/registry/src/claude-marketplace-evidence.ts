import { createHash } from "node:crypto";
import { claudeMarketplaceRules } from "./claude-marketplace-rules";
import type { ProviderSchemaJsonValue } from "./schema-snapshots";

export interface ClaudeMarketplaceRuleEvidence {
  readonly id: string;
  readonly owners: readonly string[];
  readonly predicate: string;
  readonly qualification: string;
  /** Exact facts from the third-party schema pin, never provider runtime proof. */
  readonly schema: readonly { readonly pointer: string; readonly value: ProviderSchemaJsonValue }[];
}

export interface ClaudeMarketplaceEvidence {
  readonly id: "claude-marketplace-extensions";
  readonly target: "claude";
  readonly schemaSnapshotId: "claude-marketplace-schema";
  readonly reviewedAt: string;
  readonly source: { readonly url: string; readonly contentHash: string };
  readonly rules: readonly ClaudeMarketplaceRuleEvidence[];
}

export const CLAUDE_MARKETPLACE_EVIDENCE: ClaudeMarketplaceEvidence = {
  id: "claude-marketplace-extensions",
  target: "claude",
  schemaSnapshotId: "claude-marketplace-schema",
  reviewedAt: "2026-10-31",
  source: {
    url: "https://json.schemastore.org/claude-code-marketplace.json",
    contentHash: "sha256:42c3f80413638e93a420256d942f409104b651379b9ac2451cc636f581de2ffc",
  },
  rules: claudeMarketplaceRules,
};

export function assertClaudeMarketplaceEvidence(evidence: ClaudeMarketplaceEvidence): void {
  const invalid = (message: string): never => { throw new Error(`skillset: Claude marketplace evidence ${message}`); };
  if (evidence.id !== "claude-marketplace-extensions") invalid("has an unknown identity");
  if (evidence.target !== "claude") invalid("has the wrong target");
  if (evidence.schemaSnapshotId !== "claude-marketplace-schema") invalid("has the wrong schema linkage");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(evidence.reviewedAt)) invalid("requires a review date");
  if (!/^https:\/\//u.test(evidence.source?.url ?? "") || !/^sha256:[a-f0-9]{64}$/u.test(evidence.source?.contentHash ?? "")) invalid("requires a pinned HTTPS source");
  if (evidence.rules.length === 0) invalid("requires rules");
  const ids = new Set<string>();
  for (const rule of evidence.rules) {
    if (rule.id.trim() === "" || ids.has(rule.id)) invalid(`has a missing or duplicate rule ID ${rule.id}`);
    ids.add(rule.id);
    if (rule.owners.length === 0 || rule.owners.some((owner) => owner.trim() === "")) invalid(`${rule.id} requires an implementation owner`);
    if (rule.predicate.trim() === "" || rule.qualification.trim() === "") invalid(`${rule.id} requires a predicate and provenance qualification`);
    const pointers = new Set<string>();
    for (const fact of rule.schema) {
      if (!/^\/(?:[^~]|~[01])*$/u.test(fact.pointer) || pointers.has(fact.pointer) || fact.value === undefined) invalid(`${rule.id} has an invalid or duplicate schema pointer`);
      pointers.add(fact.pointer);
    }
  }
}

export interface ClaudeMarketplaceEvidenceReview {
  readonly id: ClaudeMarketplaceEvidence["id"];
  readonly schemaSnapshotId: ClaudeMarketplaceEvidence["schemaSnapshotId"];
  readonly reviewedAt: string;
  readonly sourceUrl: string;
  readonly status: "changed" | "matched" | "unavailable";
  readonly sourceChanged: boolean;
  readonly schemaRuleIds: readonly string[];
  readonly changedRuleIds: readonly string[];
  readonly unresolvedRuleIds: readonly string[];
}

/** Missing authority stays visible even when the fetched schema bytes match. */
export function inspectClaudeMarketplaceEvidence(
  evidence: ClaudeMarketplaceEvidence,
  sourceBody: string | undefined
): ClaudeMarketplaceEvidenceReview {
  assertClaudeMarketplaceEvidence(evidence);
  const schemaRules = evidence.rules.filter((rule) => rule.schema.length > 0);
  const base = {
    id: evidence.id, schemaSnapshotId: evidence.schemaSnapshotId,
    reviewedAt: evidence.reviewedAt, sourceUrl: evidence.source.url,
    schemaRuleIds: schemaRules.map((rule) => rule.id),
    unresolvedRuleIds: evidence.rules.filter((rule) => rule.schema.length === 0).map((rule) => rule.id),
  };
  let document: unknown;
  try {
    if (sourceBody === undefined) throw new Error("source unavailable");
    document = JSON.parse(sourceBody);
  } catch {
    return { ...base, changedRuleIds: [], sourceChanged: false, status: "unavailable" };
  }
  const actualHash = `sha256:${createHash("sha256").update(sourceBody!).digest("hex")}`;
  const sourceChanged = actualHash !== evidence.source.contentHash;
  const changedRuleIds = schemaRules.filter((rule) => rule.schema.some((fact) =>
    JSON.stringify(readPointer(document, fact.pointer)) !== JSON.stringify(fact.value)
  )).map((rule) => rule.id);
  return { ...base, changedRuleIds, sourceChanged, status: sourceChanged || changedRuleIds.length > 0 ? "changed" : "matched" };
}

function readPointer(document: unknown, pointer: string): unknown {
  let value = document;
  for (const segment of pointer.slice(1).split("/")) {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

assertClaudeMarketplaceEvidence(CLAUDE_MARKETPLACE_EVIDENCE);
