import { join } from "node:path";
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
    ? join(outputRoot, pluginId, target).replaceAll("\\", "/")
    : join(outputRoot, "plugins", pluginId).replaceAll("\\", "/");
}

export function pluginManifestPath(
  outputRoot: string,
  target: TargetName,
  pluginId: string
): string {
  const manifestDirectory = pluginManifestDirectory(target);
  return join(pluginTargetRoot(outputRoot, target, pluginId), manifestDirectory, "plugin.json").replaceAll("\\", "/");
}

export function pluginManifestDirectory(target: TargetName): string {
  return `.${target}-plugin`;
}

export function claudeMarketplacePath(outputRoot: string): string {
  return isDefaultPluginOutputRoot(outputRoot)
    ? ".claude-plugin/marketplace.json"
    : join(outputRoot, ".claude-plugin", "marketplace.json").replaceAll("\\", "/");
}

export function providerSourceForPlugin(
  outputRoot: string,
  target: TargetName,
  pluginId: string
): string {
  return isDefaultPluginOutputRoot(outputRoot)
    ? `./plugins/${pluginId}/${target}`
    : `./plugins/${pluginId}`;
}

export function pluginTargetForOutputPath(
  graph: BuildGraph,
  path: string
): TargetName | undefined {
  for (const target of targetNames()) {
    const outputRoot = graph.root.outputs.plugins[target];
    if (isDefaultPluginOutputRoot(outputRoot)) {
      const parts = path.split("/");
      if (parts.length >= 3 && parts[0] === outputRoot && parts[2] === target) return target;
      continue;
    }
    if (path === outputRoot || path.startsWith(`${outputRoot}/`)) return target;
  }
  return undefined;
}

export function pluginPathPartsForOutput(
  outputRoot: string,
  target: TargetName,
  path: string
): { readonly pluginId: string; readonly pluginPath: string } | undefined {
  const prefix = isDefaultPluginOutputRoot(outputRoot)
    ? `${outputRoot}/`
    : `${outputRoot}/plugins/`;
  if (!path.startsWith(prefix)) return undefined;
  const rest = path.slice(prefix.length);
  const parts = rest.split("/");
  if (isDefaultPluginOutputRoot(outputRoot)) {
    if (parts.length < 3 || parts[1] !== target) return undefined;
    return { pluginId: parts[0]!, pluginPath: parts.slice(2).join("/") };
  }
  if (parts.length < 2) return undefined;
  return { pluginId: parts[0]!, pluginPath: parts.slice(1).join("/") };
}
