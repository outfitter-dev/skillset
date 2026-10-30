import { posix } from "node:path";
import { readRecord } from "./config";
import type { BuildGraph, JsonValue, SourceIslandFile } from "./types";

/** A plugin can preserve structured native files and all hook runtime resources. */
export function isOpaquePluginIsland(graph: BuildGraph, island: SourceIslandFile): boolean {
  const plugin = graph.plugins.find((candidate) => candidate.id === island.plugin);
  if (!plugin || plugin.metadata.preprocess !== false) return false;
  if (island.relativePath.startsWith("hooks/") || !/\.mdc?$/.test(island.relativePath)) return true;
  const declaration = readRecord(plugin.targets[island.target].options, "manifest")?.hooks;
  return hookResourceDirectories(declaration).some((directory) => island.relativePath.startsWith(`${directory}/`));
}

function hookResourceDirectories(declaration: JsonValue | undefined): readonly string[] {
  const entries = Array.isArray(declaration) ? declaration : [declaration];
  return entries.flatMap((entry) => {
    if (typeof entry !== "string" || !entry.startsWith("./") || !entry.endsWith(".json") || entry.includes("\\") || entry.split("/").includes("..")) return [];
    const directory = posix.dirname(posix.normalize(entry));
    // A root-level declaration cannot make every Markdown document opaque.
    return directory === "." ? [] : [directory];
  });
}
