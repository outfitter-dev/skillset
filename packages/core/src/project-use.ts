import { compareStrings } from "./path";
import { selectorForPluginSkill } from "./source-unit-selector";
import type { BuildGraph, SourcePlugin, SourceSkill } from "./types";

export interface ProjectUseSkillCopy {
  readonly collisionSources: readonly string[];
  readonly effectiveName: string;
  readonly plugin: SourcePlugin;
  readonly selectionRule: string;
  readonly skill: SourceSkill;
  readonly sourceUnit: string;
}

export function resolveProjectUseSkillCopies(
  graph: BuildGraph
): readonly ProjectUseSkillCopy[] {
  const selected = graph.pluginPlan?.internalUse.skills ?? [];
  const candidates = selected.map(({ pluginId, skillId }) => {
    const plugin = graph.plugins.find((item) => item.id === pluginId);
    const skill = plugin?.skills.find((item) => item.id === skillId);
    const decision = graph.pluginPlan?.internalUse.decisions.find(
      (item) =>
        item.pluginId === pluginId &&
        item.skillId === skillId &&
        item.status === "live"
    );
    if (plugin === undefined || skill === undefined || decision === undefined) {
      throw new Error(
        `skillset: internal-use selection references missing live skill ${pluginId}:${skillId}`
      );
    }
    return { decision, plugin, skill };
  });
  const workspaceByName = new Map<string, string[]>();
  for (const skill of graph.standaloneSkills) {
    workspaceByName.set(skill.id, [
      ...(workspaceByName.get(skill.id) ?? []),
      `workspace:${skill.id}`,
    ]);
  }
  const pluginByName = new Map<string, string[]>();
  for (const { plugin, skill } of candidates) {
    pluginByName.set(skill.id, [
      ...(pluginByName.get(skill.id) ?? []),
      selectorForPluginSkill(plugin.id, skill.id),
    ]);
  }
  return candidates
    .map(({ decision, plugin, skill }) => {
      const collisionSources = [
        ...(workspaceByName.get(skill.id) ?? []),
        ...(pluginByName.get(skill.id) ?? []),
      ].sort(compareStrings);
      const collides = collisionSources.length > 1;
      return {
        collisionSources: collides ? collisionSources : [],
        effectiveName: collides ? `${plugin.id}-${skill.id}` : skill.id,
        plugin,
        selectionRule: decision.rule,
        skill,
        sourceUnit: selectorForPluginSkill(plugin.id, skill.id),
      };
    })
    .sort((left, right) => compareStrings(left.sourceUnit, right.sourceUnit));
}
