import type { MarketplacePluginEntryConfig } from "./types";

export type MarketplaceRefPolicyKind = "channel" | "local" | "ref" | "sha" | "version";

export interface MarketplaceRequestedRefPolicy {
  readonly channel?: string;
  readonly kind: MarketplaceRefPolicyKind;
  readonly ref?: string;
  readonly sha?: string;
  readonly version?: string;
}

export function marketplaceRequestedRefPolicy(
  entry: MarketplacePluginEntryConfig
): MarketplaceRequestedRefPolicy {
  if (entry.sha !== undefined) return { kind: "sha", sha: entry.sha };
  if (entry.ref !== undefined) return { kind: "ref", ref: entry.ref };
  if (entry.channel !== undefined) return { channel: entry.channel, kind: "channel" };
  if (entry.version !== undefined) return { kind: "version", version: entry.version };
  if (entry.repo !== undefined) return { channel: "latest", kind: "channel" };
  return { kind: "local" };
}
