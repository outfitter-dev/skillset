/* eslint-disable func-style, no-await-in-loop, no-use-before-define -- Transaction phases are intentionally ordered and helper-first. */
/* eslint-disable unicorn/import-style -- Named path helpers keep the transaction paths explicit. */

import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { buildSkillsetResult, verifySkillsetResult } from "./build";
import { compareStrings, resolveInside } from "./path";
import { renderBuildGraph } from "./render";
import { loadBuildGraph } from "./resolver";
import { pathExists, toPosix, workspaceRoot } from "./source-rename-paths";
import { SourceRenamePlanError } from "./source-rename-types";
import type {
  SourceRenameApplyRequest,
  SourceRenameGeneratedOperation,
  SourceRenameMoveOperation,
  SourceRenamePlan,
  SourceRenameReport,
  SourceRenameRequest,
  SourceRenameUpdateOperation,
} from "./source-rename-types";
import type { RenderedFile } from "./types";
import { applyWorkspaceTransaction } from "./workspace-transaction";
import type { WorkspaceTransactionPlan } from "./workspace-transaction";

export async function applySourceRename(
  request: SourceRenameApplyRequest,
  planRename: (request: SourceRenameApplyRequest) => Promise<SourceRenamePlan>
): Promise<SourceRenameReport> {
  const plan = await planRename(request);
  if (request.expectedPlanHash !== plan.planHash) {
    throw new SourceRenamePlanError(
      `plan changed since preview: expected ${request.expectedPlanHash}, received ${plan.planHash}`
    );
  }

  const rootPath = await workspaceRoot(request.rootPath);
  const verification = await verifySkillsetResult(rootPath);
  if (!verification.ok) {
    throw new SourceRenamePlanError(
      `generated output is not current; reconcile or rebuild before renaming:\n${verification.data.failures.join("\n")}`
    );
  }

  const sourceTransaction = sourceTransactionPlan(plan);
  const generatedTransaction = generatedTransactionPlan(plan);
  const fullPlan: WorkspaceTransactionPlan = {
    deletes: [
      ...(sourceTransaction.deletes ?? []),
      ...(generatedTransaction.deletes ?? []),
    ],
    ...(sourceTransaction.moves === undefined
      ? {}
      : { moves: sourceTransaction.moves }),
    writes: [
      ...(sourceTransaction.writes ?? []),
      ...(generatedTransaction.writes ?? []),
    ],
  };
  await applyWorkspaceTransaction(
    rootPath,
    fullPlan,
    request.transactionOptions
  );

  return {
    ...plan,
    applied: true,
    writtenPaths: transactionPaths(fullPlan),
  };
}

export async function planSourceRenameGeneratedEffects(
  request: SourceRenameRequest,
  sourcePlan: SourceRenamePlan
): Promise<readonly SourceRenameGeneratedOperation[]> {
  const rootPath = await workspaceRoot(request.rootPath);
  const currentGraph = await loadBuildGraph(rootPath);
  const currentRendered = await renderBuildGraph(currentGraph);
  const shadowRoot = await createShadowWorkspace(
    rootPath,
    currentGraph.outputRoots
  );
  try {
    await copyExistingRenderedOutputs(rootPath, shadowRoot, currentRendered);
    await applyWorkspaceTransaction(
      shadowRoot,
      sourceTransactionPlan(sourcePlan)
    );
    const nextRendered = (await buildSkillsetResult(shadowRoot)).data;
    await assertNoUnmanagedOutputCollisions(
      rootPath,
      currentRendered,
      nextRendered
    );
    return generatedEffects(currentRendered, nextRendered);
  } finally {
    await rm(shadowRoot, { force: true, recursive: true });
  }
}

function sourceTransactionPlan(
  plan: SourceRenamePlan
): WorkspaceTransactionPlan {
  return {
    moves: plan.operations
      .filter(
        (operation): operation is SourceRenameMoveOperation =>
          operation.kind === "move"
      )
      .map((operation) => ({ from: operation.from, to: operation.to })),
    writes: plan.operations
      .filter(
        (operation): operation is SourceRenameUpdateOperation =>
          operation.kind === "update"
      )
      .map((operation) => ({
        content: operation.content,
        path: operation.path,
      })),
  };
}

function generatedTransactionPlan(
  plan: SourceRenamePlan
): WorkspaceTransactionPlan {
  return {
    deletes: plan.generatedOperations
      .filter((operation) => operation.kind === "delete")
      .map((operation) => operation.path),
    writes: plan.generatedOperations
      .filter(
        (
          operation
        ): operation is Extract<
          SourceRenameGeneratedOperation,
          { readonly kind: "create" | "update" }
        > => operation.kind !== "delete"
      )
      .map((operation) => ({
        content: operation.content,
        mode: operation.mode,
        path: operation.path,
      })),
  };
}

function generatedEffects(
  current: readonly RenderedFile[],
  next: readonly RenderedFile[]
): readonly SourceRenameGeneratedOperation[] {
  const currentByPath = new Map(current.map((file) => [file.path, file]));
  const nextByPath = new Map(next.map((file) => [file.path, file]));
  const effects: SourceRenameGeneratedOperation[] = [];

  for (const file of next) {
    const previous = currentByPath.get(file.path);
    if (previous === undefined) {
      effects.push({ content: file.content, kind: "create", mode: file.mode, path: file.path });
    } else if (
      previous.mode !== file.mode ||
      !renderedContentEquals(previous.content, file.content)
    ) {
      effects.push({ content: file.content, kind: "update", mode: file.mode, path: file.path });
    }
  }
  for (const file of current) {
    if (!nextByPath.has(file.path)) {
      effects.push({ kind: "delete", path: file.path });
    }
  }
  return effects.toSorted((left, right) => {
    const pathOrder = compareStrings(left.path, right.path);
    return pathOrder === 0 ? compareStrings(left.kind, right.kind) : pathOrder;
  });
}

function renderedContentEquals(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

async function createShadowWorkspace(
  rootPath: string,
  outputRoots: readonly string[]
): Promise<string> {
  const shadowRoot = await mkdtemp(join(tmpdir(), "skillset-source-rename-"));
  const excludedRoots = outputRoots.map((path) =>
    toPosix(relative(rootPath, path))
  );
  for (const entry of await readdir(rootPath)) {
    if (shadowCopyExcluded(entry, excludedRoots)) {
      continue;
    }
    await cp(join(rootPath, entry), join(shadowRoot, entry), {
      filter: (path) =>
        !shadowCopyExcluded(toPosix(relative(rootPath, path)), excludedRoots),
      recursive: true,
    });
  }
  return shadowRoot;
}

function shadowCopyExcluded(
  path: string,
  outputRoots: readonly string[]
): boolean {
  const segments = path.split("/");
  const [first = ""] = segments;
  return (
    first === ".git" ||
    segments.includes("node_modules") ||
    path === ".skillset/cache" ||
    path.startsWith(".skillset/cache/") ||
    first.startsWith(".skillset-workspace-transaction-") ||
    outputRoots.some(
      (root) =>
        path === root || (root.length > 0 && path.startsWith(`${root}/`))
    )
  );
}

async function copyExistingRenderedOutputs(
  rootPath: string,
  shadowRoot: string,
  rendered: readonly RenderedFile[]
): Promise<void> {
  for (const file of rendered) {
    const source = resolveInside(rootPath, file.path);
    if (!(await pathExists(source))) {
      continue;
    }
    const target = resolveInside(shadowRoot, file.path);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target);
  }
}

async function assertNoUnmanagedOutputCollisions(
  rootPath: string,
  current: readonly RenderedFile[],
  next: readonly RenderedFile[]
): Promise<void> {
  const managed = new Set(current.map((file) => file.path));
  for (const file of next) {
    if (managed.has(file.path)) {
      continue;
    }
    if (await pathExists(resolveInside(rootPath, file.path))) {
      throw new SourceRenamePlanError(
        `generated destination is unmanaged: ${file.path}; reconcile it before renaming`
      );
    }
  }
}

function transactionPaths(plan: WorkspaceTransactionPlan): readonly string[] {
  return [
    ...new Set([
      ...(plan.deletes ?? []),
      ...(plan.moves ?? []).flatMap((move) => [move.from, move.to]),
      ...(plan.writes ?? []).map((write) => write.path),
    ]),
  ].toSorted(compareStrings);
}
