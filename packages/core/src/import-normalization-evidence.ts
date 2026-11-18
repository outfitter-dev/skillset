import { providerMcpEvidence } from "@skillset/registry";
import { validateImportNormalizations, type ImportNormalization } from "@skillset/schema";
import type { McpNormalizationChange } from "./portable-mcp-import";

/** Snapshot references explain the adapter choice; they are not a runtime judgment. */
export function recordMcpNormalizations(
  changes: readonly McpNormalizationChange[],
  dialect: ImportNormalization["dialect"],
  sourcePath: string,
  destinationPath: string
): readonly ImportNormalization[] {
  const snapshot = providerMcpEvidence.find((entry) => entry.target === dialect);
  const observations: readonly ImportNormalization[] = changes.map((change) => ({
    code: change.code, dialect,
    source: { path: sourcePath, pointer: change.sourcePointer },
    destination: { path: destinationPath, pointer: change.destinationPointer },
    occurrences: change.occurrences,
    fidelity: "unknown",
    evidence: [
      "Observed import conversion; provider runtime equivalence has not been established by this report.",
      "https://github.com/outfitter-dev/skillset/blob/main/docs/reference/features/mcp-servers.md",
      ...(snapshot?.sources.map((entry) => entry.url) ?? []),
    ],
    ...(snapshot === undefined ? {} : { providerVersion: snapshot.providerVersion, observedAt: snapshot.observedAt }),
  }));
  const validation = validateImportNormalizations(observations);
  if (!validation.ok) throw new Error(`skillset: MCP normalization evidence is not representable: ${validation.diagnostics.map((item) => item.message).join("; ")}`);
  return observations;
}
