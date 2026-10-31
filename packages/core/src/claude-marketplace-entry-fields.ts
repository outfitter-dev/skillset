import {
  CLAUDE_MARKETPLACE_RESTRICTED_HEADERS,
  CLAUDE_MARKETPLACE_RESTRICTED_HEADER_PREFIXES,
} from "@skillset/registry";
import { issue, type ProviderFormatConformanceFile, type ProviderFormatConformanceIssue } from "./provider-format-conformance-validation";
import type { JsonRecord } from "./types";
import { isJsonRecord } from "./yaml";

/** Offline validation only: helper commands are never executed. */
export function checkClaudeMarketplaceEntryHeaders(
  file: ProviderFormatConformanceFile,
  plugin: JsonRecord,
  prefix: string,
  entryValid: boolean,
): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  const report = (field: string, message: string, code: "invalid-shape" | "invalid-field-type" = "invalid-shape") => {
    issues.push(issue(file, "claude", "claude-marketplace-schema", code, `destination field ${prefix}.${field} ${message}`));
  };
  if (isJsonRecord(plugin.headers)) {
    for (const [key, value] of Object.entries(plugin.headers)) {
      if (typeof value !== "string") report(`headers.${key}`, "must be a string", "invalid-field-type");
    }
  }
  const helper = plugin.headersHelper;
  if (typeof helper === "string" && (helper.length > 500 || /[^\x20-\x7E]| {4,}/u.test(helper))) {
    report("headersHelper", "must contain at most 500 printable ASCII characters with no run of four spaces");
  }
  // Provider conditions run after successful entry parsing. Avoid inventing
  // source-dependent diagnostics for malformed values already reported above.
  if (!entryValid || issues.length > 0) return issues;
  const activeHelper = typeof helper === "string" && helper !== "";
  const archive = isJsonRecord(plugin.source) && plugin.source.source === "archive";
  if (!archive) {
    if (plugin.headers !== undefined || activeHelper) {
      report(activeHelper ? "headersHelper" : "headers", "headers/headersHelper only apply to archive sources");
    }
    return issues;
  }
  if (activeHelper) {
    if (plugin.strict !== false) report("headersHelper", "must set strict: false on the entry");
    if (isJsonRecord(plugin.source) && plugin.source.sha256 === undefined) {
      report("source.sha256", "must be present for an active headersHelper under strict validation");
    }
  }
  if (isJsonRecord(plugin.headers)) {
    for (const key of Object.keys(plugin.headers)) {
      const normalized = key.toLowerCase().replaceAll("_", "-");
      if (CLAUDE_MARKETPLACE_RESTRICTED_HEADERS.some((blocked) => normalized === blocked) ||
          CLAUDE_MARKETPLACE_RESTRICTED_HEADER_PREFIXES.some((blocked) => normalized.startsWith(blocked))) {
        report(`headers.${key}`, "must not set a request-routing or identity header");
      }
    }
  }
  return issues;
}
