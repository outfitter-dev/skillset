import type { SkillsetCliDiagnostic } from "./types";

const LEGACY_SOURCE_METADATA_FIELDS = [
  {
    field: "title",
    help: "Move `skillset.title` to `skillset.listing.display_name`.",
    replacement: "listing.display_name",
  },
  {
    field: "summary",
    help: "Move `skillset.summary` to `skillset.listing.summary`.",
    replacement: "listing.summary",
  },
  {
    field: "category",
    help: "Move `skillset.category` to `skillset.listing.category`.",
    replacement: "listing.category",
  },
  {
    field: "presentation",
    help: "Move presentation fields under `skillset.listing` and use snake_case field names.",
    replacement: "listing",
  },
] as const;

export function diagnoseSourceMetadataCompatibility(
  value: unknown,
  path = "$.skillset"
): readonly SkillsetCliDiagnostic[] {
  if (!isRecord(value)) return [];

  const diagnostics: SkillsetCliDiagnostic[] = [];
  for (const legacy of LEGACY_SOURCE_METADATA_FIELDS) {
    if (value[legacy.field] === undefined) continue;
    diagnostics.push({
      code: `source-metadata/legacy-${legacy.field}`,
      help: legacy.help,
      message: `${path}.${legacy.field} is retained for compatibility; use ${path}.${legacy.replacement}`,
      path: `${path}.${legacy.field}`,
      severity: "warning",
    });
  }

  if (value.owner !== undefined) {
    diagnostics.push({
      code: "source-metadata/legacy-owner",
      help: "Use `skillset.author` for ordinary attribution. Keep `skillset.owner` only when it intentionally names a distinct publisher.",
      message: `${path}.owner is an advanced publisher override; ordinary attribution belongs in ${path}.author`,
      path: `${path}.owner`,
      severity: "warning",
    });
  }
  if (value.version !== undefined) {
    diagnostics.push({
      code: "source-metadata/legacy-version",
      help: "Let Skillset derive versions from release and change state. Keep `skillset.version` only as an explicit compatibility baseline.",
      message: `${path}.version is a compatibility baseline; release and change state are authoritative`,
      path: `${path}.version`,
      severity: "warning",
    });
  }

  return diagnostics;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
