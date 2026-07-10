import type { JsonRecord, TargetName } from "@skillset/core/internal/types";
import type { JsonValue } from "@skillset/core";

export const PORTABLE_PLUGIN_METADATA_FIELDS = [
  "author",
  "description",
  "homepage",
  "keywords",
  "license",
  "repository",
] as const;

export type PortablePluginMetadataField = (typeof PORTABLE_PLUGIN_METADATA_FIELDS)[number];
export type ProviderPluginManifestEntry = readonly [TargetName, JsonRecord];

export interface PortablePluginMetadataConflict {
  readonly field: PortablePluginMetadataField;
  readonly providers: readonly TargetName[];
}

export function portablePluginMetadataConflicts(
  manifests: Iterable<ProviderPluginManifestEntry>
): readonly PortablePluginMetadataConflict[] {
  const entries = [...manifests];
  return PORTABLE_PLUGIN_METADATA_FIELDS.flatMap((field) => {
    const values = new Set<string>();
    const providers = new Set<TargetName>();
    for (const [provider, manifest] of entries) {
      const value = manifest[field];
      if (value === undefined) continue;
      values.add(stableJson(value));
      providers.add(provider);
    }
    return values.size > 1 ? [{ field, providers: [...providers].sort() }] : [];
  });
}

export function firstPortablePluginMetadataValue(
  manifests: Iterable<ProviderPluginManifestEntry>,
  field: PortablePluginMetadataField
): JsonValue | undefined {
  for (const [, manifest] of manifests) {
    const value = manifest[field];
    if (value !== undefined) return value;
  }
  return undefined;
}

function stableJson(value: JsonValue): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, JsonValue] => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)])
  );
}
