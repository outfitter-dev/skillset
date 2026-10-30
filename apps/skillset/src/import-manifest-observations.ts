import { listProviderDestinationFormatSnapshots, getStandardProfile } from "@skillset/registry";
import { validateImportNormalizations, type ImportNormalization } from "@skillset/schema";
import type { JsonRecord } from "@skillset/core/internal/types";

/** Capture assignments at config synthesis; no destination runtime equivalence is implied. */
export function manifestIdentityObservations(
  dialect: ImportNormalization["dialect"],
  manifest: JsonRecord,
  name: string,
  descriptionPointer: string | undefined,
  destinationPath: string
): readonly ImportNormalization[] {
  const snapshot = listProviderDestinationFormatSnapshots().find((entry) => entry.target === dialect && entry.destination === "plugin");
  const standard = dialect === "agent-plugins" ? getStandardProfile("agent-plugins-1.0") : undefined;
  const sourcePath = dialect === "agent-plugins" ? "plugin.json" : `.${dialect}-plugin/plugin.json`;
  const evidence = [
    "Observed manifest-to-source assignment; provider runtime equivalence has not been established by this report.",
    "https://github.com/outfitter-dev/skillset/blob/main/docs/configuration/frontmatter.md",
    ...(snapshot?.provenance.sources.map((entry) => entry.url) ?? []),
    ...(standard?.provenance.snapshots.map((entry) => entry.url) ?? []),
  ];
  const fields: { code: ImportNormalization["code"]; source: string; destination: string }[] = [];
  if (typeof manifest.name === "string") fields.push({ code: manifest.name === name ? "manifest.name" : "manifest.name-remap", source: "/name", destination: "/skillset/name" });
  if (descriptionPointer !== undefined) fields.push({ code: "manifest.description", source: descriptionPointer, destination: "/skillset/description" });
  const entries: ImportNormalization[] = fields.map((field) => ({
    code: field.code, dialect, source: { path: sourcePath, pointer: field.source },
    destination: { path: destinationPath, pointer: field.destination },
    occurrences: 1, fidelity: "unknown", evidence,
    ...(snapshot === undefined ? {} : { observedAt: snapshot.provenance.fetchedAt.slice(0, 10) }),
  }));
  const validation = validateImportNormalizations(entries);
  if (!validation.ok) throw new Error(`skillset: manifest normalization evidence is not representable: ${validation.diagnostics.map((item) => item.message).join("; ")}`);
  return entries;
}
