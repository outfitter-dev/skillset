import type { JsonRecord } from "./types";
import { isJsonRecord } from "./yaml";

export function storedClaudeMarketplaceProviderEntry(entry: JsonRecord): JsonRecord | undefined {
  if (
    entry.requestedTarget !== "claude" ||
    typeof entry.repo !== "string" ||
    typeof entry.plugin !== "string" ||
    typeof entry.generatedPath !== "string" ||
    !isPortableMarketplacePath(entry.generatedPath) ||
    !isJsonRecord(entry.requested) ||
    !isJsonRecord(entry.resolved) ||
    !isJsonRecord(entry.providerEntry)
  ) {
    return undefined;
  }

  const providerEntry = entry.providerEntry;
  if (!isJsonRecord(providerEntry.source)) return undefined;
  const source = providerEntry.source;
  const resolvedSha = entry.resolved.sha;
  if (
    providerEntry.name !== entry.plugin ||
    typeof resolvedSha !== "string" ||
    !/^[0-9a-f]{40}$/u.test(resolvedSha) ||
    source.source !== "git-subdir" ||
    source.url !== claudeMarketplaceRepoSource(entry.repo) ||
    source.path !== claudeMarketplacePluginRoot(entry.generatedPath) ||
    source.sha !== resolvedSha
  ) {
    return undefined;
  }
  if (entry.requested.kind === "ref" && source.ref !== entry.requested.ref) return undefined;
  if (entry.requested.kind !== "ref" && source.ref !== undefined) return undefined;
  return providerEntry;
}

export function claudeMarketplaceRepoSource(repo: string): string {
  const github = repo.match(/^github:([^/]+\/[^/]+)$/u);
  return github?.[1] ?? repo;
}

export function claudeMarketplacePluginRoot(generatedPath: string): string {
  const suffix = "/.claude-plugin/plugin.json";
  if (!generatedPath.endsWith(suffix)) return generatedPath.slice(0, generatedPath.lastIndexOf("/"));
  return generatedPath.slice(0, -suffix.length);
}

function isPortableMarketplacePath(value: string): boolean {
  return !value.startsWith("/") &&
    !value.startsWith("~") &&
    !/^[A-Za-z]:[\\/]/u.test(value) &&
    !value.split(/[\\/]+/u).includes("..");
}
