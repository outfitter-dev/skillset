import { stat } from "node:fs/promises";
import { assertRealPathInside, isPathInside, logicalDiagnosticPath, resolveInside } from "./path";
import { readStringArray } from "./config";
import type { BuildGraph, SourceIslandFile, SourcePlugin, TargetName } from "./types";

/** Explicit native resource directories bypass document parsing as well as preprocessing. */
export function isOpaquePluginIsland(graph: BuildGraph, island: SourceIslandFile): boolean {
  const plugin = graph.plugins.find((candidate) => candidate.id === island.plugin);
  if (!plugin) return false;
  const directories = readStringArray(plugin.targets[island.target].options, "opaque") ?? [];
  if (directories.some((directory) => isPathInside(directory, island.relativePath))) return true;
  // Preserve the existing structured/default-hook opt-out for authored configs.
  return plugin.metadata.preprocess === false &&
    (isPathInside("hooks", island.relativePath) || !/\.mdc?$/.test(island.relativePath));
}

/** An explicit copy declaration must name an existing, contained directory. */
export async function validateOpaqueIslandDirectories(rootPath: string, islandPath: string, plugin: SourcePlugin, target: TargetName): Promise<void> {
  for (const directory of readStringArray(plugin.targets[target].options, "opaque") ?? []) {
    const absolute = resolveInside(islandPath, directory);
    const info = await stat(absolute).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!info?.isDirectory()) throw new Error(`skillset: ${logicalDiagnosticPath(rootPath, absolute)} must be an existing directory for ${target}.opaque`);
    await assertRealPathInside(rootPath, absolute);
    await assertRealPathInside(islandPath, absolute);
  }
}
