import { readReportBundle, ReportStoreError } from "@skillset/core";
import type { ReportStoreErrorCode, StoredReportBundle } from "@skillset/core";

import {
  runFiniteCommand,
  type FiniteCommandWriter,
} from "./cli-finite-command";
import { renderCliHelp } from "./cli-help";

export interface ReportCommandRequest {
  readonly cwd: string;
  readonly jsonOutput: boolean;
  readonly reference: string | undefined;
  readonly reportSubcommand: "show" | undefined;
}

const REPORT_EXIT_CODES: Readonly<Record<ReportStoreErrorCode, number>> = {
  invalid_bundle: 2,
  invalid_reference: 2,
  invariant: 4,
  not_found: 1,
  read_failed: 3,
};

export const reportStoreExitCode = (code: ReportStoreErrorCode): number => {
  return REPORT_EXIT_CODES[code];
};

type ReportShowResult =
  | { readonly bundle: StoredReportBundle; readonly ok: true }
  | {
      readonly code: ReportStoreErrorCode;
      readonly message: string;
      readonly ok: false;
    };

export const runReportCommand = async (
  request: ReportCommandRequest
): Promise<void> => {
  if (request.reportSubcommand === undefined) {
    process.stdout.write(`${renderCliHelp(["report", "--help"])}\n`);
    return;
  }
  if (request.reference === undefined) {
    throw new Error("skillset: report show requires <id-or-path>");
  }
  const reference = request.reference;

  return runFiniteCommand<ReportShowResult>({
    execute: async () => {
      try {
        return {
          bundle: await readReportBundle(reference, {
            cwd: request.cwd,
          }),
          ok: true,
        };
      } catch (error) {
        if (error instanceof ReportStoreError) {
          return { code: error.code, message: error.message, ok: false };
        }
        return {
          code: "invariant",
          message: "skillset: unexpected report retrieval failure",
          ok: false,
        };
      }
    },
    exitCode: (result) => (result.ok ? 0 : reportStoreExitCode(result.code)),
    json: (result) =>
      result.ok
        ? {
            command: "report.show",
            data: {
              report: result.bundle.report,
              resolvedPath: result.bundle.resolvedPath,
            },
          }
        : {
            command: "report.show",
            data: {},
            diagnostics: [
              {
                code: `report.${result.code}`,
                message: result.message,
                severity: "error",
              },
            ],
            kind: "diagnostics",
          },
    jsonOutput: request.jsonOutput,
    renderHuman: renderReportShowHuman,
  });
};

const renderReportShowHuman = (
  result: ReportShowResult,
  writer: FiniteCommandWriter
): void => {
  if (result.ok) {
    writer.stdout.write(result.bundle.markdown);
  } else {
    writer.stderr.write(`${result.message}\n`);
  }
};
