// Known legacy listing aliases remain open to extensions and blank compatibility values.
export const SOURCE_PRESENTATION_FIELD_TYPES = {
  display_name: "string",
  displayName: "string",
  summary: "string",
  short_description: "string",
  shortDescription: "string",
  description: "string",
  long_description: "string",
  longDescription: "string",
  category: "string",
  color: "string",
  brand_color: "string",
  brandColor: "string",
  website_url: "string",
  websiteURL: "string",
  privacy_policy_url: "string",
  privacyPolicyURL: "string",
  terms_of_service_url: "string",
  termsOfServiceURL: "string",
  composer_icon: "string",
  composerIcon: "string",
  logo: "string",
  logo_dark: "string",
  logoDark: "string",
  capabilities: "string-array",
  default_prompt: "string-array",
  defaultPrompt: "string-array",
  screenshots: "string-array",
} as const;

export const ADAPTIVE_HOOK_SCRIPT_PREFIX_PATTERN = "^(?:\\./|\\{\\{scripts\\.dir\\}\\}/)";
// Match whole parent segments through true string end, including after line terminators.
export const ADAPTIVE_HOOK_UNSAFE_RELATIVE_PATH_PATTERN =
  "^/|^[A-Za-z]:[\\\\/]|(?:^|[\\\\/])\\.\\.(?=[\\\\/]|(?![\\s\\S]))";

export const SEMVER_PATTERN =
  "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9]\\d*|[A-Za-z-][0-9A-Za-z-]*))*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$";
export const PROVIDER_NATIVE_REFERENCE_NAME_PATTERN =
  "^(?!.*[\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029])\\S(?:.*\\S)?$";
export const WORKSPACE_ID_PATTERN =
  "^[a-z0-9][a-z0-9._-]*(?:--[a-z0-9][a-z0-9._-]*)*$";
export const WORKSPACE_ID_MAX_LENGTH = 160;
export const REPORT_WORKSPACE_NAME_PATTERN =
  "^(?!\\.{1,2}$)(?!~$)(?![A-Za-z]:)[^\\\\/\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029]+$";
export const REPORT_REPOSITORY_IDENTITY_PATTERN =
  "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:/(?!\\.{1,2}(?:/|$))[A-Za-z0-9._-]+)+$";
export type ListConjunction = "and" | "or";

export function createSemverRegExp(): RegExp {
  return new RegExp(SEMVER_PATTERN, "u");
}

export function isProviderNativeReferenceName(value: string): boolean {
  return new RegExp(PROVIDER_NATIVE_REFERENCE_NAME_PATTERN, "u").test(value);
}

export function isWorkspaceId(value: string): boolean {
  return (
    value.length <= WORKSPACE_ID_MAX_LENGTH &&
    new RegExp(WORKSPACE_ID_PATTERN, "u").test(value)
  );
}

export function formatList(
  values: readonly string[],
  conjunction: ListConjunction = "or"
): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} ${conjunction} ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, ${conjunction} ${values.at(-1)}`;
}
