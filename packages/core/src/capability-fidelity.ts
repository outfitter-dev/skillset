import { createHash } from "node:crypto";

import type { CapabilityFidelity } from "@skillset/schema";

export type ReviewedCapabilityFidelity = Exclude<CapabilityFidelity, "unknown">;

export interface ScopedCapabilityJudgment {
  readonly fidelity: ReviewedCapabilityFidelity;
  readonly scope: string;
  readonly reason: string;
  readonly authorityHash: string;
}

export function capabilityAuthorityHash(record: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(record)).digest("hex")}`;
}

export function assessPinnedCapabilityJudgment(
  judgment: ScopedCapabilityJudgment | undefined,
  authorityHash: string | undefined
): { readonly fidelity: CapabilityFidelity; readonly scope: string; readonly reason: string } {
  if (judgment === undefined) {
    return { fidelity: "unknown", scope: "event relationship", reason: "No reviewed event relationship." };
  }
  if (authorityHash !== judgment.authorityHash) {
    return {
      fidelity: "unknown",
      scope: judgment.scope,
      reason: authorityHash === undefined ? "Reviewed evidence is missing." : "Reviewed evidence changed; reassessment is required.",
    };
  }
  return { fidelity: judgment.fidelity, scope: judgment.scope, reason: judgment.reason };
}
