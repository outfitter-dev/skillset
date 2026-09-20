/**
 * `skillset resolve` — clear generated-output conflicts during a rebase or
 * merge (SET-600).
 *
 * A generated-output conflict carries no information. Its resolution never
 * depends on what the markers say; it is always "regenerate from the merged
 * source". So the conflict is treated as a signal about which outputs are
 * stale, not as a merge to perform.
 */

import {
  buildSkillsetResult,
  diffSkillsetResult,
  type SkillsetRepairPlan,
} from "@skillset/core";
import { compareStrings } from "@skillset/core/internal/path";
import { loadBuildGraph } from "@skillset/core/internal/resolver";
import type { SkillsetOptions } from "@skillset/core/internal/types";

import { serializeDiagnostics } from "./cli-diagnostics";
import { printCliJsonData } from "./cli-output";
import { printDiagnostics } from "./cli-renderers";
import {
  inventoryConflicts,
  isGitRepository,
  isLockPath,
  materializeConflictedPaths,
  readConflictedPaths,
  readUnstagedProjectionPaths,
  restoreWorktreePaths,
  snapshotWorktreePaths,
  stagePaths,
  type ConflictInventory,
} from "./resolve-conflicts";

export interface ResolveCommandRequest {
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
  readonly yes: boolean;
}

interface ResolveReport {
  readonly authored: readonly string[];
  readonly generated: readonly string[];
  /** Conflicted generated paths that were edited by hand on one side. */
  readonly handEdited: readonly string[];
  readonly repair?: SkillsetRepairPlan;
  readonly staged: readonly string[];
  readonly state: "blocked" | "nothing-to-resolve" | "planned" | "resolved";
  /** Worktree-only paths that could contaminate a generated repair. */
  readonly unstaged?: readonly string[];
}

export async function runResolveCommand({
  jsonOutput,
  options,
  rootPath,
  yes,
}: ResolveCommandRequest): Promise<void> {
  if (!(await isGitRepository(rootPath))) {
    throw new Error("skillset: resolve requires a git repository");
  }
  const conflicted = await readConflictedPaths(rootPath);
  if (conflicted.length === 0) {
    return report(
      {
        authored: [],
        generated: [],
        handEdited: [],
        staged: [],
        state: "nothing-to-resolve",
      },
      { jsonOutput }
    );
  }

  const inventory = await inventoryConflicts(rootPath, conflicted);
  // Authored conflicts come first, always. Regenerating from source that still
  // carries conflict markers would render those markers into generated output —
  // a file that looks valid, stages like a valid file, and corresponds to no
  // source. That is the exact artifact this command exists to prevent.
  if (inventory.authored.length > 0) {
    return report(
      {
        authored: inventory.authored,
        generated: inventory.generated,
        handEdited: inventory.handEdited,
        staged: [],
        state: "blocked",
      },
      { jsonOutput }
    );
  }
  // A conflicted path represents neither side, so the verdict table has no
  // baseline. Each side was instead checked against its own lock; a side that
  // disagreed with its own recorded hash was edited after it was generated, and
  // regenerating would discard that edit without ever reporting it.
  if (inventory.handEdited.length > 0) {
    return report(
      {
        authored: inventory.authored,
        generated: inventory.generated,
        handEdited: inventory.handEdited,
        staged: [],
        state: "blocked",
      },
      { jsonOutput }
    );
  }
  if (!yes) {
    return report(
      {
        authored: inventory.authored,
        generated: inventory.generated,
        handEdited: inventory.handEdited,
        staged: [],
        state: "planned",
      },
      { jsonOutput }
    );
  }

  const graph = await loadBuildGraph(rootPath, options);
  const unstaged = await readUnstagedProjectionPaths(
    rootPath,
    new Set(conflicted),
    graph.sourceRoot,
    [graph.rootConfigPath, graph.rootManifestPath, ...graph.externalInputPaths]
  );
  if (unstaged.length > 0) {
    return report(
      {
        authored: inventory.authored,
        generated: inventory.generated,
        handEdited: inventory.handEdited,
        staged: [],
        state: "blocked",
        unstaged,
      },
      { jsonOutput }
    );
  }

  const conflictPreimages = await snapshotWorktreePaths(
    rootPath,
    inventory.generated
  );
  let rollbackPreimages = conflictPreimages;
  let completed:
    | {
        readonly result: Awaited<ReturnType<typeof buildSkillsetResult>>;
        readonly staged: readonly string[];
      }
    | undefined;
  try {
    // Materialize each lock and every payload it owns from one coherent side so
    // the repair sees whole files rather than marker soup or a mixed baseline.
    await materializeConflictedPaths(
      rootPath,
      inventory.generated,
      inventory.materializationStages
    );

    // No path scope: a rebase needs the whole projection consistent with the
    // merged source, not just the paths that happened to conflict. Scoping the
    // repair would leave every other output stale. The gate is broader too,
    // which is the safe direction — resolve already checked the conflicted
    // paths against both sides' locks by this point.
    const preview = await diffSkillsetResult(rootPath, {
      ...options,
      repair: {},
    });
    if (!preview.ok) {
      await restoreWorktreePaths(rootPath, rollbackPreimages);
      printDiagnosticsUnlessJson(preview.diagnostics, jsonOutput);
      return report(
        {
          authored: inventory.authored,
          generated: inventory.generated,
          handEdited: inventory.handEdited,
          ...(preview.repair === undefined ? {} : { repair: preview.repair }),
          staged: [],
          state: "blocked",
        },
        { diagnostics: preview.diagnostics, jsonOutput }
      );
    }

    const conflictSet = new Set(inventory.generated);
    const plannedPaths = new Set([
      ...preview.data.added,
      ...preview.data.changed,
      ...preview.data.missing,
      ...preview.data.removed,
    ]);
    const additionalPreimages = await snapshotWorktreePaths(
      rootPath,
      [...plannedPaths].filter((path) => !conflictSet.has(path))
    );
    rollbackPreimages = [...conflictPreimages, ...additionalPreimages];

    const result = await buildSkillsetResult(rootPath, {
      ...options,
      repair: {},
    });
    if (!result.ok) {
      await restoreWorktreePaths(rootPath, rollbackPreimages);
      printDiagnosticsUnlessJson(result.diagnostics, jsonOutput);
      return report(
        {
          authored: inventory.authored,
          generated: inventory.generated,
          handEdited: inventory.handEdited,
          ...(result.repair === undefined ? {} : { repair: result.repair }),
          staged: [],
          state: "blocked",
        },
        { diagnostics: result.diagnostics, jsonOutput }
      );
    }

    const staged = stageableGeneratedPaths(inventory, result);
    if (!(await stagePaths(rootPath, staged))) {
      throw new Error("skillset: resolve could not stage repaired output");
    }
    completed = { result, staged };
  } catch (error) {
    await restoreWorktreePaths(rootPath, rollbackPreimages);
    throw error;
  }
  if (completed === undefined) {
    throw new Error("skillset: resolve completed without a repair result");
  }
  return report(
    {
      authored: inventory.authored,
      generated: inventory.generated,
      handEdited: inventory.handEdited,
      ...(completed.result.repair === undefined
        ? {}
        : { repair: completed.result.repair }),
      staged: completed.staged,
      state: "resolved",
    },
    { diagnostics: completed.result.diagnostics, jsonOutput }
  );
}

/**
 * Every conflicted generated path plus each path Core reports it wrote or
 * removed. Existing conflict paths are lock-confirmed; new output paths are
 * authorized by Core's generated write summary.
 */
function stageableGeneratedPaths(
  inventory: ConflictInventory,
  result: Awaited<ReturnType<typeof buildSkillsetResult>>
): readonly string[] {
  const generatedByRepair = new Set([
    ...result.writes.writtenPaths,
    ...result.writes.deletedPaths,
  ]);
  const candidates = new Set([...inventory.generated, ...generatedByRepair]);
  return [...candidates]
    .filter(
      (path) =>
        inventory.managedPaths.has(path) ||
        generatedByRepair.has(path) ||
        isLockPath(path)
    )
    .sort(compareStrings);
}

function printDiagnosticsUnlessJson(
  diagnostics: Parameters<typeof printDiagnostics>[0],
  jsonOutput: boolean
): void {
  if (!jsonOutput) printDiagnostics(diagnostics);
}

function report(
  data: ResolveReport,
  context: {
    readonly diagnostics?: Parameters<typeof serializeDiagnostics>[0];
    readonly jsonOutput: boolean;
  }
): void {
  const exitCode = data.state === "blocked" ? 1 : 0;
  if (context.jsonOutput) {
    printCliJsonData(
      "resolve",
      data,
      exitCode,
      data.state === "planned" ? "plan" : "mutation",
      serializeDiagnostics(context.diagnostics ?? [])
    );
    if (exitCode !== 0) process.exitCode = exitCode;
    return;
  }
  printResolveText(data);
  if (exitCode !== 0) process.exitCode = exitCode;
}

function printResolveText(data: ResolveReport): void {
  if (data.state === "nothing-to-resolve") {
    console.log("skillset: nothing to resolve");
    return;
  }
  for (const entry of data.repair?.verdicts ?? []) {
    if (entry.action === "none") continue;
    console.log(`  ${entry.verdict}: ${entry.outputPath} (${entry.action})`);
  }
  if (data.state === "planned") {
    for (const path of data.generated) console.log(`  generated: ${path}`);
    console.log(
      `skillset: ${data.generated.length} generated and ${data.authored.length} authored conflicts (rerun with --yes to repair and stage the generated ones)`
    );
    return;
  }
  if (data.authored.length > 0) {
    console.error(
      "skillset: authored conflicts must be resolved before generated output can be regenerated"
    );
    for (const path of data.authored) console.error(`  ${path}`);
    console.error(
      "skillset: resolve those by hand, then rerun skillset resolve --yes"
    );
    return;
  }
  if (data.handEdited.length > 0) {
    console.error(
      "skillset: these generated files were edited by hand on one side of the conflict, and regenerating would discard the edit"
    );
    for (const path of data.handEdited) console.error(`  ${path}`);
    console.error(
      "skillset: recover each edit into its authoring source with skillset explain <path>, commit that, then rerun skillset resolve --yes"
    );
    return;
  }
  if ((data.unstaged?.length ?? 0) > 0) {
    console.error(
      "skillset: unstaged or untracked paths could change generated output during resolve"
    );
    for (const path of data.unstaged ?? []) console.error(`  ${path}`);
    console.error(
      "skillset: stage or remove those paths, then rerun skillset resolve --yes"
    );
    return;
  }
  if (data.state === "blocked") {
    // The repair itself refused. Its diagnostics and verdicts are already
    // printed; say what that means for the conflict and where to go next.
    console.error(
      "skillset: the repair refused, so nothing was staged and the conflict is still open"
    );
    console.error(
      "skillset: resolve each path named above at its source, then rerun skillset resolve --yes"
    );
    return;
  }
  if (data.staged.length > 0) {
    console.log(
      `skillset: repaired and staged ${data.staged.length} generated files`
    );
  }
  if (data.state === "resolved") console.log("skillset: all conflicts cleared");
}
