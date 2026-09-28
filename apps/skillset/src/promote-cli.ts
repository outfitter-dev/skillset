import * as core from "@skillset/core";
import type { SkillsetCliChange } from "@skillset/schema";

import { printCliJsonData } from "./cli-output";
import { defaultLifecycleLedgerLock, type LifecycleLedgerLock } from "./lifecycle-ledger-lock";
import { publicGeneratedOperation } from "./source-mutation-cli";

export interface PromoteCommandRequest {
  readonly draftPath: string;
  readonly jsonOutput: boolean;
  readonly rootPath: string;
  readonly yes: boolean;
}

interface PromoteOperation {
  readonly from?: string;
  readonly kind: "append" | "delete" | "move" | "update";
  readonly path?: string;
  readonly to?: string;
}

interface PromoteGeneratedOperation {
  readonly kind: "create" | "delete" | "update";
  readonly path: string;
}

interface SourcePromotionPlan {
  readonly baselineSourceHash?: string;
  readonly changedSinceDraft: boolean | null;
  readonly diff: readonly string[];
  readonly draftEventId?: string;
  readonly draftSourceHash: string;
  readonly from: string;
  readonly generatedOperations: readonly PromoteGeneratedOperation[];
  readonly kind: "paired" | "unpaired";
  readonly operations: readonly PromoteOperation[];
  readonly planHash: string;
  readonly selector: string;
  readonly to: string;
  readonly warnings: readonly string[];
}

interface SourcePromotionReport extends SourcePromotionPlan {
  readonly writtenPaths?: readonly string[];
}

export interface PromoteCommandCore {
  readonly planSourcePromotion: (request: {
    readonly draftPath: string;
    readonly rootPath: string;
  }) => Promise<SourcePromotionPlan>;
  readonly promoteSource: (request: {
    readonly draftPath: string;
    readonly expectedPlanHash: string;
    readonly rootPath: string;
  }) => Promise<SourcePromotionReport>;
}

export interface PromoteCommandContext {
  readonly core?: PromoteCommandCore;
  /** Serializes the applying plan and transaction with other ledger writers. */
  readonly ledgerLock?: LifecycleLedgerLock;
  readonly write?: (value: string) => void;
}

const writtenPaths = (report: SourcePromotionPlan): readonly string[] =>
  "writtenPaths" in report && Array.isArray(report.writtenPaths)
    ? report.writtenPaths
    : [];

const publicOperation = (operation: PromoteOperation) =>
  operation.kind === "move"
    ? { from: operation.from, kind: operation.kind, to: operation.to }
    : { kind: operation.kind, path: operation.path };

const changes = (
  report: SourcePromotionPlan,
  state: SkillsetCliChange["state"]
): readonly SkillsetCliChange[] => [
  ...report.operations.map((operation) => ({
    action: operation.kind === "append" ? ("update" as const) : operation.kind,
    path:
      operation.kind === "move" ? (operation.to ?? "") : (operation.path ?? ""),
    ...(operation.kind === "move" && operation.from !== undefined
      ? { reason: `from ${operation.from}` }
      : {}),
    state,
  })),
  ...report.generatedOperations.map((operation) => ({
    action: operation.kind,
    path: operation.path,
    reason: "generated output",
    state,
  })),
];

const renderPromotion = (
  report: SourcePromotionPlan,
  applied: boolean,
  paths: readonly string[]
): string => {
  const state = applied ? "wrote" : "would";
  const lines = [
    `skillset: promote ${report.kind} ${report.selector} ${report.from} -> ${report.to}`,
    ...report.operations.map((operation) =>
      operation.kind === "move"
        ? `  ${state} move: ${operation.from ?? "?"} -> ${operation.to ?? "?"}`
        : `  ${state} ${operation.kind}: ${operation.path ?? "?"}`
    ),
    ...report.generatedOperations.map(
      (operation) => `  ${state} ${operation.kind} generated: ${operation.path}`
    ),
    ...report.warnings.map((warning) => `  warning: ${warning}`),
    ...(report.diff.length === 0
      ? ["  authored diff: no content changes"]
      : ["  authored diff:", ...report.diff.map((line) => `    ${line}`)]),
    `  draft hash: ${report.draftSourceHash}`,
    ...(report.baselineSourceHash === undefined
      ? []
      : [`  fork baseline: ${report.baselineSourceHash}`]),
    `  plan: ${report.planHash}`,
  ];
  lines.push(
    applied
      ? `skillset: wrote ${paths.length} workspace path${paths.length === 1 ? "" : "s"}`
      : `skillset: preview only; rerun skillset promote ${report.from} --yes to apply this plan`
  );
  return `${lines.join("\n")}\n`;
};

export const runPromoteCommand = async (
  request: PromoteCommandRequest,
  context: PromoteCommandContext = {}
): Promise<void> => {
  const promoteCore = context.core ?? (core as unknown as PromoteCommandCore);
  const planRequest = {
    draftPath: request.draftPath,
    rootPath: request.rootPath,
  };
  const report = request.yes
    ? await (context.ledgerLock ?? defaultLifecycleLedgerLock)(request.rootPath, async () =>
        promoteCore.promoteSource({
          ...planRequest,
          expectedPlanHash: (await promoteCore.planSourcePromotion(planRequest)).planHash,
        })
      )
    : await promoteCore.planSourcePromotion(planRequest);
  const paths = request.yes ? writtenPaths(report) : [];
  if (request.jsonOutput) {
    printCliJsonData(
      "promote",
      {
        plan: {
          ...(report.baselineSourceHash === undefined
            ? {}
            : { baselineSourceHash: report.baselineSourceHash }),
          changedSinceDraft: report.changedSinceDraft,
          diff: report.diff,
          draftSourceHash: report.draftSourceHash,
          from: report.from,
          generatedOperations: report.generatedOperations.map(
            publicGeneratedOperation
          ),
          kind: report.kind,
          operations: report.operations.map(publicOperation),
          planHash: report.planHash,
          selector: report.selector,
          to: report.to,
          warnings: report.warnings,
        },
        planHash: report.planHash,
        state: request.yes ? "written" : "planned",
        writes: paths,
      },
      0,
      request.yes ? "mutation" : "plan",
      [],
      changes(report, request.yes ? "written" : "planned")
    );
    return;
  }
  (context.write ?? process.stdout.write.bind(process.stdout))(
    renderPromotion(report, request.yes, paths)
  );
};
