import { renderCliHelp } from "./cli-help";
import { cliVersion } from "./cli-version";
import { PromptCancelledError } from "./prompt-cancelled-error";

export async function runCli(
  rawArgs: readonly string[] = process.argv.slice(2)
): Promise<void> {
  if (rawArgs.length === 1 && rawArgs[0] === "--version") {
    await writeFastPath(`${cliVersion}\n`);
    return;
  }

  if (rawArgs.some((arg) => arg === "--help" || arg === "-h")) {
    await writeFastPath(`${renderCliHelp(rawArgs)}\n`);
    return;
  }

  const { parseCliRequest } = await import("./cli-args");
  const route = parseCliRequest(rawArgs);
  switch (route.command) {
    case "build":
      return (await import("./build-cli")).runBuildCommand(route.request);
    case "change":
      return (await import("./change-cli")).runChangeCommand(route.request);
    case "check":
      return (await import("./check-cli")).runCheckCommand(route.request);
    case "create":
      return (await import("./create-cli")).runCreateCommand(route.request);
    case "dev":
      return (await import("./dev-cli")).runDevCommand(route.request);
    case "draft":
      return (await import("./draft-cli")).runDraftCommand(route.request);
    case "diff":
      return (await import("./build-cli")).runDiffCommand(route.request);
    case "eval":
      return (await import("./eval-cli")).runEvalCommand(route.request);
    case "distribute":
      return (await import("./distribution-cli")).runDistributionCommand(
        route.request
      );
    case "explain":
      return (await import("./inspect-cli")).runExplainCommand(route.request);
    case "hooks":
      return (await import("./hooks-cli")).runHooksCommand(route.request);
    case "import":
      return (await import("./source-cli")).runImportCommand(route.request);
    case "init":
      return (await import("./init-cli")).runInitCommand(route.request);
    case "list":
      return (await import("./inspect-cli")).runListCommand(route.request);
    case "lookup":
      return route.request.kind === "features"
        ? (await import("./inspect-cli")).runLookupFeaturesCommand(
            route.request.value
          )
        : (await import("./inspect-cli")).runLookupRoute(route.request.value);
    case "marketplace":
      return (await import("./distribution-cli")).runMarketplaceCommand(
        route.request
      );
    case "move":
      return (await import("./move-cli")).runMoveCommand(route.request);
    case "new":
      return (await import("./source-cli")).runNewCommand(route.request);
    case "promote":
      return (await import("./promote-cli")).runPromoteCommand(route.request);
    case "reconcile":
      return (await import("./recovery-cli")).runReconcileCommand(
        route.request
      );
    case "rename":
      return (await import("./rename-cli")).runRenameCommand(route.request);
    case "release":
      return (await import("./release-cli")).runReleaseCommand(route.request);
    case "report":
      return (await import("./report-cli")).runReportCommand(route.request);
    case "resolve":
      return (await import("./resolve-cli")).runResolveCommand(route.request);
    case "restore":
      return (await import("./recovery-cli")).runRestoreCommand(route.request);
    case "status":
      return (await import("./inspect-cli")).runStatusCommand(route.request);
    case "test":
      return (await import("./test-cli")).runTestCommand(route.request);
    case "update":
      return (await import("./update-cli")).runUpdateCommand(route.request);
  }
}

function writeFastPath(text: string): Promise<void> {
  // A fast process can exit before Bun flushes console.log to a pipe.
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function reportCliError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = cliErrorExitCode(error);
}

export function cliErrorExitCode(error: unknown): number {
  return error instanceof PromptCancelledError ? error.exitCode : 1;
}
