import { readString, readStringArray } from "./config";
import type { ResolvedLicense } from "./licenses";
import { renderCodexAuthor } from "./source-author";
import { readSourceListing } from "./source-listing";
import type { BuildGraph, JsonRecord, SourcePlugin } from "./types";
import { pluginVersion } from "./versioning";

export const AGENT_PLUGIN_MANIFEST_SCHEMA =
  "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

/** Render the closed portable Agent Plugins root shared by standard and ChatGPT bundles. */
export function renderAgentPluginManifest(
  graph: BuildGraph,
  plugin: SourcePlugin,
  license: ResolvedLicense | undefined
): JsonRecord {
  const listing = readSourceListing(plugin.metadata);
  const keywords =
    readStringArray(listing, "keywords") ??
    readStringArray(plugin.metadata, "keywords");
  return Object.fromEntries(
    Object.entries({
      $schema: AGENT_PLUGIN_MANIFEST_SCHEMA,
      author:
        renderCodexAuthor(plugin.metadata.author) ??
        renderCodexAuthor(graph.root.metadata.author),
      description:
        readString(listing, "summary") ??
        readString(listing, "description") ??
        readString(plugin.metadata, "description") ??
        plugin.id,
      homepage: readString(plugin.metadata, "homepage"),
      keywords: keywords === undefined ? undefined : [...keywords],
      license: license?.manifestValue,
      name: plugin.id,
      repository: readString(plugin.metadata, "repository"),
      version: pluginVersion(graph, plugin),
    }).filter(([, value]) => value !== undefined)
  );
}
