import { relative } from "node:path";
import { importedFrontmatterContext } from "./adoption-frontmatter-findings";
import { readRecord } from "./config";
import { readMigrationState } from "./migration-state";
import type { BuildGraph, JsonRecord } from "./types";

/** A recorded decision cannot substitute for a source boundary or survive field reintroduction. */
export async function assertResolvedSourceFrontmatter(graph: BuildGraph): Promise<void> {
  const sources: { readonly sourcePath: string; readonly metadata: JsonRecord; readonly frontmatter?: JsonRecord }[] = [
    { sourcePath: graph.rootConfigPath, metadata: graph.root.metadata },
    ...graph.plugins.map((plugin) => ({ sourcePath: plugin.configPath, metadata: plugin.metadata })),
    ...graph.standaloneSkills,
    ...graph.plugins.flatMap((plugin) => plugin.skills),
    ...[...graph.rules, ...graph.projectAgents].map((source) => ({
      sourcePath: source.sourcePath, frontmatter: source.frontmatter,
      metadata: readRecord(source.frontmatter, "skillset") ?? {},
    })),
  ];
  const { state } = await readMigrationState(graph.rootPath);
  for (const source of sources) {
    const path = relative(graph.rootPath, source.sourcePath).replaceAll("\\", "/");
    const fieldContexts = new Set(Object.keys(source.frontmatter ?? {}).map((field) => importedFrontmatterContext(undefined, field)));
    const pending = state.flags.filter((flag) => flag.source.path === path && flag.code === "adopt.unattributed-frontmatter" &&
      (flag.state !== "resolved" || fieldContexts.has(flag.fingerprints.context)));
    if (pending.length > 0) {
      throw new Error(`skillset: ${path}: unresolved imported frontmatter review (${pending.map((flag) => flag.id).join(", ")}); a recorded resolution cannot authorize a remaining or reintroduced unattributed field.`);
    }
    const unresolved = source.metadata.unresolved_frontmatter;
    if (Array.isArray(unresolved) && unresolved.length > 0) {
      throw new Error(`skillset: ${source.sourcePath}: unresolved imported frontmatter (${unresolved.join(", ")}); establish portable meaning or move the fields into an explicit provider boundary before rendering.`);
    }
  }
}
