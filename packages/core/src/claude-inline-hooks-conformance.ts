import { containsMisplacedGuard } from "./claude-hook-guard-scan";
import { CLAUDE_INLINE_HOOK_EVENTS, CLAUDE_INLINE_HOOK_HANDLERS } from "@skillset/registry";
import { checkFieldTypes, checkRequiredFields, checkUnknownFields, issue, type ProviderFormatConformanceFile, type ProviderFormatConformanceIssue } from "./provider-format-conformance-validation";
import { isJsonRecord } from "./yaml";

type ProviderRef = "claude-plugin-manifest-schema" | "claude-marketplace-schema";
const events = new Set<string>(CLAUDE_INLINE_HOOK_EVENTS);

/** Raw Wq acceptance plus standalone Tt guard observations; never normalize or mutate input. */
export function checkClaudeInlineHooks(file: ProviderFormatConformanceFile, value: unknown, prefix: string, providerRef: ProviderRef): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  const entries = Array.isArray(value) ? value.map((entry, index) => [entry, `${prefix}[${index}]`] as const) : [[value, prefix] as const];
  for (const [entry, path] of entries) {
    // Reference/container checks are owned by the manifest and shared reference leaf.
    if (!isJsonRecord(entry)) continue;
    issues.push(...checkUnknownFields(file, entry, "claude", providerRef, CLAUDE_INLINE_HOOK_EVENTS, path));
    for (const [event, groups] of Object.entries(entry)) {
      const eventPath = `${path}.${event}`;
      if (!events.has(event)) continue;
      if (!Array.isArray(groups)) {
        issues.push(issue(file, "claude", providerRef, "invalid-field-type", `destination field ${eventPath} must be an array`));
        continue;
      }
      for (const [index, group] of groups.entries()) {
        const groupPath = `${eventPath}[${index}]`;
        // Tt scans before parsing and uses no metadata exemptions. Raw marketplace
        // validation does not call Tt, so these observations are standalone-only.
        if (providerRef === "claude-plugin-manifest-schema" && containsMisplacedGuard(group, 3)) {
          issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${groupPath} contains a misplaced guarding hook`));
          continue;
        }
        if (!isJsonRecord(group)) {
          issues.push(issue(file, "claude", providerRef, "invalid-field-type", `destination field ${groupPath} must be an object`));
          continue;
        }
        issues.push(...checkRequiredFields(file, group, "claude", providerRef, ["hooks"], groupPath), ...checkFieldTypes(file, group, "claude", providerRef, { matcher: "string", hooks: "array" }, groupPath));
        if (Array.isArray(group.hooks)) for (const [handlerIndex, handler] of group.hooks.entries()) {
          issues.push(...checkClaudeInlineHookHandler(file, handler, `${groupPath}.hooks[${handlerIndex}]`, providerRef));
        }
      }
    }
  }
  return issues;
}

function checkClaudeInlineHookHandler(file: ProviderFormatConformanceFile, handler: unknown, prefix: string, providerRef: ProviderRef): readonly ProviderFormatConformanceIssue[] {
  if (!isJsonRecord(handler)) return [issue(file, "claude", providerRef, "invalid-field-type", `destination field ${prefix} must be an object`)];
  if (typeof handler.type !== "string" || !Object.hasOwn(CLAUDE_INLINE_HOOK_HANDLERS, handler.type)) return [issue(file, "claude", providerRef, "invalid-shape", `destination field ${prefix}.type must name a Claude hook handler`)];
  const contract = CLAUDE_INLINE_HOOK_HANDLERS[handler.type as keyof typeof CLAUDE_INLINE_HOOK_HANDLERS];
  const issues = [...checkRequiredFields(file, handler, "claude", providerRef, contract.required, prefix), ...checkFieldTypes(file, handler, "claude", providerRef, contract.fields, prefix)];
  const report = (field: string, message: string) => issues.push(issue(file, "claude", providerRef, "invalid-shape", `destination field ${prefix}.${field} ${message}`));
  if (typeof handler.timeout === "number" && (!Number.isFinite(handler.timeout) || handler.timeout <= 0)) report("timeout", "must be a positive number");
  if (handler.type === "command") {
    if (typeof handler.shell === "string" && handler.shell !== "bash" && handler.shell !== "powershell") report("shell", "must be bash or powershell");
    for (const field of ["rewakeMessage", "rewakeSummary"] as const) if (handler[field] === "") report(field, "must not be empty");
  }
  if (handler.type === "http") {
    if (typeof handler.url === "string") {
      try { new URL(handler.url); } catch { report("url", "must be a parsable absolute URL"); }
    }
    if (isJsonRecord(handler.headers)) for (const [name, value] of Object.entries(handler.headers)) {
      if (typeof value !== "string") issues.push(issue(file, "claude", providerRef, "invalid-field-type", `destination field ${prefix}.headers.${name} must be a string`));
    }
  }
  return issues;
}
