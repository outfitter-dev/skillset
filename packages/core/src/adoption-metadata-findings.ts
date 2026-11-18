import { getStandardProfile } from "@skillset/registry";
import type { MigrationFlag } from "@skillset/schema";
import { incompatibleAgentSkillsMetadataKeys } from "./agent-skills-metadata";
import { readRecord } from "./config";
import { migrationDigest } from "./migration-state";
import { createInitialMigrationFlag } from "./migration-state-reconcile";
import { compareStrings } from "./path";
import type { JsonRecord, SourceOrigin } from "./types";

/** A standard-profile compatibility candidate, not a selected-provider verdict. */
export function importedMetadataFindings(
  source: { readonly path: string; readonly origin?: SourceOrigin },
  frontmatter: JsonRecord
): readonly MigrationFlag[] {
  const metadata = readRecord(frontmatter, "metadata") ?? {};
  const profile = getStandardProfile("agent-skills");
  return incompatibleAgentSkillsMetadataKeys(metadata).toSorted(compareStrings).map((key) => {
    const pointer = `/metadata/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    return createInitialMigrationFlag({
      code: "adopt.metadata-standard-incompatible",
      severity: "warning",
      disposition: "lossy-unsupported",
      message: "Preserved canonical metadata contains a non-string value incompatible with the Agent Skills standard. Review applicable output before cutover.",
      source: { path: source.path },
      ...(source.origin === undefined ? {} : { origin: { path: source.origin.path } }),
      fingerprints: { content: `sha256:${migrationDigest(metadata[key])}`, context: `sha256:${migrationDigest(["agent-skills", pointer])}` },
      placement: { kind: "sidecar", reason: "Frontmatter cannot contain inline migration locators." },
      evidence: [
        { summary: `Preserved metadata location (JSON Pointer): ${pointer}` },
        { summary: "Canonical metadata allows structured values; the Agent Skills destination requires string values. No provider ownership, selected output, runtime meaning or successful build is inferred. Applicable standard and provider projections are evaluated by the renderer." },
        ...profile.provenance.snapshots.filter((snapshot) => snapshot.kind === "specification").map((snapshot) => ({ reference: snapshot.url, summary: `Agent Skills specification ${snapshot.contentHash}, observed ${snapshot.observedAt}: metadata maps strings to strings.` })),
        ...(source.origin?.repo === undefined ? [] : [{ summary: "Original repository.", reference: source.origin.repo }]),
        ...(source.origin?.ref === undefined ? [] : [{ summary: `Original revision: ${source.origin.ref}.` }]),
      ],
      relatedReportIds: [],
    });
  });
}
