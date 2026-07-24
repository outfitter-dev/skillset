import {
  createActivationProofIdentity,
  listCurrentActivationProofDeclarations,
} from "@skillset/core";
import { renderBuildGraph } from "@skillset/core/internal/render";
import type { SkillsetRenderResult } from "@skillset/core/internal/render-result";
import { loadBuildGraph } from "@skillset/core/internal/resolver";
import type { SkillsetOptions } from "@skillset/core/internal/types";
import type {
  ActivationProofIdentity,
} from "@skillset/schema";

import {
  inspectActivationReadiness,
  type ActivationInspectionReport,
  type ActivationProviderCommandRunner,
} from "./activation-inspection";
import { readActivationProofReceipts } from "./activation-proof-evidence";
import { runtimeProbeAdapterId } from "./runtime-probe";

export interface WorkspaceActivationOptions {
  readonly options: SkillsetOptions;
  readonly proofRenderResults?: readonly SkillsetRenderResult[];
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
  const proofReceipts = await readActivationProofReceipts(
    input.rootPath,
    graph,
    input.options
  );
  const currentProofIdentities = await currentProofIdentityMap(
    graph,
    input.proofRenderResults ?? input.renderResults,
    input.untrustedOutputPaths ?? []
  );
  const report = await inspectActivationReadiness({
    allowActive: true,
    currentProofIdentities,
    graph,
    ...(includeSourcePath === undefined ? {} : { includeSourcePath }),
    proofReceipts,
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

async function currentProofIdentityMap(
  graph: Awaited<ReturnType<typeof loadBuildGraph>>,
  renderResults: readonly SkillsetRenderResult[],
  untrustedOutputPaths: readonly string[]
): Promise<
  Readonly<Record<string, readonly ActivationProofIdentity[]>>
> {
  const rendered = await renderBuildGraph(graph);
  const identities: Record<string, ActivationProofIdentity[]> = {};
  for (const declaration of await listCurrentActivationProofDeclarations(
    graph,
    renderResults
  )) {
    let identity: ActivationProofIdentity;
    try {
      identity = createActivationProofIdentity({
        adapterId: runtimeProbeAdapterId(declaration.target),
        declarationHash: declaration.declarationHash,
        graph,
        ...(declaration.projectionSourceUnits === undefined
          ? {}
          : {
              projectionSourceUnits: declaration.projectionSourceUnits,
            }),
        rendered,
        renderResults,
        requirementIds: declaration.requirementIds,
        untrustedOutputPaths,
      });
    } catch {
      continue;
    }
    for (const requirementId of declaration.requirementIds) {
      const current = identities[requirementId] ?? [];
      if (
        !current.some((candidate) => proofIdentityEquals(candidate, identity))
      ) {
        current.push(identity);
        identities[requirementId] = current;
      }
    }
  }
  return identities;
}

function proofIdentityEquals(
  left: ActivationProofIdentity,
  right: ActivationProofIdentity
): boolean {
  return (
    left.adapterId === right.adapterId &&
    left.declarationHash === right.declarationHash &&
    left.projectionHash === right.projectionHash &&
    left.sourceHash === right.sourceHash &&
    left.target === right.target
  );
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
