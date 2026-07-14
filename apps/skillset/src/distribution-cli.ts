import {
  checkMarketplaces,
  planDistributions,
  updateMarketplaces,
} from "@skillset/core";
import type {
  DistributionPlanReport,
  MarketplaceCheckReport,
  MarketplaceUpdateReport,
} from "@skillset/core";
import type { SkillsetOptions } from "@skillset/core/internal/types";
import type { SkillsetCliDiagnostic } from "@skillset/schema";

import { printCliJsonData } from "./cli-output";

export interface DistributionCommandRequest {
  readonly distributionName: string | undefined;
  readonly distributionSubcommand: "plan" | undefined;
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
}

export async function runDistributionCommand({
  distributionName,
  distributionSubcommand,
  jsonOutput,
  options,
  rootPath,
}: DistributionCommandRequest): Promise<void> {
  if (distributionSubcommand === "plan") {
    const report = await planDistributions(rootPath, {
      ...options,
      ...(distributionName === undefined ? {} : { name: distributionName }),
    });
    if (jsonOutput) {
      printCliJsonData("distribute.plan", { plans: report.plans }, 0, "plan");
    } else {
      printDistributionPlan(report);
    }
    return;
  }
  throw new Error("skillset: expected distribute subcommand plan");
}

export interface MarketplaceCommandRequest {
  readonly jsonOutput: boolean;
  readonly marketplaceName: string | undefined;
  readonly marketplaceSubcommand: "check" | "update" | undefined;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
  readonly yes: boolean;
}

export async function runMarketplaceCommand({
  jsonOutput,
  marketplaceName,
  marketplaceSubcommand,
  options,
  rootPath,
  yes,
}: MarketplaceCommandRequest): Promise<void> {
  if (marketplaceSubcommand === "check") {
    const report = await checkMarketplaces(rootPath, {
      ...options,
      ...(marketplaceName === undefined ? {} : { name: marketplaceName }),
    });
    if (jsonOutput) {
      const diagnostics = report.entries
        .filter((entry) => entry.readiness === "not-ready")
        .map(
          (entry): SkillsetCliDiagnostic => ({
            code: "marketplace.not-ready",
            message: `${entry.catalog}/${entry.entryId}: ${entry.reason}`,
            ...(entry.generatedPath === undefined
              ? {}
              : { path: entry.generatedPath }),
            severity: "error",
          })
        );
      printCliJsonData(
        "marketplace.check",
        report,
        report.ok ? 0 : 1,
        "diagnostics",
        diagnostics
      );
    } else {
      printMarketplaceCheck(report);
    }
    if (!report.ok) {
      process.exitCode = 1;
    }
    return;
  }
  if (marketplaceSubcommand === "update") {
    const report = await updateMarketplaces(rootPath, {
      ...options,
      ...(marketplaceName === undefined ? {} : { name: marketplaceName }),
      write: yes,
    });
    if (jsonOutput) {
      printCliJsonData(
        "marketplace.update",
        {
          report,
          state:
            report.ok && report.writtenPaths.length > 0 ? "written" : "planned",
          writes: report.writtenPaths,
        },
        report.ok ? 0 : 1
      );
    } else {
      printMarketplaceUpdate(report);
    }
    if (!jsonOutput && !yes) {
      console.log("skillset: marketplace update preview wrote no files");
    }
    if (!report.ok) {
      process.exitCode = 1;
    }
    return;
  }
  throw new Error("skillset: expected marketplace subcommand check or update");
}

function printDistributionPlan(report: DistributionPlanReport): void {
  if (report.plans.length === 0) {
    console.log("skillset: no distributions configured");
    return;
  }
  for (const plan of report.plans) {
    console.log(
      `skillset: distribution ${plan.name} planned ${plan.files.length} file${plan.files.length === 1 ? "" : "s"} (${formatDistributionNoOp(plan.noOp)})`
    );
    console.log(
      `  from: ${plan.from.target} ${plan.from.selector} (${plan.from.outputRoot})`
    );
    if (plan.from.runtime !== undefined) {
      console.log(`  runtime: ${plan.from.runtime}`);
    }
    console.log(`  to: ${plan.destination.kind} ${plan.destination.root}`);
    if (plan.destination.branch !== undefined) {
      console.log(`  branch: ${plan.destination.branch}`);
    }
    if (plan.destination.subdirectory !== undefined) {
      console.log(`  subdirectory: ${plan.destination.subdirectory}`);
    }
    console.log(`  digest: ${plan.sourceDigest}`);
    for (const file of plan.files) {
      console.log(
        `  ${file.status}: ${file.sourcePath} -> ${file.destinationPath} (${file.bytes} bytes, ${file.hash.slice(0, 12)})`
      );
      const ownership = formatOwnershipSummary(file.ownership);
      if (ownership !== undefined) {
        console.log(`    ownership: ${ownership}`);
      }
    }
  }
}

function printMarketplaceCheck(report: MarketplaceCheckReport): void {
  if (report.marketplaces.length === 0) {
    console.log("skillset: no marketplaces configured");
    return;
  }
  console.log(
    `skillset: marketplace check ${report.ok ? "passed" : "failed"} ` +
      `(${report.entries.length} target entr${report.entries.length === 1 ? "y" : "ies"})`
  );
  for (const entry of report.entries) {
    const source = entry.repo ?? entry.source.repository ?? entry.source.kind;
    console.log(
      `  ${entry.readiness}: ${entry.catalog}/${entry.entryId} ${entry.requestedTarget} ` +
        `plugin ${entry.plugin} source ${source}`
    );
    console.log(`    reason: ${entry.reason}`);
    if (entry.lock.state !== "locked") {
      console.log(
        `    lock: ${entry.lock.state} ${entry.lock.policy} (${entry.lock.reason})`
      );
    }
    if (entry.generatedPath !== undefined) {
      console.log(`    generated: ${entry.generatedPath}`);
    }
    if (entry.generatedPaths.length > 1) {
      console.log(`    generated bundle: ${entry.generatedPaths.join(", ")}`);
    }
  }
}

function printMarketplaceUpdate(report: MarketplaceUpdateReport): void {
  if (report.check.marketplaces.length === 0) {
    console.log("skillset: no marketplaces configured");
    return;
  }
  console.log(
    `skillset: marketplace update ${report.ok ? "passed" : "failed"} ` +
      `(${report.check.entries.length} target entr${report.check.entries.length === 1 ? "y" : "ies"})`
  );
  for (const file of report.files) {
    const state = report.write
      ? report.writtenPaths.includes(file.path)
        ? "wrote"
        : "unchanged"
      : "would write";
    console.log(`  ${state}: ${file.path} (${file.catalog} ${file.target})`);
  }
  if (report.ok) {
    const state = report.write ? "wrote" : "would write";
    console.log(`  ${state}: ${report.lockPath}`);
    return;
  }
  printMarketplaceCheck(report.check);
}

function formatDistributionNoOp(noOp: boolean | "unknown"): string {
  if (noOp === "unknown") {
    return "destination state unknown";
  }
  return noOp ? "no-op" : "would change";
}

function formatOwnershipSummary(
  ownership: DistributionPlanReport["plans"][number]["files"][number]["ownership"]
): string | undefined {
  if (ownership.fields.length === 0) {
    return undefined;
  }
  const counts = new Map<string, number>();
  for (const field of ownership.fields) {
    counts.set(field.owner, (counts.get(field.owner) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([owner, count]) => `${owner}:${count}`)
    .join(" ");
  return `file:${ownership.file.owner} fields:${summary}`;
}
