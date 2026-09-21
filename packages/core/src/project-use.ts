import { relative, sep } from "node:path";

import { isOutputSelected } from "./config";
import { compareStrings } from "./path";
import { selectorForPluginSkill } from "./source-unit-selector";
import { targetNames } from "./targets";
import type {
  BuildGraph,
  SourcePlugin,
  SourceSkill,
  TargetName,
} from "./types";

export interface ProjectUseSkillCopy {
  readonly collisionSources: readonly string[];
  readonly effectiveName: string;
  readonly plugin: SourcePlugin;
  readonly selectionRule: string;
  readonly skill: SourceSkill;
  readonly sourceUnit: string;
}

export interface ProjectUseStatusEntry {
  readonly effectiveName: string;
  readonly owner: { readonly target: TargetName };
  readonly role: "project-use";
  readonly selectionRule: string;
  readonly sourcePath: string;
  readonly sourceUnit: string;
  readonly target: TargetName;
}

interface ProjectUseCandidate {
  readonly decision: NonNullable<BuildGraph["pluginPlan"]>["internalUse"]["decisions"][number];
  readonly plugin: SourcePlugin;
  readonly skill: SourceSkill;
  readonly sourceUnit: string;
}

interface ProjectUseNameCandidate extends ProjectUseCandidate {
  readonly collisionSources: Set<string>;
  readonly preferredName: string;
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
    return {
      decision,
      plugin,
      skill,
      sourceUnit: selectorForPluginSkill(plugin.id, skill.id),
    };
  }).sort((left, right) => compareStrings(left.sourceUnit, right.sourceUnit));
  const workspaceByName = new Map<string, string[]>();
  for (const skill of graph.standaloneSkills) {
    workspaceByName.set(skill.id, [
      ...(workspaceByName.get(skill.id) ?? []),
      `workspace:${skill.id}`,
    ]);
  }
  const pluginByName = new Map<string, string[]>();
  for (const { skill, sourceUnit } of candidates) {
    pluginByName.set(skill.id, [
      ...(pluginByName.get(skill.id) ?? []),
      sourceUnit,
    ]);
  }

  const named: ProjectUseNameCandidate[] = candidates.map((candidate) => {
    const collisionSources = [
      ...(workspaceByName.get(candidate.skill.id) ?? []),
      ...(pluginByName.get(candidate.skill.id) ?? []),
    ].sort(compareStrings);
    return {
      ...candidate,
      collisionSources: new Set(
        collisionSources.length > 1 ? collisionSources : []
      ),
      preferredName: collisionSources.length > 1
        ? `${candidate.plugin.id}-${candidate.skill.id}`
        : candidate.skill.id,
    };
  });
  const preferredByName = new Map<string, ProjectUseNameCandidate[]>();
  for (const candidate of named) {
    preferredByName.set(candidate.preferredName, [
      ...(preferredByName.get(candidate.preferredName) ?? []),
      candidate,
    ]);
  }
  const conflicts = new Set<ProjectUseNameCandidate>();
  for (const [name, group] of preferredByName) {
    const workspaceSources = workspaceByName.get(name) ?? [];
    if (workspaceSources.length === 0 && group.length === 1) continue;
    const completeSources = new Set([
      ...workspaceSources,
      ...group.flatMap((candidate) => [
        candidate.sourceUnit,
        ...candidate.collisionSources,
      ]),
    ]);
    for (const candidate of group) {
      conflicts.add(candidate);
      for (const source of completeSources) {
        candidate.collisionSources.add(source);
      }
    }
  }

  const usedSources = new Map<string, string[]>();
  for (const [name, sources] of workspaceByName) {
    usedSources.set(name, [...sources]);
  }
  for (const candidate of named) {
    if (conflicts.has(candidate)) continue;
    usedSources.set(candidate.preferredName, [candidate.sourceUnit]);
  }

  const effectiveNames = new Map<ProjectUseNameCandidate, string>();
  for (const candidate of named) {
    if (!conflicts.has(candidate)) {
      effectiveNames.set(candidate, candidate.preferredName);
      continue;
    }
    const baseName = `${candidate.plugin.id}-${candidate.preferredName}`;
    let effectiveName = baseName;
    let suffix = 2;
    while (usedSources.has(effectiveName)) {
      for (const source of usedSources.get(effectiveName) ?? []) {
        candidate.collisionSources.add(source);
      }
      effectiveName = `${baseName}-${suffix}`;
      suffix += 1;
    }
    usedSources.set(effectiveName, [candidate.sourceUnit]);
    effectiveNames.set(candidate, effectiveName);
  }

  return named.map((candidate) => ({
    collisionSources: [...candidate.collisionSources].sort(compareStrings),
    effectiveName: effectiveNames.get(candidate) ?? candidate.preferredName,
    plugin: candidate.plugin,
    selectionRule: candidate.decision.rule,
    skill: candidate.skill,
    sourceUnit: candidate.sourceUnit,
  }));
}

export function projectUseStatusEntries(
  graph: BuildGraph
): readonly ProjectUseStatusEntry[] {
  return resolveProjectUseSkillCopies(graph).flatMap((copy) =>
    targetNames().flatMap((target) => {
      if (
        !copy.skill.targets[target].enabled ||
        !isOutputSelected(
          graph.root.outputs.targetOutputs[target].skills,
          copy.skill.id
        )
      ) {
        return [];
      }
      return [{
        effectiveName: copy.effectiveName,
        owner: { target },
        role: "project-use" as const,
        selectionRule: copy.selectionRule,
        sourcePath: relative(graph.rootPath, copy.skill.sourcePath)
          .split(sep)
          .join("/"),
        sourceUnit: copy.sourceUnit,
        target,
      }];
    })
  ).sort((left, right) =>
    compareStrings(
      `${left.sourceUnit}\0${left.target}`,
      `${right.sourceUnit}\0${right.target}`
    )
  );
}
