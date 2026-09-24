import { reportCliError, runCli } from "./cli-core";
import {
  CliOutputError,
  CliUsageError,
  cliExitCode,
  createCliEvent,
  createCliResult,
  readCliCommand,
  readCliMachineMode,
  renderCliEvent,
  renderCliResult,
  type CliMachineMode,
} from "./cli-output";

export async function runCliEntrypoint(
  args: readonly string[] = process.argv.slice(2)
): Promise<void> {
  let mode: CliMachineMode | undefined;
  try {
    mode = readCliMachineMode(args);
    if (mode !== undefined && (args.includes("--help") || args.includes("-h"))) {
      throw new CliUsageError(
        "skillset: --help cannot be combined with --json or --jsonl",
        readCliCommand(args)
      );
    }
    await runCli(args);
  } catch (error) {
    mode ??=
      args.includes("--jsonl") && !args.includes("--json")
        ? "jsonl"
        : args.includes("--json")
          ? "json"
          : undefined;
    if (!mode) {
      reportCliError(error);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const exitCode = cliExitCode(error);
    const command = error instanceof CliOutputError
      ? error.command ?? readCliCommand(args)
      : readCliCommand(args);
    const data = { exitCode, message };
    const output =
      mode === "jsonl"
        ? renderCliEvent(
            createCliEvent({
              command,
              data,
              event: "failed",
              sequence: 1,
            })
          )
        : renderCliResult(
            createCliResult({
              command,
              data: {},
              diagnostics: [{ code: "cli.usage", message, severity: "error" }],
              exitCode,
              kind: "diagnostics",
            })
          );
    process.stdout.write(output);
    process.exitCode = exitCode;
  }
}
