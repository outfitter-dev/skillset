import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import {
  mergeRecords,
  readRecord,
  readString,
  readStringArray,
} from "./config";
import { renderClaudePluginDependencies } from "./dependencies";
import type { ResolvedLicense } from "./licenses";
import { validateSlug } from "./path";
import { hasAdaptivePluginHookOutput } from "./render-hooks";
import type {
  BuildGraph,
  JsonRecord,
  JsonValue,
  SourcePlugin,
  SourcePluginFeature,
  SourceSkill,
  TargetName,
} from "./types";
import { pluginVersion } from "./versioning";

const DEFAULT_CODEX_COLOR = "#B06DFF";

export function renderPluginManifest(
  graph: BuildGraph,
  plugin: SourcePlugin,
  target: TargetName,
  enabledSkills: readonly SourceSkill[],
  license: ResolvedLicense | undefined
): JsonRecord {
  const metadata = plugin.metadata;
  const targetOptions = plugin.targets[target].options;
  const portableManifest = readRecord(metadata, "manifest") ?? {};
  const base: JsonRecord = {
    name: readString(portableManifest, "name") ?? plugin.id,
    version: pluginVersion(graph, plugin),
    description:
      readString(metadata, "summary") ??
      readString(metadata, "description") ??
      plugin.id,
    author: metadata.author,
    homepage: metadata.homepage,
    repository: metadata.repository,
    license: license?.manifestValue,
    keywords: metadata.keywords,
  };
  const dependencies =
    target === "claude"
      ? renderClaudePluginDependencies(graph, plugin)
      : undefined;
  const manifestOverrides = readRecord(targetOptions, "manifest") ?? {};
  if (
    target === "claude" &&
    dependencies !== undefined &&
    manifestOverrides.dependencies !== undefined
  ) {
    throw new Error(
      `skillset: plugin ${plugin.id} declares dependencies, but claude.manifest.dependencies would overwrite generated dependency metadata`
    );
  }

  const targetBase =
    target === "claude"
      ? withOptionalSurfacePaths(
          graph,
          mergeRecords(
            base,
            dependencies === undefined ? {} : { dependencies }
          ),
          plugin,
          enabledSkills,
          target
        )
      : target === "codex"
        ? mergeRecords(
            withOptionalSurfacePaths(
              graph,
              base,
              plugin,
              enabledSkills,
              target
            ),
            {
              interface: renderCodexInterface(graph, plugin),
            }
          )
        : withOptionalSurfacePaths(
            graph,
            mergeRecords(
              base,
              renderCursorPluginDisplayFields(metadata, portableManifest)
            ),
            plugin,
            enabledSkills,
            target
          );
  const withOverrides = mergeRecords(targetBase, manifestOverrides);

  return mergeRecords(withOverrides, {
    version: pluginVersion(graph, plugin),
  });
}

function renderCursorPluginDisplayFields(
  metadata: JsonRecord,
  portableManifest: JsonRecord
): JsonRecord {
  const tags = readStringArray(portableManifest, "tags");
  return {
    displayName:
      readString(portableManifest, "displayName") ??
      readString(metadata, "title"),
    category: readString(portableManifest, "category"),
    logo: readString(portableManifest, "logo") ?? readString(metadata, "logo"),
    ...(tags === undefined ? {} : { tags: [...tags] }),
  };
}

export function renderCodexInterface(
  graph: BuildGraph,
  plugin: SourcePlugin
): JsonRecord {
  const metadata = plugin.metadata;
  const presentation = mergeRecords(
    readRecord(metadata, "ui") ?? {},
    readRecord(metadata, "presentation") ?? {}
  );
  const author =
    readRecord(metadata, "author") ??
    readRecord(graph.root.metadata, "owner") ??
    {};
  const targetOptions = plugin.targets.codex.options;
  const interfaceOverrides = readRecord(targetOptions, "interface") ?? {};
  const color =
    readString(targetOptions, "color") ??
    readPresentationString(
      presentation,
      "color",
      "brand_color",
      "brandColor"
    ) ??
    DEFAULT_CODEX_COLOR;
  const website =
    readPresentationString(presentation, "website_url", "websiteURL") ??
    readString(metadata, "homepage") ??
    readString(metadata, "repository");
  const capabilities = readStringArray(presentation, "capabilities");
  const defaultPrompt =
    readStringArray(presentation, "default_prompt") ??
    readStringArray(presentation, "defaultPrompt");
  const screenshots = readStringArray(presentation, "screenshots");

  const base: JsonRecord = {
    displayName:
      readPresentationString(presentation, "display_name", "displayName") ??
      readString(metadata, "title") ??
      titleize(plugin.id),
    shortDescription:
      readPresentationString(
        presentation,
        "summary",
        "short_description",
        "shortDescription"
      ) ??
      readString(metadata, "summary") ??
      readString(metadata, "description") ??
      plugin.id,
    longDescription:
      readPresentationString(
        presentation,
        "description",
        "long_description",
        "longDescription"
      ) ??
      readString(metadata, "description") ??
      readString(metadata, "summary") ??
      plugin.id,
    developerName:
      readPresentationString(presentation, "developer_name", "developerName") ??
      readString(author, "name") ??
      "Skillset Maintainers",
    category:
      readString(presentation, "category") ??
      readString(metadata, "category") ??
      "Productivity",
    capabilities: [...(capabilities ?? ["Interactive", "Write"])],
    websiteURL: website,
    privacyPolicyURL: readPresentationString(
      presentation,
      "privacy_policy_url",
      "privacyPolicyURL"
    ),
    termsOfServiceURL: readPresentationString(
      presentation,
      "terms_of_service_url",
      "termsOfServiceURL"
    ),
    defaultPrompt: defaultPrompt ? [...defaultPrompt] : undefined,
    brandColor: color,
    composerIcon: readPresentationString(
      presentation,
      "composer_icon",
      "composerIcon"
    ),
    logo: readString(presentation, "logo"),
    screenshots: [...(screenshots ?? [])],
  };

  return mergeRecords(base, interfaceOverrides);
}

function readPresentationString(
  record: JsonRecord,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = readString(record, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function withOptionalSurfacePaths(
  graph: BuildGraph,
  manifest: JsonRecord,
  plugin: SourcePlugin,
  enabledSkills: readonly SourceSkill[],
  target: TargetName
): JsonRecord {
  const withPaths: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (value !== undefined) withPaths[key] = value;
  }

  if (enabledSkills.length > 0) withPaths.skills = "./skills/";
  if (target === "claude") {
    if (pluginHasPath(plugin, "commands")) withPaths.commands = "./commands";
    if (pluginHasPath(plugin, "agents")) withPaths.agents = "./agents";
    if (
      pluginHasPath(plugin, "hooks/hooks.json") ||
      hasAdaptivePluginHookOutput(graph, plugin, target)
    )
      withPaths.hooks = "./hooks/hooks.json";
    if (pluginHasFeature(plugin, "mcp")) withPaths.mcpServers = "./.mcp.json";
    if (pluginHasPath(plugin, ".lsp.json"))
      withPaths.lspServers = "./.lsp.json";
    if (pluginHasPath(plugin, "output-styles"))
      withPaths.outputStyles = "./output-styles/";
    // Themes and monitors are experimental Claude plugin components; declare them
    // under the documented `experimental` manifest key.
    const experimental: Record<string, JsonValue> = {};
    if (pluginHasPath(plugin, "themes")) experimental.themes = "./themes/";
    if (pluginHasPath(plugin, "monitors/monitors.json")) {
      experimental.monitors = "./monitors/monitors.json";
    }
    if (Object.keys(experimental).length > 0)
      withPaths.experimental = experimental;
  } else if (target === "codex") {
    if (
      pluginHasPath(plugin, "hooks/hooks.json") ||
      hasAdaptivePluginHookOutput(graph, plugin, target)
    ) {
      withPaths.hooks = "./hooks/hooks.json";
    }
    if (pluginHasFeature(plugin, "mcp")) withPaths.mcpServers = "./.mcp.json";
    if (pluginHasPath(plugin, ".app.json")) withPaths.apps = "./.app.json";
  } else {
    if (pluginHasPath(plugin, "rules")) withPaths.rules = "./rules/";
    if (pluginHasPath(plugin, "commands")) withPaths.commands = "./commands/";
    if (pluginHasPath(plugin, "agents")) withPaths.agents = "./agents/";
    if (
      pluginHasPath(plugin, "hooks/hooks.json") ||
      hasAdaptivePluginHookOutput(graph, plugin, target)
    ) {
      withPaths.hooks = "./hooks/hooks.json";
    }
    if (pluginHasFeature(plugin, "mcp")) withPaths.mcpServers = "./mcp.json";
  }

  return withPaths;
}

function pluginHasFeature(
  plugin: SourcePlugin,
  key: SourcePluginFeature["key"]
): boolean {
  return plugin.features.some((feature) => feature.key === key);
}

/**
 * Render Codex and Cursor plugin hook files at the documented default path
 * `hooks/hooks.json` with a top-level `hooks` object.
 *
 * Source resolution: `hooks/hooks.json` is the canonical hook source for both
 * plugin targets. Flat event maps are normalized into the canonical
 * `{ "hooks": { ... } }` shape.
 */
function pluginHasPath(plugin: SourcePlugin, path: string): boolean {
  try {
    validateSlug(plugin.id, "plugin id");
  } catch {
    return false;
  }
  // Real file-system errors (EACCES, ELOOP, ...) must surface instead of being
  // read as "path absent"; only a missing path counts as no surface.
  return hasRenderableContent(join(plugin.path, path));
}

function hasRenderableContent(path: string): boolean {
  // A missing path means "no surface"; any other FS error (EACCES, ELOOP, ...)
  // must surface instead of being read as absent.
  let stats;
  try {
    stats = statSync(path);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
  if (stats.isFile()) return !isIgnoredCompanionFile(path);
  if (!stats.isDirectory()) return false;

  for (const entry of readdirSync(path)) {
    if (hasRenderableContent(join(path, entry))) return true;
  }

  return false;
}

function isIgnoredCompanionFile(path: string): boolean {
  const name = basename(path);
  return name === ".DS_Store" || name === ".gitkeep";
}

function titleize(value: string): string {
  return value
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
