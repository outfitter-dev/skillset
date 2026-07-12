import { reportCliError, runCli } from "./cli-core";
import {
  CliOutputError,
  createCliEvent,
  createCliResult,
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
    const exitCode = classifyCliFailure(error);
    const data = { exitCode, message };
    const output =
      mode === "jsonl"
        ? renderCliEvent(
            createCliEvent({
              command: "cli",
              data,
              event: "failed",
              sequence: 1,
            })
          )
        : renderCliResult(
            createCliResult({
              command: "cli",
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

function classifyCliFailure(error: unknown): number {
  if (error instanceof CliOutputError) return error.exitCode;
  if (
    error instanceof Error &&
    (error.message.startsWith("skillset: expected") ||
      error.message.startsWith("skillset: --"))
  )
    return 2;
  return 3;
}
