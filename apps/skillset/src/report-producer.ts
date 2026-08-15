import type { SkillsetReportWorkspace } from "@skillset/schema";
import {
  createOperationReport,
  type CreateOperationReportInput,
} from "@skillset/core/internal/report";

import { cliVersion } from "./cli-version";

export interface CreateCliOperationReportInput {
  readonly command: CreateOperationReportInput["command"];
  readonly exitCode: CreateOperationReportInput["exitCode"];
  readonly sentinels?: readonly string[] | undefined;
  readonly workspace: SkillsetReportWorkspace;
}

/** Creates a CLI-owned receipt without exposing Skillset-owned version or identity facts. */
export function createCliOperationReport(
  input: CreateCliOperationReportInput
) {
  return createOperationReport({
    ...input,
    skillsetVersion: cliVersion,
  });
}
