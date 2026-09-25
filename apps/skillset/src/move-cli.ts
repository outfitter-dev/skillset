import * as core from "@skillset/core";
import type { SkillsetCliChange } from "@skillset/schema";

import { printCliJsonData } from "./cli-output";
import { defaultLifecycleLedgerLock, type LifecycleLedgerLock } from "./lifecycle-ledger-lock";

export interface MoveCommandRequest {
  readonly from: string;
  readonly jsonOutput: boolean;
  readonly rootPath: string;
  readonly to: string;
  readonly yes: boolean;
}

interface MovePlanOperation {
  readonly from?: string;
  readonly kind: "append" | "move" | "update";
  readonly path?: string;
  readonly to?: string;
}

interface MoveGeneratedOperation {
  readonly kind: "create" | "delete" | "update";
  readonly path: string;
}

interface SourceMovePlan {
  readonly from: string;
  readonly generatedOperations?: readonly MoveGeneratedOperation[];
  readonly kind: string;
  readonly notices: readonly string[];
  readonly operations: readonly MovePlanOperation[];
  readonly planHash: string;
  readonly to: string;
  readonly warnings: readonly string[];
}

interface SourceMoveReport extends SourceMovePlan {
  readonly applied?: boolean;
  readonly writtenPaths?: readonly string[];
}

export interface MoveCommandCore {
  readonly moveSource: (request: {
    readonly expectedPlanHash: string;
    readonly from: string;
    readonly rootPath: string;
    readonly to: string;
  }) => Promise<SourceMoveReport>;
  readonly planSourceMove: (request: {
    readonly from: string;
    readonly rootPath: string;
    readonly to: string;
  }) => Promise<SourceMovePlan>;
}

export interface MoveCommandContext {
  readonly core?: MoveCommandCore;
  /** Serializes the applying plan and transaction with other ledger writers. */
  readonly ledgerLock?: LifecycleLedgerLock;
  readonly write?: (value: string) => void;
}

const readWrittenPaths = (report: SourceMovePlan): readonly string[] => {
  if (!("writtenPaths" in report)) return [];
  const paths = report.writtenPaths;
  return Array.isArray(paths) ? paths : [];
};

const renderChanges = (
  report: SourceMovePlan,
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
  ...(report.generatedOperations ?? []).map((operation) => ({
    action: operation.kind,
    path: operation.path,
    reason: "generated output",
    state,
  })),
];

const renderPublicPlan = (report: SourceMovePlan) => ({
  from: report.from,
  generatedOperations: (report.generatedOperations ?? []).map((operation) => ({
    kind: operation.kind,
    path: operation.path,
  })),
  kind: report.kind,
  notices: report.notices,
  operations: report.operations.map((operation) =>
    operation.kind === "move"
      ? { from: operation.from, kind: operation.kind, to: operation.to }
      : { kind: operation.kind, path: operation.path }
  ),
  planHash: report.planHash,
  to: report.to,
  warnings: report.warnings,
});

const renderMoveReport = (
  report: SourceMovePlan,
  applied: boolean,
  writtenPaths: readonly string[]
): string => {
  const state = applied ? "wrote" : "would";
  const lines = [
    `skillset: move ${report.kind} ${report.from} -> ${report.to}`,
    ...report.operations.map((operation) =>
      operation.kind === "move"
        ? `  ${state} move: ${operation.from ?? "?"} -> ${operation.to ?? "?"}`
        : `  ${state} ${operation.kind}: ${operation.path ?? "?"}`
    ),
    ...(report.generatedOperations ?? []).map(
      (operation) =>
        `  ${state} ${operation.kind} generated: ${operation.path}`
    ),
    ...report.notices.map((notice) => `  notice: ${notice}`),
    ...report.warnings.map((warning) => `  warning: ${warning}`),
    `  plan: ${report.planHash}`,
  ];
  if (applied) {
    lines.push(
      writtenPaths.length === 0
        ? "skillset: move plan was already applied"
        : `skillset: wrote ${writtenPaths.length} workspace path${writtenPaths.length === 1 ? "" : "s"}`
    );
  } else {
    lines.push(
      `skillset: preview only; rerun skillset move ${report.from} ${report.to} --yes to apply this plan`
    );
  }
  return `${lines.join("\n")}\n`;
};

export const runMoveCommand = async (
  request: MoveCommandRequest,
  context: MoveCommandContext = {}
): Promise<void> => {
  const moveCore = context.core ?? (core as unknown as MoveCommandCore);
  const planRequest = {
    from: request.from,
    rootPath: request.rootPath,
    to: request.to,
  };
  const report = request.yes
    ? await (context.ledgerLock ?? defaultLifecycleLedgerLock)(request.rootPath, async () =>
        moveCore.moveSource({
          ...planRequest,
          expectedPlanHash: (await moveCore.planSourceMove(planRequest)).planHash,
        })
      )
    : await moveCore.planSourceMove(planRequest);
  const writtenPaths = request.yes ? readWrittenPaths(report) : [];
  if (request.jsonOutput) {
    printCliJsonData(
      "move",
      {
        notices: report.notices,
        plan: renderPublicPlan(report),
        planHash: report.planHash,
        state: request.yes ? "written" : "planned",
        writes: writtenPaths,
      },
      0,
      request.yes ? "mutation" : "plan",
      [],
      renderChanges(report, request.yes ? "written" : "planned")
    );
    return;
  }
  (context.write ?? process.stdout.write.bind(process.stdout))(
    renderMoveReport(report, request.yes, writtenPaths)
  );
};
