import {
  CODEX_LEGACY_INTERFACE_ALIASES, CODEX_LEGACY_INTERFACE_ARRAYS,
  CODEX_LEGACY_INTERFACE_FIELDS, CODEX_LEGACY_INTERFACE_NULLABLE_STRINGS,
} from "@skillset/registry";
import { checkFieldTypes, checkUnknownFields, issue,
  type ProviderFormatConformanceFile, type ProviderFormatConformanceIssue,
} from "./provider-format-conformance-validation";
import type { JsonValue } from "./types";
import { isJsonRecord } from "./yaml";

/** Preserve the legacy loader's nullable strings and tolerant prompt variants. */
export function checkCodexLegacyInterface(
  file: ProviderFormatConformanceFile, value: JsonValue | undefined
): readonly ProviderFormatConformanceIssue[] {
  if (value === undefined || value === null) return [];
  const providerRef = "codex-plugin-manifest-overlay";
  if (!isJsonRecord(value)) {
    return [issue(file, "codex", providerRef, "invalid-field-type", "destination field interface must be an object or null")];
  }
  const issues: ProviderFormatConformanceIssue[] = [
    ...checkUnknownFields(file, value, "codex", providerRef, CODEX_LEGACY_INTERFACE_FIELDS, "interface"),
    ...checkFieldTypes(file, value, "codex", providerRef,
      Object.fromEntries(CODEX_LEGACY_INTERFACE_ARRAYS.map((field) => [field, "string-array" as const])), "interface"),
  ];
  for (const field of CODEX_LEGACY_INTERFACE_NULLABLE_STRINGS) {
    const member = value[field];
    if (member !== undefined && member !== null && typeof member !== "string") {
      issues.push(issue(file, "codex", providerRef, "invalid-field-type",
        `destination field interface.${field} must be a string or null`));
    }
  }
  // Distinct aliases survive JSON.parse; duplicate identical literal keys do not.
  for (const [canonical, alias] of CODEX_LEGACY_INTERFACE_ALIASES) {
    if (Object.hasOwn(value, canonical) && Object.hasOwn(value, alias)) {
      issues.push(issue(file, "codex", providerRef, "invalid-shape",
        `destination fields interface.${canonical} and interface.${alias} duplicate the same legacy field`));
    }
  }
  return issues;
}
