/**
 * RawPluginManifestInterface in Codex 0.147.0, commit
 * be6e8eac029b183056b7e4402879f15d2c85f61b, core-plugins/src/manifest.rs.
 * Source SHA-256: 1844eae543cfdc60e32f257ca2cb233e71c65c3f0b085871da1c8c930090a328.
 * These are deserialization rules, not lossless runtime normalization claims.
 * defaultPrompt has an Invalid(JsonValue) variant and intentionally has no type check.
 */
export const CODEX_LEGACY_INTERFACE_NULLABLE_STRINGS = [
  "brandColor", "category", "composerIcon", "developerName", "displayName",
  "logo", "logoDark", "longDescription", "privacyPolicyUrl", "privacyPolicyURL",
  "shortDescription", "termsOfServiceUrl", "termsOfServiceURL", "websiteUrl", "websiteURL",
] as const;

export const CODEX_LEGACY_INTERFACE_ARRAYS = ["capabilities", "screenshots"] as const;

export const CODEX_LEGACY_INTERFACE_ALIASES = [
  ["privacyPolicyUrl", "privacyPolicyURL"],
  ["termsOfServiceUrl", "termsOfServiceURL"],
  ["websiteUrl", "websiteURL"],
] as const;

export const CODEX_LEGACY_INTERFACE_FIELDS = [
  ...CODEX_LEGACY_INTERFACE_NULLABLE_STRINGS,
  ...CODEX_LEGACY_INTERFACE_ARRAYS,
  "defaultPrompt",
].sort();
