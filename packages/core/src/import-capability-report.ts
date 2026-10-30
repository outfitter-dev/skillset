import type { ImportCapabilityAssessment } from "@skillset/schema";

export function renderImportCapabilityAssessments(entries: readonly ImportCapabilityAssessment[]): readonly string[] {
  if (entries.length === 0) return [];
  return ["", "## Capability candidates", "", "These comparisons do not imply that a target is selected, an output was emitted, or runtime support is established.", "",
    ...entries.map((entry) => `- ${JSON.stringify(entry.source.path)}#${JSON.stringify(entry.source.pointer)} (${entry.sourceProvider ?? "unknown source"}) → ${entry.candidateTarget}: ${entry.capabilityId ?? "unmapped"}/${entry.featureId ?? "unmapped"}; ${entry.fidelity} (${entry.eligibility}). ${entry.reasons.join(" ")}`),
  ];
}
