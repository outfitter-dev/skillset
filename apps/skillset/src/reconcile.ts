import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { buildSkillsetResult, diffSkillsetResult } from "@skillset/core";
import {
  explainPath,
  listGeneratedEntries,
  suggestSource,
  type SourceSuggestionReport,
} from "@skillset/core/internal/authoring";
import type { SkillsetOptions } from "@skillset/core/internal/types";

export type ReconcileChoice = "output" | "source";

export interface ReconcileReport {
  readonly applied: boolean;
  readonly backupManifestPath?: string;
  readonly backupRunId?: string;
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
  const auxiliarySkillOutput = explanation.entries.some((entry) =>
    (entry.kind === "standalone-skill" || entry.kind === "plugin-skill") &&
    entry.outputPath !== explanation.path &&
    entry.files?.includes(explanation.path) === true
  );
  await assertReconcileDriftIsScoped(
    rootPath,
    explanation.path,
    sourcePaths,
    choice === "source",
    skillsetOptions
  );
  let outputResolution = choice === "source"
    ? {
        entries: explanation.entries,
        generatedPath: explanation.path,
        message: "Source selected; output reverse-patch analysis was skipped.",
        nextSteps: ["Rebuild the managed output from its source."],
        ...(sourcePath === undefined ? {} : { sourcePath }),
        status: "refused" as const,
        wouldWrite: false,
        wrote: false,
      }
    : outputExists && auxiliarySkillOutput
    ? {
        entries: explanation.entries,
        generatedPath: explanation.path,
        message: "Auxiliary skill outputs cannot replace the owning SKILL.md source body.",
        nextSteps: ["Update the auxiliary source resource directly, or use source resolution to restore its generated copy."],
        ...(sourcePath === undefined ? {} : { sourcePath }),
        status: "refused" as const,
        wouldWrite: false,
        wrote: false,
      }
    : outputExists
    ? await suggestSource(rootPath, managedPath, {
        ...skillsetOptions,
        write: false,
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
  let backupManifestPath: string | undefined;
  let backupRunId: string | undefined;
  if (write && choice !== undefined) {
    const applyBuild = async (): Promise<void> => {
      const built = await buildSkillsetResult(rootPath, skillsetOptions);
      if (!built.ok) {
        const reason = built.diagnostics.map((diagnostic) => diagnostic.message).join("; ");
        throw new Error(`skillset: reconcile build failed${reason.length === 0 ? "" : `: ${reason}`}`);
      }
      writtenPaths = built.writes.paths;
      backupManifestPath = built.writes.backupManifestPath;
      backupRunId = built.writes.backupRunId;
    };
    if (choice === "output") {
      if (!outputResolution.wouldWrite || sourcePath === undefined) {
        throw new Error(`skillset: output cannot win for ${managedPath}: ${outputResolution.message}`);
      }
      const sourceAbsolute = resolve(rootPath, sourcePath);
      const originalSource = await readFile(sourceAbsolute, "utf8");
      try {
        outputResolution = await suggestSource(rootPath, managedPath, {
          ...skillsetOptions,
          write: true,
        });
        if (!outputResolution.wrote) {
          throw new Error(`skillset: output cannot win for ${managedPath}: ${outputResolution.message}`);
        }
        await applyBuild();
      } catch (error) {
        await writeFile(sourceAbsolute, originalSource, "utf8");
        throw error;
      }
    } else {
      await applyBuild();
    }
  }

  return {
    applied: write && choice !== undefined,
    ...(backupManifestPath === undefined ? {} : { backupManifestPath }),
    ...(backupRunId === undefined ? {} : { backupRunId }),
    ...(choice === undefined ? {} : { choice }),
    generatedPath: explanation.path,
    outputResolution,
    ...(sourcePath === undefined ? {} : { sourcePath }),
    sourceResolutionAvailable: true,
    writtenPaths,
  };
}

async function assertReconcileDriftIsScoped(
  rootPath: string,
  managedPath: string,
  sourcePaths: readonly string[],
  allowSourceSiblings: boolean,
  options: SkillsetOptions
): Promise<void> {
  const entries = (await listGeneratedEntries(rootPath, options)).filter((entry) =>
    sourcePaths.includes(entry.sourcePath)
  );
  const allowedPaths = new Set([
    managedPath,
    ...(allowSourceSiblings
      ? entries.flatMap((entry) => [entry.outputPath, ...(entry.files ?? [])])
      : []),
    ...entries.map((entry) => join(entry.outputRoot, "skillset.lock")),
  ].map(normalizeReconcilePath));
  const preview = await diffSkillsetResult(rootPath, options);
  const driftPaths = [
    ...preview.data.added,
    ...preview.data.changed,
    ...preview.data.missing,
    ...preview.data.removed,
  ];
  const unrelated = driftPaths.filter((path) => !allowedPaths.has(normalizeReconcilePath(path)));
  if (unrelated.length > 0) {
    throw new Error(
      `skillset: reconcile ${managedPath} refuses to write while unrelated generated drift exists: ${unrelated.join(", ")}`
    );
  }
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
    if (report.backupRunId !== undefined) {
      lines.push(`  recovery: skillset restore ${report.backupRunId} --yes`);
    }
  } else if (report.choice === "source") {
    lines.push("skillset: preview only; rerun with --use source --yes to apply");
  } else if (report.outputResolution.wouldWrite) {
    lines.push("skillset: preview only; rerun with --use output --yes to apply");
  } else {
    lines.push("skillset: choose --use source or --use output, then pass --yes to apply");
  }
  for (const step of report.outputResolution.nextSteps) lines.push(`  output next: ${step}`);
  return `${lines.join("\n")}\n`;
}

function normalizeReconcilePath(path: string): string {
  return path.replaceAll("\\", "/");
}
