import type { SkillsetRenderResult } from "@skillset/core/internal/render-result";
import { loadBuildGraph } from "@skillset/core/internal/resolver";
import type { SkillsetOptions } from "@skillset/core/internal/types";

import {
  inspectActivationReadiness,
  type ActivationInspectionReport,
  type ActivationProviderCommandRunner,
} from "./activation-inspection";

export interface WorkspaceActivationOptions {
  readonly options: SkillsetOptions;
  readonly renderResults: readonly SkillsetRenderResult[];
  readonly rootPath: string;
  readonly runCommand?: ActivationProviderCommandRunner;
  readonly signal?: AbortSignal;
  readonly sourcePaths?: readonly string[];
  readonly untrustedOutputPaths?: readonly string[];
}

export async function inspectWorkspaceActivation(
  input: WorkspaceActivationOptions
): Promise<ActivationInspectionReport> {
  const graph = await loadBuildGraph(input.rootPath, input.options);
  const includeSourcePath = sourcePathFilter(input.sourcePaths);
  const report = await inspectActivationReadiness({
    allowActive: true,
    graph,
    ...(includeSourcePath === undefined ? {} : { includeSourcePath }),
    renderResults: input.renderResults,
    rootPath: input.rootPath,
    ...(input.untrustedOutputPaths === undefined
      ? {}
      : { untrustedOutputPaths: input.untrustedOutputPaths }),
    ...(input.runCommand === undefined ? {} : { runCommand: input.runCommand }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  return input.sourcePaths === undefined ? report : scopeInspectionEvidence(report);
}

function sourcePathFilter(
  sourcePaths: readonly string[] | undefined
): ((path: string) => boolean) | undefined {
  if (sourcePaths === undefined) return undefined;
  const paths = sourcePaths.map(normalizePath);
  return (path) => {
    const normalized = normalizePath(path);
    return paths.some(
      (candidate) =>
        normalized === candidate || normalized.startsWith(`${candidate}/`)
    );
  };
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function scopeInspectionEvidence(
  report: ActivationInspectionReport
): ActivationInspectionReport {
  return {
    ...report,
    inspections: report.inspections.map(
      ({
        stderrBytes: _stderrBytes,
        stderrTruncated: _stderrTruncated,
        stdoutBytes: _stdoutBytes,
        stdoutTruncated: _stdoutTruncated,
        ...receipt
      }) => ({
        ...receipt,
        summary:
          receipt.outcome === "ran"
            ? "provider observation completed for the selected activation subjects"
            : receipt.summary,
      })
    ),
  };
}
