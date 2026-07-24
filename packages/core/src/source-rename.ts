/* eslint-disable func-style, no-await-in-loop, no-use-before-define -- Ordered source reads and hoisted helpers expose the planner phases. */
/* eslint-disable unicorn/import-style -- Named path helpers keep source-plan construction concise. */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { compareStrings } from "./path";
import { loadBuildGraph } from "./resolver";
import { assertSourceReferenceContract } from "./source-reference-contract";
import {
  applySourceRename,
  planSourceRenameGeneratedEffects,
} from "./source-rename-apply";
import {
  assertDestination,
  assertNoSymlinkTraversal,
  assertSourceContained,
  classifyRename,
  display,
  existingContainedPath,
  futureContainedPath,
  isCaseOnlyRename,
  pathExists,
  pathIsDirectory,
  pluginForSkill,
  remapPath,
  sameExistingEntry,
  sourceMarkdownDocuments,
  sourceYamlDocuments,
  workspaceRoot,
  allSkills,
} from "./source-rename-paths";
import {
  updateMarkdownDocument,
  updateYamlDocument,
} from "./source-rename-rewrite";
import type { SkillIdentityRename } from "./source-rename-rewrite";
import {
  hookIdentityRenameMap,
  updateAdaptiveHookDocument,
  updateSkillEvalDocument,
} from "./source-rename-structured";
import { SourceRenamePlanError } from "./source-rename-types";
import type {
  SourceRenameApplyRequest,
  SourceRenameMoveOperation,
  SourceRenameOperation,
  SourceRenamePlan,
  SourceRenameReport,
  SourceRenameRequest,
  SourceRenameUpdateOperation,
} from "./source-rename-types";

export { SourceRenamePlanError } from "./source-rename-types";
export type {
  SourceRenameApplyRequest,
  SourceRenameGeneratedOperation,
  SourceRenameKind,
  SourceRenameMoveOperation,
  SourceRenameOperation,
  SourceRenamePlan,
  SourceRenameReport,
  SourceRenameRequest,
  SourceRenameUpdateOperation,
} from "./source-rename-types";

/**
 * Plans one source-only rename without mutating the workspace.
 *
 * This is intentionally narrower than a generic filesystem move: it accepts a
 * source file or complete source skill root, proves both endpoints stay in the
 * same authoring scope, and produces the exact structural document rewrites a
 * later workspace transaction may apply.
 */
export async function planSourceRename(
  request: SourceRenameRequest
): Promise<SourceRenamePlan> {
  assertSourceReferenceContract();
  const sourcePlan = await planAuthoredSourceRename(request);
  const generatedOperations = await planSourceRenameGeneratedEffects(
    request,
    sourcePlan
  );
  return {
    ...sourcePlan,
    generatedOperations,
    planHash: hashPlan({
      generatedOperations,
      kind: sourcePlan.kind,
      operations: sourcePlan.operations,
      warnings: sourcePlan.warnings,
    }),
  };
}

async function planAuthoredSourceRename(
  request: SourceRenameRequest
): Promise<SourceRenamePlan> {
  const rootPath = await workspaceRoot(request.rootPath);
  const graph = await loadBuildGraph(rootPath);
  const fromPath = await existingContainedPath(rootPath, request.from, "from");
  const toPath = await futureContainedPath(rootPath, request.to, "to");
  assertSourceContained(graph, fromPath, "from");
  assertSourceContained(graph, toPath, "to");
  await assertNoSymlinkTraversal(rootPath, fromPath, "from");
  await assertNoSymlinkTraversal(rootPath, toPath, "to");

  const classification = classifyRename(
    graph,
    fromPath,
    await pathIsDirectory(fromPath)
  );
  assertDestination(graph, classification, fromPath, toPath);
  if (
    (await pathExists(toPath)) &&
    !(
      isCaseOnlyRename(fromPath, toPath) &&
      (await sameExistingEntry(fromPath, toPath))
    )
  ) {
    throw new SourceRenamePlanError(
      `destination already exists: ${display(rootPath, toPath)}`
    );
  }

  const renamedPath = (path: string): string =>
    remapPath(path, fromPath, toPath);
  const oldSkill = classification.skill;
  const plugin =
    oldSkill === undefined ? undefined : pluginForSkill(graph, oldSkill);
  const identityRename: SkillIdentityRename | undefined =
    oldSkill === undefined
      ? undefined
      : {
          from: oldSkill.id,
          ...(plugin === undefined ? {} : { pluginId: plugin.id }),
          sourcePath: oldSkill.sourcePath,
          to: basename(toPath),
        };
  const hookIdentityRenames = hookIdentityRenameMap(graph, fromPath, toPath);
  const warnings = new Set<string>();
  const updates = new Map<string, string>();

  for (const documentPath of await sourceMarkdownDocuments(graph)) {
    const source = await readFile(documentPath, "utf-8");
    const updated = await updateMarkdownDocument({
      documentPath,
      fromPath,
      graph,
      hookIdentityRenames,
      ...(identityRename === undefined ? {} : { identityRename }),
      renamedPath,
      source,
      warnings,
    });
    if (updated !== source) {
      updates.set(renamedPath(documentPath), updated);
    }
  }

  for (const documentPath of sourceYamlDocuments(graph)) {
    const source = await readFile(documentPath, "utf-8");
    const updated = updateYamlDocument({
      documentPath,
      fromPath,
      graph,
      hookIdentityRenames,
      ...(identityRename === undefined ? {} : { identityRename }),
      renamedPath,
      source,
      warnings,
    });
    if (updated !== source) {
      updates.set(renamedPath(documentPath), updated);
    }
  }

  for (const hook of graph.adaptiveHooks) {
    const source = await readFile(hook.sourcePath, "utf-8");
    const updated = updateAdaptiveHookDocument({
      graph,
      hook,
      renamedPath,
      source,
    });
    if (updated !== source) {
      updates.set(renamedPath(hook.sourcePath), updated);
    }
  }

  for (const skill of allSkills(graph)) {
    const evalPath = join(dirname(skill.sourcePath), "evals", "evals.json");
    if (!(await pathExists(evalPath))) {
      continue;
    }
    const source = await readFile(evalPath, "utf-8");
    const updated = updateSkillEvalDocument({
      ...(oldSkill === skill && identityRename !== undefined
        ? { identityRename }
        : {}),
      renamedPath,
      skill,
      source,
    });
    if (updated !== source) {
      updates.set(renamedPath(evalPath), updated);
    }
  }

  const move: SourceRenameMoveOperation = {
    from: display(rootPath, fromPath),
    kind: "move",
    to: display(rootPath, toPath),
  };
  const operations: readonly SourceRenameOperation[] = [
    move,
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
  const normalizedWarnings = [...warnings].toSorted(compareStrings);
  return {
    from: move.from,
    generatedOperations: [],
    kind: classification.kind,
    operations,
    planHash: hashPlan({
      kind: classification.kind,
      operations,
      warnings: normalizedWarnings,
    }),
    to: move.to,
    warnings: normalizedWarnings,
  };
}

/**
 * Applies a previously previewable source rename and its regenerated outputs
 * as one rollback-capable workspace transaction.
 */
export function renameSource(
  request: SourceRenameApplyRequest
): Promise<SourceRenameReport> {
  return applySourceRename(request, planSourceRename);
}

function hashPlan(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
