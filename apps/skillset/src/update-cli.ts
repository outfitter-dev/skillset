import type { SkillsetOptions } from "@skillset/core/internal/types";

import { printCliJsonData } from "./cli-output";
import {
  renderProviderFormatUpdateReport,
  runProviderFormatUpdates,
} from "./provider-format-updates";

export interface UpdateCommandRequest {
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
  readonly yes: boolean;
}

export async function runUpdateCommand({
  jsonOutput,
  options,
  rootPath,
  yes,
}: UpdateCommandRequest): Promise<void> {
  const report = await runProviderFormatUpdates(rootPath, "update", {
    ...options,
    write: yes,
  });
  if (jsonOutput) {
    printCliJsonData(
      "update",
      {
        report,
        state: report.wrote ? "written" : "planned",
        writes: report.writtenPaths,
      },
      report.ok && !report.blocked ? 0 : 1
    );
  } else {
    process.stdout.write(renderProviderFormatUpdateReport(report));
    if (!yes) {
      console.log("skillset: update preview wrote no files");
    }
  }
  if (!report.ok || report.blocked) {
    process.exitCode = 1;
  }
  return;
}
