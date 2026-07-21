import type {
  FeatureCapability,
  LookupSubject,
  LookupView,
} from "@skillset/core";
import { targetNames } from "@skillset/core";
import {
  doctorSkillset,
  explainPath,
  listFeatureCapabilities,
  listGeneratedEntries,
} from "@skillset/core/internal/authoring";
import type {
  SkillsetOptions,
  SourceOrigin,
  TargetName,
} from "@skillset/core/internal/types";
import type { SkillsetCliDiagnostic } from "@skillset/schema";

import {
  runFiniteCommand,
  type FiniteCommandWriter,
} from "./cli-finite-command";
import { renderGeneratedEntryList } from "./cli-list-renderer";
import { printCliJsonData } from "./cli-output";
import { runLookupCommand } from "./lookup-cli";

export interface ListCommandRequest {
  readonly details: boolean;
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
}

export async function runListCommand({
  details,
  jsonOutput,
  options,
  rootPath,
}: ListCommandRequest): Promise<void> {
  return runFiniteCommand({
    execute: () => listGeneratedEntries(rootPath, options),
    exitCode: () => 0,
    json: (entries) => ({ command: "list", data: { entries } }),
    jsonOutput,
    renderHuman: (entries, writer) => {
      writeLine(writer, renderGeneratedEntryList(entries, details));
    },
  });
}

export interface LookupFeaturesCommandRequest {
  readonly featureId: string | undefined;
  readonly jsonOutput: boolean;
}

export function runLookupFeaturesCommand({
  featureId,
  jsonOutput,
}: LookupFeaturesCommandRequest): void {
  const features = listFeatureCapabilities(featureId);
  if (jsonOutput) {
    const exitCode = featureId !== undefined && features.length === 0 ? 1 : 0;
    printCliJsonData("lookup features", { features }, exitCode);
    return;
  }
  if (features.length === 0) {
    console.log(`skillset: feature ${featureId ?? ""} not found`);
    process.exitCode = 1;
    return;
  }
  for (const feature of features) {
    printFeatureCapability(feature);
  }
  console.log(
    `skillset: listed ${features.length} feature${features.length === 1 ? "" : "s"}`
  );
  return;
}

export interface LookupRouteRequest {
  readonly lookupAspects: readonly string[];
  readonly lookupField: string | undefined;
  readonly lookupSubject: LookupSubject | undefined;
  readonly lookupTargets: readonly TargetName[];
  readonly lookupViews: readonly LookupView[];
  readonly jsonOutput: boolean;
}

export function runLookupRoute({
  lookupAspects,
  lookupField,
  lookupSubject,
  lookupTargets,
  lookupViews,
  jsonOutput,
}: LookupRouteRequest): void {
  runLookupCommand({
    aspects: lookupAspects,
    ...(lookupField === undefined ? {} : { field: lookupField }),
    json: jsonOutput,
    ...(lookupSubject === undefined ? {} : { subject: lookupSubject }),
    targets: lookupTargets,
    views: lookupViews,
  });
  return;
}

export interface ExplainCommandRequest {
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly path: string | undefined;
  readonly rootPath: string;
}

export async function runExplainCommand({
  jsonOutput,
  options,
  path,
  rootPath,
}: ExplainCommandRequest): Promise<void> {
  if (path === undefined) {
    throw new Error("skillset: expected a path to explain");
  }
  return runFiniteCommand({
    execute: () => explainPath(rootPath, path, options),
    exitCode: (result) => (result.kind === "unknown" ? 1 : 0),
    json: (result) => ({
      command: "explain",
      data: result,
      diagnostics: explainDiagnostics(result),
      kind: result.kind === "unknown" ? "diagnostics" : "data",
    }),
    jsonOutput,
    renderHuman: printExplainResult,
  });
}

function explainDiagnostics(
  result: Awaited<ReturnType<typeof explainPath>>
): readonly SkillsetCliDiagnostic[] {
  return result.kind === "unknown"
    ? result.notes.map(
        (message): SkillsetCliDiagnostic => ({
          code: "explain.path-unknown",
          message,
          path: result.path,
          severity: "error",
        })
      )
    : [];
}

function printExplainResult(
  result: Awaited<ReturnType<typeof explainPath>>,
  writer: FiniteCommandWriter
): void {
  writeLine(writer, `skillset: ${result.path} (${result.kind})`);
  for (const entry of result.entries) {
    writeLine(
      writer,
      `  [${entry.target}] ${entry.sourcePath} -> ${entry.outputPath}`
    );
    if (entry.version !== undefined) {
      writeLine(writer, `    version: ${entry.version}`);
    }
    if (entry.targetState !== undefined) {
      writeLine(writer, `    target state: ${entry.targetState}`);
    }
    if (entry.validation !== undefined) {
      writeLine(writer, `    validation: ${entry.validation}`);
    }
    if (entry.feature !== undefined) {
      writeLine(writer, `    feature: ${entry.feature}`);
    }
    if (entry.origin !== undefined) {
      writeLine(writer, `    origin: ${entry.origin}`);
    }
    if (entry.sourceOrigin !== undefined) {
      writeLine(
        writer,
        `    source origin: ${formatSourceOrigin(entry.sourceOrigin)}`
      );
    }
    if (entry.sourcePointer !== undefined) {
      writeLine(writer, `    source pointer: ${entry.sourcePointer}`);
    }
    if (entry.dependencies !== undefined && entry.dependencies.length > 0) {
      writeLine(writer, `    dependencies: ${entry.dependencies.join(", ")}`);
    }
    if (
      entry.preprocessDependencies !== undefined &&
      entry.preprocessDependencies.length > 0
    ) {
      writeLine(
        writer,
        `    preprocess dependencies: ${entry.preprocessDependencies.join(", ")}`
      );
    }
    if (entry.transforms !== undefined && entry.transforms.length > 0) {
      writeLine(
        writer,
        `    transforms: ${entry.transforms.map((transform) => `${transform.intent} x${transform.count}`).join(", ")}`
      );
    }
    if (entry.sourceHash !== undefined) {
      writeLine(writer, `    source hash: ${entry.sourceHash}`);
    }
    if (entry.outputHash !== undefined) {
      writeLine(writer, `    output hash: ${entry.outputHash}`);
    }
  }
  for (const feature of result.features) {
    writeLine(writer, `  feature ${feature.id}: ${feature.title}`);
    for (const target of targetNames()) {
      writeLine(
        writer,
        `    ${target}: ${feature.targetSupport[target].status}`
      );
    }
  }
  for (const outcome of result.renderResults) {
    printRenderResult(outcome, writer);
  }
  for (const realization of result.toolsRealization) {
    if (realization.entries.length === 0) {
      continue;
    }
    const macro =
      realization.macro === undefined ? "" : ` (macro: ${realization.macro})`;
    writeLine(writer, `  tools realization [${realization.target}]${macro}:`);
    for (const entry of realization.entries) {
      const name =
        entry.kind === "native-overlay"
          ? `native ${entry.ruleDirection ?? ""} ${entry.rule ?? ""}`.trim()
          : (entry.aspect ?? "unknown");
      const classified = entry.unclassified === true ? " (unclassified)" : "";
      const emits =
        entry.emits.length === 0 ? "" : ` -> ${entry.emits.join(", ")}`;
      writeLine(
        writer,
        `    ${name}${classified}: ${entry.decidingLayer} -> ${entry.tier} via ${entry.surface}${emits}`
      );
      for (const diagnostic of entry.diagnostics) {
        writeLine(writer, `      risk: ${diagnostic}`);
      }
    }
  }
  for (const note of result.notes) {
    writeLine(writer, `  note: ${note}`);
  }
}

export interface StatusCommandRequest {
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
}

export async function runStatusCommand({
  jsonOutput,
  options,
  rootPath,
}: StatusCommandRequest): Promise<void> {
  // doctorSkillset carries source warnings in the structured report; the CLI
  // renders them below instead of relying on core operations to print.
  return runFiniteCommand({
    execute: () => doctorSkillset(rootPath, options),
    exitCode: (report) => (report.ok ? 0 : 1),
    json: (report) => ({
      command: "status",
      data: report,
      kind: "diagnostics",
    }),
    jsonOutput,
    renderHuman: printStatusReport,
  });
}

function printStatusReport(
  report: Awaited<ReturnType<typeof doctorSkillset>>,
  writer: FiniteCommandWriter
): void {
  for (const issue of report.lintIssues) {
    writeLine(
      writer,
      `  lint ${issue.severity}: ${issue.path}: ${issue.code}: ${issue.message}`
    );
  }
  if (report.buildError !== undefined) {
    writeLine(writer, `  build error: ${report.buildError}`);
  }
  const { added, changed, removed } = report.drift;
  const { missing } = report.drift;
  const driftCount =
    added.length + changed.length + missing.length + removed.length;
  if (driftCount > 0) {
    writeLine(
      writer,
      `  drift: ${added.length} added, ${changed.length} changed, ${missing.length} missing, ${removed.length} removed (run skillset build --yes)`
    );
  }
  writeLine(
    writer,
    `  features: ${report.featureCapabilities.total} registry entries; status ${formatCountSummary(report.featureCapabilities.byFeatureStatus)}`
  );
  for (const target of targetNames()) {
    writeLine(
      writer,
      `  feature support: ${target} ${formatCountSummary(report.featureCapabilities.byTargetSupport[target])}`
    );
  }
  for (const outcome of report.notableRenderResults) {
    printRenderResult(outcome, writer);
  }
  if (report.ok) {
    if (report.notableRenderResults.length === 0) {
      writeLine(writer, "skillset: status found no problems");
    } else {
      writeLine(
        writer,
        `skillset: status found ${report.notableRenderResults.length} render result advisor${report.notableRenderResults.length === 1 ? "y" : "ies"}`
      );
    }
  } else {
    const problems: string[] = [];
    if (report.lintIssues.length > 0) {
      problems.push(`${report.lintIssues.length} lint issue(s)`);
    }
    if (driftCount > 0) {
      problems.push("generated-output drift");
    }
    if (report.buildError !== undefined) {
      problems.push("a build error");
    }
    if (report.notableRenderResults.length > 0) {
      problems.push(
        `${report.notableRenderResults.length} render result advisor${report.notableRenderResults.length === 1 ? "y" : "ies"}`
      );
    }
    writeLine(writer, `skillset: status found ${problems.join(" and ")}`);
  }
}

function formatSourceOrigin(origin: SourceOrigin): string {
  const remote =
    origin.repo === undefined || origin.ref === undefined
      ? ""
      : `${origin.repo} @ ${origin.ref} `;
  return `${remote}path ${origin.path}`;
}

function printFeatureCapability(feature: FeatureCapability): void {
  console.log(`feature ${feature.id}: ${feature.title}`);
  console.log(`  status: ${feature.status}`);
  for (const target of targetNames()) {
    console.log(`  ${target}: ${formatFeatureSupport(feature.targetSupport[target])}`);
  }
  if (feature.docs.length > 0) {
    console.log(`  docs: ${feature.docs.join(", ")}`);
  }
}

function formatFeatureSupport(support: FeatureCapability["targetSupport"][TargetName]): string {
  const reason = support.reason === undefined ? "" : ` (${support.reason})`;
  const note = support.note === undefined ? "" : ` note: ${support.note}`;
  return `${support.status}${reason}${note}`;
}

function formatCountSummary(counts: Readonly<Record<string, number>>): string {
  return Object.entries(counts)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key} ${count}`)
    .join(", ");
}

function printRenderResult(
  outcome: {
    readonly destination?: string;
    readonly diagnostics?: readonly {
      readonly code: string;
      readonly path?: string;
    }[];
    readonly featureId: string;
    readonly outputs?: readonly { readonly path: string }[];
    readonly policy?: string;
    readonly reason?: string;
    readonly sourceUnit: string;
    readonly status: string;
    readonly target?: string;
  },
  writer: FiniteCommandWriter
): void {
  const target = outcome.target ?? "workspace";
  const destination =
    outcome.destination === undefined ? "" : ` -> ${outcome.destination}`;
  const policy =
    outcome.policy === undefined ? "" : ` policy: ${outcome.policy}`;
  const reason =
    outcome.reason === undefined ? "" : ` reason: ${outcome.reason}`;
  writeLine(
    writer,
    `  render [${target}] ${outcome.sourceUnit}: ${outcome.featureId}${destination} ${outcome.status}${policy}${reason}`
  );
  if (outcome.outputs !== undefined && outcome.outputs.length > 0) {
    writeLine(
      writer,
      `    outputs: ${outcome.outputs.map((output) => output.path).join(", ")}`
    );
  }
  if (outcome.diagnostics !== undefined && outcome.diagnostics.length > 0) {
    writeLine(
      writer,
      `    diagnostics: ${outcome.diagnostics.map((diagnostic) => `${diagnostic.code}${diagnostic.path === undefined ? "" : ` ${diagnostic.path}`}`).join(", ")}`
    );
  }
}

function writeLine(writer: FiniteCommandWriter, line: string): void {
  writer.stdout.write(`${line}\n`);
}
