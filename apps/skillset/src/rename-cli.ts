import * as core from "@skillset/core";
import type { SkillsetCliChange } from "@skillset/schema";

import { printCliJsonData } from "./cli-output";

export interface RenameCommandRequest {
  readonly from: string;
  readonly jsonOutput: boolean;
  readonly rootPath: string;
  readonly to: string;
  readonly yes: boolean;
}

interface RenamePlanOperation {
  readonly from?: string;
  readonly kind: "move" | "update";
  readonly path?: string;
  readonly to?: string;
}

interface RenameGeneratedOperation {
  readonly kind: "create" | "delete" | "update";
  readonly path: string;
}

interface SourceRenamePlan {
  readonly from: string;
  readonly generatedOperations?: readonly RenameGeneratedOperation[];
  readonly kind: string;
  readonly operations: readonly RenamePlanOperation[];
  readonly planHash: string;
  readonly to: string;
  readonly warnings: readonly string[];
}

interface SourceRenameReport extends SourceRenamePlan {
  readonly applied?: boolean;
  readonly writtenPaths?: readonly string[];
}

export interface RenameCommandCore {
  readonly planSourceRename: (request: {
    readonly from: string;
    readonly rootPath: string;
    readonly to: string;
  }) => Promise<SourceRenamePlan>;
  readonly renameSource: (request: {
    readonly expectedPlanHash: string;
    readonly from: string;
    readonly rootPath: string;
    readonly to: string;
  }) => Promise<SourceRenameReport>;
}

export interface RenameCommandContext {
  readonly core?: RenameCommandCore;
  readonly write?: (value: string) => void;
}

const readWrittenPaths = (report: SourceRenamePlan): readonly string[] => {
  if (!("writtenPaths" in report)) {
    return [];
  }
  const paths = report.writtenPaths;
  return Array.isArray(paths) ? paths : [];
};

const renderOperation = (
  operation: RenamePlanOperation,
  applied: boolean
): string => {
  const state = applied ? "wrote" : "would";
  if (operation.kind === "move") {
    return `  ${state} move: ${operation.from ?? "?"} -> ${operation.to ?? "?"}`;
  }
  return `  ${state} update: ${operation.path ?? "?"}`;
};

const renderGeneratedOperation = (
  operation: RenameGeneratedOperation,
  applied: boolean
): string =>
  `  ${applied ? "wrote" : "would"} ${operation.kind} generated: ${operation.path}`;

const renderChanges = (
  report: SourceRenamePlan,
  state: SkillsetCliChange["state"]
): readonly SkillsetCliChange[] => [
  ...report.operations.map((operation) => ({
    action: operation.kind,
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

const renderPublicPlan = (report: SourceRenamePlan) => ({
  from: report.from,
  generatedOperations: (report.generatedOperations ?? []).map((operation) => ({
    kind: operation.kind,
    path: operation.path,
  })),
  kind: report.kind,
  operations: report.operations.map((operation) =>
    operation.kind === "move"
      ? {
          from: operation.from,
          kind: operation.kind,
          to: operation.to,
        }
      : { kind: operation.kind, path: operation.path }
  ),
  planHash: report.planHash,
  to: report.to,
  warnings: report.warnings,
});

const renderRenameReport = (
  report: SourceRenamePlan,
  applied: boolean,
  writtenPaths: readonly string[]
): string => {
  const lines = [
    `skillset: rename ${report.kind} ${report.from} -> ${report.to}`,
    ...report.operations.map((operation) =>
      renderOperation(operation, applied)
    ),
    ...(report.generatedOperations ?? []).map((operation) =>
      renderGeneratedOperation(operation, applied)
    ),
    ...report.warnings.map((warning) => `  warning: ${warning}`),
    `  plan: ${report.planHash}`,
  ];
  if (applied) {
    if (writtenPaths.length > 0) {
      lines.push(
        `skillset: wrote ${writtenPaths.length} workspace path${writtenPaths.length === 1 ? "" : "s"}`
      );
    } else {
      lines.push("skillset: rename plan was already applied");
    }
  } else {
    lines.push(
      `skillset: preview only; rerun skillset rename ${report.from} ${report.to} --yes to apply this plan`
    );
  }
  return `${lines.join("\n")}\n`;
};

export const runRenameCommand = async (
  request: RenameCommandRequest,
  context: RenameCommandContext = {}
): Promise<void> => {
  const renameCore = context.core ?? (core as unknown as RenameCommandCore);
  const planRequest = {
    from: request.from,
    rootPath: request.rootPath,
    to: request.to,
  };
  const preview = await renameCore.planSourceRename(planRequest);
  const report = request.yes
    ? await renameCore.renameSource({
        ...planRequest,
        expectedPlanHash: preview.planHash,
      })
    : preview;
  const writtenPaths = request.yes ? readWrittenPaths(report) : [];
  const changes = renderChanges(report, request.yes ? "written" : "planned");

  if (request.jsonOutput) {
    printCliJsonData(
      "rename",
      {
        plan: renderPublicPlan(report),
        planHash: report.planHash,
        state: request.yes ? "written" : "planned",
        writes: writtenPaths,
      },
      0,
      request.yes ? "mutation" : "plan",
      [],
      changes
    );
    return;
  }

  (context.write ?? process.stdout.write.bind(process.stdout))(
    renderRenameReport(report, request.yes, writtenPaths)
  );
};
