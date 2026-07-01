import {
  lookupSkillsetReference,
  type LookupReport,
  type LookupSubject,
  type LookupView,
} from "@skillset/core";

import { renderValidatedJson } from "./structured-output";
import type { JsonRecord, TargetName } from "./types";

export interface LookupCommandOptions {
  readonly aspects: readonly string[];
  readonly field?: string;
  readonly json: boolean;
  readonly subject?: LookupSubject;
  readonly targets: readonly TargetName[];
  readonly views: readonly LookupView[];
}

export function runLookupCommand(options: LookupCommandOptions): void {
  const report = lookupSkillsetReference({
    ...(options.aspects.length === 0 ? {} : { aspects: options.aspects }),
    ...(options.field === undefined ? {} : { field: options.field }),
    ...(options.subject === undefined ? {} : { subject: options.subject }),
    ...(options.targets.length === 0 ? {} : { targets: options.targets }),
    ...(options.views.length === 0 ? {} : { views: options.views }),
  });
  if (options.json) {
    process.stdout.write(renderValidatedJson(report as unknown as JsonRecord, "skillset lookup"));
  } else {
    printLookupReport(report);
  }
  if (report.diagnostics.some((diagnostic) => diagnostic.severity === "error")) process.exitCode = 1;
}

export function readLookupSubject(value: string): LookupSubject {
  if (
    value === "agent" ||
    value === "hooks" ||
    value === "instruction" ||
    value === "plugin" ||
    value === "skill" ||
    value === "workspace"
  ) {
    return value;
  }
  throw new Error("skillset: expected lookup subject skill, agent, instruction, workspace, hooks, or plugin");
}

export function readLookupTarget(value: string): TargetName {
  if (value === "claude" || value === "codex") return value;
  throw new Error(`skillset: unknown lookup compatibility target ${value}; expected claude or codex`);
}

export function addLookupTarget(targets: readonly TargetName[], target: TargetName): TargetName[] {
  return [...new Set([...targets, target])];
}

export function addLookupTargets(targets: readonly TargetName[], value: string): TargetName[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .reduce((current, item) => addLookupTarget(current, readLookupTarget(item)), [...targets]);
}

export function addLookupView(views: readonly LookupView[], view: LookupView): LookupView[] {
  return [...new Set([...views, view])];
}

export function setLookupField(current: string | undefined, value: string): string {
  if (current !== undefined) throw new Error("skillset: pass only one --field value");
  return value;
}

function printLookupReport(report: LookupReport): void {
  if (report.subject === undefined) {
    console.log("skillset lookup subjects");
    for (const subject of report.subjects) {
      console.log(`  ${subject.subject}: ${subject.description}`);
      console.log(`    views: ${subject.defaultViews.join(", ")}`);
    }
    console.log("  flags: --frontmatter --fields --field <path> --values --events --compat [claude|codex...] --examples --schema --claude --codex --json");
    console.log(`skillset: listed ${report.subjects.length} lookup subjects`);
    return;
  }

  console.log(`skillset lookup ${report.subject}${report.aspects.length === 0 ? "" : ` ${report.aspects.join(" ")}`}`);
  for (const diagnostic of report.diagnostics) {
    console.log(`  ${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}`);
  }
  if (report.fields.length > 0) {
    console.log("  fields:");
    for (const field of report.fields) {
      const required = field.required ? " required" : "";
      const values = field.values === undefined ? "" : ` values: ${field.values.map(formatLookupValue).join(", ")}`;
      console.log(`    ${field.path}: ${field.type}${required}${values}`);
    }
  }
  if (report.events.length > 0) {
    console.log("  events:");
    for (const event of report.events) {
      const required = event.fields.filter((field) => field.required).map((field) => field.name);
      const suffix = required.length === 0 ? "" : ` required: ${required.join(", ")}`;
      const handlers = event.handlerTypes.length === 0 ? "" : ` handlers: ${event.handlerTypes.join(", ")}`;
      const values = event.matcherValues.length === 0 ? "" : ` values: ${event.matcherValues.join(", ")}`;
      console.log(`    [${event.target}] ${event.name} matcher: ${event.matcherKind}${values}${handlers}${suffix}`);
    }
  }
  if (report.compatibility.length > 0) {
    console.log("  compatibility:");
    for (const item of report.compatibility) {
      const reason = item.reason === undefined ? "" : ` (${item.reason})`;
      const note = item.note === undefined ? "" : ` note: ${item.note}`;
      console.log(`    [${item.target}] ${item.featureId}: ${item.status}${reason}${note}`);
    }
  }
  if (report.examples.length > 0) {
    console.log("  examples:");
    for (const example of report.examples) {
      console.log(`    ${example.path}: ${example.description}`);
    }
  }
  if (report.schema !== undefined) {
    console.log(`  schema: ${report.schema.id} (${report.schema.title})`);
  }
  console.log(`skillset: lookup ${report.diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "reported diagnostics" : "complete"}`);
}

function formatLookupValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
