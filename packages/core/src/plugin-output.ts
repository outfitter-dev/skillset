import { join } from "node:path";
import { targetNames } from "./targets";
import type { BuildGraph, TargetName } from "./types";

export const DEFAULT_PLUGIN_OUTPUT_ROOT = "plugins";

export function isDefaultPluginOutputRoot(path: string): boolean {
  return path === DEFAULT_PLUGIN_OUTPUT_ROOT;
}

export function pluginTargetRoot(
  _outputRoot: string,
  _target: TargetName,
  pluginId: string
): string {
  return join(DEFAULT_PLUGIN_OUTPUT_ROOT, pluginId).replaceAll("\\", "/");
}

/** The bundle-owning identity of a plugin; `{ id }` keeps the default shape. */
export interface PluginBundleSource {
  readonly claudeBundlePath?: string;
  readonly id: string;
}

/** The root that owns one plugin package for every enabled target. */
export function pluginBundleRoot(
  outputRoot: string,
  target: TargetName,
  plugin: PluginBundleSource
): string {
  return pluginTargetRoot(outputRoot, target, plugin.id);
}

export function pluginManifestPath(
  outputRoot: string,
  target: TargetName,
  plugin: PluginBundleSource
): string {
  const manifestDirectory = pluginManifestDirectory(target);
  return join(pluginBundleRoot(outputRoot, target, plugin), manifestDirectory, "plugin.json")
    .replaceAll("\\", "/");
}

export function pluginManifestDirectory(target: TargetName): string {
  // ChatGPT product bundles use the Agent Plugins root manifest. `codex`
  // remains the compiler target, configuration key, and runtime identity.
  if (target === "codex") return "";
  return `.${target}-plugin`;
}

export function isPluginManifestOutputPath(
  graph: BuildGraph,
  path: string,
  target: TargetName
): boolean {
  const parts = pluginPathPartsForOutput(
    graph,
    graph.root.outputs.plugins[target],
    target,
    path
  );
  const directory = pluginManifestDirectory(target);
  return parts?.pluginPath ===
    (directory === "" ? "plugin.json" : `${directory}/plugin.json`);
}

/** The shared root whose `skillset.lock` records generated plugin packages. */
export function pluginLockRootPath(
  outputRoot: string,
  _target: TargetName,
  _plugin: PluginBundleSource
): string {
  return outputRoot;
}

export function claudeMarketplacePath(outputRoot: string): string {
  return isDefaultPluginOutputRoot(outputRoot)
    ? ".claude-plugin/marketplace.json"
    : join(outputRoot, ".claude-plugin", "marketplace.json").replaceAll("\\", "/");
}

export function cursorMarketplacePath(outputRoot: string): string {
  return isDefaultPluginOutputRoot(outputRoot)
    ? ".cursor-plugin/marketplace.json"
    : join(outputRoot, ".cursor-plugin", "marketplace.json").replaceAll(
        "\\",
        "/"
      );
}

export function chatGptMarketplacePath(): string {
  return ".agents/plugins/marketplace.json";
}

export function providerSourceForPlugin(
  _outputRoot: string,
  _target: TargetName,
  plugin: PluginBundleSource
): string {
  return `./plugins/${plugin.id}`;
}

export function pluginTargetForOutputPath(
  graph: BuildGraph,
  path: string
): TargetName | undefined {
  if (path.endsWith("/.claude-plugin/plugin.json")) return "claude";
  if (path.endsWith("/.cursor-plugin/plugin.json")) return "cursor";
  if (path.endsWith("/plugin.json")) {
    for (const plugin of graph.plugins) {
      const root = pluginBundleRoot(graph.root.outputs.plugins.codex, "codex", plugin);
      if (path === `${root}/plugin.json`) return "codex";
    }
  }

  const matching = targetNames().filter((target) => {
    const outputRoot = graph.root.outputs.plugins[target];
    return graph.plugins.some((plugin) => {
      const root = pluginBundleRoot(outputRoot, target, plugin);
      return path === root || path.startsWith(`${root}/`);
    });
  });
  return matching.length === 1 ? matching[0] : undefined;
}

export function pluginPathPartsForOutput(
  _graph: BuildGraph,
  _outputRoot: string,
  _target: TargetName,
  path: string
): { readonly pluginId: string; readonly pluginPath: string } | undefined {
  const prefix = `${DEFAULT_PLUGIN_OUTPUT_ROOT}/`;
  if (!path.startsWith(prefix)) return undefined;
  const rest = path.slice(prefix.length);
  const parts = rest.split("/");
  if (parts.length < 2) return undefined;
  return { pluginId: parts[0]!, pluginPath: parts.slice(1).join("/") };
}
