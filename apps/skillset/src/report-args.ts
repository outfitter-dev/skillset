import { assertBooleanOption, CliArgReader } from "./cli-arg-reader";
import type { CliParseContext } from "./cli-arg-values";
import { CliOutputError } from "./cli-output";
import type { ReportCommandRequest } from "./report-cli";

export const parseReportCommandRequest = (
  args: readonly string[],
  context: CliParseContext
): ReportCommandRequest => {
  if (args[1] === undefined) {
    return {
      cwd: context.cwd,
      jsonOutput: false,
      reference: undefined,
      reportSubcommand: undefined,
    };
  }

  try {
    if (args[1] !== "show") {
      throw new Error("skillset: expected report subcommand show");
    }
    const reader = new CliArgReader(args, 2);
    const reference = reader.readOptionalPositional();
    if (reference === undefined) {
      throw new Error("skillset: report show requires <id-or-path>");
    }

    let jsonOutput = false;
    while (!reader.done) {
      const option = reader.readOption();
      if (option === undefined) {
        break;
      }
      if (option.flag !== "--json") {
        throw new Error(`skillset: unknown option ${option.raw}`);
      }
      assertBooleanOption(option);
      jsonOutput = true;
    }

    return {
      cwd: context.cwd,
      jsonOutput,
      reference,
      reportSubcommand: "show",
    };
  } catch (error) {
    if (error instanceof CliOutputError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CliOutputError(message, 2, "report.show");
  }
};
