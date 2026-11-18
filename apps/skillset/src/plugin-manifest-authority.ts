import type { JsonRecord, TargetName } from "@skillset/core/internal/types";
import type { JsonValue } from "@skillset/core";
import { readSourceAuthorRecord, validateSourceMetadata } from "@skillset/schema";

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

/** Preserve the observed native divergence; never union discovery lists or infer equivalent search behavior. */
export function cursorKeywordBoundary(manifests: Iterable<ProviderPluginManifestEntry>): {
  readonly canonical: { readonly provider: "claude"; readonly value: string[] };
  readonly cursor: string[];
} | undefined {
  const entries = [...manifests];
  const exactList = (provider: TargetName): string[] | undefined => {
    const values = entries.filter(([target]) => target === provider).map(([, manifest]) => manifest.keywords);
    const value = values[0];
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
    if (!validateSourceMetadata({ listing: { keywords: value } }).ok) return undefined;
    if (values.some((candidate) => JSON.stringify(candidate) !== JSON.stringify(value))) return undefined;
    return [...value];
  };
  // Codex's shared standard manifest cannot accept an arbitrary native root override.
  // Require explicit Claude/Codex agreement and retain Cursor's distinct authored list.
  const claude = exactList("claude");
  const codex = exactList("codex");
  const cursor = exactList("cursor");
  if (claude === undefined || codex === undefined || cursor === undefined) return undefined;
  if (JSON.stringify(claude) !== JSON.stringify(codex) || JSON.stringify(cursor) === JSON.stringify(claude)) return undefined;
  return { canonical: { provider: "claude", value: claude }, cursor };
}

export function portablePluginMetadataConflicts(
  manifests: Iterable<ProviderPluginManifestEntry>
): readonly PortablePluginMetadataConflict[] {
  const entries = [...manifests];
  const keywordBoundary = cursorKeywordBoundary(entries);
  return PORTABLE_PLUGIN_METADATA_FIELDS.flatMap((field) => {
    if (field === "keywords" && keywordBoundary !== undefined) return [];
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
    // Cursor tags are a provider-native discovery concept, not a portable
    // spelling of canonical keywords. Portable manifest keywords are compared
    // separately by portablePluginMetadataConflicts.
    return undefined;
  }
  if (provider === "codex") {
    const interfaceMetadata = asRecord(manifest.interface);
    if (listingField === "display_name") return interfaceMetadata?.displayName;
    return interfaceMetadata?.[listingField];
  }
  if (provider === "cursor") {
    // Cursor category is not authoritative for the shared listing category.
    // Import preserves it in cursor.manifest instead of cross-projecting it.
    if (listingField === "category") return undefined;
    if (listingField === "display_name") return manifest.displayName;
    return manifest[listingField];
  }
  if (provider === "claude" && listingField === "display_name") {
    return manifest.displayName;
  }
  return undefined;
}

function asRecord(value: JsonValue | undefined): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;
}

export function firstPortablePluginMetadataSource(
  manifests: Iterable<ProviderPluginManifestEntry>,
  field: Exclude<PortablePluginMetadataField, "author">
): { readonly provider: TargetName; readonly value: JsonValue } | undefined {
  const entries = [...manifests];
  if (field === "keywords") {
    const boundary = cursorKeywordBoundary(entries);
    if (boundary !== undefined) return boundary.canonical;
  }
  for (const [provider, manifest] of entries) {
    const value = manifest[field];
    if (value !== undefined) return { provider, value };
  }
  return undefined;
}

/**
 * Native `author` value normalized to the canonical source shape, or
 * `undefined` when the value cannot become canonical source. String shorthand
 * normalizes to a record, and every candidate record is checked against the
 * shared source-metadata author contract, so shapes an object check alone would
 * accept (`{}`, an email-only object, a missing or non-string `name`) are
 * rejected here instead of being lifted into source that fails validation.
 */
function canonicalNativeAuthorRecord(
  value: JsonValue | undefined
): JsonRecord | undefined {
  const author = readSourceAuthorRecord(value);
  if (author === undefined) return undefined;
  return validateSourceMetadata({ author }).ok ? author : undefined;
}

/**
 * Providers whose native `author` is present but cannot form canonical source.
 * `author` is the one portable field Skillset normalizes across providers, so
 * such a value has no canonical form: conflict detection and canonicalization
 * both have to skip it, and the importer strips `author` from provider
 * overrides as source-owned. Callers must reject these providers first,
 * otherwise a malformed native value is indistinguishable from an absent one
 * and disappears on import.
 */
export function unreadableNativeAuthorProviders(
  manifests: Iterable<ProviderPluginManifestEntry>
): readonly TargetName[] {
  const providers: TargetName[] = [];
  for (const [provider, manifest] of manifests) {
    if (manifest.author === undefined) continue;
    if (canonicalNativeAuthorRecord(manifest.author) !== undefined) continue;
    providers.push(provider);
  }
  return providers.sort();
}

/** Assumes `unreadableNativeAuthorProviders` already rejected malformed values. */
function authorMetadataConflicts(
  manifests: readonly ProviderPluginManifestEntry[]
): readonly PortablePluginMetadataConflict[] {
  const values = new Map<string, Set<string>>();
  const providers = new Set<TargetName>();
  for (const [provider, manifest] of manifests) {
    const author = canonicalNativeAuthorRecord(manifest.author);
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

/** Retain the first valid contribution to each field; callers check conflicts separately. */
export function resolveNativeAuthor(
  manifests: Iterable<ProviderPluginManifestEntry>
): {
  readonly value: JsonRecord | undefined;
  readonly contributions: readonly { readonly provider: TargetName; readonly sourcePointer: string; readonly destinationPointer: string }[];
} {
  const author: Record<string, JsonValue> = {};
  const contributions: { provider: TargetName; sourcePointer: string; destinationPointer: string }[] = [];
  for (const [provider, manifest] of manifests) {
    const normalized = canonicalNativeAuthorRecord(manifest.author);
    if (normalized === undefined) continue;
    for (const [key, value] of Object.entries(normalized)) {
      if (value !== undefined && author[key] === undefined) {
        author[key] = value;
        const pointerKey = key.replaceAll("~", "~0").replaceAll("/", "~1");
        contributions.push({
          provider,
          sourcePointer: typeof manifest.author === "string" ? "/author" : `/author/${pointerKey}`,
          destinationPointer: `/skillset/author/${pointerKey}`,
        });
      }
    }
  }
  return { value: Object.keys(author).length === 0 ? undefined : author, contributions };
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
