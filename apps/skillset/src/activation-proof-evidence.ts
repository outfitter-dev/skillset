import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { BuildGraph, SkillsetOptions } from "@skillset/core/internal/types";
import {
  validateActivationProofReceipt,
  type ActivationProofReceipt,
} from "@skillset/schema";

import {
  retainedRunRootPaths,
  resolveRetainedRunPath,
} from "./retained-runs";

const DECLARED_TEST_ROOT = ".skillset/cache/tests";

export async function readActivationProofReceipts(
  rootPath: string,
  graph: BuildGraph,
  options: Pick<SkillsetOptions, "xdg">
): Promise<readonly ActivationProofReceipt[]> {
  const reports = await readProofReports(
    rootPath,
    graph,
    DECLARED_TEST_ROOT,
    options
  );
  return reports
    .flatMap((report) => readProofReceipts(report))
    .toSorted((left, right) =>
      left.claimIds.join("\0").localeCompare(right.claimIds.join("\0"))
    );
}

async function readProofReports(
  rootPath: string,
  graph: BuildGraph,
  logicalRoot: string,
  options: Pick<SkillsetOptions, "xdg">
): Promise<readonly unknown[]> {
  const paths = retainedRunRootPaths(rootPath, graph, logicalRoot, options.xdg);
  let runIds: string[];
  try {
    runIds = (await readdir(paths.absolute.runsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && isPortableRunId(entry.name))
      .map((entry) => entry.name)
      .toSorted();
  } catch {
    return [];
  }
  const reports = await Promise.all(
    runIds.map(async (runId) => {
      const logicalReportPath = join(
        paths.logical.runsRoot,
        runId,
        "report.json"
      ).replaceAll("\\", "/");
      const reportPath = resolveRetainedRunPath(
        rootPath,
        graph,
        logicalReportPath,
        options.xdg
      );
      try {
        return JSON.parse(await readFile(reportPath, "utf8")) as unknown;
      } catch {
        return undefined;
      }
    })
  );
  return reports.filter((report) => report !== undefined);
}

function readProofReceipts(value: unknown): readonly ActivationProofReceipt[] {
  if (!isRecord(value) || !Array.isArray(value.proofReceipts)) return [];
  return value.proofReceipts.flatMap((receipt) => {
    const validation = validateActivationProofReceipt(receipt);
    return validation.ok ? [receipt as ActivationProofReceipt] : [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPortableRunId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}
