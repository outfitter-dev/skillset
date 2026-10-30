import type { ImportNormalization } from "@skillset/schema";

/** Values are deliberately absent: JSON pointers identify the observed source edits. */
export function renderImportNormalizations(entries: readonly ImportNormalization[]): readonly string[] {
  if (entries.length === 0) return [];
  const code = (value: string) => `\`${JSON.stringify(value).slice(1, -1).replaceAll("`", "\\u0060")}\``;
  return [
    "", "## Import normalizations", "",
    "These are observed source conversions. Runtime fidelity remains unknown; this report does not establish cross-provider equivalence.",
    ...entries.flatMap((entry) => [
      `- ${code(entry.code)} (${code(entry.dialect)}, ${entry.occurrences} occurrence(s)): ${code(entry.source.path + "#" + entry.source.pointer)} → ${code(entry.destination.path + "#" + entry.destination.pointer)}`,
      ...(entry.providerVersion === undefined ? [] : [`  - Provider evidence: ${code(entry.providerVersion)}, observed ${code(entry.observedAt ?? "unknown")}.`]),
      ...entry.evidence.map((evidence) => `  - ${code(evidence)}`),
    ]),
    "",
  ];
}
