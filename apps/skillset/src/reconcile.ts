import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { buildSkillsetResult } from "@skillset/core";
import { explainPath, suggestSource, type SourceSuggestionReport } from "@skillset/core/internal/authoring";
import type { SkillsetOptions } from "@skillset/core/internal/types";

export type ReconcileChoice = "output" | "source";

export interface ReconcileReport {
  readonly applied: boolean;
  readonly choice?: ReconcileChoice;
  readonly generatedPath: string;
  readonly outputResolution: SourceSuggestionReport;
  readonly sourcePath?: string;
  readonly sourceResolutionAvailable: boolean;
  readonly writtenPaths: readonly string[];
}

export async function reconcileManagedPath(
  rootPath: string,
  managedPath: string,
  options: SkillsetOptions & { readonly choice?: ReconcileChoice; readonly write?: boolean } = {}
): Promise<ReconcileReport> {
  const { choice, write = false, ...skillsetOptions } = options;
  const explanation = await explainPath(rootPath, managedPath, skillsetOptions);
  if (explanation.kind !== "generated" || explanation.entries.length === 0) {
    throw new Error(`skillset: reconcile requires a managed generated path; ${managedPath} has no generated owner`);
  }

  const outputExists = await stat(resolve(rootPath, explanation.path)).then(() => true, () => false);
  const sourcePaths = [...new Set(explanation.entries.map((entry) => entry.sourcePath))];
  const sourcePath = sourcePaths.length === 1 ? sourcePaths[0] : undefined;
  const outputResolution = outputExists
    ? await suggestSource(rootPath, managedPath, {
        ...skillsetOptions,
        write: write && choice === "output",
      })
    : {
        entries: explanation.entries,
        generatedPath: explanation.path,
        message: "Generated output is missing; output cannot win.",
        nextSteps: ["Use source resolution to rebuild the missing managed output."],
        ...(sourcePath === undefined ? {} : { sourcePath }),
        status: "refused" as const,
        wouldWrite: false,
        wrote: false,
      };
  let writtenPaths: readonly string[] = [];
  if (write && choice !== undefined) {
    if (choice === "output" && !outputResolution.wrote) {
      throw new Error(`skillset: output cannot win for ${managedPath}: ${outputResolution.message}`);
    }
    const built = await buildSkillsetResult(rootPath, skillsetOptions);
    if (!built.ok) {
      const reason = built.diagnostics.map((diagnostic) => diagnostic.message).join("; ");
      throw new Error(`skillset: reconcile build failed${reason.length === 0 ? "" : `: ${reason}`}`);
    }
    writtenPaths = built.writes.paths;
  }

  return {
    applied: write && choice !== undefined,
    ...(choice === undefined ? {} : { choice }),
    generatedPath: explanation.path,
    outputResolution,
    ...(sourcePath === undefined ? {} : { sourcePath }),
    sourceResolutionAvailable: true,
    writtenPaths,
  };
}

export function renderReconcileReport(report: ReconcileReport): string {
  const lines = [
    `skillset: reconcile ${report.generatedPath}`,
    `  source: ${report.sourcePath ?? "unknown"}`,
    "  source wins: available; re-render managed output from source",
    `  output wins: ${report.outputResolution.wouldWrite ? "available" : "refused"}; ${report.outputResolution.message}`,
  ];
  if (report.applied) {
    lines.push(`skillset: reconciled using ${report.choice} (${report.writtenPaths.length} generated file${report.writtenPaths.length === 1 ? "" : "s"} refreshed)`);
  } else if (report.choice !== undefined) {
    lines.push(`skillset: preview only; rerun with --use ${report.choice} --yes to apply`);
  } else {
    lines.push("skillset: choose --use source or --use output, then pass --yes to apply");
  }
  for (const step of report.outputResolution.nextSteps) lines.push(`  output next: ${step}`);
  return `${lines.join("\n")}\n`;
}
