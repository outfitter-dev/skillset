import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { ImportNormalization } from "@skillset/schema";
import { ISOLATED_OUT_ROOT, type SkillsetBuildResult } from "./build";
import { compareCapability, findCapabilities, type CapabilityComparison } from "./capability-crosswalk";
import { readRecord } from "./config";
import { pluginManifestPath } from "./plugin-output";
import type { BuildGraph, JsonRecord } from "./types";

/** Ephemeral import facts: never persist source values or fingerprints in receipts. */
export interface ManifestIdentityCandidate {
  readonly configPath: string;
  readonly field: "name" | "description";
  readonly valueHash: string;
}

function hash(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** Capture only selected direct fields from the staged native manifest used for synthesis. */
export function captureManifestIdentityCandidates(entries: readonly ImportNormalization[], manifest: JsonRecord | undefined): readonly ManifestIdentityCandidate[] {
  if (manifest === undefined) return [];
  return entries.flatMap((entry) => {
    const field = entry.code === "manifest.name" ? "name" : entry.code === "manifest.description" ? "description" : undefined;
    if (field === undefined || entry.dialect !== "claude" || entry.source.path !== ".claude-plugin/plugin.json" || entry.source.pointer !== `/${field}` || entry.destination.pointer !== `/skillset/${field}`) return [];
    const value = manifest[field];
    return typeof value === "string" && value.length > 0 ? [{ configPath: entry.destination.path, field, valueHash: hash(value) }] : [];
  });
}

export function manifestIdentityComparison(): CapabilityComparison | undefined {
  return findCapabilities("claude-manifest-identity").flatMap((definition) => compareCapability(definition, ["claude"]))[0];
}

/** Called only with the graph and output bytes from the same successful isolated build. */
export function qualifyManifestIdentityRoundTrips(
  entries: readonly ImportNormalization[], candidates: readonly ManifestIdentityCandidate[], graph: BuildGraph,
  build: Pick<SkillsetBuildResult, "ok" | "data">, comparison: CapabilityComparison | undefined
): readonly ImportNormalization[] {
  const observations = entries.map(({ roundTrip: _previousProof, ...entry }) => entry);
  if (!build.ok) return observations;
  if (comparison?.capabilityId !== "claude-manifest-identity" || comparison.target !== "claude" || comparison.fidelity !== "exact" || comparison.evidenceStatus !== "current") return observations;
  return observations.map((entry) => {
    const candidate = candidates.find((item) => entry.dialect === "claude" && entry.code === `manifest.${item.field}` && entry.source.path === ".claude-plugin/plugin.json" && entry.source.pointer === `/${item.field}` && entry.destination.path === item.configPath && entry.destination.pointer === `/skillset/${item.field}`);
    if (candidate === undefined) return entry;
    const plugin = graph.plugins.find((item) => resolve(graph.rootPath, item.configPath) === resolve(graph.rootPath, candidate.configPath));
    if (plugin === undefined || !plugin.targets.claude.enabled) return entry;
    const { field, valueHash } = candidate;
    const value = plugin.metadata[field];
    if (typeof value !== "string" || hash(value) !== valueHash || (field === "name" && hash(plugin.id) !== valueHash)) return entry;
    const portable = readRecord(plugin.metadata, "manifest") ?? {};
    const native = readRecord(plugin.targets.claude.options, "manifest") ?? {};
    const listing = readRecord(plugin.metadata, "listing") ?? {};
    // Equality through an override is a different route, even if its value happens to agree.
    if (native[field] !== undefined || (field === "name" && portable.name !== undefined) || (field === "description" && (listing.summary !== undefined || listing.description !== undefined))) return entry;
    const path = `${ISOLATED_OUT_ROOT}/${pluginManifestPath(graph.root.outputs.plugins.claude, "claude", plugin)}`;
    const output = build.data.find((file) => file.path === path);
    if (output === undefined) return entry;
    const manifest = JSON.parse(new TextDecoder().decode(output.content)) as JsonRecord;
    if (typeof manifest[field] !== "string" || hash(manifest[field]) !== valueHash) return entry;
    return { ...entry, roundTrip: {
      scope: "claude-manifest-identity", target: "claude", fidelity: "exact",
      output: { path, pointer: `/${field}` }, outputHash: hash(output.content), authorityHash: comparison.authorityHash,
      evidence: ["docs/adrs/0048-adoption-is-a-reviewable-migration.md", comparison.semanticScope!, ...comparison.evidence.map((item) => item.ref)],
    } };
  });
}
