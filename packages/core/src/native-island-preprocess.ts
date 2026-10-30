import type { BuildGraph, SourceIslandFile } from "./types";

/** Non-Markdown native files have no frontmatter; their plugin can opt out. */
export function isOpaquePluginIsland(graph: BuildGraph, island: SourceIslandFile): boolean {
  return island.plugin !== undefined && !/\.mdc?$/.test(island.relativePath) &&
    graph.plugins.find((plugin) => plugin.id === island.plugin)?.metadata.preprocess === false;
}
