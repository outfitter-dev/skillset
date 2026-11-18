import { listProviderSkillFrontmatterFields } from "@skillset/registry";
import { targetNames } from "./targets";
import { renderInlineCode } from "./report-markdown";
import type { ImportCapabilityAssessment } from "@skillset/schema";

export function renderImportCapabilityAssessments(entries: readonly ImportCapabilityAssessment[]): readonly string[] {
  if (entries.length === 0) return [];
  // Escape line breaks before choosing a code fence so a source field cannot
  // terminate an inline span with a blank line.
  const code = (value: string) => renderInlineCode(JSON.stringify(value).slice(1, -1));
  return ["", "## Capability candidates", "", "These comparisons do not imply that a target is selected, an output was emitted, or runtime support is established.", "",
    ...entries.map((entry) => `- ${code(entry.source.path + "#" + entry.source.pointer)} (${code(entry.sourceProvider ?? "unknown source")}) → ${code(entry.candidateTarget)}: ${code(entry.capabilityId ?? "unmapped")}/${code(entry.featureId ?? "unmapped")}; ${code(entry.fidelity)} (${code(entry.eligibility)}). ${entry.reasons.map(code).join(" ")}`),
  ];
}


/** Unknown native field names are source content, not approved global receipt identifiers. */
export function sanitizeImportCapabilityAssessments(entries: readonly ImportCapabilityAssessment[]): readonly ImportCapabilityAssessment[] {
  return structuredClone(entries).map((entry) => entry.construct !== "native-skill-frontmatter" ? entry : {
    ...entry, source: { ...entry.source, pointer: approvedFieldPointer(entry.source.pointer, entry.sourceProvider) },
  });
}

function approvedFieldPointer(pointer: string, provider: string | undefined): string {
  const publicFields = new Set(targetNames().flatMap(listProviderSkillFrontmatterFields));
  const prefix = provider === undefined ? "/" : `/${provider}/frontmatter/`;
  const segment = pointer.startsWith(prefix) ? pointer.slice(prefix.length) : "";
  const field = segment.replaceAll("~1", "/").replaceAll("~0", "~");
  return segment.length > 0 && !segment.includes("/") && publicFields.has(field) ? pointer : "/[REDACTED]";
}

/** Apply the same allowlist to final serialized JSON, including reads of modified bundles. */
export function containsUnapprovedCapabilityLocations(value: unknown): boolean {
  if (typeof value !== "object" || value === null || !("payload" in value)) return false;
  const payload = value.payload;
  if (typeof payload !== "object" || payload === null || !("capabilityAssessments" in payload) || !Array.isArray(payload.capabilityAssessments)) return false;
  return payload.capabilityAssessments.some((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || !("construct" in entry) || entry.construct !== "native-skill-frontmatter" || !("source" in entry)) return false;
    const source = entry.source;
    if (typeof source !== "object" || source === null || !("pointer" in source) || typeof source.pointer !== "string") return false;
    const provider = "sourceProvider" in entry && typeof entry.sourceProvider === "string" ? entry.sourceProvider : undefined;
    return approvedFieldPointer(source.pointer, provider) !== source.pointer;
  });
}
