import {
  assessProviderValidationFreshness,
  listProviderValidationLanes,
} from "../packages/registry/src/provider-validation";
import type {
  ProviderValidationFreshnessStatus,
  ProviderValidationLane,
  ProviderValidationLaneId,
} from "../packages/registry/src/provider-validation";

export type ProviderValidationUpstreamStatus =
  | "changed"
  | "current"
  | "refresh-failed";

export interface ProviderValidationUpstreamResult {
  readonly checkedAt: string;
  readonly error?: string;
  readonly freshness: ProviderValidationFreshnessStatus;
  readonly lane: ProviderValidationLaneId;
  readonly registryPin: string;
  readonly status: ProviderValidationUpstreamStatus;
  readonly upstreamPin?: string;
}

export interface ProviderValidationUpstreamReport {
  readonly checkedAt: string;
  readonly ok: boolean;
  readonly results: readonly ProviderValidationUpstreamResult[];
}

interface UpstreamResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  text(): Promise<string>;
}

export type ProviderValidationUpstreamFetch = (
  url: string
) => Promise<UpstreamResponse>;

export async function checkProviderValidationUpstreams(
  checkedAt = new Date().toISOString(),
  fetcher: ProviderValidationUpstreamFetch = fetch
): Promise<ProviderValidationUpstreamReport> {
  const results = await Promise.all(
    listProviderValidationLanes().map((lane) =>
      checkProviderValidationUpstream(lane, checkedAt, fetcher)
    )
  );
  return {
    checkedAt,
    ok: results.every((result) => result.status === "current"),
    results,
  };
}

export function renderProviderValidationUpstreamReport(
  report: ProviderValidationUpstreamReport
): string {
  return `${[
    `skillset: checked provider validation upstreams at ${report.checkedAt}`,
    "| Lane | Registry pin | Upstream pin | Upstream | Validation evidence |",
    "| --- | --- | --- | --- | --- |",
    ...report.results.map(
      (result) =>
        `| ${result.lane} | ${result.registryPin} | ${result.upstreamPin ?? "unavailable"} | ${result.status} | ${result.freshness} |`
    ),
    ...report.results.flatMap((result) =>
      result.error === undefined ? [] : [`  ! ${result.lane}: ${result.error}`]
    ),
  ].join("\n")}\n`;
}

async function checkProviderValidationUpstream(
  lane: ProviderValidationLane,
  checkedAt: string,
  fetcher: ProviderValidationUpstreamFetch
): Promise<ProviderValidationUpstreamResult> {
  try {
    const upstreamPin = await resolveUpstreamPin(lane.id, fetcher);
    const freshness = assessProviderValidationFreshness(lane, checkedAt, {
      upstreamPin,
    }).status;
    return {
      checkedAt,
      freshness,
      lane: lane.id,
      registryPin: lane.pin,
      status: upstreamPin === lane.pin ? "current" : "changed",
      upstreamPin,
    };
  } catch (error) {
    return {
      checkedAt,
      error: message(error),
      freshness: assessProviderValidationFreshness(lane, checkedAt, {
        error: message(error),
      }).status,
      lane: lane.id,
      registryPin: lane.pin,
      status: "refresh-failed",
    };
  }
}

async function resolveUpstreamPin(
  lane: ProviderValidationLaneId,
  fetcher: ProviderValidationUpstreamFetch
): Promise<string> {
  switch (lane) {
    case "claude-product": {
      const value = await fetchJson(
        "https://registry.npmjs.org/@anthropic-ai/claude-code/latest",
        fetcher
      );
      const version = readString(value, "version");
      return `@anthropic-ai/claude-code@${version}`;
    }
    case "codex-authoring": {
      const release = await fetchJson(
        "https://api.github.com/repos/openai/codex/releases/latest",
        fetcher
      );
      const tag = readString(release, "tag_name");
      const commit = await fetchJson(
        `https://api.github.com/repos/openai/codex/commits/${encodeURIComponent(tag)}`,
        fetcher
      );
      return readCommitSha(commit);
    }
    case "cursor-authoring":
      return readCommitSha(
        await fetchJson(
          "https://api.github.com/repos/cursor/plugins/commits/main",
          fetcher
        )
      );
    case "agent-skills-reference":
      return readCommitSha(
        await fetchJson(
          "https://api.github.com/repos/agentskills/agentskills/commits/main",
          fetcher
        )
      );
  }
}

async function fetchJson(
  url: string,
  fetcher: ProviderValidationUpstreamFetch
): Promise<Record<string, unknown>> {
  const response = await fetcher(url);
  if (!response.ok)
    throw new Error(`${url}: ${response.status} ${response.statusText}`);
  const value: unknown = JSON.parse(await response.text());
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${url}: expected a JSON object`);
  return value as Record<string, unknown>;
}

function readCommitSha(value: Record<string, unknown>): string {
  const sha = readString(value, "sha");
  if (!/^[a-f0-9]{40}$/u.test(sha))
    throw new Error(`invalid upstream commit ${sha}`);
  return sha;
}

function readString(value: Record<string, unknown>, key: string): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.length === 0)
    throw new Error(`upstream response requires ${key}`);
  return candidate;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(args: readonly string[]): Promise<void> {
  if (args.length !== 1 || args[0] !== "check")
    throw new Error("skillset: expected provider-validation-maintenance check");
  const report = await checkProviderValidationUpstreams();
  process.stdout.write(renderProviderValidationUpstreamReport(report));
  if (!report.ok) process.exitCode = 1;
}

if (import.meta.main) await main(process.argv.slice(2));
