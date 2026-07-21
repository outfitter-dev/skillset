import {
  runProviderMaintenance,
  type ProviderMaintenanceReport,
  type ProviderMaintenanceSubcommand,
} from "../packages/registry/src/provider-maintenance";

export function renderProviderMaintenanceReport(
  report: ProviderMaintenanceReport
): string {
  const lines: string[] = [];
  lines.push(
    `skillset: provider ${report.command} checked ${report.schemaResults.length} schema snapshots`
  );
  for (const result of report.schemaResults) {
    const marker =
      result.status === "matched"
        ? "="
        : result.status === "changed"
          ? "~"
          : "!";
    lines.push(`  ${marker} schema ${result.id}: ${result.status}`);
    if (result.error !== undefined) lines.push(`    error: ${result.error}`);
    if (
      result.snapshotHash !== undefined &&
      result.snapshotHash.expected !== result.snapshotHash.actual
    ) {
      lines.push(
        `    snapshot: ${result.snapshotHash.expected} -> ${result.snapshotHash.actual}`
      );
    }
    if (report.command !== "check") {
      for (const source of result.sources) {
        const actual = source.actualHash ?? "unavailable";
        if (source.status !== "matched")
          lines.push(
            `    source: ${source.url} ${source.expectedHash} -> ${actual}`
          );
      }
      for (const change of result.summaryChanges) lines.push(`    ${change}`);
    }
  }
  lines.push(
    `skillset: ${report.schemaMatched} matched, ${report.schemaChanged} changed, ${report.errors} failed; ` +
      `${report.destinationReviews.length} destination format snapshots require manual review`
  );
  if (report.command === "diff") {
    for (const review of report.destinationReviews) {
      lines.push(
        `  ? destination ${review.id} [${review.target}]: ${review.status} ${review.contentHash}`
      );
      lines.push(`    reason: ${review.reason}`);
      for (const source of review.sources) lines.push(`    source: ${source}`);
    }
  }
  if (report.command === "update") {
    if (report.wrote) {
      lines.push(`skillset: wrote ${report.schemaPath}`);
    } else if (report.schemaChanged > 0 && report.errors === 0) {
      lines.push(
        "skillset: rerun providers update with --yes to refresh schema snapshots"
      );
    } else if (report.errors > 0) {
      lines.push(
        "skillset: provider schema snapshots were not updated because checks failed"
      );
    } else {
      lines.push("skillset: provider schema snapshots are current");
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main(args: readonly string[]): Promise<void> {
  const subcommand = args[0];
  if (!isSubcommand(subcommand)) {
    throw new Error(
      "skillset: expected provider maintenance command check, diff, or update"
    );
  }
  const unexpectedArgs = args.slice(1);
  if (unexpectedArgs.length > 0) {
    throw new Error(
      `skillset: provider maintenance does not accept additional arguments: ${unexpectedArgs.join(" ")}`
    );
  }

  const report = await runProviderMaintenance(process.cwd(), subcommand, {
    write: subcommand === "update",
  });
  process.stdout.write(renderProviderMaintenanceReport(report));
  if (!report.ok) process.exitCode = 1;
}

function isSubcommand(
  value: string | undefined
): value is ProviderMaintenanceSubcommand {
  return value === "check" || value === "diff" || value === "update";
}

if (import.meta.main) await main(process.argv.slice(2));
