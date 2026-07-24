import type {
  ActivationReadinessSummary,
  ActivationRequirement,
} from "@skillset/core";

import type { ActivationInspectionReport } from "./activation-inspection";
import type { FiniteCommandWriter } from "./cli-finite-command";

const STATE_ORDER = {
  blocked: 0,
  missing: 1,
  stale: 2,
  unverified: 3,
  not_applicable: 4,
  satisfied: 5,
} as const;

export function printActivationInspection(
  report: ActivationInspectionReport,
  writer: FiniteCommandWriter
): void {
  writeLine(
    writer,
    `  activation: ${humanSummary(report.readiness.summary)} (${formatCounts(report)})`
  );
  for (const inspection of report.inspections) {
    writeLine(
      writer,
      `    inspector [${inspection.target}] ${inspection.inspectorId}: ${inspection.effect}, ${inspection.outcome} - ${inspection.summary}`
    );
  }
  for (const requirement of actionableRequirements(
    report.readiness.requirements
  )) {
    writeLine(
      writer,
      `    [${requirement.target}] ${requirement.capability} ${requirement.subject} ${requirement.stage}: ${requirement.state} - ${requirement.reason}`
    );
    for (const action of requirement.nextActions) {
      writeLine(
        writer,
        `      next: ${action.label}${action.mutates ? " (changes provider state)" : ""}`
      );
    }
  }
}

function actionableRequirements(
  requirements: readonly ActivationRequirement[]
): readonly ActivationRequirement[] {
  return requirements
    .filter((requirement) => requirement.state !== "satisfied")
    .toSorted((left, right) => {
      if (left.required !== right.required) return left.required ? -1 : 1;
      const state = STATE_ORDER[left.state] - STATE_ORDER[right.state];
      return state === 0 ? left.id.localeCompare(right.id) : state;
    });
}

function humanSummary(summary: ActivationReadinessSummary): string {
  return summary === "ready_unverified"
    ? "ready with unverified requirements"
    : summary;
}

function formatCounts(report: ActivationInspectionReport): string {
  const counts = report.readiness.counts;
  return [
    `${counts.satisfied} satisfied`,
    `${counts.missing} missing`,
    `${counts.blocked} blocked`,
    `${counts.stale} stale`,
    `${counts.unverified} unverified`,
  ].join(", ");
}

function writeLine(writer: FiniteCommandWriter, line: string): void {
  writer.stdout.write(`${line}\n`);
}
