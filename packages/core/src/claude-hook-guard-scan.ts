import { CLAUDE_INLINE_HOOK_EVENTS } from "@skillset/registry";
import { issue, type ProviderFormatConformanceFile, type ProviderFormatConformanceIssue } from "./provider-format-conformance-validation";
import { isJsonRecord } from "./yaml";

const events = new Set<string>(CLAUDE_INLINE_HOOK_EVENTS);
const excluded = new Set(["metadata", "mcpServers", "lspServers", "experimental"]);

function hasGuardKey(value: unknown): boolean {
  return isJsonRecord(value) && Object.entries(value).some(([key, entry]) =>
    (key === "PreToolUse" || key === "PermissionRequest") && entry !== null && entry !== undefined && !(Array.isArray(entry) && entry.length === 0)
  );
}

function isMatcherLike(value: unknown): boolean {
  if (!isJsonRecord(value)) return false;
  if (!("matcher" in value) && Object.keys(value).some(key => events.has(key))) return false;
  const hooks = value.hooks;
  if (Array.isArray(hooks)) return hooks.length > 0;
  return isJsonRecord(hooks) && ("matcher" in value || typeof hooks.type === "string");
}

/** Pinned Nne: immediate checks precede depth and typed-handler stops. Tt uses the defaults. */
export function containsMisplacedGuard(value: unknown, depth: number, matchersCount = false, unscannedKeys: ReadonlySet<string> = new Set(), inHooksList = false): boolean {
  if (hasGuardKey(value) || (matchersCount && isMatcherLike(value))) return true;
  if (depth === 0 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(entry => containsMisplacedGuard(entry, depth - 1, matchersCount, unscannedKeys, inHooksList));
  if (inHooksList && "type" in value && typeof value.type === "string") return false;
  return Object.entries(value).some(([key, entry]) => !unscannedKeys.has(key) && containsMisplacedGuard(entry, depth - 1, matchersCount && !events.has(key), unscannedKeys, key === "hooks" && Array.isArray(entry)));
}

function outsideHooks(value: Record<string, unknown>): boolean {
  return hasGuardKey(value) || Object.entries(value).some(([key, entry]) => key !== "hooks" && !excluded.has(key) && containsMisplacedGuard(entry, 3, !events.has(key), excluded));
}

// Fne traverses nested arrays only, not arbitrary object descendants.
function nestedArrayGuard(value: unknown): boolean {
  if (isMatcherLike(value)) return true;
  if (Array.isArray(value)) return value.some(nestedArrayGuard);
  return hasGuardKey(value);
}

/** Read-only sQ preflight for standalone manifests; raw marketplace parsing has no such scan. */
export function checkClaudeMisplacedHooks(file: ProviderFormatConformanceFile, manifest: Record<string, unknown>): readonly ProviderFormatConformanceIssue[] {
  const issues: ProviderFormatConformanceIssue[] = [];
  const report = (location: string) => issues.push(issue(file, "claude", "claude-plugin-manifest-schema", "invalid-shape", `destination field hooks contains a misplaced guarding hook ${location}; the pinned standalone parser cannot load this declaration`));
  // sQ attributes each aggregate scan to hooks, rather than claiming an exact descendant path.
  if (outsideHooks(manifest)) report('outside "hooks" at the top level');
  if (isJsonRecord(manifest.experimental) && outsideHooks({ unlifted: manifest.experimental })) report('outside "hooks" under experimental');
  if (Array.isArray(manifest.hooks) && manifest.hooks.some(entry => Array.isArray(entry) && nestedArrayGuard(entry))) report("in a nested hooks array");
  return issues;
}
