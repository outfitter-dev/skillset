/* eslint-disable complexity, func-style, no-await-in-loop, no-use-before-define -- Ordered reads make the complete mutation plan explicit. */
/* eslint-disable unicorn/import-style -- Named path helpers keep source-plan construction concise. */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { readChangeLedger } from "./change-ledger";
import { compareStrings } from "./path";
import { loadBuildGraph } from "./resolver";
import {
  classifySkillCollectionMove,
  movedDraftDestination,
} from "./source-move-paths";
import {
  rewritePendingChangeScopes,
  rewriteSourceMoveConfig,
} from "./source-move-rewrite";
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
  pathExists,
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
import { workspaceChangeFile, workspaceChangesDir } from "./workspace-state";

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
          ...(documentPath === graph.rootConfigPath
            ? { rootContract: "workspace-config" as const }
            : documentPath === graph.rootManifestPath
              ? { rootContract: "root-source-manifest" as const }
              : {}),
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

    for (const documentPath of await pendingChangeDocuments(
      rootPath,
      graph.sourceDir
    )) {
      const source =
        updates.get(documentPath) ?? (await readFile(documentPath, "utf8"));
      let rewritten: string;
      try {
        rewritten = rewritePendingChangeScopes(source, documentPath, {
          fromSelector,
          toSelector,
        });
      } catch (error) {
        throw new SourceMovePlanError(
          `cannot rewrite pending change entry ${display(rootPath, documentPath)}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      if (rewritten !== source) {
        updates.set(documentPath, rewritten);
      }
    }

    const ledger = await sourceMoveLedgerUpdate(
      rootPath,
      graph.sourceDir,
      fromSelector,
      toSelector
    );
    updates.set(ledger.path, ledger.content);

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

/** Pending change entries are mutable authored source; JSONL streams are not. */
async function pendingChangeDocuments(
  rootPath: string,
  sourceDir: string
): Promise<readonly string[]> {
  const changesPath = join(rootPath, workspaceChangesDir(sourceDir));
  if (!(await pathExists(changesPath))) {
    return [];
  }
  const entries = await readdir(changesPath, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        !entry.name.startsWith(".")
    )
    .map((entry) => join(changesPath, entry.name))
    .toSorted(compareStrings);
}

async function sourceMoveLedgerUpdate(
  rootPath: string,
  sourceDir: string,
  from: string,
  to: string
): Promise<{ readonly content: string; readonly path: string }> {
  const path = workspaceChangeFile(sourceDir, "ledger.jsonl");
  const absolutePath = join(rootPath, path);
  const previous = (await pathExists(absolutePath))
    ? await readFile(absolutePath, "utf8")
    : "";
  const events = await readChangeLedger(rootPath, { sourceDir });
  const last = events.at(-1)?.createdAt;
  const timestamp = last === undefined ? 0 : Date.parse(last) + 1;
  if (!Number.isFinite(timestamp)) {
    throw new SourceMovePlanError(
      `cannot append identity history after invalid ledger timestamp ${JSON.stringify(last)}`
    );
  }
  const id = `source-moved-${createHash("sha256")
    .update(previous)
    .update("\0")
    .update(from)
    .update("\0")
    .update(to)
    .digest("hex")}`;
  const line = JSON.stringify({
    createdAt: new Date(timestamp).toISOString(),
    id,
    payload: { from, to },
    schemaVersion: 1,
    type: "source.moved",
  });
  return {
    content: `${previous}${previous.length === 0 || previous.endsWith("\n") ? "" : "\n"}${line}\n`,
    path: absolutePath,
  };
}
