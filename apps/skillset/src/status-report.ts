import {
  observeDoctorSkillset,
  type DoctorObservation,
  type DoctorReport,
} from "@skillset/core/internal/authoring";
import { EmptySourceGraphError } from "@skillset/core/internal/empty-source-graph";
import { independentlyObserveOutputBaseline } from "@skillset/core/internal/output-safety";
import { GeneratedLockReadError } from "@skillset/core/internal/generated-lock-read";
import type { SkillsetOptions } from "@skillset/core/internal/types";
import { quoteShellArgument } from "./recovery-guidance";
import { readPendingChangeEntries, type PendingChangeEntry } from "./change-entries";

interface StatusNextAction {
  readonly kind: "author" | "build" | "check" | "diagnose" | "reconcile";
  readonly message: string;
  readonly command?: string;
}

export interface WorkspaceStatusReport extends Omit<DoctorReport, "featureCapabilities" | "ok"> {
  readonly conclusion: {
    readonly state: DoctorReport["outputState"]["state"] | "no-active-source" | "inspection-failed";
    readonly ready: boolean;
    readonly summary: string;
    readonly nextAction: StatusNextAction;
  };
  readonly outputBlockers: readonly string[];
  readonly source: { readonly state: "observed" | "empty" | "inactive" | "unavailable" };
  readonly release: {
    readonly pendingEntries: number;
    readonly ignoredEntries: number;
    readonly diagnostics: PendingChangeEntry["schemaDiagnostics"];
  };
}

/** Command completion is separate from the workspace readiness conclusion. */
export async function inspectWorkspaceStatus(
  rootPath: string,
  options: SkillsetOptions
): Promise<{ readonly completed: boolean; readonly report: WorkspaceStatusReport }> {
  const observation = await observeDoctorSkillset(rootPath, options);
  const entries = await readPendingChangeEntries(rootPath, options);
  const release = {
    pendingEntries: entries.filter((entry) => !entry.ignored).length,
    ignoredEntries: entries.filter((entry) => entry.ignored).length,
    diagnostics: entries.flatMap((entry) => entry.schemaDiagnostics),
  };
  const empty = observation.failure?.phase === "graph" && observation.failure.error instanceof EmptySourceGraphError;
  // An empty graph does not inspect outputs; collect its independent blockers
  // here without broadening the public doctor's baseline-recovery contract.
  const outputBlockers = empty
    ? (await independentlyObserveOutputBaseline(rootPath, options)).corruptLocks.map((error) => error.message)
    : [];
  const inactive = observation.hasActiveSource === false;
  const completed = isCompletedObservation(observation);
  const { featureCapabilities: _registry, ok: _readiness, ...details } = observation.report;
  const state = !completed ? "inspection-failed"
    : details.lintIssues.some((issue) => issue.severity === "error") || release.diagnostics.length > 0 ||
      outputBlockers.length > 0 ||
      (!empty && details.outputState.state === "blocked")
      ? "blocked" : empty || inactive ? "no-active-source" : details.outputState.state;
  const summaries: Record<WorkspaceStatusReport["conclusion"]["state"], string> = {
    "inspection-failed": "Workspace inspection could not complete.",
    "no-active-source": "No active source was found.",
    "no-output-baseline": "Workspace has no output baseline.",
    current: "Workspace output is current.",
    "source-ahead": "Source is ahead of generated output.",
    "output-diverged": "Generated output diverged from its managed baseline.",
    blocked: "Workspace has blockers.",
  };
  const rootArgument = ` --root ${quoteShellArgument(rootPath)}`;
  const nextAction: StatusNextAction = state === "no-active-source"
    ? { kind: "author", message: inactive ? "Promote a draft or author meaningful active source." : "Author or import meaningful source under .skillset/." }
    : state === "blocked" || state === "inspection-failed"
      ? { kind: "diagnose", message: "Resolve the reported diagnostics before changing output.", command: `skillset check${rootArgument}` }
      : state === "output-diverged"
        ? { kind: "reconcile", message: "Preview reconciliation of the managed output changes.", command: `skillset reconcile${rootArgument}` }
        : state === "current"
          ? { kind: "check", message: "Run the workspace readiness check.", command: `skillset check${rootArgument}` }
          : { kind: "build", message: "Preview the generated output plan.", command: `skillset build${rootArgument}` };
  return {
    completed,
    report: {
      ...details,
      outputBlockers,
      conclusion: { state, ready: state === "current", summary: summaries[state], nextAction },
      source: { state: empty ? "empty" : observation.failure?.phase === "graph" ? "unavailable" : inactive ? "inactive" : "observed" },
      release,
    },
  };
}

function isCompletedObservation(observation: DoctorObservation): boolean {
  if (observation.failure === undefined) return true;
  const { error, phase } = observation.failure;
  if (phase === "graph" && error instanceof EmptySourceGraphError) return true;
  // A validated corrupt lock is an observed blocker; unreadable locks and
  // unknown source/render failures do not establish completed inspection.
  return error instanceof GeneratedLockReadError && (error.kind === "invalid-json" || error.kind === "schema");
}
