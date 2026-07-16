import { runBuildCommand, runDiffCommand } from "./build-cli";
import { runChangeCommand } from "./change-cli";
import { runCheckCommand } from "./check-cli";
import { parseCliRequest } from "./cli-args";
import { USAGE } from "./cli-usage";
import { runDevCommand } from "./dev-cli";
import {
  runDistributionCommand,
  runMarketplaceCommand,
} from "./distribution-cli";
import { runHooksCommand } from "./hooks-cli";
import { runInitCommand } from "./init-cli";
import {
  runExplainCommand,
  runListCommand,
  runLookupFeaturesCommand,
  runLookupRoute,
  runStatusCommand,
} from "./inspect-cli";
import { PromptCancelledError } from "./prompt-adapter";
import { runReconcileCommand, runRestoreCommand } from "./recovery-cli";
import { runReleaseCommand } from "./release-cli";
import { runImportCommand, runNewCommand } from "./source-cli";
import { runTestCommand } from "./test-cli";
import { runUpdateCommand } from "./update-cli";

export async function runCli(
  rawArgs: readonly string[] = process.argv.slice(2)
): Promise<void> {
  if (rawArgs.some((arg) => arg === "--help" || arg === "-h")) {
    console.log(USAGE);
    return;
  }

  const route = parseCliRequest(rawArgs);
  switch (route.command) {
    case "build":
      return runBuildCommand(route.request);
    case "change":
      return runChangeCommand(route.request);
    case "check":
      return runCheckCommand(route.request);
    case "dev":
      return runDevCommand(route.request);
    case "diff":
      return runDiffCommand(route.request);
    case "distribute":
      return runDistributionCommand(route.request);
    case "explain":
      return runExplainCommand(route.request);
    case "hooks":
      return runHooksCommand(route.request);
    case "import":
      return runImportCommand(route.request);
    case "init":
      return runInitCommand(route.request);
    case "list":
      return runListCommand(route.request);
    case "lookup":
      return route.request.kind === "features"
        ? runLookupFeaturesCommand(route.request.value)
        : runLookupRoute(route.request.value);
    case "marketplace":
      return runMarketplaceCommand(route.request);
    case "new":
      return runNewCommand(route.request);
    case "reconcile":
      return runReconcileCommand(route.request);
    case "release":
      return runReleaseCommand(route.request);
    case "restore":
      return runRestoreCommand(route.request);
    case "status":
      return runStatusCommand(route.request);
    case "test":
      return runTestCommand(route.request);
    case "update":
      return runUpdateCommand(route.request);
  }
}

export function reportCliError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = cliErrorExitCode(error);
}

export function cliErrorExitCode(error: unknown): number {
  return error instanceof PromptCancelledError ? error.exitCode : 1;
}
