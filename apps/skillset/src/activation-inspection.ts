import {
  deriveActivationSubjects,
  listProviderActivationDescriptors,
  planActivationReadiness,
} from "@skillset/core";
import type {
  ActivationObservation,
  ActivationSubject,
  ProviderActivationInspector,
} from "@skillset/core";
import type {
  ActivationProofIdentity,
  ActivationProofReceipt,
} from "@skillset/schema";
import type { SkillsetRenderResult } from "@skillset/core/internal/render-result";
import type { BuildGraph } from "@skillset/core/internal/types";
import {
  ACTIVATION_INSPECTION_SCHEMA,
  type ActivationInspectionOutcome,
  type ActivationInspectionReport,
  type ActivationInspectorReceipt,
  validateActivationInspectionReport,
} from "@skillset/schema";

import { parseActivationInspectorOutput } from "./activation-parsers";
import {
  isProviderCommandUnavailable,
  runProviderCommand,
} from "./provider-command";
import type {
  ProviderCommand,
  ProviderCommandExecutionOptions,
  ProviderCommandExecutionResult,
} from "./provider-command";

export { ACTIVATION_INSPECTION_SCHEMA };
export type {
  ActivationInspectionOutcome,
  ActivationInspectionReport,
  ActivationInspectorReceipt,
};

const DEFAULT_ACTIVATION_TIMEOUT_MS = 5_000;
const MAX_ACTIVATION_OUTPUT_BYTES = 64 * 1024;
const MAX_VERSION_OUTPUT_BYTES = 512;

export interface ActivationInspectionOptions {
  readonly allowActive: boolean;
  readonly currentProofIdentities?: Readonly<
    Record<string, readonly ActivationProofIdentity[]>
  >;
  readonly env?: Record<string, string | undefined>;
  readonly graph: BuildGraph;
  readonly includeSourcePath?: (path: string) => boolean;
  readonly includeSubject?: (subject: ActivationSubject) => boolean;
  readonly renderResults: readonly SkillsetRenderResult[];
  readonly proofReceipts?: readonly ActivationProofReceipt[];
  readonly rootPath: string;
  readonly runCommand?: ActivationProviderCommandRunner;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly untrustedOutputPaths?: readonly string[];
}

export type ActivationProviderCommandRunner = (
  command: ProviderCommand,
  options: ProviderCommandExecutionOptions
) => Promise<ProviderCommandExecutionResult>;

interface InspectorRun {
  readonly observations: readonly ActivationObservation[];
  readonly receipt: ActivationInspectorReceipt;
}

type BinaryVersionInspection =
  | { readonly binaryVersion: string; readonly kind: "matched" }
  | { readonly kind: "outside_evidence_boundary" }
  | { readonly kind: "unavailable" };

/**
 * Runs the explicit provider observation path. Bare build, check, status, and
 * explain routes do not call this operation.
 */
export async function inspectActivationReadiness(
  options: ActivationInspectionOptions
): Promise<ActivationInspectionReport> {
  const boundedOptions = {
    ...options,
    timeoutMs: activationTimeout(options.timeoutMs),
  };
  const runner = options.runCommand ?? runProviderCommand;
  const subjects = deriveActivationSubjects(options.graph, {
    ...(options.includeSourcePath === undefined
      ? {}
      : { includeSourcePath: options.includeSourcePath }),
  }).filter(options.includeSubject ?? (() => true));
  const versionCache = new Map<string, Promise<BinaryVersionInspection>>();
  const runs: InspectorRun[] = [];

  for (const descriptor of listProviderActivationDescriptors()) {
    const matchingSubjects = subjects
      .filter(
        (subject) =>
          subject.target === descriptor.target &&
          subject.capability === descriptor.capability
      )
      .map((subject) => subject.subject);
    if (matchingSubjects.length === 0) continue;

    for (const inspector of descriptor.inspectors) {
      runs.push(
        await runInspector({
          descriptor,
          env: options.env ?? process.env,
          inspector,
          matchingSubjects,
          options: boundedOptions,
          runner,
          versionCache,
        })
      );
    }
  }

  const report: ActivationInspectionReport = {
    inspections: runs
      .map(({ receipt }) => receipt)
      .toSorted((left, right) =>
        left.inspectorId.localeCompare(right.inspectorId)
      ),
    readiness: planActivationReadiness({
      ...(options.currentProofIdentities === undefined
        ? {}
        : { currentProofIdentities: options.currentProofIdentities }),
      graph: options.graph,
      ...(options.includeSourcePath === undefined
        ? {}
        : { includeSourcePath: options.includeSourcePath }),
      ...(options.includeSubject === undefined
        ? {}
        : { includeSubject: options.includeSubject }),
      observations: runs.flatMap(({ observations }) => observations),
      ...(options.proofReceipts === undefined
        ? {}
        : { proofReceipts: options.proofReceipts }),
      renderResults: options.renderResults,
      ...(options.untrustedOutputPaths === undefined
        ? {}
        : { untrustedOutputPaths: options.untrustedOutputPaths }),
    }),
    schema: ACTIVATION_INSPECTION_SCHEMA,
  };
  const validation = validateActivationInspectionReport(report);
  if (!validation.ok) {
    throw new Error(
      `skillset: invalid activation inspection report: ${validation.diagnostics
        .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
        .join("; ")}`
    );
  }
  return report;
}

async function runInspector(input: {
  readonly descriptor: ReturnType<
    typeof listProviderActivationDescriptors
  >[number];
  readonly env: Record<string, string | undefined>;
  readonly inspector: ProviderActivationInspector;
  readonly matchingSubjects: readonly string[];
  readonly options: ActivationInspectionOptions;
  readonly runner: ActivationProviderCommandRunner;
  readonly versionCache: Map<string, Promise<BinaryVersionInspection>>;
}): Promise<InspectorRun> {
  const base = {
    capability: input.descriptor.capability,
    effect: input.inspector.effect,
    inspectorId: input.inspector.id,
    stderrBytes: 0,
    stderrTruncated: false,
    stdoutBytes: 0,
    stdoutTruncated: false,
    subjects: [...input.matchingSubjects].toSorted(),
    target: input.descriptor.target,
  } as const;

  if (input.inspector.surface.kind === "unavailable") {
    return {
      observations: [],
      receipt: {
        ...base,
        outcome: "unavailable",
        summary: "the provider exposes no authoritative inspection surface",
      },
    };
  }
  if (input.inspector.effect === "active" && !input.options.allowActive) {
    return {
      observations: [],
      receipt: {
        ...base,
        outcome: "skipped",
        summary: "active provider observation was not requested",
      },
    };
  }

  const binary = input.inspector.surface.argv[0];
  const version =
    input.versionCache.get(binary) ??
    inspectBinaryVersion(
      {
        cmd: input.inspector.surface.versionArgv,
        cwd: input.options.rootPath,
      },
      input,
      input.descriptor.evidence.providerVersion
    );
  input.versionCache.set(binary, version);
  const versionInspection = await version;
  if (versionInspection.kind === "unavailable") {
    return {
      observations: [],
      receipt: {
        ...base,
        outcome: "unavailable",
        summary: "the provider version executable is unavailable",
      },
    };
  }
  if (versionInspection.kind === "outside_evidence_boundary") {
    return {
      observations: [],
      receipt: {
        ...base,
        outcome: "skipped",
        summary:
          "provider observation was skipped because the binary version is outside the registry evidence boundary",
      },
    };
  }
  const binaryVersion = versionInspection.binaryVersion;

  let result: ProviderCommandExecutionResult;
  try {
    result = await input.runner(
      {
        cmd: input.inspector.surface.argv,
        cwd: input.options.rootPath,
      },
      commandOptions(input, MAX_ACTIVATION_OUTPUT_BYTES)
    );
  } catch (error) {
    if (isProviderCommandUnavailable(error)) {
      return {
        observations: [],
        receipt: {
          ...base,
          binaryVersion,
          outcome: "unavailable",
          summary: "the provider executable is unavailable",
        },
      };
    }
    throw error;
  }

  const evidence = {
    ...(binaryVersion === undefined ? {} : { binaryVersion }),
    stderrBytes: result.stderrBytes,
    stderrTruncated: result.stderrTruncated,
    stdoutBytes: result.stdoutBytes,
    stdoutTruncated: result.stdoutTruncated,
  };
  if (result.timedOut) {
    return {
      observations: [],
      receipt: {
        ...base,
        ...evidence,
        outcome: "timed_out",
        summary: "provider observation exceeded its bounded timeout",
      },
    };
  }
  if (result.exitCode !== 0 || result.stdoutTruncated) {
    return {
      observations: [],
      receipt: {
        ...base,
        ...evidence,
        outcome: result.stdoutTruncated ? "malformed" : "unavailable",
        summary: result.stdoutTruncated
          ? "provider output exceeded the parser evidence budget"
          : "provider observation did not complete successfully",
      },
    };
  }
  const parsed = parseActivationInspectorOutput({
    capability: input.descriptor.capability,
    inspectorId: input.inspector.id,
    stdout: result.stdout,
    subjects: input.matchingSubjects,
  });
  return {
    observations: parsed.facts.map((fact) => ({
      capability: input.descriptor.capability,
      claim: fact.claim,
      inspectorId: input.inspector.id,
      observationEffect: input.inspector.effect,
      origin: "observed",
      ...(fact.state === "satisfied"
        ? {}
        : { reasonCode: reasonCodeForStage(input.descriptor, fact.stage) }),
      stage: fact.stage,
      state: fact.state,
      subject: fact.subject,
      target: input.descriptor.target,
    })),
    receipt: {
      ...base,
      ...evidence,
      outcome: parsed.outcome,
      summary: parsed.summary,
    },
  };
}

async function inspectBinaryVersion(
  command: ProviderCommand,
  input: {
    readonly env: Record<string, string | undefined>;
    readonly options: ActivationInspectionOptions;
    readonly runner: ActivationProviderCommandRunner;
  },
  expectedVersion: string
): Promise<BinaryVersionInspection> {
  try {
    const result = await input.runner(
      command,
      commandOptions(input, MAX_VERSION_OUTPUT_BYTES)
    );
    if (result.exitCode !== 0 || result.timedOut || result.stdoutTruncated) {
      return { kind: "outside_evidence_boundary" };
    }
    const binaryVersion = extractEvidenceVersion(
      result.stdout,
      expectedVersion
    );
    return binaryVersion === undefined
      ? { kind: "outside_evidence_boundary" }
      : { binaryVersion, kind: "matched" };
  } catch (error) {
    if (isProviderCommandUnavailable(error)) return { kind: "unavailable" };
    throw error;
  }
}

function reasonCodeForStage(
  descriptor: ReturnType<typeof listProviderActivationDescriptors>[number],
  stage: ActivationObservation["stage"]
): string {
  const reason = descriptor.reasons.find(
    (candidate) => candidate.stage === stage
  );
  if (reason === undefined) {
    throw new Error(
      `skillset: activation descriptor ${descriptor.id} has no reason for ${stage}`
    );
  }
  return reason.code;
}

function activationTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_ACTIVATION_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      "skillset: activation timeout must be a positive safe integer"
    );
  }
  return timeoutMs;
}

function commandOptions(
  input: {
    readonly env: Record<string, string | undefined>;
    readonly options: ActivationInspectionOptions;
  },
  maxStdoutBytes: number
): ProviderCommandExecutionOptions {
  return {
    env: input.env,
    maxStderrBytes: 0,
    maxStdoutBytes,
    ...(input.options.signal === undefined
      ? {}
      : { signal: input.options.signal }),
    timeoutMs: input.options.timeoutMs ?? DEFAULT_ACTIVATION_TIMEOUT_MS,
  };
}

function extractEvidenceVersion(
  stdout: string,
  expectedVersion: string
): string | undefined {
  const line = stdout.split(/\r?\n/u)[0]?.trim();
  if (line === undefined || line.length === 0 || line.length > 160) {
    return undefined;
  }
  const escaped = expectedVersion.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|\\s|\\()${escaped}(?:$|\\s|\\))`, "u").test(line)
    ? expectedVersion
    : undefined;
}
