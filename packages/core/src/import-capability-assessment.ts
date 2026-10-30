import type { ImportCapabilityAssessment, ImportNormalization } from "@skillset/schema";
import { compareCapability, findCapabilities, type CapabilityComparison } from "./capability-crosswalk";
import { compareStrings } from "./path";
import { targetNames } from "./targets";
import type { TargetName } from "./types";

export type ImportCapabilityRequest = Pick<ImportCapabilityAssessment, "construct" | "source" | "sourceProvider"> & { readonly capabilityQuery: string };

/** Query all registered candidate targets; neither source attribution nor a query alias authorizes a mapping. */
export function assessImportedCapability(request: ImportCapabilityRequest): readonly ImportCapabilityAssessment[] {
  const definitions = findCapabilities(request.capabilityQuery);
  return targetNames().flatMap((candidateTarget) => {
    const rows = definitions.flatMap((definition) => compareCapability(definition, [candidateTarget]));
    return (rows.length === 0 ? [undefined] : rows).map((row) => assessImportedCapabilityCandidate(request, candidateTarget, row));
  });
}

export function assessImportedCapabilityCandidate(request: ImportCapabilityRequest, candidateTarget: TargetName, row: CapabilityComparison | undefined): ImportCapabilityAssessment {
  const eligibility = request.sourceProvider === undefined ? "unknown-source"
    : row === undefined ? "no-capability"
    : row.evidenceStatus === "stale" ? "stale-evidence"
    : row.semanticScope === undefined ? "no-judgment" : "scope-mismatch";
  const reason = {
    "unknown-source": "Source provider is unknown; field spelling does not establish attribution or semantic equivalence.",
    "no-capability": "No capability matches this construct in the crosswalk; structural field recognition is not a semantic judgment.",
    "no-judgment": "The candidate capability has no pinned semantic judgment for this target.",
    "stale-evidence": "The candidate judgment does not match its current authority hash.",
    "scope-mismatch": request.construct === "native-hook-runtime"
      ? "Validated declaration pass-through does not establish arbitrary command, environment, payload or cross-provider runtime semantics."
      : "The candidate judgment describes canonical projection or validated pass-through, not this imported native construct. No source-to-destination judgment is established.",
  }[eligibility];
  return {
    construct: request.construct, source: request.source,
    ...(request.sourceProvider === undefined ? {} : { sourceProvider: request.sourceProvider }),
    candidateTarget, fidelity: "unknown", eligibility,
    ...(row === undefined ? {} : {
      capabilityId: row.capabilityId, featureId: row.featureId, authorityHash: row.authorityHash,
      ...(row.semanticScope === undefined ? {} : { judgmentScope: row.semanticScope }),
    }),
    reasons: [reason, ...(row?.limitations ?? [])],
    evidence: ["docs/adrs/0048-adoption-is-a-reviewable-migration.md", ...(row?.evidence.map((entry) => entry.ref) ?? [])],
  };
}

export function assessImportedFrontmatter(source: { readonly path: string; readonly fields: readonly string[]; readonly providers: readonly TargetName[] }): readonly ImportCapabilityAssessment[] {
  const providers = [...new Set(source.providers)].sort(compareStrings);
  return [...new Set(source.fields)].sort(compareStrings).flatMap((field) =>
    (providers.length === 0 ? [undefined] : providers).flatMap((provider) => assessImportedCapability({
      construct: "native-skill-frontmatter", capabilityQuery: field,
      source: { path: source.path, pointer: `${provider === undefined ? "" : `/${provider}/frontmatter`}/${field.replaceAll("~", "~0").replaceAll("/", "~1")}` },
      ...(provider === undefined ? {} : { sourceProvider: provider }),
    })));
}

export function assessImportedNormalizations(entries: readonly ImportNormalization[]): readonly ImportCapabilityAssessment[] {
  return entries.flatMap((entry) => {
    const construct = entry.code.startsWith("mcp.") ? "mcp-conversion" : entry.code.startsWith("manifest.") ? "manifest-conversion" : undefined;
    if (construct === undefined) return [];
    return assessImportedCapability({ construct, capabilityQuery: construct === "mcp-conversion" ? "plugin-mcp" : "plugin-manifests", sourceProvider: entry.dialect, source: entry.destination });
  });
}

export function capabilityFindingEvidence(assessments: readonly ImportCapabilityAssessment[]): readonly { readonly summary: string; readonly reference?: string }[] {
  return assessments.flatMap((entry) => [
    { summary: `Candidate target: ${entry.candidateTarget}; capability: ${entry.capabilityId ?? "unmapped"}; feature: ${entry.featureId ?? "unmapped"}; Capability fidelity: ${entry.fidelity}; eligibility: ${entry.eligibility}. ${entry.reasons.join(" ")}` },
    ...(entry.authorityHash === undefined ? [] : [{ summary: `Crosswalk authority: ${entry.authorityHash}. Judgment scope: ${entry.judgmentScope ?? "none"}.` }]),
    ...entry.evidence.map((reference) => ({ summary: "Crosswalk evidence (not an imported-source semantic judgment).", reference })),
  ]);
}


export function assessImportedHookRuntime(source: { readonly path: string; readonly targets: readonly TargetName[]; readonly pointers?: readonly string[] }): readonly ImportCapabilityAssessment[] {
  const providers = [...new Set(source.targets)].sort(compareStrings);
  return (providers.length === 0 ? [undefined] : providers).flatMap((sourceProvider) =>
    [...new Set(source.pointers ?? [""])].sort(compareStrings).flatMap((pointer) => assessImportedCapability({
      construct: "native-hook-runtime", capabilityQuery: "native-hooks", ...(sourceProvider === undefined ? {} : { sourceProvider }), source: { path: source.path, pointer },
    })));
}
