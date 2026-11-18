import { importedMetadataFindings } from "./adoption-metadata-findings";
import { createHash } from "node:crypto";
import { listProviderSkillFrontmatterFields, providerDestinationFormatSnapshots } from "@skillset/registry";
import type { MigrationFlag } from "@skillset/schema";
import { assessImportedFrontmatter, capabilityFindingEvidence } from "./import-capability-assessment";
import { readRecord } from "./config";
import { createInitialMigrationFlag } from "./migration-state-reconcile";
import { compareStrings } from "./path";
import type { SourceOrigin, TargetName } from "./types";
import { parseMarkdown } from "./yaml";

export interface FrontmatterFindingSource {
  readonly path: string;
  readonly providers: readonly TargetName[];
  readonly fields: readonly string[];
  readonly metadataCompatibility?: boolean;
  readonly origin?: SourceOrigin;
}

/** Attribution is not proof of portable semantics, including for structurally known fields. */
export function importedFrontmatterFindings(source: FrontmatterFindingSource, content: string): readonly MigrationFlag[] {
  const { frontmatter } = parseMarkdown(content, source.path);
  const providers = [...new Set(source.providers)].sort(compareStrings);
  const fieldFindings = [...new Set(source.fields)].sort(compareStrings).flatMap((field) =>
    (providers.length === 0 ? [undefined] : providers).map((provider) => {
      const value = provider === undefined ? frontmatter[field] : readRecord(readRecord(frontmatter, provider) ?? {}, "frontmatter")?.[field];
      if (value === undefined) throw new Error(`skillset: ${source.path}: imported field ${field} is missing from its recorded provider boundary.`);
      const known = provider !== undefined && listProviderSkillFrontmatterFields(provider).includes(field);
      const snapshot = providerDestinationFormatSnapshots.find((item) => item.target === provider && item.destination === "skill");
      return createInitialMigrationFlag({
        code: provider === undefined ? "adopt.unattributed-frontmatter" : known ? "adopt.provider-frontmatter-unverified" : "adopt.unknown-frontmatter",
        severity: provider === undefined ? "error" : "warning",
        disposition: "ambiguous",
        message: provider === undefined
          ? `Review frontmatter field ${field}: source provider and portable meaning are unknown.`
          : `Review ${provider}.frontmatter.${field}: preserved by source attribution; cross-provider meaning is not established.`,
        source: { path: source.path },
        ...(source.origin === undefined ? {} : { origin: { path: source.origin.path } }),
        fingerprints: { content: digest(JSON.stringify(value)), context: importedFrontmatterContext(provider, field) },
        placement: { kind: "sidecar", reason: "Frontmatter cannot contain inline migration locators." },
        evidence: [
          ...capabilityFindingEvidence(assessImportedFrontmatter({ path: source.path, fields: [field], providers: provider === undefined ? [] : [provider] })),
          { summary: provider === undefined ? "No source provider was declared; no provider was inferred from field spelling." : `Declared source provider: ${provider}. Preservation does not establish native support for unknown fields.` },
          ...(known && snapshot !== undefined ? snapshot.provenance.sources.map((item) => ({ reference: item.url, summary: `Structural snapshot ${snapshot.id}, fetched ${snapshot.provenance.fetchedAt}, lists ${field}. This is not cross-provider equivalence or runtime verification.` })) : [{ summary: "No matching pinned structural field evidence; meaning remains unknown." }]),
          ...(source.origin?.repo === undefined ? [] : [{ summary: "Original repository.", reference: source.origin.repo }]),
          ...(source.origin?.ref === undefined ? [] : [{ summary: `Original revision: ${source.origin.ref}.` }]),
        ],
        relatedReportIds: [],
      });
    })
  );
  return [...fieldFindings, ...(source.metadataCompatibility === true ? importedMetadataFindings(source, frontmatter) : [])];
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** Stable field ownership identity; shared with revalidation of resolved findings. */
export function importedFrontmatterContext(provider: TargetName | undefined, field: string): string {
  return digest(JSON.stringify([provider ?? "unknown", field]));
}
