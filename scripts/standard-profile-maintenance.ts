import {
  runStandardProfileMaintenance,
  type StandardProfileMaintenanceReport,
  type StandardProfileMaintenanceSubcommand,
} from "../packages/registry/src/standard-profile-maintenance";

export function renderStandardProfileMaintenanceReport(
  report: StandardProfileMaintenanceReport
): string {
  const lines = [
    "skillset: standard " +
      report.command +
      " checked " +
      report.results.length +
      " profiles",
    ...report.results.flatMap((result) => [
      "  " +
        (result.status === "matched"
          ? "="
          : result.status === "changed"
            ? "~"
            : "!") +
        " " +
        result.id +
        ": " +
        result.status,
      ...result.snapshots
        .filter((snapshot) => snapshot.status !== "matched")
        .map((snapshot) =>
          snapshot.status === "error"
            ? "    " + snapshot.url + ": " + (snapshot.error ?? "unknown error")
            : "    " +
              snapshot.url +
              " " +
              snapshot.expectedHash +
              " -> " +
              snapshot.actualHash
        ),
    ]),
    "skillset: " +
      (report.results.length - report.changed - report.errors) +
      " matched, " +
      report.changed +
      " changed, " +
      report.errors +
      " failed; snapshots were not adopted",
  ];
  return lines.join("\n") + "\n";
}

async function main(args: readonly string[]): Promise<void> {
  const subcommand = args[0];
  if (!isSubcommand(subcommand)) {
    throw new Error(
      "skillset: expected standard profile maintenance command check, diff, or update"
    );
  }
  if (args.length > 1) {
    throw new Error(
      "skillset: standard profile maintenance does not accept additional arguments: " +
        args.slice(1).join(" ")
    );
  }
  const report = await runStandardProfileMaintenance(subcommand);
  process.stdout.write(renderStandardProfileMaintenanceReport(report));
  if (!report.ok) process.exitCode = 1;
}

function isSubcommand(
  value: string | undefined
): value is StandardProfileMaintenanceSubcommand {
  return value === "check" || value === "diff" || value === "update";
}

if (import.meta.main) await main(process.argv.slice(2));
