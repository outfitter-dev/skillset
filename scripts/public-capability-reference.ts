import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { TARGET_NAMES } from "@skillset/schema";
import { compareCapability, listCapabilities, type CapabilityComparison } from "@skillset/core/internal/capability-crosswalk";
import { assertNoSymlinkComponents } from "./docs-reference";

export const PUBLIC_CAPABILITY_REFERENCE = ".skillset/plugins/skillset/shared/references/provider-capabilities.md";
const HEADER = "<!-- Generated capability reference; do not edit. -->";

/** Retain consumer semantics while omitting contributor implementation locations. */
export function projectCapabilityComparison(row: CapabilityComparison) {
  return {
    featureId: row.featureId,
    target: row.target,
    canonical: row.canonical,
    destination: row.destination === undefined ? undefined : {
      id: row.destination.id,
      format: row.destination.format,
      sources: row.destination.provenance.sources.map(source => source.url),
    },
    realization: row.realization.description,
    destinationSupport: row.realization.destinationSupport,
    fidelity: row.fidelity,
    evidenceStatus: row.evidenceStatus,
    authorityHash: row.authorityHash,
    semanticScope: row.semanticScope,
    limitations: row.limitations.map(limitation => limitation.startsWith("Implementation proof:")
      ? "Reviewed implementation evidence is tracked with this capability; contributor locations are not bundled."
      : limitation),
    standards: row.standards,
  };
}

export function buildPublicCapabilityCatalog() {
  return listCapabilities().map(definition => ({
    id: definition.id,
    title: definition.title,
    family: definition.family,
    aliases: definition.aliases,
    rows: compareCapability(definition, TARGET_NAMES).map(projectCapabilityComparison),
  }));
}

export function renderPublicCapabilityReference(): string {
  return [
    HEADER, "", "# Provider Capability Reference", "",
    "This bundled snapshot is generated from the same semantic catalog as `skillset lookup capability`. Read the section matching the requested concept or exact native alias; an alias can identify more than one concept.", "",
    "Evidence status is relative to the bundled authority pins, not a live upstream freshness check. Destination support is separate from semantic fidelity. Neither establishes installation, activation, or runtime effectiveness. Missing or stale judgments remain unknown. Use a qualified installed CLI for its own current catalog; do not silently combine snapshots.", "",
    ...buildPublicCapabilityCatalog().flatMap(capability => [
      `## ${capability.id}: ${capability.title}`, "",
      `Family: ${capability.family}. Exact aliases: ${capability.aliases.length ? capability.aliases.map(alias => `\`${alias}\``).join(", ") : "none"}.`, "",
      ...capability.rows.flatMap(row => [
        `### ${row.target}: ${row.featureId}`, "",
        `- Canonical source: \`${row.canonical.shape}\` (contracts: ${row.canonical.contracts.map(id => `\`${id}\``).join(", ") || "none"}).`,
        `- Realization: ${row.realization}`,
        `- Destination support: ${row.destinationSupport}; fidelity: **${row.fidelity}**; evidence: **${row.evidenceStatus}**.`,
        `- Semantic scope: ${row.semanticScope ?? "No reviewed semantic scope is recorded."}`,
        `- Authority pin: \`${row.authorityHash}\`.`,
        `- Standards: ${row.standards.join(", ") || "none recorded"}.`,
        ...(row.destination === undefined ? ["- Provider-native destination: none recorded."] : [
          `- Provider-native destination: \`${row.destination.id}\`.`,
          "", "```json", JSON.stringify(row.destination.format, null, 2), "```", "",
          ...row.destination.sources.map(url => `- Provider source: ${url}`),
        ]),
        "", "Limitations:", "",
        ...row.limitations.map(limitation => `- ${limitation}`), "",
      ]),
    ]),
  ].join("\n");
}

export async function generatePublicCapabilityReference(
  root: string,
  options: { readonly check?: boolean } = {}
): Promise<void> {
  await assertNoSymlinkComponents(root, PUBLIC_CAPABILITY_REFERENCE);
  const output = join(root, PUBLIC_CAPABILITY_REFERENCE);
  const expected = renderPublicCapabilityReference();
  const current = await readFile(output, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (options.check) {
    if (current !== expected) throw new Error("skillset: public capability reference is missing or stale; run bun run docs:generate");
    return;
  }
  if (current !== undefined && !current.startsWith(HEADER)) {
    throw new Error("skillset: refusing to replace unmanaged public capability reference");
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, expected, "utf8");
}
