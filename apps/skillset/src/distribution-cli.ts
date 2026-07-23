import {
  checkMarketplaces,
  listMarketplaceCatalogs,
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
import {
  confirmProceed,
  createInteractiveSession,
  type InteractiveSession,
} from "./interactive-session";

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

export interface MarketplaceCommandContext {
  readonly interactiveSession?: InteractiveSession;
  readonly listCatalogs?: typeof listMarketplaceCatalogs;
  readonly update?: typeof updateMarketplaces;
  readonly write?: (value: string) => void;
}

export async function runMarketplaceCommand(
  request: MarketplaceCommandRequest,
  context: MarketplaceCommandContext = {}
): Promise<void> {
  const {
    jsonOutput,
    marketplaceName,
    marketplaceSubcommand,
    options,
    rootPath,
    yes,
  } = request;
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
      process.stdout.write(renderMarketplaceCheck(report));
    }
    if (!report.ok) {
      process.exitCode = 1;
    }
    return;
  }
  if (marketplaceSubcommand === "update") {
    const interactiveSession =
      context.interactiveSession ??
      createInteractiveSession({ machineMode: jsonOutput });
    if (interactiveSession !== undefined && !yes && !jsonOutput) {
      return runInteractiveMarketplaceUpdate(
        request,
        interactiveSession,
        context
      );
    }
    const report = await (context.update ?? updateMarketplaces)(rootPath, {
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
      (context.write ?? process.stdout.write.bind(process.stdout))(
        renderMarketplaceUpdate(report)
      );
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

async function runInteractiveMarketplaceUpdate(
  request: MarketplaceCommandRequest,
  session: InteractiveSession,
  context: MarketplaceCommandContext
): Promise<void> {
  const update = context.update ?? updateMarketplaces;
  const write = context.write ?? process.stdout.write.bind(process.stdout);
  session.banner();
  let marketplaceName = request.marketplaceName;
  if (marketplaceName === undefined) {
    const catalogs = await (context.listCatalogs ?? listMarketplaceCatalogs)(
      request.rootPath,
      request.options
    );
    marketplaceName =
      catalogs.length > 1
        ? await session.prompts.select({
            choices: catalogs.map((catalog) => ({
              name: catalog,
              value: catalog,
            })),
            message: "Marketplace:",
          })
        : catalogs[0];
  }
  const updateOptions = {
    ...request.options,
    ...(marketplaceName === undefined ? {} : { name: marketplaceName }),
  };
  const preview = await update(request.rootPath, {
    ...updateOptions,
    write: false,
  });
  write(renderMarketplaceUpdate(preview));
  if (
    !preview.ok ||
    preview.check.marketplaces.length === 0 ||
    !(await confirmProceed(session))
  ) {
    if (!preview.ok) process.exitCode = 1;
    return;
  }
  if (preview.planHash === undefined) {
    throw new Error("skillset: marketplace update preview is missing its plan hash");
  }
  const applied = await update(request.rootPath, {
    ...updateOptions,
    expectedPlanHash: preview.planHash,
    write: true,
  });
  write(renderMarketplaceUpdate(applied));
  if (!applied.ok) process.exitCode = 1;
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

function renderMarketplaceCheck(report: MarketplaceCheckReport): string {
  const lines: string[] = [];
  if (report.marketplaces.length === 0) {
    return "skillset: no marketplaces configured\n";
  }
  lines.push(
    `skillset: marketplace check ${report.ok ? "passed" : "failed"} ` +
      `(${report.entries.length} target entr${report.entries.length === 1 ? "y" : "ies"})`
  );
  for (const entry of report.entries) {
    const source = entry.repo ?? entry.source.repository ?? entry.source.kind;
    lines.push(
      `  ${entry.readiness}: ${entry.catalog}/${entry.entryId} ${entry.requestedTarget} ` +
        `plugin ${entry.plugin} source ${source}`
    );
    lines.push(`    reason: ${entry.reason}`);
    if (entry.lock.state !== "locked") {
      lines.push(
        `    lock: ${entry.lock.state} ${entry.lock.policy} (${entry.lock.reason})`
      );
    }
    if (entry.generatedPath !== undefined) {
      lines.push(`    generated: ${entry.generatedPath}`);
    }
    if (entry.generatedPaths.length > 1) {
      lines.push(`    generated bundle: ${entry.generatedPaths.join(", ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderMarketplaceUpdate(
  report: MarketplaceUpdateReport
): string {
  const lines: string[] = [];
  if (report.check.marketplaces.length === 0) {
    return "skillset: no marketplaces configured\n";
  }
  lines.push(
    `skillset: marketplace update ${report.ok ? "passed" : "failed"} ` +
      `(${report.check.entries.length} target entr${report.check.entries.length === 1 ? "y" : "ies"})`
  );
  for (const file of report.files) {
    const state = report.write
      ? report.writtenPaths.includes(file.path)
        ? "wrote"
        : "unchanged"
      : "would write";
    lines.push(`  ${state}: ${file.path} (${file.catalog} ${file.target})`);
  }
  if (report.ok) {
    const state = report.write ? "wrote" : "would write";
    lines.push(`  ${state}: ${report.lockPath}`);
    return `${lines.join("\n")}\n`;
  }
  if (report.reason !== undefined) {
    lines.push(`  reason: ${report.reason}`);
  }
  if (!report.check.ok) {
    lines.push(renderMarketplaceCheck(report.check));
  }
  return `${lines.join("\n").trimEnd()}\n`;
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
