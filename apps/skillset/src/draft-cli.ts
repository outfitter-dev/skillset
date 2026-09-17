import * as core from "@skillset/core";
import type { SkillsetCliChange } from "@skillset/schema";

import { printCliJsonData } from "./cli-output";

export interface DraftCommandRequest {
  readonly jsonOutput: boolean;
  readonly rootPath: string;
  readonly shippedPath: string;
  readonly yes: boolean;
}

interface DraftOperation {
  readonly from?: string;
  readonly kind: "copy" | "update";
  readonly path?: string;
  readonly to?: string;
}

interface DraftGeneratedOperation {
  readonly kind: "create" | "delete" | "update";
  readonly path: string;
}

interface SourceDraftPlan {
  readonly from: string;
  readonly generatedOperations: readonly DraftGeneratedOperation[];
  readonly operations: readonly DraftOperation[];
  readonly planHash: string;
  readonly selector: string;
  readonly sourceHash: string;
  readonly to: string;
  readonly warnings: readonly string[];
}

interface SourceDraftReport extends SourceDraftPlan {
  readonly writtenPaths?: readonly string[];
}

export interface DraftCommandCore {
  readonly draftSource: (request: {
    readonly expectedPlanHash: string;
    readonly rootPath: string;
    readonly shippedPath: string;
  }) => Promise<SourceDraftReport>;
  readonly planSourceDraft: (request: {
    readonly rootPath: string;
    readonly shippedPath: string;
  }) => Promise<SourceDraftPlan>;
}

export interface DraftCommandContext {
  readonly core?: DraftCommandCore;
  readonly write?: (value: string) => void;
}

const writtenPaths = (report: SourceDraftPlan): readonly string[] =>
  "writtenPaths" in report && Array.isArray(report.writtenPaths)
    ? report.writtenPaths
    : [];

const publicOperation = (operation: DraftOperation) =>
  operation.kind === "copy"
    ? { from: operation.from, kind: operation.kind, to: operation.to }
    : { kind: operation.kind, path: operation.path };

const changes = (
  report: SourceDraftPlan,
  state: SkillsetCliChange["state"]
): readonly SkillsetCliChange[] => [
  ...report.operations.map((operation) => ({
    action:
      operation.kind === "copy" ? ("create" as const) : ("update" as const),
    path:
      operation.kind === "copy" ? (operation.to ?? "") : (operation.path ?? ""),
    ...(operation.kind === "copy" && operation.from !== undefined
      ? { reason: `copied from ${operation.from}` }
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

const renderDraft = (
  report: SourceDraftPlan,
  applied: boolean,
  paths: readonly string[]
): string => {
  const state = applied ? "wrote" : "would";
  const lines = [
    `skillset: draft ${report.selector} ${report.from} -> ${report.to}`,
    ...report.operations.map((operation) =>
      operation.kind === "copy"
        ? `  ${state} copy: ${operation.from ?? "?"} -> ${operation.to ?? "?"}`
        : `  ${state} update: ${operation.path ?? "?"}`
    ),
    ...report.generatedOperations.map(
      (operation) => `  ${state} ${operation.kind} generated: ${operation.path}`
    ),
    ...report.warnings.map((warning) => `  warning: ${warning}`),
    `  fork baseline: ${report.sourceHash}`,
    `  plan: ${report.planHash}`,
  ];
  lines.push(
    applied
      ? `skillset: wrote ${paths.length} workspace path${paths.length === 1 ? "" : "s"}`
      : `skillset: preview only; rerun skillset draft ${report.from} --yes to apply this plan`
  );
  return `${lines.join("\n")}\n`;
};

export const runDraftCommand = async (
  request: DraftCommandRequest,
  context: DraftCommandContext = {}
): Promise<void> => {
  const draftCore = context.core ?? (core as unknown as DraftCommandCore);
  const planRequest = {
    rootPath: request.rootPath,
    shippedPath: request.shippedPath,
  };
  const preview = await draftCore.planSourceDraft(planRequest);
  const report = request.yes
    ? await draftCore.draftSource({
        ...planRequest,
        expectedPlanHash: preview.planHash,
      })
    : preview;
  const paths = request.yes ? writtenPaths(report) : [];
  if (request.jsonOutput) {
    printCliJsonData(
      "draft",
      {
        plan: {
          from: report.from,
          generatedOperations: report.generatedOperations,
          operations: report.operations.map(publicOperation),
          planHash: report.planHash,
          selector: report.selector,
          sourceHash: report.sourceHash,
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
    renderDraft(report, request.yes, paths)
  );
};
