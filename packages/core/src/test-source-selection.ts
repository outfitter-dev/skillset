import { readdir, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { isPathInside, resolveInside } from "./path";
import { targetNames } from "./targets";
import type { SkillsetTestSelection } from "./test-declaration";
import type { BuildGraph } from "./types";

/** Prune the final staged source, using graph identities rather than output names. */
export async function applySourceSelection(
  graph: BuildGraph,
  workspace: string,
  selection: SkillsetTestSelection
): Promise<void> {
  if (!selection.filterSource) return;
  const sourceRoot = resolveInside(workspace, graph.sourceRoot);
  const staged = (path: string) =>
    resolveInside(workspace, relative(graph.rootPath, path));
  await pruneToPaths(
    join(sourceRoot, "subagents"),
    graph.projectAgents
      .filter((agent) =>
        selection.agents.some(
          (selected) => selected.filename === agent.filename
        )
      )
      .map((agent) => staged(agent.sourcePath))
  );
  await pruneToPaths(
    join(sourceRoot, "skills"),
    graph.standaloneSkills
      .filter((skill) => selection.primarySkills.includes(skill.id))
      .map((skill) => staged(dirname(skill.sourcePath)))
  );

  const selectedPlugins = graph.plugins.filter(
    (plugin) =>
      selection.plugins.includes(plugin.id) ||
      selection.pluginSkills.some((skill) => skill.pluginId === plugin.id)
  );
  await pruneToPaths(
    join(sourceRoot, "plugins"),
    selectedPlugins.map((plugin) => staged(plugin.path))
  );
  for (const plugin of selectedPlugins) {
    if (selection.plugins.includes(plugin.id)) continue;
    const pluginPath = staged(plugin.path);
    const skills = plugin.skills.filter((skill) =>
      selection.pluginSkills.some(
        (selected) =>
          selected.pluginId === plugin.id && selected.skillId === skill.id
      )
    );
    await pruneToPaths(
      join(pluginPath, "skills"),
      skills.map((skill) => staged(dirname(skill.sourcePath)))
    );
    await pruneToPaths(
      pluginPath,
      ["config.yaml", "shared", "skillset.yaml", "skills"].map((name) =>
        join(pluginPath, name)
      )
    );
  }
  for (const name of [
    "rules",
    ...targetNames().map((target) => `_${target}`),
  ]) {
    await rm(join(sourceRoot, name), { force: true, recursive: true });
  }
}

/** Keep complete selected units and their grouping ancestors; never descend into a unit. */
async function pruneToPaths(
  directory: string,
  keep: readonly string[]
): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (keep.includes(path)) continue;
    if (
      entry.isDirectory() &&
      keep.some((selected) => isPathInside(path, selected))
    ) {
      await pruneToPaths(path, keep);
    } else {
      await rm(path, { force: true, recursive: true });
    }
  }
}
