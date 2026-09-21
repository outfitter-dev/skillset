/* eslint-disable complexity, func-style, no-use-before-define -- Named path predicates keep collection-move policy explicit. */
/* eslint-disable no-nested-ternary, unicorn/import-style, unicorn/no-nested-ternary -- Collection ownership branches mirror the two supported directions. */

import { basename, dirname, join, relative, sep } from "node:path";

import { SourceMovePlanError } from "./source-move-types";
import type { SourceMoveKind } from "./source-move-types";
import { display, isWithin, pathExists } from "./source-rename-paths";
import type { BuildGraph, SourcePlugin, SourceSkill } from "./types";

export interface SourceMoveClassification {
  readonly draft?: SourceSkill;
  readonly fromCollectionRoot: string;
  readonly fromPlugin?: SourcePlugin;
  readonly kind: SourceMoveKind;
  readonly skill: SourceSkill;
  readonly toCollectionRoot: string;
  readonly toPlugin?: SourcePlugin;
}

export async function classifySkillCollectionMove(
  graph: BuildGraph,
  fromPath: string,
  toPath: string,
  sourceIsDirectory: boolean
): Promise<SourceMoveClassification> {
  if (!sourceIsDirectory) {
    throw movePathError(
      graph,
      fromPath,
      toPath,
      "source must be a complete shipped skill directory"
    );
  }

  const standalone = graph.standaloneSkills.find(
    (skill) => dirname(skill.sourcePath) === fromPath
  );
  const pluginOwner = graph.plugins.find((plugin) =>
    plugin.skills.some((skill) => dirname(skill.sourcePath) === fromPath)
  );
  const pluginSkill = pluginOwner?.skills.find(
    (skill) => dirname(skill.sourcePath) === fromPath
  );
  const skill = standalone ?? pluginSkill;
  if (skill === undefined) {
    const discovered = (graph.discoveredSkills ?? []).find(
      (candidate) => dirname(candidate.sourcePath) === fromPath
    );
    throw movePathError(
      graph,
      fromPath,
      toPath,
      discovered?.status === "draft"
        ? "source is a draft; move its shipped same-container sibling instead"
        : "source must be a complete shipped skill directory"
    );
  }

  if (basename(toPath) !== skill.id) {
    throw movePathError(
      graph,
      fromPath,
      toPath,
      `destination must preserve skill leaf ${JSON.stringify(skill.id)}`
    );
  }

  const workspaceCollection = join(graph.sourceRootPath, "skills");
  const fromPlugin = pluginOwner;
  const toPlugin =
    fromPlugin === undefined
      ? graph.plugins.find((plugin) =>
          isSkillCollectionDestination(join(plugin.path, "skills"), toPath)
        )
      : undefined;
  const toCollectionRoot =
    fromPlugin === undefined
      ? toPlugin === undefined
        ? undefined
        : join(toPlugin.path, "skills")
      : isSkillCollectionDestination(workspaceCollection, toPath)
        ? workspaceCollection
        : undefined;

  if (toCollectionRoot === undefined) {
    throw movePathError(
      graph,
      fromPath,
      toPath,
      fromPlugin === undefined
        ? "destination must be inside a known plugin skill collection in this workspace"
        : "destination must be inside this workspace's standalone skill collection"
    );
  }

  const workspaceInventory = graph.discoveredSkills?.filter((candidate) =>
    isWithin(workspaceCollection, dirname(candidate.sourcePath))
  ) ?? graph.standaloneSkills;
  const destinationInventory =
    toPlugin === undefined
      ? workspaceInventory
      : (toPlugin.discoveredSkills ?? toPlugin.skills);
  const leafCollision = destinationInventory.find(
    (candidate) => candidate.id === skill.id
  );
  if (leafCollision !== undefined || (await pathExists(toPath))) {
    const collisionPath =
      leafCollision === undefined ? toPath : dirname(leafCollision.sourcePath);
    throw movePathError(
      graph,
      fromPath,
      toPath,
      `destination leaf already exists at ${display(graph.rootPath, collisionPath)}`
    );
  }

  const sourceInventory =
    fromPlugin === undefined
      ? workspaceInventory
      : (fromPlugin.discoveredSkills ?? fromPlugin.skills);
  const draft = sourceInventory.find(
    (candidate) =>
      candidate.id === skill.id && candidate.draftOrigin === "_drafts"
  );
  const draftDestination =
    draft === undefined
      ? undefined
      : join(dirname(toPath), "_drafts", basename(toPath));
  if (draftDestination !== undefined && (await pathExists(draftDestination))) {
    throw movePathError(
      graph,
      fromPath,
      toPath,
      `draft destination already exists at ${display(graph.rootPath, draftDestination)}`
    );
  }

  return {
    ...(draft === undefined ? {} : { draft }),
    fromCollectionRoot:
      fromPlugin === undefined
        ? workspaceCollection
        : join(fromPlugin.path, "skills"),
    ...(fromPlugin === undefined ? {} : { fromPlugin }),
    kind:
      fromPlugin === undefined ? "workspace-to-plugin" : "plugin-to-workspace",
    skill,
    toCollectionRoot,
    ...(toPlugin === undefined ? {} : { toPlugin }),
  };
}

export function movedDraftDestination(toPath: string): string {
  return join(dirname(toPath), "_drafts", basename(toPath));
}

function isSkillCollectionDestination(
  collectionRoot: string,
  toPath: string
): boolean {
  if (!isWithin(collectionRoot, toPath) || toPath === collectionRoot) {
    return false;
  }
  const parts = relative(collectionRoot, toPath).split(sep).filter(Boolean);
  return (
    parts.length > 0 && !parts.slice(0, -1).some((part) => part.startsWith("_"))
  );
}

function movePathError(
  graph: BuildGraph,
  fromPath: string,
  toPath: string,
  reason: string
): SourceMovePlanError {
  return new SourceMovePlanError(
    `${reason}: ${display(graph.rootPath, fromPath)} -> ${display(graph.rootPath, toPath)}`
  );
}
