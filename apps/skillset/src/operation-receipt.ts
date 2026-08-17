import { relative, resolve } from "node:path";

import { resolveRepoCacheKey, type SkillsetRenderResult } from "@skillset/core";
import { createReportBundle } from "@skillset/core/internal/report-store";
import type {
  SkillsetAdoptionReportPayload,
  SkillsetImportReportPayload,
  SkillsetReportPhaseStatus,
  SkillsetReportRenderResultCounts,
  SkillsetReport,
} from "@skillset/schema";

import { adoptCandidateId, type AdoptReport } from "./adopt";
import type { ImportReport } from "./import";
import {
  createCliAdoptionReport,
  createCliImportReport,
} from "./report-producer";
import type { ImportKind, ImportProvider } from "./source-arg-values";

export interface OperationReceiptReference {
  readonly id: string;
  readonly path: string;
  readonly showCommand: string;
}

interface ImportReceiptInput {
  readonly failed: boolean;
  readonly imports: readonly ImportReport[];
  readonly kind: ImportKind | undefined;
  readonly provider: ImportProvider | undefined;
  readonly rootPath: string;
}

export async function persistAdoptionReceipt(
  report: AdoptReport
): Promise<OperationReceiptReference> {
  return persistOperationReceipt(
    createCliAdoptionReport({
      exitCode: report.ok ? 0 : 1,
      payload: adoptionPayload(report),
      workspace: operationReportWorkspace(report.rootPath),
    })
  );
}

export async function persistImportReceipt(
  input: ImportReceiptInput
): Promise<OperationReceiptReference> {
  return persistOperationReceipt(
    createCliImportReport({
      exitCode: input.failed ? 1 : 0,
      payload: importPayload(input),
      workspace: operationReportWorkspace(input.rootPath),
    })
  );
}

/** One private publication seam for CLI-owned global receipts. */
async function persistOperationReceipt(
  report: SkillsetReport
): Promise<OperationReceiptReference> {
  const stored = await createReportBundle(report);
  return operationReceiptReference(stored.report.id, stored.resolvedPath);
}

export function printOperationReceipt(
  receipt: OperationReceiptReference
): void {
  console.log(`  report: ${receipt.id}`);
  console.log(`  show: ${receipt.showCommand}`);
  console.log(`  path: ${receipt.path}`);
}

function adoptionPayload(report: AdoptReport): SkillsetAdoptionReportPayload {
  const blockedBeforeWrite = !report.write;
  const failedImports = report.imports.filter((entry) => !entry.ok).length;
  const lintErrors = report.lintIssues.filter(
    (issue) => issue.severity === "error"
  ).length;
  const diagnosticCodes = new Set<string>(
    report.surveyDiagnostics.map((diagnostic) => diagnostic.code)
  );
  if (failedImports > 0) diagnosticCodes.add("adopt.import-failed");
  if (lintErrors > 0) diagnosticCodes.add("adopt.lint-failed");
  if (report.buildError !== undefined)
    diagnosticCodes.add("adopt.build-failed");
  const candidateIds = boundedUniqueSorted(
    report.candidates.map(adoptCandidateId)
  );
  const destinations = boundedUniqueSorted(
    report.imports.flatMap((entry) => [
      ...(entry.destination === undefined ? [] : [entry.destination]),
      ...entry.baselinePaths.map((path) => workspacePath(report.rootPath, path)),
    ])
  );
  const importedUnitIds = boundedUniqueSorted(
    report.imports.flatMap((entry) =>
      entry.units.map((unit) => `${unit.kind}:${unit.name}`)
    )
  );

  return {
    alreadyAdopted: report.alreadyAdopted,
    candidateIds: candidateIds.items,
    destinations: destinations.items,
    diagnosticCodes: boundedUniqueSorted(diagnosticCodes).items,
    importedUnitIds: importedUnitIds.items,
    listCounts: {
      candidateIds: candidateIds.total,
      destinations: destinations.total,
      importedUnitIds: importedUnitIds.total,
    },
    migrationFlagCodes: report.transformPreviews.some(
      (preview) => preview.dialectDeclared
    )
      ? ["adopt.claude-dialect"]
      : [],
    phases: {
      build: phase(
        report.builtFiles,
        blockedBeforeWrite
          ? "not-run"
          : report.buildError === undefined
            ? "passed"
            : "failed"
      ),
      import: phase(
        report.imports.length,
        blockedBeforeWrite
          ? "not-run"
          : report.candidates.length === 0
            ? "skipped"
            : failedImports > 0
              ? "failed"
              : "passed"
      ),
      lint: phase(
        report.lintIssues.length,
        blockedBeforeWrite ? "not-run" : lintErrors === 0 ? "passed" : "failed"
      ),
      setup: phase(
        report.setupFiles.length,
        report.surveyDiagnostics.some(
          (diagnostic) => diagnostic.severity === "error"
        )
          ? "failed"
          : "passed"
      ),
    },
    renderResults: summarizeRenderResultCounts(report.renderResults),
  };
}

function importPayload(input: ImportReceiptInput): SkillsetImportReportPayload {
  const reports = input.imports;
  const destinations = boundedUniqueSorted(
    reports.map((report) => workspacePath(input.rootPath, report.targetPath))
  );
  const importedUnitIds = boundedUniqueSorted(
    reports.map((report) => `${report.kind}:${report.name}`)
  );
  return {
    destinations: destinations.items,
    diagnosticCodes: input.failed
      ? [reports.length > 0 ? "import.partial" : "import.failed"]
      : [],
    fields: {
      inferred: reports.reduce(
        (total, report) => total + report.inferredSourceFields.length,
        0
      ),
      preserved: reports.reduce(
        (total, report) => total + report.preservedTargetNativeFields.length,
        0
      ),
      unsupported: reports.reduce(
        (total, report) => total + report.unsupportedFields.length,
        0
      ),
    },
    fileCount: reports.reduce((total, report) => total + report.files, 0),
    importedUnitIds: importedUnitIds.items,
    listCounts: {
      destinations: destinations.total,
      importedUnitIds: importedUnitIds.total,
    },
    partial: input.failed && reports.length > 0,
    requestedKind: input.kind ?? "auto",
    ...(input.provider === undefined
      ? {}
      : { requestedProvider: input.provider }),
    renderResults: summarizeRenderResultCounts(
      reports.flatMap((report) => report.renderResults)
    ),
    warningCodes: boundedUniqueSorted(
      reports.flatMap((report) => [
        ...(report.preservedTargetNativeFields.length > 0
          ? ["import.target-native-preserved"]
          : []),
        ...(report.unsupportedFields.length > 0
          ? ["import.unsupported-preserved"]
          : []),
      ])
    ).items,
  };
}

function summarizeRenderResultCounts(
  results: readonly SkillsetRenderResult[]
): SkillsetReportRenderResultCounts {
  const counts = {
    failed: 0,
    rendered: 0,
    skipped: 0,
    unsupported: 0,
  };
  for (const result of results) {
    if (result.status === "failed") counts.failed += 1;
    else if (result.status === "unsupported") counts.unsupported += 1;
    else if (
      result.status === "externally_managed" ||
      result.status === "intentionally_skipped"
    )
      counts.skipped += 1;
    else counts.rendered += 1;
  }
  return counts satisfies SkillsetReportRenderResultCounts;
}

function phase(
  count: number,
  status: SkillsetReportPhaseStatus
): { readonly count: number; readonly status: SkillsetReportPhaseStatus } {
  return { count, status };
}

function operationReportWorkspace(rootPath: string): {
  readonly id: string;
} {
  const cacheKey = resolveRepoCacheKey({ rootPath }).key;
  const localHash = cacheKey.match(/--local-([0-9a-f]{12})$/u)?.[1];
  if (localHash === undefined)
    throw new Error("skillset: could not derive private workspace identity");
  return { id: `workspace--local-${localHash}` };
}

function operationReceiptReference(
  id: string,
  path: string
): OperationReceiptReference {
  return { id, path, showCommand: `skillset report show ${id}` };
}

function workspacePath(rootPath: string, path: string): string {
  return relative(resolve(rootPath), resolve(rootPath, path)).replaceAll(
    "\\",
    "/"
  );
}

function boundedUniqueSorted(values: Iterable<string>): {
  readonly items: readonly string[];
  readonly total: number;
} {
  const unique = [...new Set(values)].sort((left, right) =>
    left.localeCompare(right)
  );
  return { items: unique.slice(0, 200), total: unique.length };
}
