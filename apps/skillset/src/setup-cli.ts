import { sourceUnitDisplay } from "@skillset/core/internal/source-unit-selector";

import { adoptCandidateId } from "./adopt";
import { formatScaffoldFileLine } from "./scaffold-report";
import type { SetupReport } from "./setup";

export const printSetupReport = (result: SetupReport, reason: string): void => {
  for (const file of result.files) {
    console.log(formatScaffoldFileLine(file.path, file.status));
  }
  if (result.git !== undefined) {
    console.log(formatScaffoldFileLine(result.git.path, result.git.status));
  }
  for (const baseline of result.baselines) {
    console.log(
      formatScaffoldFileLine(
        `baseline ${sourceUnitDisplay(baseline.scope)} ${baseline.version}`,
        baseline.status
      )
    );
  }
  for (const candidate of result.importCandidates) {
    console.log(
      `  ? import candidate ${candidate.kind} ${candidate.path} (id: ${adoptCandidateId(candidate)})`
    );
  }
  for (const diagnostic of result.surveyDiagnostics) {
    const marker = diagnostic.severity === "error" ? "FAIL" : "warning";
    console.log(
      `  ${marker} ${diagnostic.code} ${diagnostic.paths.join(", ")}: ${diagnostic.message}`
    );
    console.log(`    resolution: ${diagnostic.recommendation}`);
  }
  for (const skip of result.surveySkips) {
    console.log(`  ! skipped ${skip.surface} ${skip.path}: ${skip.reason}`);
  }
  const created = result.files.filter(
    (file) => file.status === "create"
  ).length;
  const existing = result.files.length - created;
  const gitCreated = result.git?.status === "create" ? 1 : 0;
  const gitExisting = result.git?.status === "exists" ? 1 : 0;
  const baselines = result.baselines.filter(
    (baseline) => baseline.status === "create"
  ).length;
  const candidates = result.importCandidates.length;
  const details = [
    `${created + gitCreated} to create`,
    `${existing + gitExisting} already present`,
    ...(baselines === 0
      ? []
      : [`${baselines} baseline${baselines === 1 ? "" : "s"} to adopt`]),
    ...(candidates === 0
      ? []
      : [`${candidates} import candidate${candidates === 1 ? "" : "s"}`]),
  ];
  console.log(`skillset: ${result.kind} ${details.join(", ")} (${reason})`);
  console.log(`  root: ${result.rootPath}`);
};
