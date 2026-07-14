import type {
  FeatureCapability,
  LookupSubject,
  LookupView,
} from "@skillset/core";
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

import { printCliJsonData } from "./cli-output";
import { runLookupCommand } from "./lookup-cli";

export interface ListCommandRequest {
  readonly jsonOutput: boolean;
  readonly options: SkillsetOptions;
  readonly rootPath: string;
}

export async function runListCommand({
  jsonOutput,
  options,
  rootPath,
}: ListCommandRequest): Promise<void> {
  const entries = await listGeneratedEntries(rootPath, options);
  if (jsonOutput) {
    printCliJsonData("list", { entries });
    return;
  }
  for (const entry of entries) {
    const feature = entry.feature === undefined ? "" : ` ${entry.feature}`;
    const origin = entry.origin === undefined ? "" : ` (${entry.origin})`;
    const dependencies =
      entry.dependencies === undefined || entry.dependencies.length === 0
        ? ""
        : ` deps:${entry.dependencies.join(";")}`;
    console.log(
      `  [${entry.target}] ${entry.kind ?? "generated"}${feature}${origin} ${entry.sourcePath} -> ${entry.outputPath}${dependencies}`
    );
  }
  console.log(`skillset: listed ${entries.length} generated entries`);
  return;
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
  const result = await explainPath(rootPath, path, options);
  if (jsonOutput) {
    const exitCode = result.kind === "unknown" ? 1 : 0;
    const diagnostics =
      result.kind === "unknown"
        ? result.notes.map(
            (message): SkillsetCliDiagnostic => ({
              code: "explain.path-unknown",
              message,
              path: result.path,
              severity: "error",
            })
          )
        : [];
    printCliJsonData(
      "explain",
      result,
      exitCode,
      result.kind === "unknown" ? "diagnostics" : "data",
      diagnostics
    );
    return;
  }
  console.log(`skillset: ${result.path} (${result.kind})`);
  for (const entry of result.entries) {
    console.log(
      `  [${entry.target}] ${entry.sourcePath} -> ${entry.outputPath}`
    );
    if (entry.version !== undefined) {
      console.log(`    version: ${entry.version}`);
    }
    if (entry.targetState !== undefined) {
      console.log(`    target state: ${entry.targetState}`);
    }
    if (entry.validation !== undefined) {
      console.log(`    validation: ${entry.validation}`);
    }
    if (entry.feature !== undefined) {
      console.log(`    feature: ${entry.feature}`);
    }
    if (entry.origin !== undefined) {
      console.log(`    origin: ${entry.origin}`);
    }
    if (entry.sourceOrigin !== undefined) {
      console.log(
        `    source origin: ${formatSourceOrigin(entry.sourceOrigin)}`
      );
    }
    if (entry.sourcePointer !== undefined) {
      console.log(`    source pointer: ${entry.sourcePointer}`);
    }
    if (entry.dependencies !== undefined && entry.dependencies.length > 0) {
      console.log(`    dependencies: ${entry.dependencies.join(", ")}`);
    }
    if (
      entry.preprocessDependencies !== undefined &&
      entry.preprocessDependencies.length > 0
    ) {
      console.log(
        `    preprocess dependencies: ${entry.preprocessDependencies.join(", ")}`
      );
    }
    if (entry.transforms !== undefined && entry.transforms.length > 0) {
      console.log(
        `    transforms: ${entry.transforms.map((transform) => `${transform.intent} x${transform.count}`).join(", ")}`
      );
    }
    if (entry.sourceHash !== undefined) {
      console.log(`    source hash: ${entry.sourceHash}`);
    }
    if (entry.outputHash !== undefined) {
      console.log(`    output hash: ${entry.outputHash}`);
    }
  }
  for (const feature of result.features) {
    console.log(`  feature ${feature.id}: ${feature.title}`);
    console.log(`    claude: ${feature.targetSupport.claude.status}`);
    console.log(`    codex: ${feature.targetSupport.codex.status}`);
  }
  for (const outcome of result.renderResults) {
    printRenderResult(outcome);
  }
  for (const realization of result.toolsRealization) {
    if (realization.entries.length === 0) {
      continue;
    }
    const macro =
      realization.macro === undefined ? "" : ` (macro: ${realization.macro})`;
    console.log(`  tools realization [${realization.target}]${macro}:`);
    for (const entry of realization.entries) {
      const name =
        entry.kind === "native-overlay"
          ? `native ${entry.ruleDirection ?? ""} ${entry.rule ?? ""}`.trim()
          : (entry.aspect ?? "unknown");
      const classified = entry.unclassified === true ? " (unclassified)" : "";
      const emits =
        entry.emits.length === 0 ? "" : ` -> ${entry.emits.join(", ")}`;
      console.log(
        `    ${name}${classified}: ${entry.decidingLayer} -> ${entry.tier} via ${entry.surface}${emits}`
      );
      for (const diagnostic of entry.diagnostics) {
        console.log(`      risk: ${diagnostic}`);
      }
    }
  }
  for (const note of result.notes) {
    console.log(`  note: ${note}`);
  }
  if (result.kind === "unknown") {
    process.exitCode = 1;
  }
  return;
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
  const report = await doctorSkillset(rootPath, options);
  if (jsonOutput) {
    const exitCode = report.ok ? 0 : 1;
    printCliJsonData("status", report, exitCode, "diagnostics");
    return;
  }
  for (const issue of report.lintIssues) {
    console.log(
      `  lint ${issue.severity}: ${issue.path}: ${issue.code}: ${issue.message}`
    );
  }
  if (report.buildError !== undefined) {
    console.log(`  build error: ${report.buildError}`);
  }
  const { added, changed, removed } = report.drift;
  const { missing } = report.drift;
  const driftCount =
    added.length + changed.length + missing.length + removed.length;
  if (driftCount > 0) {
    console.log(
      `  drift: ${added.length} added, ${changed.length} changed, ${missing.length} missing, ${removed.length} removed (run skillset build --yes)`
    );
  }
  console.log(
    `  features: ${report.featureCapabilities.total} registry entries; status ${formatCountSummary(report.featureCapabilities.byFeatureStatus)}`
  );
  console.log(
    `  feature support: claude ${formatCountSummary(report.featureCapabilities.byTargetSupport.claude)}`
  );
  console.log(
    `  feature support: codex ${formatCountSummary(report.featureCapabilities.byTargetSupport.codex)}`
  );
  for (const outcome of report.notableRenderResults) {
    printRenderResult(outcome);
  }
  if (report.ok) {
    if (report.notableRenderResults.length === 0) {
      console.log("skillset: status found no problems");
    } else {
      console.log(
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
    console.log(`skillset: status found ${problems.join(" and ")}`);
    process.exitCode = 1;
  }
  return;
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
  console.log(
    `  claude: ${formatFeatureSupport(feature.targetSupport.claude)}`
  );
  console.log(`  codex: ${formatFeatureSupport(feature.targetSupport.codex)}`);
  if (feature.docs.length > 0) {
    console.log(`  docs: ${feature.docs.join(", ")}`);
  }
}

function formatFeatureSupport(
  support: FeatureCapability["targetSupport"]["claude"]
): string {
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

function printRenderResult(outcome: {
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
}): void {
  const target = outcome.target ?? "workspace";
  const destination =
    outcome.destination === undefined ? "" : ` -> ${outcome.destination}`;
  const policy =
    outcome.policy === undefined ? "" : ` policy: ${outcome.policy}`;
  const reason =
    outcome.reason === undefined ? "" : ` reason: ${outcome.reason}`;
  console.log(
    `  render [${target}] ${outcome.sourceUnit}: ${outcome.featureId}${destination} ${outcome.status}${policy}${reason}`
  );
  if (outcome.outputs !== undefined && outcome.outputs.length > 0) {
    console.log(
      `    outputs: ${outcome.outputs.map((output) => output.path).join(", ")}`
    );
  }
  if (outcome.diagnostics !== undefined && outcome.diagnostics.length > 0) {
    console.log(
      `    diagnostics: ${outcome.diagnostics.map((diagnostic) => `${diagnostic.code}${diagnostic.path === undefined ? "" : ` ${diagnostic.path}`}`).join(", ")}`
    );
  }
}
