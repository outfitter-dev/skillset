import { expect, test } from "bun:test";

import {
  collectReleaseWaits,
  diagnoseReleaseWaits,
  type GitHubRead,
} from "../release-wait-diagnostic";
import {
  releaseWaitReport,
  type ReleaseObservation,
  type ReleaseRun,
} from "../release-wait-state";

const repository = "outfitter-dev/skillset";
const base = `repos/${repository}/actions`;
const now = Date.parse("2026-09-07T20:00:00Z");
function run(id = 1, status = "waiting", age = 70): ReleaseRun {
  return {
    id,
    status,
    event: "push",
    head_branch: "main",
    created_at: new Date(now - age * 60_000).toISOString(),
    html_url: `https://github.com/${repository}/actions/runs/${id}`,
  };
}
const gate = {
  name: "npm",
  url: `https://github.com/${repository}/settings/environments/1`,
  reviewers: [
    {
      name: "release-team",
      url: "https://github.com/orgs/outfitter-dev/teams/release-team",
    },
  ],
};
function observation(status = "waiting", age = 70): ReleaseObservation {
  return {
    run: run(1, status, age),
    jobCount: 3,
    gates: status === "waiting" ? [gate] : [],
  };
}

test("idle and ordinary active release work remain healthy regardless of run age", () => {
  expect(releaseWaitReport([], now).exitCode).toBe(0);
  const report = releaseWaitReport([observation("in_progress", 180)], now);
  expect(report.exitCode).toBe(0);
  expect(report.markdown).toContain("execution phase is not inferred");
});

test("a short intentional gate is visible without a failure", () => {
  const report = releaseWaitReport([observation("waiting", 10)], now);
  expect(report.exitCode).toBe(0);
  expect(report.markdown).toContain("Created 10 minutes ago");
  expect(report.markdown).toContain("Eligible reviewers: [release-team]");
});

test("stale environment gates use run age without inventing approval duration", () => {
  const report = releaseWaitReport([observation()], now);
  expect(report.exitCode).toBe(1);
  expect(report.markdown).toContain("Created 70 minutes ago");
  expect(report.markdown).toContain("Approval wait duration is unavailable");
  expect(report.markdown).toContain(gate.url);
  expect(report.markdown).not.toContain("waiting for 70 minutes");
});

test("zero-job queues corroborate only a possible older gated holder", () => {
  const queued = { run: run(2, "pending", 65), jobCount: 0, gates: [] };
  const paired = releaseWaitReport([observation(), queued], now);
  expect(paired.exitCode).toBe(1);
  expect(paired.markdown).toContain(
    "consistent with workflow-level serialization"
  );
  expect(paired.markdown).toContain("cause is not confirmed");
  const unknown = releaseWaitReport([queued], now);
  expect(unknown.markdown).toContain("cause is unknown");
  expect(unknown.markdown).not.toContain(
    "consistent with workflow-level serialization"
  );
  expect(releaseWaitReport([{ ...queued, jobCount: 1 }], now).exitCode).toBe(0);
});

test("waiting without gate evidence stays unknown and stale", () => {
  const report = releaseWaitReport([{ ...observation(), gates: [] }], now);
  expect(report.exitCode).toBe(1);
  expect(report.markdown).toContain("no pending environment was returned");
});

function apiFixture(
  runs: ReleaseRun[],
  options: { gate?: boolean; jobs?: number } = {}
) {
  const calls: string[] = [];
  const api: GitHubRead = async (path) => {
    calls.push(path);
    if (path.includes("/workflows/")) {
      const status = new URL(`https://api.github.com/${path}`).searchParams.get(
        "status"
      );
      const selected = runs.filter((run) => run.status === status);
      return selected.length > 100
        ? [
            {
              total_count: selected.length,
              workflow_runs: selected.slice(0, 100),
            },
            {
              total_count: selected.length,
              workflow_runs: selected.slice(100),
            },
          ]
        : [{ total_count: selected.length, workflow_runs: selected }];
    }
    if (path.includes("/jobs?"))
      return [
        {
          total_count: options.jobs ?? 0,
          jobs: Array(options.jobs ?? 0).fill({}),
        },
      ];
    if (path.endsWith("/pending_deployments"))
      return options.gate
        ? [
            {
              environment: { name: gate.name, html_url: gate.url },
              reviewers: [
                {
                  reviewer: {
                    slug: gate.reviewers[0]!.name,
                    html_url: gate.reviewers[0]!.url,
                  },
                },
              ],
            },
          ]
        : [];
    return runs.find((run) => path === `${base}/runs/${run.id}`);
  };
  return { api, calls };
}

test("queries every active status and reads gate/reviewer evidence", async () => {
  const fixture = apiFixture([run()], { gate: true, jobs: 3 });
  const report = await diagnoseReleaseWaits(fixture.api, repository, now);
  expect(report.exitCode).toBe(1);
  expect(report.markdown).toContain("release-team");
  expect(
    fixture.calls.filter((path) => path.includes("/workflows/"))
  ).toHaveLength(5);
  expect(
    fixture.calls.some((path) => path.includes("branch=main&status=pending"))
  ).toBe(true);
});

test("status-specific pagination retains more than 100 old active runs", async () => {
  const fixture = apiFixture(
    Array.from({ length: 101 }, (_, i) => run(i + 1, "pending"))
  );
  expect(await collectReleaseWaits(fixture.api, repository)).toHaveLength(101);
});

test("a run completing between enumeration and observation is omitted", async () => {
  const fixture = apiFixture([run()]);
  const api: GitHubRead = (path) =>
    path === `${base}/runs/1`
      ? Promise.resolve(run(1, "completed"))
      : fixture.api(path);
  expect((await diagnoseReleaseWaits(api, repository, now)).exitCode).toBe(0);
});

test("deduplicates transitions across status queries and rejects unstable observation", async () => {
  const fixture = apiFixture([run()]);
  let details = 0;
  const api: GitHubRead = async (path) => {
    if (path.includes("status=pending"))
      return [{ total_count: 1, workflow_runs: [run(1, "pending")] }];
    if (path === `${base}/runs/1`)
      return run(1, details++ === 0 ? "waiting" : "in_progress");
    return fixture.api(path);
  };
  const report = await diagnoseReleaseWaits(api, repository, now);
  expect(report.exitCode).toBe(2);
  expect(details).toBe(2);
  expect(report.markdown).toContain("changed status during observation");
});

test("API errors and incomplete pagination are unavailable, never healthy or a lock diagnosis", async () => {
  const cases: GitHubRead[] = [
    async () => {
      throw new Error("API unavailable");
    },
    async () => [{ total_count: 1001, workflow_runs: [run()] }],
    async () => [{ total_count: 2, workflow_runs: [run()] }],
    async () => [
      { total_count: 1, workflow_runs: [{ ...run(), created_at: "invalid" }] },
    ],
    async () => [],
  ];
  for (const api of cases) {
    const report = await diagnoseReleaseWaits(api, repository, now);
    expect(report.exitCode).toBe(2);
    expect(report.markdown).toContain("Evidence unavailable");
    expect(report.markdown).not.toContain("No active main-branch");
    expect(report.markdown).not.toContain(
      "consistent with workflow-level serialization"
    );
  }
});

test("PR syntax-validation runs do not masquerade as the main Release concurrency group", async () => {
  const fixture = apiFixture([{ ...run(), event: "pull_request" }]);
  expect(await collectReleaseWaits(fixture.api, repository)).toHaveLength(0);
});

test("duplicate rows within one status cannot hide a missing run", async () => {
  const api: GitHubRead = async () => [
    { total_count: 2, workflow_runs: [run(), run()] },
  ];
  const report = await diagnoseReleaseWaits(api, repository, now);
  expect(report.exitCode).toBe(2);
  expect(report.markdown).toContain("pagination duplicated run");
});

test("same-status job or gate changes invalidate the observation", async () => {
  for (const changed of ["jobs", "gates"]) {
    const fixture = apiFixture([run(1, "pending")]);
    let reads = 0;
    const api: GitHubRead = async (path) => {
      if (changed === "jobs" && path.includes("/jobs?")) {
        const count = reads++ === 0 ? 0 : 1;
        return [{ total_count: count, jobs: Array(count).fill({}) }];
      }
      if (changed === "gates" && path.endsWith("pending_deployments"))
        return reads++ === 0
          ? []
          : [{ environment: { name: "npm" }, reviewers: [] }];
      return fixture.api(path);
    };
    const report = await diagnoseReleaseWaits(api, repository, now);
    expect(report.exitCode).toBe(2);
    expect(report.markdown).toContain(
      "jobs or gates changed during observation"
    );
  }
});
