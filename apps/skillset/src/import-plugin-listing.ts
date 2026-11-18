import { readRecord, readString } from "@skillset/core/internal/config";
import type { JsonRecord, JsonValue, TargetName } from "@skillset/core/internal/types";
import type { ImportNormalization } from "@skillset/schema";
import { manifestNormalizationObservations } from "./import-manifest-observations";
import { firstPortablePluginMetadataSource, type NativeListingMetadataConflict, type NativeListingMetadataField } from "./plugin-manifest-authority";

interface SelectedListingValue {
  readonly provider: TargetName;
  readonly pointer: string;
  readonly value: JsonValue;
}

export function importedListing(
  manifests: ReadonlyMap<TargetName, JsonRecord>,
  conflicts: readonly NativeListingMetadataConflict[],
  canonicalManifestDescription: string,
  destinationPath: string
): { readonly value: JsonRecord | undefined; readonly normalizations: readonly ImportNormalization[] } {
  const codexInterface = readRecord(manifests.get("codex") ?? {}, "interface") ?? {};
  const normalizations: ImportNormalization[] = [];
  const string = (provider: TargetName, field: string): SelectedListingValue | undefined => {
    const value = readString(provider === "codex" ? codexInterface : manifests.get(provider) ?? {}, field);
    return value === undefined ? undefined : { value, provider, pointer: provider === "codex" ? `/interface/${field}` : `/${field}` };
  };
  const array = (field: string): SelectedListingValue | undefined => {
    const value = copyJsonStringArray(codexInterface[field]);
    return value === undefined ? undefined : { value, provider: "codex", pointer: `/interface/${field}` };
  };
  const assign = (field: string, selected: SelectedListingValue | undefined): JsonValue | undefined => {
    if (selected === undefined) return undefined;
    normalizations.push(...manifestNormalizationObservations(selected.provider, [{
      code: "manifest.listing", source: selected.pointer, destination: `/skillset/listing/${field}`,
    }], destinationPath));
    return selected.value;
  };
  const nativeShortDescription = string("codex", "shortDescription");
  const nativeLongDescription = string("codex", "longDescription");
  const summary = nativeShortDescription?.value === canonicalManifestDescription ? nativeShortDescription : undefined;
  const description = summary !== undefined || nativeLongDescription?.value === canonicalManifestDescription ? nativeLongDescription : undefined;
  const keywordSource = firstPortablePluginMetadataSource(manifests, "keywords");
  const keywords = copyJsonStringArray(keywordSource?.value);
  const listing: JsonRecord = {
    display_name: assign("display_name", hasListingConflict(conflicts, "listing.display_name") ? undefined
      : string("codex", "displayName") ?? string("claude", "displayName") ?? string("cursor", "displayName")),
    summary: assign("summary", summary),
    description: assign("description", description),
    category: assign("category", hasListingConflict(conflicts, "listing.category") ? undefined : string("codex", "category")),
    capabilities: assign("capabilities", array("capabilities")),
    color: assign("color", string("codex", "brandColor")),
    website_url: assign("website_url", string("codex", "websiteURL")),
    privacy_policy_url: assign("privacy_policy_url", string("codex", "privacyPolicyURL")),
    terms_of_service_url: assign("terms_of_service_url", string("codex", "termsOfServiceURL")),
    default_prompt: assign("default_prompt", array("defaultPrompt")),
    composer_icon: assign("composer_icon", string("codex", "composerIcon")),
    logo: assign("logo", hasListingConflict(conflicts, "listing.logo") ? undefined : string("codex", "logo") ?? string("cursor", "logo")),
    screenshots: assign("screenshots", array("screenshots")),
    keywords: assign("keywords", keywords === undefined || keywordSource === undefined ? undefined : { provider: keywordSource.provider, pointer: "/keywords", value: keywords }),
  };
  return { value: Object.values(listing).some((value) => value !== undefined) ? listing : undefined, normalizations };
}

export function hasListingConflict(conflicts: readonly NativeListingMetadataConflict[], field: NativeListingMetadataField): boolean {
  return conflicts.some((conflict) => conflict.field === field);
}

function copyJsonStringArray(value: JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return [...value];
}
