import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveRepoCacheKey } from "@skillset/core";
import {
  createReportBundle,
  type StoredReportBundle,
} from "@skillset/core/internal/report-store";
import type {
  SkillsetExternalFixturePhase,
  SkillsetExternalFixtureReportPayload,
  SkillsetExternalFixtureReportWorkspace,
  SkillsetReportEvidenceDescriptor,
} from "@skillset/schema";

import { gitSafeEnv } from "../../apps/skillset/src/git-env";
import { registerSandboxReportExportRequest } from "../../apps/skillset/src/report-export-request";
import {
  createCliExternalFixtureReport,
  externalFixtureManifestEntrySha256,
} from "../../apps/skillset/src/report-producer";
import type {
  ExternalRepoEntry,
  ExternalRunReport,
  ExternalStageResult,
} from "./external";

const REPORTS_DIR = ".skillset/cache/fixtures";

export interface PersistExternalFixtureReportInput {
  readonly entry: ExternalRepoEntry;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly evidence: readonly SkillsetReportEvidenceDescriptor[];
  readonly manifestEntryCount: number;
  readonly manifestSha256: string;
  readonly report: ExternalRunReport;
  readonly rootPath: string;
}

export interface PersistExternalFixtureReportResult {
  readonly requestRegistered: boolean;
  readonly stored: StoredReportBundle;
}

/**
 * Writes the compatibility evidence files without serializing raw diagnostics,
 * paths, recommendations, command output, or imported fixture content.
 */
export async function writeExternalRunReport(
  reportDir: string,
  report: ExternalRunReport,
  entry: Pick<ExternalRepoEntry, "ref" | "repo">
): Promise<SkillsetReportEvidenceDescriptor> {
  const phases = externalFixturePhases(report);
  const comparisonDifferences = countComparisonDifferences(report);
  const evidence = {
    fixture: {
      name: report.name,
      pinnedCommit: entry.ref,
      repository: reportRepositoryIdentity(entry.repo),
    },
    phases,
    pipelinePassed: Object.values(phases).every(
      (phase) => phase.status === "passed"
    ),
    summaries: {
      comparisonDifferences,
      importedUnits: report.summary.importedUnits,
      migrationFlags: report.summary.migrationFlags,
      renderResults: report.summary.renderResults,
      surveyCandidates: report.survey.candidates.length,
    },
  };
  const json = `${JSON.stringify(evidence, null, 2)}\n`;
  const markdown = renderExternalEvidenceMarkdown(evidence);
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, "report.md"), markdown);
  await writeFile(join(reportDir, "report.json"), json);
  const digest = createHash("sha256");
  digest.update("report.json\0", "utf8");
  digest.update(json, "utf8");
  digest.update("report.md\0", "utf8");
  digest.update(markdown, "utf8");
  return {
    available: true,
    bytes:
      Buffer.byteLength(json, "utf8") + Buffer.byteLength(markdown, "utf8"),
    entries: 2,
    id: join(REPORTS_DIR, report.name).replaceAll("\\", "/"),
    sha256: digest.digest("hex"),
  };
}

/**
 * Publishes one completed external-fixture receipt and, only inside a validated
 * test sandbox, requests export of that exact UUID to the parent process.
 */
export async function persistExternalFixtureReport(
  input: PersistExternalFixtureReportInput
): Promise<PersistExternalFixtureReportResult> {
  const env = input.env ?? process.env;
  const phases = externalFixturePhases(input.report);
  const pipelinePassed = Object.values(phases).every(
    (phase) => phase.status === "passed"
  );
  const typedReport = createCliExternalFixtureReport({
    exitCode: pipelinePassed ? 0 : 1,
    payload: {
      evidence: input.evidence,
      fixture: {
        manifestEntryCount: input.manifestEntryCount,
        manifestEntrySha256: externalFixtureManifestEntrySha256(input.entry),
        manifestSha256: input.manifestSha256,
        name: input.entry.name,
        pinnedCommit: input.entry.ref,
        repository: reportRepositoryIdentity(input.entry.repo),
        targets: input.entry.targets,
      },
      phases,
      pipelinePassed,
      runtime: { bunVersion: Bun.version },
      summaries: {
        comparisonDifferences: countComparisonDifferences(input.report),
        importedUnits: input.report.summary.importedUnits,
        migrationFlags: input.report.summary.migrationFlags,
        renderResults: input.report.summary.renderResults,
        surveyCandidates: input.report.survey.candidates.length,
      },
    },
    workspace: await externalFixtureWorkspace(input.rootPath, env),
  });
  const stored = await createReportBundle(typedReport, { env });
  const requestRegistered = await registerSandboxReportExportRequest({
    env,
    expectedRepoRoot: input.rootPath,
    reportId: stored.report.id,
  });
  return { requestRegistered, stored };
}

export function externalFixturePhases(
  report: ExternalRunReport
): SkillsetExternalFixtureReportPayload["phases"] {
  return {
    acquire: externalFixturePhase(report, "acquire"),
    init: externalFixturePhase(report, "init"),
    import: externalFixturePhase(report, "import"),
    lint: externalFixturePhase(report, "lint"),
    build: externalFixturePhase(report, "build"),
    purity: externalFixturePhase(report, "purity"),
    compare: externalFixturePhase(report, "compare"),
  };
}

function externalFixturePhase(
  report: ExternalRunReport,
  stage: ExternalStageResult["stage"]
): SkillsetExternalFixturePhase {
  const outcomes = report.stages.filter((entry) => entry.stage === stage);
  if (outcomes.length === 0) {
    return { exitClass: "not-run", status: "not-run" };
  }
  return outcomes.every((outcome) => outcome.ok)
    ? { exitClass: "success", status: "passed" }
    : { exitClass: "command-failure", status: "failed" };
}

async function externalFixtureWorkspace(
  rootPath: string,
  env: Readonly<Record<string, string | undefined>>
): Promise<SkillsetExternalFixtureReportWorkspace> {
  const [commit, status, remote] = await Promise.all([
    gitOutput(rootPath, ["rev-parse", "HEAD"], env),
    gitOutput(rootPath, ["status", "--porcelain"], env),
    gitOutput(rootPath, ["remote", "get-url", "origin"], env),
  ]);
  const cacheKey = resolveRepoCacheKey({ rootPath }).key;
  const localHash = cacheKey.match(/--local-([0-9a-f]{12})$/u)?.[1];
  if (localHash === undefined) {
    throw new Error("skillset: could not derive private workspace identity");
  }
  return {
    id: `workspace--local-${localHash}`,
    repository: {
      commit: commit.trim(),
      dirty: status.trim().length > 0,
      identity: reportRepositoryIdentity(remote.trim()),
    },
  };
}

function reportRepositoryIdentity(value: string): string {
  const trimmed = value.trim();
  const scpLike = trimmed.match(/^git@([^:]+):(.+)$/u);
  let host: string;
  let path: string;
  if (scpLike !== null) {
    host = scpLike[1]!.toLowerCase();
    path = scpLike[2]!;
  } else {
    let url: URL;
    try {
      url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    } catch (error) {
      throw new Error("skillset: external fixture repository is invalid", {
        cause: error,
      });
    }
    host = url.hostname.toLowerCase();
    path = url.pathname.replace(/^\/+/, "");
  }
  const identity = `${host}/${path.replace(/\.git$/iu, "")}`;
  if (!/^[a-z0-9.-]+(?:\/[A-Za-z0-9._-]+)+$/u.test(identity)) {
    throw new Error("skillset: external fixture repository is invalid");
  }
  return identity;
}

function countComparisonDifferences(report: ExternalRunReport): number {
  return report.roundTrips.reduce(
    (total, roundTrip) =>
      total +
      roundTrip.comparison.different.length +
      roundTrip.comparison.generatedOnly.length +
      roundTrip.comparison.originalOnly.length,
    0
  );
}

function renderExternalEvidenceMarkdown(evidence: {
  readonly fixture: {
    readonly name: string;
    readonly pinnedCommit: string;
    readonly repository: string;
  };
  readonly phases: SkillsetExternalFixtureReportPayload["phases"];
  readonly pipelinePassed: boolean;
  readonly summaries: SkillsetExternalFixtureReportPayload["summaries"];
}): string {
  const lines = [
    `# External fixture evidence: ${evidence.fixture.name}`,
    "",
    `- repository: ${evidence.fixture.repository}`,
    `- pinned commit: ${evidence.fixture.pinnedCommit}`,
    `- result: ${evidence.pipelinePassed ? "pass" : "fail"}`,
    "",
    "## Phases",
    "",
  ];
  for (const [name, phase] of Object.entries(evidence.phases)) {
    lines.push(`- ${name}: ${phase.status} (${phase.exitClass})`);
  }
  lines.push(
    "",
    "## Summaries",
    "",
    `- survey candidates: ${evidence.summaries.surveyCandidates}`,
    `- imported units: ${evidence.summaries.importedUnits}`,
    `- migration flags: ${evidence.summaries.migrationFlags}`,
    `- comparison differences: ${evidence.summaries.comparisonDifferences}`,
    `- render results: ${evidence.summaries.renderResults.rendered} rendered, ${evidence.summaries.renderResults.skipped} skipped, ${evidence.summaries.renderResults.unsupported} unsupported, ${evidence.summaries.renderResults.failed} failed`
  );
  return `${lines.join("\n")}\n`;
}

async function gitOutput(
  cwd: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", cwd, ...args],
    env: gitSafeEnv(env),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}\n${stdout}${stderr}`.trim()
    );
  }
  return stdout;
}
