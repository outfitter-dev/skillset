/* eslint-disable complexity, func-style, no-await-in-loop, no-use-before-define -- Ordered reads make the complete mutation plan explicit. */
/* eslint-disable unicorn/import-style -- Named path helpers keep source-plan construction concise. */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { compareStrings } from "./path";
import { loadBuildGraph } from "./resolver";
import {
  classifySkillCollectionMove,
  movedDraftDestination,
} from "./source-move-paths";
import { rewriteSourceMoveConfig } from "./source-move-rewrite";
import { SourceMovePlanError } from "./source-move-types";
import type {
  SourceMoveApplyRequest,
  SourceMovePlan,
  SourceMoveReport,
  SourceMoveRequest,
} from "./source-move-types";
import {
  applySourceMutation,
  planSourceMutationGeneratedEffects,
} from "./source-rename-apply";
import {
  assertNoSymlinkTraversal,
  assertSourceContained,
  display,
  existingContainedPath,
  futureContainedPath,
  pathIsDirectory,
  remapPath,
  sourceMarkdownDocuments,
  sourceYamlDocuments,
  workspaceRoot,
} from "./source-rename-paths";
import {
  updateMarkdownDocument,
  updateYamlDocument,
} from "./source-rename-rewrite";
import type { SkillIdentityRename } from "./source-rename-rewrite";
import { hookIdentityRenameMap } from "./source-rename-structured";
import type {
  SourceRenameMoveOperation,
  SourceRenameOperation,
  SourceRenameUpdateOperation,
} from "./source-rename-types";
import { SourceRenamePlanError } from "./source-rename-types";
import { sourceUnitSelector } from "./source-unit-selector";
import { workspaceChangeFile } from "./workspace-state";

export { SourceMovePlanError } from "./source-move-types";
export type {
  SourceMoveApplyRequest,
  SourceMoveKind,
  SourceMovePlan,
  SourceMoveReport,
  SourceMoveRequest,
} from "./source-move-types";

export async function planSourceMove(
  request: SourceMoveRequest
): Promise<SourceMovePlan> {
  const authored = await planAuthoredSourceMove(request);
  const generatedOperations = await planSourceMutationGeneratedEffects(
    request,
    authored,
    (message) => new SourceMovePlanError(message),
    "moving"
  );
  return finalizePlan(authored, generatedOperations);
}

async function planAuthoredSourceMove(
  request: SourceMoveRequest
): Promise<SourceMovePlan> {
  try {
    const rootPath = await workspaceRoot(request.rootPath);
    const graph = await loadBuildGraph(rootPath);
    const fromPath = await existingContainedPath(
      rootPath,
      request.from,
      "from"
    );
    const toPath = await futureContainedPath(rootPath, request.to, "to");
    assertSourceContained(graph, fromPath, "from");
    assertSourceContained(graph, toPath, "to");
    await assertNoSymlinkTraversal(rootPath, fromPath, "from");
    await assertNoSymlinkTraversal(rootPath, toPath, "to");

    const classification = await classifySkillCollectionMove(
      graph,
      fromPath,
      toPath,
      await pathIsDirectory(fromPath)
    );
    const fromSelector = sourceUnitSelector(
      classification.fromPlugin === undefined
        ? `skill:${classification.skill.id}`
        : `plugin.${classification.fromPlugin.id}.skill:${classification.skill.id}`
    );
    const toSelector = sourceUnitSelector(
      classification.toPlugin === undefined
        ? `skill:${classification.skill.id}`
        : `plugin.${classification.toPlugin.id}.skill:${classification.skill.id}`
    );
    const draftFrom =
      classification.draft === undefined
        ? undefined
        : dirname(classification.draft.sourcePath);
    const draftTo =
      draftFrom === undefined ? undefined : movedDraftDestination(toPath);
    const renamedPath = (path: string): string => {
      const live = remapPath(path, fromPath, toPath);
      return live !== path || draftFrom === undefined || draftTo === undefined
        ? live
        : remapPath(path, draftFrom, draftTo);
    };
    const identityRename: SkillIdentityRename = {
      from: classification.skill.id,
      ...(classification.fromPlugin === undefined
        ? {}
        : { fromPluginId: classification.fromPlugin.id }),
      sourcePath: classification.skill.sourcePath,
      to: classification.skill.id,
      ...(classification.toPlugin === undefined
        ? {}
        : { toPluginId: classification.toPlugin.id }),
    };
    const warnings = new Set<string>();
    const notices = new Set<string>();
    const updates = new Map<string, string>();
    const hookIdentityRenames = hookIdentityRenameMap(graph, fromPath, toPath);

    for (const documentPath of await sourceMarkdownDocuments(graph)) {
      const source = await readFile(documentPath, "utf8");
      const updated = await updateMarkdownDocument({
        documentPath,
        fromPath,
        graph,
        hookIdentityRenames,
        identityRename,
        renamedPath,
        source,
        warnings,
      });
      if (updated !== source) {
        updates.set(renamedPath(documentPath), updated);
      }
    }

    const pluginDraftDeclared =
      classification.kind === "plugin-to-workspace" &&
      classification.fromPlugin?.configuredDrafts?.includes(
        `skill:${classification.skill.id}`
      ) === true;
    for (const documentPath of sourceYamlDocuments(graph)) {
      const source = await readFile(documentPath, "utf8");
      const generallyUpdated = updateYamlDocument({
        documentPath,
        fromPath,
        graph,
        hookIdentityRenames,
        identityRename,
        renamedPath,
        source,
        warnings,
      });
      const rewritten = rewriteSourceMoveConfig(
        generallyUpdated,
        documentPath,
        {
          fromSelector,
          ...(classification.fromPlugin === undefined
            ? {}
            : { internalUsePluginId: classification.fromPlugin.id }),
          leaf: classification.skill.id,
          movePluginDraftToWorkspace: pluginDraftDeclared,
          rootDocument:
            documentPath === graph.rootConfigPath ||
            documentPath === graph.rootManifestPath,
          sourcePluginDocument:
            documentPath === classification.fromPlugin?.configPath,
          toSelector,
        }
      );
      if (rewritten.removedInternalUse) {
        notices.add(
          `removed plugins.internal_use selection for ${fromSelector}; workspace skills are not selected implicitly`
        );
      }
      if (rewritten.content !== source) {
        updates.set(renamedPath(documentPath), rewritten.content);
      }
    }

    const moves: SourceRenameMoveOperation[] = [
      {
        from: display(rootPath, fromPath),
        kind: "move",
        to: display(rootPath, toPath),
      },
      ...(draftFrom === undefined || draftTo === undefined
        ? []
        : [
            {
              from: display(rootPath, draftFrom),
              kind: "move" as const,
              to: display(rootPath, draftTo),
            },
          ]),
    ];
    const operations: readonly SourceRenameOperation[] = [
      ...moves,
      {
        event: {
          payload: { from: fromSelector, to: toSelector },
          type: "source.moved",
        },
        kind: "append",
        path: display(
          rootPath,
          join(rootPath, workspaceChangeFile(graph.sourceDir, "ledger.jsonl"))
        ),
      },
      ...[...updates.entries()]
        .toSorted(([left], [right]) => compareStrings(left, right))
        .map(
          ([path, content]): SourceRenameUpdateOperation => ({
            content,
            kind: "update",
            path: display(rootPath, path),
          })
        ),
    ];
    const sourcePlan: SourceMovePlan = {
      from: moves[0]?.from ?? display(rootPath, fromPath),
      generatedOperations: [],
      kind: classification.kind,
      notices: [...notices].toSorted(compareStrings),
      operations,
      planHash: "",
      to: moves[0]?.to ?? display(rootPath, toPath),
      warnings: [...warnings].toSorted(compareStrings),
    };
    return finalizePlan(sourcePlan, []);
  } catch (error) {
    if (error instanceof SourceMovePlanError) {
      throw error;
    }
    if (error instanceof SourceRenamePlanError) {
      throw new SourceMovePlanError(
        error.message.replace(/^skillset: source rename /u, "")
      );
    }
    throw error;
  }
}

export function moveSource(
  request: SourceMoveApplyRequest
): Promise<SourceMoveReport> {
  return applySourceMutation(
    request,
    planSourceMove,
    (message) => new SourceMovePlanError(message),
    "moving"
  );
}

function finalizePlan(
  plan: SourceMovePlan,
  generatedOperations: SourceMovePlan["generatedOperations"]
): SourceMovePlan {
  const value = {
    ...plan,
    generatedOperations,
    planHash: "",
  };
  return {
    ...value,
    planHash: createHash("sha256")
      .update(
        JSON.stringify({
          generatedOperations,
          kind: value.kind,
          notices: value.notices,
          operations: value.operations,
          warnings: value.warnings,
        })
      )
      .digest("hex"),
  };
}
