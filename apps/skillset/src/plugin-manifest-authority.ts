import type { JsonRecord, TargetName } from "@skillset/core/internal/types";
import type { JsonValue } from "@skillset/core";
import { readSourceAuthorRecord } from "@skillset/schema";

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

export const NATIVE_LISTING_METADATA_FIELDS = [
  "listing.category",
  "listing.display_name",
  "listing.keywords",
  "listing.logo",
] as const;

export type NativeListingMetadataField =
  (typeof NATIVE_LISTING_METADATA_FIELDS)[number];

export interface NativeListingMetadataConflict {
  readonly field: NativeListingMetadataField;
  readonly providers: readonly TargetName[];
}

export function portablePluginMetadataConflicts(
  manifests: Iterable<ProviderPluginManifestEntry>
): readonly PortablePluginMetadataConflict[] {
  const entries = [...manifests];
  return PORTABLE_PLUGIN_METADATA_FIELDS.flatMap((field) => {
    if (field === "author") {
      return authorMetadataConflicts(entries);
    }
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

export function nativeListingMetadataConflicts(
  manifests: Iterable<ProviderPluginManifestEntry>
): readonly NativeListingMetadataConflict[] {
  const entries = [...manifests];
  return NATIVE_LISTING_METADATA_FIELDS.flatMap((field) => {
    const values = new Set<string>();
    const providers = new Set<TargetName>();
    for (const [provider, manifest] of entries) {
      const value = nativeListingMetadataValue(provider, manifest, field);
      if (value === undefined) continue;
      values.add(stableJson(value));
      providers.add(provider);
    }
    return values.size > 1 ? [{ field, providers: [...providers].sort() }] : [];
  });
}

function nativeListingMetadataValue(
  provider: TargetName,
  manifest: JsonRecord,
  field: NativeListingMetadataField
): JsonValue | undefined {
  const listingField = field.slice("listing.".length);
  if (listingField === "keywords") {
    return provider === "cursor" ? manifest.tags : manifest.keywords;
  }
  if (provider === "codex") {
    const interfaceMetadata = asRecord(manifest.interface);
    if (listingField === "display_name") return interfaceMetadata?.displayName;
    return interfaceMetadata?.[listingField];
  }
  if (provider === "cursor") {
    if (listingField === "display_name") return manifest.displayName;
    return manifest[listingField];
  }
  return undefined;
}

function asRecord(value: JsonValue | undefined): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;
}

export function firstPortablePluginMetadataValue(
  manifests: Iterable<ProviderPluginManifestEntry>,
  field: PortablePluginMetadataField
): JsonValue | undefined {
  if (field === "author") {
    return canonicalAuthorValue(manifests);
  }
  for (const [, manifest] of manifests) {
    const value = manifest[field];
    if (value !== undefined) return value;
  }
  return undefined;
}

function authorMetadataConflicts(
  manifests: readonly ProviderPluginManifestEntry[]
): readonly PortablePluginMetadataConflict[] {
  const values = new Map<string, Set<string>>();
  const providers = new Set<TargetName>();
  for (const [provider, manifest] of manifests) {
    const author = readSourceAuthorRecord(manifest.author);
    if (author === undefined) continue;
    providers.add(provider);
    for (const [key, value] of Object.entries(author)) {
      if (value === undefined) continue;
      const fieldValues = values.get(key) ?? new Set<string>();
      fieldValues.add(stableJson(value));
      values.set(key, fieldValues);
    }
  }
  return [...values.values()].some((fieldValues) => fieldValues.size > 1)
    ? [{ field: "author", providers: [...providers].sort() }]
    : [];
}

function canonicalAuthorValue(
  manifests: Iterable<ProviderPluginManifestEntry>
): JsonRecord | undefined {
  const author: Record<string, JsonValue> = {};
  for (const [, manifest] of manifests) {
    const normalized = readSourceAuthorRecord(manifest.author);
    if (normalized === undefined) continue;
    for (const [key, value] of Object.entries(normalized)) {
      if (value !== undefined && author[key] === undefined) author[key] = value;
    }
  }
  return Object.keys(author).length === 0 ? undefined : author;
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
