import { join, relative } from "node:path";
import { targetNames } from "./targets";
import type { BuildGraph, TargetName } from "./types";

export const DEFAULT_PLUGIN_OUTPUT_ROOT = "plugins";

export function isDefaultPluginOutputRoot(path: string): boolean {
  return path === DEFAULT_PLUGIN_OUTPUT_ROOT;
}

export function pluginTargetRoot(
  outputRoot: string,
  target: TargetName,
  pluginId: string
): string {
  return isDefaultPluginOutputRoot(outputRoot)
    ? join(outputRoot, pluginId, target === "codex" ? "chatgpt" : target).replaceAll("\\", "/")
    : join(outputRoot, "plugins", pluginId).replaceAll("\\", "/");
}

/** The bundle-owning identity of a plugin; `{ id }` keeps the default shape. */
export interface PluginBundleSource {
  readonly claudeBundlePath?: string;
  readonly id: string;
}

/**
 * The root that owns one plugin's complete bundle for one target. A plugin
 * with its own claude bundle destination owns that exact path — no implicit
 * `plugins/<id>` or provider segment is appended.
 */
export function pluginBundleRoot(
  outputRoot: string,
  target: TargetName,
  plugin: PluginBundleSource
): string {
  if (target === "claude" && plugin.claudeBundlePath !== undefined) {
    return plugin.claudeBundlePath;
  }
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

/**
 * The root whose `skillset.lock` records one plugin's rendered output for one
 * target. A plugin-owned claude bundle carries its own lock at the bundle
 * destination; every other shape locks at the shared plugins root.
 */
export function pluginLockRootPath(
  outputRoot: string,
  target: TargetName,
  plugin: PluginBundleSource
): string {
  if (target === "claude" && plugin.claudeBundlePath !== undefined) {
    return plugin.claudeBundlePath;
  }
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
  outputRoot: string,
  target: TargetName,
  plugin: PluginBundleSource
): string {
  if (target === "claude" && plugin.claudeBundlePath !== undefined) {
    const marketplaceRoot = isDefaultPluginOutputRoot(outputRoot) ? "." : outputRoot;
    return `./${relative(marketplaceRoot, plugin.claudeBundlePath).replaceAll("\\", "/")}`;
  }
  return isDefaultPluginOutputRoot(outputRoot)
    ? `./plugins/${plugin.id}/${target === "codex" ? "chatgpt" : target}`
    : `./plugins/${plugin.id}`;
}

export function pluginTargetForOutputPath(
  graph: BuildGraph,
  path: string
): TargetName | undefined {
  if (bundleRootPluginForOutputPath(graph, path) !== undefined) return "claude";
  for (const target of targetNames()) {
    const outputRoot = graph.root.outputs.plugins[target];
    if (isDefaultPluginOutputRoot(outputRoot)) {
      const parts = path.split("/");
      const bundleSegment = target === "codex" ? "chatgpt" : target;
      if (parts.length >= 3 && parts[0] === outputRoot && parts[2] === bundleSegment) return target;
      continue;
    }
    if (path === outputRoot || path.startsWith(`${outputRoot}/`)) return target;
  }
  return undefined;
}

function bundleRootPluginForOutputPath(
  graph: BuildGraph,
  path: string
): PluginBundleSource | undefined {
  return graph.plugins.find(
    (plugin) =>
      plugin.claudeBundlePath !== undefined &&
      (path === plugin.claudeBundlePath ||
        path.startsWith(`${plugin.claudeBundlePath}/`))
  );
}

export function pluginPathPartsForOutput(
  graph: BuildGraph,
  outputRoot: string,
  target: TargetName,
  path: string
): { readonly pluginId: string; readonly pluginPath: string } | undefined {
  if (target === "claude") {
    const bundleOwner = bundleRootPluginForOutputPath(graph, path);
    if (bundleOwner?.claudeBundlePath !== undefined) {
      if (path === bundleOwner.claudeBundlePath) return undefined;
      return {
        pluginId: bundleOwner.id,
        pluginPath: path.slice(bundleOwner.claudeBundlePath.length + 1),
      };
    }
  }
  const prefix = isDefaultPluginOutputRoot(outputRoot)
    ? `${outputRoot}/`
    : `${outputRoot}/plugins/`;
  if (!path.startsWith(prefix)) return undefined;
  const rest = path.slice(prefix.length);
  const parts = rest.split("/");
  if (isDefaultPluginOutputRoot(outputRoot)) {
    const bundleSegment = target === "codex" ? "chatgpt" : target;
    if (parts.length < 3 || parts[1] !== bundleSegment) return undefined;
    return { pluginId: parts[0]!, pluginPath: parts.slice(2).join("/") };
  }
  if (parts.length < 2) return undefined;
  return { pluginId: parts[0]!, pluginPath: parts.slice(1).join("/") };
}
