import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { buildSkillsetResult, diffSkillsetResult } from "@skillset/core";
import {
  explainPath,
  listGeneratedEntries,
  suggestSource,
  type SourceSuggestionReport,
} from "@skillset/core/internal/authoring";
import type { SkillsetOptions } from "@skillset/core/internal/types";
import type { GeneratedEntry } from "@skillset/core/internal/types";

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
  const liveEntry = explanation.kind === "generated" && explanation.entries.length > 0
    ? undefined
    : await findLiveLockEntry(rootPath, managedPath);
  const generatedPath = liveEntry?.generatedPath ?? explanation.path;
  const ownershipEntries = liveEntry === undefined ? explanation.entries : [liveEntry.entry];
  if (ownershipEntries.length === 0) {
    throw new Error(`skillset: reconcile requires a managed generated path; ${managedPath} has no generated owner`);
  }

  const outputExists = await stat(resolve(rootPath, generatedPath)).then(() => true, () => false);
  const sourcePaths = [...new Set(ownershipEntries.map((entry) => entry.sourcePath))];
  const sourcePath = sourcePaths.length === 1 ? sourcePaths[0] : undefined;
  const auxiliarySkillOutput = ownershipEntries.some((entry) =>
    (entry.kind === "standalone-skill" || entry.kind === "plugin-skill") &&
    entry.outputPath !== generatedPath &&
    entry.files?.includes(generatedPath) === true
  );
  await assertReconcileDriftIsScoped(
    rootPath,
    generatedPath,
    sourcePaths,
    choice === "source",
    skillsetOptions,
    ownershipEntries
  );
  let outputResolution = choice === "source"
    ? {
        entries: ownershipEntries,
        generatedPath,
        message: "Source selected; output reverse-patch analysis was skipped.",
        nextSteps: ["Rebuild the managed output from its source."],
        ...(sourcePath === undefined ? {} : { sourcePath }),
        status: "refused" as const,
        wouldWrite: false,
        wrote: false,
      }
    : outputExists && auxiliarySkillOutput
    ? {
        entries: ownershipEntries,
        generatedPath,
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
        entries: ownershipEntries,
        generatedPath,
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
    outputResolution = { ...outputResolution, nextSteps: [] };
  }

  return {
    applied: write && choice !== undefined,
    ...(backupManifestPath === undefined ? {} : { backupManifestPath }),
    ...(backupRunId === undefined ? {} : { backupRunId }),
    ...(choice === undefined ? {} : { choice }),
    generatedPath,
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
  options: SkillsetOptions,
  ownershipEntries: readonly GeneratedEntry[]
): Promise<void> {
  const preview = await diffSkillsetResult(rootPath, options);
  const driftPaths = [
    ...preview.data.added,
    ...preview.data.changed,
    ...preview.data.missing,
    ...preview.data.removed,
  ];
  const liveSiblingEntries = (await Promise.all(
    driftPaths.map((path) => findLiveLockEntry(rootPath, path))
  )).flatMap((match) =>
    match !== undefined && sourcePaths.includes(match.entry.sourcePath) ? [match.entry] : []
  );
  const entries = [
    ...(await listGeneratedEntries(rootPath, options)).filter((entry) =>
      sourcePaths.includes(entry.sourcePath)
    ),
    ...ownershipEntries,
    ...liveSiblingEntries,
  ].filter((entry, index, all) =>
    all.findIndex((candidate) =>
      candidate.outputRoot === entry.outputRoot && candidate.outputPath === entry.outputPath
    ) === index
  );
  const lockedSiblingPaths = allowSourceSiblings
    ? await listLockedSiblingPaths(rootPath, entries, sourcePaths)
    : [];
  const allowedPaths = new Set([
    managedPath,
    ...(allowSourceSiblings
      ? entries.flatMap((entry) => [entry.outputPath, ...(entry.files ?? [])])
      : []),
    ...lockedSiblingPaths,
    ...entries.map((entry) => join(entry.outputRoot, "skillset.lock")),
  ].map(normalizeReconcilePath));
  const unrelated = driftPaths.filter((path) => !allowedPaths.has(normalizeReconcilePath(path)));
  if (unrelated.length > 0) {
    throw new Error(
      `skillset: reconcile ${managedPath} refuses to write while unrelated generated drift exists: ${unrelated.join(", ")}`
    );
  }
}

async function findLiveLockEntry(
  rootPath: string,
  managedPath: string
): Promise<{ readonly entry: GeneratedEntry; readonly generatedPath: string } | undefined> {
  const generatedPath = normalizeManagedPath(rootPath, managedPath);
  for (const lockPath of lockCandidates(generatedPath)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(resolve(rootPath, lockPath), "utf8")) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(parsed) || typeof parsed.outputRoot !== "string" || !Array.isArray(parsed.items)) continue;
    const outputRoot = normalizeReconcilePath(parsed.outputRoot);
    for (const item of parsed.items) {
      if (!isRecord(item) || typeof item.outputPath !== "string" || typeof item.sourcePath !== "string") continue;
      const files = Array.isArray(item.files)
        ? item.files.filter((file): file is string => typeof file === "string")
        : [];
      const ownedPaths = [item.outputPath, ...files].map((path) =>
        normalizeReconcilePath(outputRoot === "." ? path : join(outputRoot, path))
      );
      if (!ownedPaths.includes(generatedPath)) continue;
      return {
        entry: {
          files: ownedPaths,
          ...(typeof item.kind === "string" ? { kind: item.kind } : {}),
          outputPath: normalizeReconcilePath(outputRoot === "." ? item.outputPath : join(outputRoot, item.outputPath)),
          outputRoot,
          sourcePath: item.sourcePath,
          target: "live-lock",
        },
        generatedPath,
      };
    }
  }
  return undefined;
}

function lockCandidates(outputPath: string): readonly string[] {
  const candidates: string[] = [];
  let current = dirname(outputPath);
  while (current !== "." && current !== "") {
    candidates.push(`${current}/skillset.lock`);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  candidates.push("skillset.lock");
  return candidates;
}

function normalizeManagedPath(rootPath: string, path: string): string {
  const normalized = normalizeReconcilePath(relative(resolve(rootPath), resolve(rootPath, path)));
  if (normalized === "" || normalized.startsWith("../") || isAbsolute(normalized)) {
    throw new Error(`skillset: reconcile path escapes root: ${path}`);
  }
  return normalized;
}

async function listLockedSiblingPaths(
  rootPath: string,
  entries: readonly { readonly outputRoot: string }[],
  sourcePaths: readonly string[]
): Promise<readonly string[]> {
  const siblings = new Set<string>();
  for (const outputRoot of new Set(entries.map((entry) => entry.outputRoot))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(resolve(rootPath, outputRoot, "skillset.lock"), "utf8")) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.items)) continue;
    for (const item of parsed.items) {
      if (!isRecord(item) || !sourcePaths.includes(readString(item.sourcePath))) continue;
      if (typeof item.outputPath === "string") siblings.add(join(outputRoot, item.outputPath));
      if (!Array.isArray(item.files)) continue;
      for (const file of item.files) {
        if (typeof file === "string") siblings.add(join(outputRoot, file));
      }
    }
  }
  return [...siblings].sort();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
