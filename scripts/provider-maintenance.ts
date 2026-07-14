import {
  renderProviderMaintenanceReport,
  runProviderMaintenance,
  type ProviderMaintenanceSubcommand,
} from "../apps/skillset/src/provider-maintenance";

const subcommand = process.argv[2];
if (!isSubcommand(subcommand)) {
  throw new Error("skillset: expected provider maintenance command check, diff, or update");
}
const unexpectedArgs = process.argv.slice(3);
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

function isSubcommand(value: string | undefined): value is ProviderMaintenanceSubcommand {
  return value === "check" || value === "diff" || value === "update";
}
