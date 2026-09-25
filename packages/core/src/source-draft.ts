/* eslint-disable complexity, func-style, no-await-in-loop, no-use-before-define -- Lifecycle planning keeps ordered validation and evidence visible. */

import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

import { readChangeLedger, type ChangeLedgerEvent } from "./change-ledger";
import {
  formatGeneratedFileMode,
  normalizeGeneratedFileMode,
} from "./generated-file-mode";
import { compareStrings } from "./path";
import { loadBuildGraph } from "./resolver";
import {
  currentSourceIdentity,
  sourceIdentityMappings,
  sourceMappingsAfterEvent,
} from "./source-identity-mapping";
import {
  SourceDraftPlanError,
  SourcePromotionPlanError,
} from "./source-draft-types";
import type {
  SourceDraftApplyRequest,
  SourceDraftPlan,
  SourceDraftReport,
  SourceDraftRequest,
  SourcePromotionApplyRequest,
  SourcePromotionPlan,
  SourcePromotionReport,
  SourcePromotionRequest,
} from "./source-draft-types";
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
  workspaceRoot,
} from "./source-rename-paths";
import type {
  SourceMutationOperation,
  SourceRenameGeneratedOperation,
} from "./source-rename-types";
import { SourceRenamePlanError } from "./source-rename-types";
import { collectSourceFiles, hashSkillDirectory } from "./source-tree-identity";
import {
  selectorForPluginSkill,
  selectorForStandaloneSkill,
} from "./source-unit-selector";
import type { BuildGraph, SourcePlugin, SourceSkill } from "./types";
import { workspaceChangeFile } from "./workspace-state";

export {
  SourceDraftPlanError,
  SourcePromotionPlanError,
} from "./source-draft-types";
export type {
  SourceDraftApplyRequest,
  SourceDraftPlan,
  SourceDraftReport,
  SourceDraftRequest,
  SourcePromotionApplyRequest,
  SourcePromotionPlan,
  SourcePromotionReport,
  SourcePromotionRequest,
} from "./source-draft-types";

interface SkillContainer {
  readonly plugin?: SourcePlugin;
  readonly selector: string;
  readonly skill: SourceSkill;
}

interface PromotionClassification extends SkillContainer {
  readonly draftPath: string;
  readonly shippedPath: string;
  readonly shippedSkill?: SourceSkill;
}

export async function planSourceDraft(
  request: SourceDraftRequest
): Promise<SourceDraftPlan> {
  const authored = await planAuthoredDraft(request);
  const generatedOperations = await planSourceMutationGeneratedEffects(
    request,
    authored,
    (message) => new SourceDraftPlanError(message),
    "drafting"
  );
  return finalizeDraftPlan(authored, generatedOperations);
}

export function draftSource(
  request: SourceDraftApplyRequest
): Promise<SourceDraftReport> {
  return applySourceMutation(
    request,
    planSourceDraft,
    (message) => new SourceDraftPlanError(message),
    "drafting"
  );
}

export async function planSourcePromotion(
  request: SourcePromotionRequest
): Promise<SourcePromotionPlan> {
  const authored = await planAuthoredPromotion(request);
  const generatedOperations = await planSourceMutationGeneratedEffects(
    request,
    authored,
    (message) => new SourcePromotionPlanError(message),
    "promoting"
  );
  return finalizePromotionPlan(authored, generatedOperations);
}

export function promoteSource(
  request: SourcePromotionApplyRequest
): Promise<SourcePromotionReport> {
  return applySourceMutation(
    request,
    planSourcePromotion,
    (message) => new SourcePromotionPlanError(message),
    "promoting"
  );
}

async function planAuthoredDraft(
  request: SourceDraftRequest
): Promise<SourceDraftPlan> {
  try {
    const rootPath = await workspaceRoot(request.rootPath);
    const graph = await loadBuildGraph(rootPath);
    const shippedPath = await existingContainedPath(
      rootPath,
      request.shippedPath,
      "shipped path"
    );
    assertSourceContained(graph, shippedPath, "shipped path");
    await assertNoSymlinkTraversal(rootPath, shippedPath, "shipped path");
    const classification = classifyShippedSkill(
      graph,
      shippedPath,
      await pathIsDirectory(shippedPath)
    );
    const draftPath = await futureContainedPath(
      rootPath,
      join(dirname(shippedPath), "_drafts", basename(shippedPath)),
      "draft path"
    );
    assertSourceContained(graph, draftPath, "draft path");
    await assertNoSymlinkTraversal(rootPath, draftPath, "draft path");
    if (await pathExists(draftPath)) {
      throw new SourceDraftPlanError(
        `draft sibling already exists: ${display(rootPath, draftPath)}`
      );
    }

    const sourceHash = await hashSkillDirectory(shippedPath);
    const draftSelector = `${classification.selector}#draft`;
    const operations: readonly SourceMutationOperation[] = [
      {
        from: display(rootPath, shippedPath),
        kind: "copy",
        to: display(rootPath, draftPath),
      },
      {
        event: {
          payload: {
            draft: draftSelector,
            shipped: classification.selector,
            sourceHash,
          },
          type: "source.drafted",
        },
        kind: "append",
        path: ledgerPath(rootPath, graph.sourceDir),
      },
    ];
    return finalizeDraftPlan(
      {
        action: "draft",
        draftSelector,
        from: display(rootPath, shippedPath),
        generatedOperations: [],
        operations,
        planHash: "",
        selector: classification.selector,
        sourceHash,
        sourceTreeIdentities: [
          {
            hash: sourceHash,
            path: display(rootPath, shippedPath),
          },
        ],
        to: display(rootPath, draftPath),
        warnings: [],
      },
      []
    );
  } catch (error) {
    if (error instanceof SourceDraftPlanError) throw error;
    if (error instanceof SourceRenamePlanError) {
      throw new SourceDraftPlanError(
        error.message.replace(/^skillset: source rename /u, "")
      );
    }
    throw error;
  }
}

async function planAuthoredPromotion(
  request: SourcePromotionRequest
): Promise<SourcePromotionPlan> {
  try {
    const rootPath = await workspaceRoot(request.rootPath);
    const graph = await loadBuildGraph(rootPath);
    const draftPath = await existingContainedPath(
      rootPath,
      request.draftPath,
      "draft path"
    );
    assertSourceContained(graph, draftPath, "draft path");
    await assertNoSymlinkTraversal(rootPath, draftPath, "draft path");
    const classification = classifyDraftSkill(
      graph,
      draftPath,
      await pathIsDirectory(draftPath)
    );
    const draftSelector = `${classification.selector}#draft`;
    const events = await readChangeLedger(rootPath, {
      sourceDir: graph.sourceDir,
    });
    const baseline = findDraftBaseline(
      events,
      draftSelector,
      classification.selector
    );
    const paired = classification.shippedSkill !== undefined;
    const draftSourceHash = await hashSkillDirectory(draftPath);
    const currentShippedHash = paired
      ? await hashSkillDirectory(classification.shippedPath)
      : undefined;
    const changedSinceDraft = baseline === undefined || currentShippedHash === undefined
      ? null
      : currentShippedHash !== baseline.payload.sourceHash;
    const warnings = [
      ...(paired && baseline === undefined
        ? [`no recorded fork baseline for ${draftSelector}; cannot determine whether ${classification.selector} changed since drafting; review the authored diff before replacing it`]
        : []),
      ...(changedSinceDraft === true
        ? [`shipped skill ${classification.selector} changed since the draft was taken; promotion will replace the current authored bytes`]
        : []),
    ];
    const diff = await skillDirectoryDiff(
      paired ? classification.shippedPath : undefined,
      draftPath
    );
    const operations: readonly SourceMutationOperation[] = [
      {
        from: display(rootPath, draftPath),
        kind: "move",
        to: display(rootPath, classification.shippedPath),
      },
      ...(paired
        ? [
            {
              kind: "delete" as const,
              path: display(rootPath, classification.shippedPath),
            },
          ]
        : []),
      {
        event: {
          payload: {
            draft: draftSelector,
            ...(baseline === undefined ? {} : { draftEventId: baseline.id }),
            shipped: classification.selector,
          },
          type: "source.promoted",
        },
        kind: "append",
        path: ledgerPath(rootPath, graph.sourceDir),
      },
    ];
    return finalizePromotionPlan(
      {
        action: "promote",
        ...(baseline === undefined
          ? {}
          : { baselineSourceHash: baseline.payload.sourceHash }),
        changedSinceDraft,
        diff,
        draftSelector,
        ...(baseline === undefined ? {} : { draftEventId: baseline.id }),
        draftSourceHash,
        from: display(rootPath, draftPath),
        generatedOperations: [],
        kind: paired ? "paired" : "unpaired",
        operations,
        planHash: "",
        removeEmptyParents: true,
        selector: classification.selector,
        ...(currentShippedHash === undefined
          ? {}
          : { shippedSourceHash: currentShippedHash }),
        sourceTreeIdentities: [
          {
            hash: draftSourceHash,
            path: display(rootPath, draftPath),
          },
          ...(currentShippedHash === undefined
            ? []
            : [
                {
                  hash: currentShippedHash,
                  path: display(rootPath, classification.shippedPath),
                },
              ]),
        ],
        to: display(rootPath, classification.shippedPath),
        warnings,
      },
      []
    );
  } catch (error) {
    if (error instanceof SourcePromotionPlanError) throw error;
    if (error instanceof SourceRenamePlanError) {
      throw new SourcePromotionPlanError(
        error.message.replace(/^skillset: source rename /u, "")
      );
    }
    throw error;
  }
}

function classifyShippedSkill(
  graph: BuildGraph,
  path: string,
  isDirectory: boolean
): SkillContainer {
  if (!isDirectory) {
    throw new SourceDraftPlanError(
      "a shipped skill must be drafted by its directory"
    );
  }
  const workspaceSkill = graph.standaloneSkills.find(
    (skill) => dirname(skill.sourcePath) === path && skill.status === "live"
  );
  if (workspaceSkill !== undefined) {
    return {
      selector: selectorForStandaloneSkill(workspaceSkill.id),
      skill: workspaceSkill,
    };
  }
  for (const plugin of graph.plugins) {
    const skill = plugin.skills.find(
      (candidate) =>
        dirname(candidate.sourcePath) === path && candidate.status === "live"
    );
    if (skill !== undefined) {
      return {
        plugin,
        selector: selectorForPluginSkill(plugin.id, skill.id),
        skill,
      };
    }
  }
  throw new SourceDraftPlanError(
    `source must be a complete shipped skill directory: ${display(graph.rootPath, path)}`
  );
}

function classifyDraftSkill(
  graph: BuildGraph,
  path: string,
  isDirectory: boolean
): PromotionClassification {
  if (!isDirectory) {
    throw new SourcePromotionPlanError(
      "a draft skill must be promoted by its directory"
    );
  }
  if (basename(dirname(path)) !== "_drafts") {
    throw new SourcePromotionPlanError(
      `source must be an _drafts skill directory: ${display(graph.rootPath, path)}`
    );
  }
  for (const plugin of graph.plugins) {
    const draft = plugin.discoveredSkills?.find(
      (skill) =>
        dirname(skill.sourcePath) === path && skill.draftOrigin === "_drafts"
    );
    if (draft === undefined) continue;
    const shippedPath = join(dirname(dirname(path)), basename(path));
    const shippedSkill = plugin.skills.find(
      (skill) => dirname(skill.sourcePath) === shippedPath
    );
    return {
      draftPath: path,
      plugin,
      selector: selectorForPluginSkill(plugin.id, draft.id),
      shippedPath,
      ...(shippedSkill === undefined ? {} : { shippedSkill }),
      skill: draft,
    };
  }
  const workspaceDraft = graph.discoveredSkills?.find(
    (skill) =>
      dirname(skill.sourcePath) === path && skill.draftOrigin === "_drafts"
  );
  if (workspaceDraft !== undefined) {
    const shippedPath = join(dirname(dirname(path)), basename(path));
    const shippedSkill = graph.standaloneSkills.find(
      (skill) => dirname(skill.sourcePath) === shippedPath
    );
    return {
      draftPath: path,
      selector: selectorForStandaloneSkill(workspaceDraft.id),
      shippedPath,
      ...(shippedSkill === undefined ? {} : { shippedSkill }),
      skill: workspaceDraft,
    };
  }
  throw new SourcePromotionPlanError(
    `source must be a complete _drafts skill directory: ${display(graph.rootPath, path)}`
  );
}

function findDraftBaseline(
  events: readonly ChangeLedgerEvent[],
  draft: string,
  shipped: string
): Extract<ChangeLedgerEvent, { readonly type: "source.drafted" }> | undefined {
  const promoted = new Set(
    events.flatMap((event) =>
      event.type === "source.promoted" &&
      event.payload.draftEventId !== undefined
        ? [event.payload.draftEventId]
        : []
    )
  );
  const mappings = sourceIdentityMappings(events);
  return events
    .flatMap(
      (event, eventIndex) => {
        if (event.type !== "source.drafted" || promoted.has(event.id)) {
          return [];
        }
        // A move carries the paired draft, but older fork evidence stays append-only.
        // Only moves after this fork belong to it; an old selector may be reused.
        const currentShipped = currentSourceIdentity(
          event.payload.shipped,
          sourceMappingsAfterEvent(mappings, eventIndex)
        );
        return currentShipped === shipped &&
          event.payload.draft === `${event.payload.shipped}#draft` &&
          draft === `${currentShipped}#draft`
          ? [event]
          : [];
      }
    )
    .at(-1);
}

function ledgerPath(rootPath: string, sourceDir: string): string {
  return display(rootPath, join(rootPath, workspaceChangeFile(sourceDir, "ledger.jsonl")));
}

async function skillDirectoryDiff(
  shippedPath: string | undefined,
  draftPath: string
): Promise<readonly string[]> {
  const shippedFiles =
    shippedPath === undefined ? [] : await collectSourceFiles(shippedPath);
  const draftFiles = await collectSourceFiles(draftPath);
  const shippedByPath = new Map(
    shippedFiles.map((path) => [
      relative(shippedPath ?? "", path).replaceAll("\\", "/"),
      path,
    ])
  );
  const draftByPath = new Map(
    draftFiles.map((path) => [
      relative(draftPath, path).replaceAll("\\", "/"),
      path,
    ])
  );
  const lines: string[] = [];
  const paths = [
    ...new Set([...shippedByPath.keys(), ...draftByPath.keys()]),
  ].toSorted(compareStrings);
  for (const path of paths) {
    const before = shippedByPath.get(path);
    const after = draftByPath.get(path);
    const beforeBytes =
      before === undefined ? undefined : await readFile(before);
    const afterBytes = after === undefined ? undefined : await readFile(after);
    const beforeMode =
      before === undefined
        ? undefined
        : normalizeGeneratedFileMode((await lstat(before)).mode);
    const afterMode =
      after === undefined
        ? undefined
        : normalizeGeneratedFileMode((await lstat(after)).mode);
    const contentMatches =
      beforeBytes !== undefined &&
      afterBytes !== undefined &&
      beforeBytes.equals(afterBytes);
    if (contentMatches && beforeMode === afterMode) {
      continue;
    }
    lines.push(`diff --skillset ${path}`);
    if (
      beforeMode !== undefined &&
      afterMode !== undefined &&
      beforeMode !== afterMode
    ) {
      lines.push(`old mode 10${formatGeneratedFileMode(beforeMode)}`);
      lines.push(`new mode 10${formatGeneratedFileMode(afterMode)}`);
    }
    if (contentMatches) continue;
    lines.push(before === undefined ? "--- /dev/null" : `--- shipped/${path}`);
    lines.push(after === undefined ? "+++ /dev/null" : `+++ draft/${path}`);
    if (isBinary(beforeBytes) || isBinary(afterBytes)) {
      lines.push("Binary source files differ");
      continue;
    }
    lines.push("@@ authored source @@");
    for (const line of textLines(beforeBytes)) lines.push(`-${line}`);
    for (const line of textLines(afterBytes)) lines.push(`+${line}`);
  }
  return lines;
}

function isBinary(value: Buffer | undefined): boolean {
  return value?.includes(0) === true;
}

function textLines(value: Buffer | undefined): readonly string[] {
  if (value === undefined) return [];
  const lines = value.toString("utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function finalizeDraftPlan(
  plan: SourceDraftPlan,
  generatedOperations: readonly SourceRenameGeneratedOperation[]
): SourceDraftPlan {
  return finalizePlan({ ...plan, generatedOperations });
}

function finalizePromotionPlan(
  plan: SourcePromotionPlan,
  generatedOperations: readonly SourceRenameGeneratedOperation[]
): SourcePromotionPlan {
  return finalizePlan({ ...plan, generatedOperations });
}

function finalizePlan<Plan extends SourceDraftPlan | SourcePromotionPlan>(
  plan: Plan
): Plan {
  const value = { ...plan, planHash: "" };
  return {
    ...value,
    planHash: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  };
}
