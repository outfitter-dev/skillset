export const STALE_RELEASE_RUN_MINUTES = 60;

export interface ReleaseRun {
  readonly id: number;
  readonly html_url: string;
  readonly created_at: string;
  readonly status: string;
  readonly event: string;
  readonly head_branch: string;
}

export interface ReleaseGate {
  readonly name: string;
  readonly url?: string;
  readonly reviewers: readonly {
    readonly name: string;
    readonly url?: string;
  }[];
}

export interface ReleaseObservation {
  readonly run: ReleaseRun;
  readonly jobCount: number;
  readonly gates: readonly ReleaseGate[];
}

export interface ReleaseWaitReport {
  readonly exitCode: 0 | 1 | 2;
  readonly markdown: string;
}

const text = (value: string): string => value.replace(/[\r\n|`<>\[\]]/g, " ");
const link = (label: string, url?: string): string =>
  url?.startsWith("https://github.com/")
    ? `[${text(label)}](${url.replace(/[()\s]/g, encodeURIComponent)})`
    : text(label);

export function releaseWaitReport(
  observations: readonly ReleaseObservation[],
  now: number,
  unavailable?: string
): ReleaseWaitReport {
  const lines = [
    "# Release wait diagnostic",
    "",
    "This read-only diagnostic does not approve, cancel, or block Release. Run age is measured from creation, not from the start of an approval wait.",
    "",
  ];
  if (unavailable) {
    lines.push(
      `**Evidence unavailable:** ${text(unavailable)}`,
      "",
      "No healthy-state or concurrency-cause conclusion can be drawn. Retry this diagnostic or use the read-only commands below."
    );
  } else if (observations.length === 0) {
    lines.push("No active main-branch Release runs were observed.");
  }
  let stale = false;
  for (const observation of observations) {
    const { run, gates, jobCount } = observation;
    const age = Math.max(
      0,
      Math.floor((now - Date.parse(run.created_at)) / 60_000)
    );
    const zeroJobQueue =
      jobCount === 0 && ["requested", "queued", "pending"].includes(run.status);
    const waiting =
      gates.length > 0 || zeroJobQueue || run.status === "waiting";
    const isStale = waiting && age >= STALE_RELEASE_RUN_MINUTES;
    stale ||= isStale;
    lines.push(
      "",
      `## ${link(`Run ${run.id}`, run.html_url)}${isStale ? " — attention needed" : ""}`,
      "",
      `Status: ${text(run.status)} (${text(run.event)}). Created ${age} minutes ago. Observed jobs: ${jobCount}.`
    );
    if (gates.length > 0) {
      lines.push(
        "",
        "Environment protection is pending. Approval wait duration is unavailable; the age above is the age of the run."
      );
      for (const gate of gates) {
        const reviewers = gate.reviewers
          .map((reviewer) => link(reviewer.name, reviewer.url))
          .join(", ");
        lines.push(
          `- Gate: ${link(gate.name, gate.url)}. Eligible reviewers: ${reviewers || "not supplied by GitHub"}. Open the run to inspect or review its protection rules.`
        );
      }
    } else if (zeroJobQueue) {
      const candidate = observations.find(
        (other) =>
          other.gates.length > 0 &&
          other.run.head_branch === run.head_branch &&
          Date.parse(other.run.created_at) <= Date.parse(run.created_at)
      );
      lines.push(
        "",
        candidate
          ? `The zero-job queue and older gated ${link(`run ${candidate.run.id}`, candidate.run.html_url)} are consistent with workflow-level serialization holding later runs. GitHub does not expose lock ownership here; the cause is not confirmed.`
          : "No jobs have instantiated. The cause is unknown; no older approval-gated run corroborates a held Release concurrency group."
      );
    } else if (run.status === "waiting") {
      lines.push(
        "",
        "GitHub reports waiting, but no pending environment was returned. The wait cause is unknown."
      );
    } else {
      lines.push(
        "",
        "Release work is active or queued for a runner; no pending environment gate or zero-job concurrency queue was observed. The execution phase is not inferred."
      );
    }
  }
  lines.push(
    "",
    `A currently waiting run aged at least ${STALE_RELEASE_RUN_MINUTES} minutes fails this diagnostic. This allows normal setup/operator response while exposing prolonged approval or queue conditions. A long build followed by a new approval wait can also meet this threshold; inspect the linked run.`,
    "",
    "## Read-only investigation",
    "",
    "```bash",
    "for status in requested queued pending in_progress waiting; do",
    '  gh api --paginate "repos/outfitter-dev/skillset/actions/workflows/release.yml/runs?branch=main&status=$status&per_page=100"',
    "done",
    "gh api --paginate 'repos/outfitter-dev/skillset/actions/runs/RUN_ID/jobs?filter=latest&per_page=100'",
    "gh api repos/outfitter-dev/skillset/actions/runs/RUN_ID/pending_deployments",
    "```",
    "",
    "Review the named gate using the linked run. Any approval, cancellation, or release recovery remains a separate maintainer decision.",
    ""
  );
  return {
    exitCode: unavailable ? 2 : stale ? 1 : 0,
    markdown: lines.join("\n"),
  };
}
