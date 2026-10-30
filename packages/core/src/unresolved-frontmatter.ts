import { relative } from "node:path";
import { readMigrationState } from "./migration-state";
import type { BuildGraph } from "./types";

/** Preserve unattributed values in source, but never infer their output consumers. */
export async function assertResolvedSkillFrontmatter(graph: BuildGraph): Promise<void> {
  const skills = [...graph.standaloneSkills, ...graph.plugins.flatMap((plugin) => plugin.skills)];
  const { state } = await readMigrationState(graph.rootPath);
  for (const skill of skills) {
    const path = relative(graph.rootPath, skill.sourcePath).replaceAll("\\", "/");
    const pending = state.flags.filter((flag) => flag.source.path === path && flag.code === "adopt.unattributed-frontmatter" && flag.state !== "resolved");
    if (pending.length > 0) {
      throw new Error(`skillset: ${path}: unresolved imported frontmatter review (${pending.map((flag) => flag.id).join(", ")}); removing source metadata or accepting uncertainty does not establish destination support.`);
    }
    const unresolved = skill.metadata.unresolved_frontmatter;
    if (Array.isArray(unresolved) && unresolved.length > 0) {
      throw new Error(`skillset: ${skill.sourcePath}: unresolved imported frontmatter (${unresolved.join(", ")}); establish portable meaning or move the fields into an explicit provider boundary before rendering.`);
    }
  }
}
