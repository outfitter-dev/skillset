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
  readonly draftOrigin?: NonNullable<SourceSkill["draftOrigin"]>;
  readonly draftPolicy?: "only" | "override";
  readonly effectiveName: string;
  readonly plugin: SourcePlugin;
  readonly selectionRule: string;
  readonly shippedSibling?: string;
  readonly skill: SourceSkill;
  readonly sourceUnit: string;
}

export interface WorkspaceDraftSkillCopy {
  readonly collisionSources: readonly string[];
  readonly draftOrigin: NonNullable<SourceSkill["draftOrigin"]>;
  readonly effectiveName: string;
  readonly selectionRule: string;
  readonly shippedSibling?: string;
  readonly skill: SourceSkill;
  readonly sourceUnit: string;
}

export type RenderedSkillCopy = ProjectUseSkillCopy | WorkspaceDraftSkillCopy;

/**
 * Every project skill copy the render writes, with names allocated once.
 * Copies share the provider skill roots with live workspace skills, so a
 * repeated name here is a repeated output path.
 */
export function resolveRenderedSkillCopies(
  graph: BuildGraph
): readonly RenderedSkillCopy[] {
  const copies = [
    ...resolveWorkspaceDraftSkillCopies(graph),
    ...resolveProjectUseSkillCopies(graph),
  ];
  assertDistinctSkillCopyNames(
    graph.standaloneSkills.map((skill) => skill.id),
    copies
  );
  return copies;
}

export function assertDistinctSkillCopyNames(
  workspaceNames: readonly string[],
  copies: readonly Pick<RenderedSkillCopy, "effectiveName" | "sourceUnit">[]
): void {
  const claims = new Map(workspaceNames.map((name) => [name, `workspace:${name}`]));
  for (const copy of copies) {
    const prior = claims.get(copy.effectiveName);
    if (prior !== undefined) {
      throw new Error(
        `skillset: rendered skill copies ${prior} and ${copy.sourceUnit} both claim project skill directory ${copy.effectiveName}`
      );
    }
    claims.set(copy.effectiveName, copy.sourceUnit);
  }
}

export interface ProjectUseStatusEntry {
  readonly draftOrigin?: NonNullable<SourceSkill["draftOrigin"]>;
  readonly draftPolicy?: "only" | "override";
  readonly effectiveName: string;
  readonly owner: { readonly target: TargetName };
  readonly role: "bundle" | "project-use";
  readonly selectionRule: string;
  readonly shippedSibling?: string;
  readonly sourcePath: string;
  readonly sourceUnit: string;
  readonly target: TargetName;
}

interface ProjectUseCandidate {
  readonly collisionIdentity: string;
  readonly decision: NonNullable<BuildGraph["pluginPlan"]>["internalUse"]["decisions"][number];
  readonly plugin: SourcePlugin;
  readonly shippedSibling?: string;
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
  const selected = [
    ...(graph.pluginPlan?.internalUse.skills ?? []).map((item) => ({
      ...item,
      status: "live" as const,
    })),
    ...(graph.pluginPlan?.internalUse.drafts ?? []).map((item) => ({
      ...item,
      status: "draft" as const,
    })),
  ];
  const candidates = selected.map(({ pluginId, skillId, status }) => {
    const plugin = graph.plugins.find((item) => item.id === pluginId);
    const skill = (plugin?.discoveredSkills ?? plugin?.skills ?? []).find(
      (item) => item.id === skillId && (item.status ?? "live") === status
    );
    const decision = graph.pluginPlan?.internalUse.decisions.find(
      (item) =>
        item.pluginId === pluginId &&
        item.skillId === skillId &&
        item.status === status
    );
    if (plugin === undefined || skill === undefined || decision === undefined) {
      throw new Error(
        `skillset: internal-use selection references missing ${status} skill ${pluginId}:${skillId}`
      );
    }
    const sourceUnit = selectorForPluginSkill(plugin.id, skill.id);
    return {
      collisionIdentity: status === "draft" ? `${sourceUnit}#draft` : sourceUnit,
      decision,
      plugin,
      ...shippedSiblingFor(
        plugin.discoveredSkills ?? plugin.skills,
        skill,
        plugin.id
      ),
      skill,
      sourceUnit,
    };
  }).sort((left, right) =>
    compareStrings(left.collisionIdentity, right.collisionIdentity)
  );
  const workspaceByName = new Map<string, string[]>();
  for (const skill of graph.standaloneSkills) {
    workspaceByName.set(skill.id, [
      ...(workspaceByName.get(skill.id) ?? []),
      `workspace:${skill.id}`,
    ]);
  }
  for (const copy of resolveWorkspaceDraftSkillCopies(graph)) {
    workspaceByName.set(copy.effectiveName, [
      ...(workspaceByName.get(copy.effectiveName) ?? []),
      `workspace:${copy.effectiveName}`,
    ]);
  }
  const pluginByName = new Map<string, string[]>();
  for (const candidate of candidates) {
    const desiredName = projectUseDesiredName(candidate);
    pluginByName.set(desiredName, [
      ...(pluginByName.get(desiredName) ?? []),
      candidate.collisionIdentity,
    ]);
  }

  const named: ProjectUseNameCandidate[] = candidates.map((candidate) => {
    const desiredName = projectUseDesiredName(candidate);
    const collisionSources = [
      ...(workspaceByName.get(desiredName) ?? []),
      ...(pluginByName.get(desiredName) ?? []),
    ].sort(compareStrings);
    return {
      ...candidate,
      collisionSources: new Set(
        collisionSources.length > 1 ? collisionSources : []
      ),
      preferredName: collisionSources.length > 1
        ? `${candidate.plugin.id}-${desiredName}`
        : desiredName,
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
    usedSources.set(candidate.preferredName, [candidate.collisionIdentity]);
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
      effectiveName = suffixedSkillName(baseName, suffix);
      suffix += 1;
    }
    usedSources.set(effectiveName, [candidate.collisionIdentity]);
    effectiveNames.set(candidate, effectiveName);
  }

  return named.map((candidate) => ({
    collisionSources: [...candidate.collisionSources].sort(compareStrings),
    ...(candidate.skill.draftOrigin === undefined
      ? {}
      : { draftOrigin: candidate.skill.draftOrigin }),
    ...(candidate.decision.draftPolicy === undefined
      ? {}
      : { draftPolicy: candidate.decision.draftPolicy }),
    effectiveName: effectiveNames.get(candidate) ?? candidate.preferredName,
    plugin: candidate.plugin,
    selectionRule: candidate.decision.rule,
    ...(candidate.shippedSibling === undefined
      ? {}
      : { shippedSibling: candidate.shippedSibling }),
    skill: candidate.skill,
    sourceUnit: candidate.sourceUnit,
  }));
}

function projectUseDesiredName(candidate: ProjectUseCandidate): string {
  if (candidate.skill.status !== "draft") return candidate.skill.id;
  return candidate.decision.draftPolicy === "override" &&
      candidate.shippedSibling !== undefined
    ? candidate.skill.id
    : draftEffectiveName(candidate.skill.id);
}

export function resolveWorkspaceDraftSkillCopies(
  graph: BuildGraph
): readonly WorkspaceDraftSkillCopy[] {
  const pluginPaths = new Set(
    graph.plugins.flatMap((plugin) =>
      (plugin.discoveredSkills ?? plugin.skills).map((skill) => skill.sourcePath)
    )
  );
  const inventory = (graph.discoveredSkills ?? graph.standaloneSkills).filter(
    (skill) => !pluginPaths.has(skill.sourcePath)
  );
  const drafts = inventory
    .filter(
      (skill): skill is SourceSkill & {
        readonly draftOrigin: NonNullable<SourceSkill["draftOrigin"]>;
      } => skill.status === "draft" && skill.draftOrigin !== undefined
    )
    .sort((left, right) => compareStrings(left.sourcePath, right.sourcePath));
  // Live workspace skills keep their names; a draft whose derived name is
  // taken gets the next free numeric suffix.
  const used = new Map(
    graph.standaloneSkills.map((skill) => [skill.id, `workspace:${skill.id}`])
  );
  return drafts.map((skill) => {
    const sourceUnit = `skill:${skill.id}`;
    const baseName = draftEffectiveName(skill.id);
    const collisionSources = new Set<string>();
    let effectiveName = baseName;
    let suffix = 2;
    while (used.has(effectiveName)) {
      collisionSources.add(used.get(effectiveName) ?? effectiveName);
      effectiveName = suffixedSkillName(baseName, suffix);
      suffix += 1;
    }
    if (collisionSources.size > 0) collisionSources.add(`${sourceUnit}#draft`);
    used.set(effectiveName, `${sourceUnit}#draft`);
    return {
      collisionSources: [...collisionSources].sort(compareStrings),
      draftOrigin: skill.draftOrigin,
      effectiveName,
      selectionRule: "workspace drafts: side-by-side",
      ...shippedSiblingFor(inventory, skill),
      skill,
      sourceUnit,
    };
  });
}

export function draftEffectiveName(leaf: string): string {
  return `draft-${leaf}`;
}

function suffixedSkillName(baseName: string, suffix: number): string {
  return `${baseName}-${suffix}`;
}

function shippedSiblingFor(
  inventory: readonly SourceSkill[],
  skill: SourceSkill,
  pluginId?: string
): { readonly shippedSibling?: string } {
  if (skill.status !== "draft") return {};
  return inventory.some(
    (candidate) =>
      candidate.id === skill.id && (candidate.status ?? "live") === "live"
  )
    ? {
        shippedSibling: pluginId === undefined
          ? `skill:${skill.id}`
          : selectorForPluginSkill(pluginId, skill.id),
      }
    : {};
}

export function projectUseStatusEntries(
  graph: BuildGraph
): readonly ProjectUseStatusEntry[] {
  const pluginCopies = resolveProjectUseSkillCopies(graph).flatMap((copy) =>
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
        ...(copy.draftOrigin === undefined ? {} : { draftOrigin: copy.draftOrigin }),
        ...(copy.draftPolicy === undefined ? {} : { draftPolicy: copy.draftPolicy }),
        effectiveName: copy.effectiveName,
        owner: { target },
        role: "project-use" as const,
        selectionRule: copy.selectionRule,
        ...(copy.shippedSibling === undefined
          ? {}
          : { shippedSibling: copy.shippedSibling }),
        sourcePath: relative(graph.rootPath, copy.skill.sourcePath)
          .split(sep)
          .join("/"),
        sourceUnit: copy.sourceUnit,
        target,
      }];
    })
  );
  const workspaceDrafts = resolveWorkspaceDraftSkillCopies(graph).flatMap(
    (copy) =>
      targetNames().flatMap((target) => {
        if (
          !copy.skill.targets[target].enabled ||
          !isOutputSelected(
            graph.root.outputs.targetOutputs[target].skills,
            copy.skill.id
          )
        ) return [];
        return [{
          draftOrigin: copy.draftOrigin,
          effectiveName: copy.effectiveName,
          owner: { target },
          role: "bundle" as const,
          selectionRule: copy.selectionRule,
          ...(copy.shippedSibling === undefined
            ? {}
            : { shippedSibling: copy.shippedSibling }),
          sourcePath: relative(graph.rootPath, copy.skill.sourcePath)
            .split(sep)
            .join("/"),
          sourceUnit: copy.sourceUnit,
          target,
        }];
      })
  );
  return [...pluginCopies, ...workspaceDrafts].sort((left, right) =>
    compareStrings(
      `${left.sourceUnit}\0${left.effectiveName}\0${left.target}`,
      `${right.sourceUnit}\0${right.effectiveName}\0${right.target}`
    )
  );
}
