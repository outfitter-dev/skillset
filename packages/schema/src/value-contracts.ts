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
export const REPORT_RELATIVE_ID_PATTERN =
  "^(?!/)(?!.*//)(?!.*(?:^|/)\\.(?:/|$))(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*(?:^|/)\\.git(?:/|$))(?:(?:plugin:\\.)|(?:(?:instructions|plugin|plugins|skills):(?!(?:\\.|\\.git)(?:/|$))(?:[A-Za-z0-9]|\\.[A-Za-z0-9_])[A-Za-z0-9._/-]*)|(?:skill:[a-z0-9][a-z0-9._-]*)|(?:[A-Za-z0-9.][A-Za-z0-9._/-]*))$";
export const REPORT_RELATIVE_ID_MAX_LENGTH = 256;
export const REPORT_CODE_PATTERN = "^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$";
export const REPORT_CODE_MAX_LENGTH = 96;

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
