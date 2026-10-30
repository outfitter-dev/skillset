import type { BuildGraph, SourceIslandFile } from "./types";

/** A plugin can preserve structured native files and all hook runtime resources. */
export function isOpaquePluginIsland(graph: BuildGraph, island: SourceIslandFile): boolean {
  return island.plugin !== undefined &&
    (island.relativePath.startsWith("hooks/") || !/\.mdc?$/.test(island.relativePath)) &&
    graph.plugins.find((plugin) => plugin.id === island.plugin)?.metadata.preprocess === false;
}
