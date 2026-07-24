import {
  mergeRecords,
  readRecord,
  readString,
  readStringArray,
} from "./config";
import type { JsonRecord } from "./types";

export function readSourceListing(metadata: JsonRecord): JsonRecord {
  const legacyPresentation = normalizeLegacyPresentation(
    readRecord(metadata, "presentation") ?? {}
  );
  return mergeRecords(
    mergeRecords({
      display_name: readString(metadata, "title"),
      summary: readString(metadata, "summary"),
      category: readString(metadata, "category"),
      keywords: copyStringArray(readStringArray(metadata, "keywords")),
      website_url: readString(metadata, "homepage"),
    }, legacyPresentation),
    readRecord(metadata, "listing") ?? {}
  );
}

export function readListingString(
  metadata: JsonRecord,
  key: string
): string | undefined {
  return readString(readSourceListing(metadata), key);
}

export function readListingStringArray(
  metadata: JsonRecord,
  key: string
): readonly string[] | undefined {
  return readStringArray(readSourceListing(metadata), key);
}

function normalizeLegacyPresentation(presentation: JsonRecord): JsonRecord {
  return {
    display_name: readAliasString(
      presentation,
      "display_name",
      "displayName"
    ),
    summary: readAliasString(
      presentation,
      "summary",
      "short_description",
      "shortDescription"
    ),
    description: readAliasString(
      presentation,
      "description",
      "long_description",
      "longDescription"
    ),
    category: readString(presentation, "category"),
    capabilities: copyStringArray(
      readStringArray(presentation, "capabilities")
    ),
    color: readAliasString(presentation, "color", "brand_color", "brandColor"),
    website_url: readAliasString(
      presentation,
      "website_url",
      "websiteURL"
    ),
    privacy_policy_url: readAliasString(
      presentation,
      "privacy_policy_url",
      "privacyPolicyURL"
    ),
    terms_of_service_url: readAliasString(
      presentation,
      "terms_of_service_url",
      "termsOfServiceURL"
    ),
    default_prompt: copyStringArray(
      readStringArray(presentation, "default_prompt") ??
        readStringArray(presentation, "defaultPrompt")
    ),
    composer_icon: readAliasString(
      presentation,
      "composer_icon",
      "composerIcon"
    ),
    logo: readString(presentation, "logo"),
    screenshots: copyStringArray(readStringArray(presentation, "screenshots")),
  };
}

function copyStringArray(
  value: readonly string[] | undefined
): string[] | undefined {
  return value === undefined ? undefined : [...value];
}

function readAliasString(
  record: JsonRecord,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = readString(record, key);
    if (value !== undefined) return value;
  }
  return undefined;
}
