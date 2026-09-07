import { appendFile } from "node:fs/promises";

import {
  releaseWaitReport,
  type ReleaseGate,
  type ReleaseObservation,
  type ReleaseRun,
  type ReleaseWaitReport,
} from "./release-wait-state";

export type GitHubRead = (path: string, paginate?: boolean) => Promise<unknown>;
const statuses = ["requested", "queued", "pending", "in_progress", "waiting"];

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("GitHub returned a malformed object");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error("GitHub omitted required text evidence");
  return value;
}
function runEvidence(value: unknown): ReleaseRun {
  const run = object(value);
  if (
    !Number.isSafeInteger(run.id) ||
    Number(run.id) <= 0 ||
    !Number.isFinite(Date.parse(string(run.created_at)))
  )
    throw new Error("GitHub returned invalid run identity or age evidence");
  return {
    id: Number(run.id),
    created_at: string(run.created_at),
    status: string(run.status),
    event: string(run.event),
    html_url: string(run.html_url),
    head_branch: string(run.head_branch),
  };
}
function collection(value: unknown, key: string, cap?: number): unknown[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("GitHub pagination evidence is unavailable");
  const entries: unknown[] = [];
  const counts: number[] = [];
  for (const pageValue of value) {
    const page = object(pageValue);
    if (
      !Array.isArray(page[key]) ||
      !Number.isSafeInteger(page.total_count) ||
      Number(page.total_count) < 0
    )
      throw new Error(`GitHub returned malformed ${key} pagination`);
    counts.push(Number(page.total_count));
    entries.push(...page[key]);
  }
  if (
    (cap !== undefined && counts.some((count) => count > cap)) ||
    counts.some((count) => count !== entries.length)
  )
    throw new Error(
      `GitHub ${key} results were truncated or changed during pagination`
    );
  return entries;
}
function gatesEvidence(value: unknown): ReleaseGate[] {
  if (!Array.isArray(value))
    throw new Error("Pending deployment evidence is unavailable");
  return value.map((entry) => {
    const pending = object(entry);
    const environment = object(pending.environment);
    if (!Array.isArray(pending.reviewers))
      throw new Error("Pending deployment reviewer evidence is unavailable");
    return {
      name: string(environment.name),
      ...(typeof environment.html_url === "string"
        ? { url: environment.html_url }
        : {}),
      reviewers: pending.reviewers.map((entry) => {
        const reviewer = object(object(entry).reviewer);
        return {
          name: string(reviewer.login ?? reviewer.slug ?? reviewer.name),
          ...(typeof reviewer.html_url === "string"
            ? { url: reviewer.html_url }
            : {}),
        };
      }),
    };
  });
}

async function readRunWaitEvidence(api: GitHubRead, path: string) {
  const [jobs, deployments] = await Promise.all([
    api(`${path}/jobs?filter=latest&per_page=100`, true),
    api(`${path}/pending_deployments`),
  ]);
  const gates = gatesEvidence(deployments)
    .map((gate) => ({
      ...gate,
      reviewers: [...gate.reviewers].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { jobCount: collection(jobs, "jobs").length, gates };
}

export async function collectReleaseWaits(
  api: GitHubRead,
  repository: string
): Promise<ReleaseObservation[]> {
  if (repository !== "outfitter-dev/skillset")
    throw new Error(
      "Release wait diagnostic is scoped to outfitter-dev/skillset"
    );
  const base = `repos/${repository}/actions`;
  const runs = new Map<number, ReleaseRun>();
  for (const status of statuses) {
    const pages = await api(
      `${base}/workflows/release.yml/runs?branch=main&status=${status}&per_page=100`,
      true
    );
    const statusIds = new Set<number>();
    for (const value of collection(pages, "workflow_runs", 1000)) {
      const run = runEvidence(value);
      if (statusIds.has(run.id))
        throw new Error(
          `GitHub ${status} pagination duplicated run ${run.id}; results changed during enumeration`
        );
      statusIds.add(run.id);
      if (run.head_branch === "main" && run.event !== "pull_request")
        runs.set(run.id, run);
    }
  }
  const observations: ReleaseObservation[] = [];
  for (const listed of runs.values()) {
    const path = `${base}/runs/${listed.id}`;
    const current = runEvidence(await api(path));
    if (current.status === "completed" || current.event === "pull_request")
      continue;
    if (!statuses.includes(current.status) || current.head_branch !== "main")
      throw new Error(`Run ${listed.id} returned unexpected active state`);
    const firstEvidence = await readRunWaitEvidence(api, path);
    const evidence = await readRunWaitEvidence(api, path);
    const final = runEvidence(await api(path));
    if (final.status === "completed") continue;
    if (
      final.id !== listed.id ||
      final.head_branch !== "main" ||
      final.event !== current.event
    )
      throw new Error(`Run ${listed.id} changed identity during observation`);
    if (final.status !== current.status)
      throw new Error(
        `Run ${listed.id} changed status during observation; retry the diagnostic`
      );
    if (JSON.stringify(firstEvidence) !== JSON.stringify(evidence))
      throw new Error(
        `Run ${listed.id} jobs or gates changed during observation; retry the diagnostic`
      );
    observations.push({ run: final, ...evidence });
  }
  return observations.sort(
    (a, b) => Date.parse(a.run.created_at) - Date.parse(b.run.created_at)
  );
}

export async function diagnoseReleaseWaits(
  api: GitHubRead,
  repository: string,
  now = Date.now()
): Promise<ReleaseWaitReport> {
  try {
    return releaseWaitReport(await collectReleaseWaits(api, repository), now);
  } catch (error) {
    return releaseWaitReport(
      [],
      now,
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function ghRead(path: string, paginate = false): Promise<unknown> {
  const child = Bun.spawn(
    ["gh", "api", ...(paginate ? ["--paginate", "--slurp"] : []), path],
    { stdout: "pipe", stderr: "pipe", timeout: 30_000 }
  );
  const [code, stdout] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0)
    throw new Error(
      `GitHub read failed (${code}) for ${path}; check Actions read access and API availability`
    );
  return JSON.parse(stdout);
}

if (import.meta.main) {
  const report = await diagnoseReleaseWaits(
    ghRead,
    process.env.GITHUB_REPOSITORY ?? "outfitter-dev/skillset"
  );
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, report.markdown);
  process.stdout.write(report.markdown);
  if (report.exitCode !== 0 && process.env.GITHUB_ACTIONS === "true")
    console.error(
      `::error::Release wait diagnostic ${report.exitCode === 2 ? "evidence unavailable" : "needs maintainer attention"}; see the job summary. Release has not been approved or cancelled.`
    );
  process.exitCode = report.exitCode;
}
