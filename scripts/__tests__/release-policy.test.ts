import { describe, expect, test } from "bun:test";

import {
  type GitHubCheckRunsResponse,
  type ReleasePolicyInput,
  ciStateFromCheckRuns,
  evaluateReleasePolicy,
  shouldReadExactShaCi,
} from "../release-policy";
import { distTagForVersion } from "../publish";

const baseInput = (
  labels: readonly string[],
  overrides: Partial<ReleasePolicyInput> = {}
): ReleasePolicyInput => ({
  changelogText: "# Changelog\n\n## 0.13.4\n\n### Patch Changes\n",
  changedFiles: [
    { path: ".changeset/example.md", status: "D" },
    { path: "apps/skillset/CHANGELOG.md", status: "M" },
    { path: "apps/skillset/package.json", status: "M" },
  ],
  ciPassed: true,
  commit: {
    authorEmail: "41898282+github-actions[bot]@users.noreply.github.com",
    authorName: "github-actions[bot]",
    committerEmail: "noreply@github.com",
    committerName: "GitHub",
    subject: "chore(release): version packages (#96)",
  },
  packageName: "skillset",
  previousVersion: "0.13.3",
  published: false,
  ref: "refs/heads/main",
  registryComplete: false,
  releasePullRequest: {
    baseRefName: "main",
    body: "",
    comments: [],
    headRefName: "changeset-release/main",
    labels,
    number: 96,
    title: "chore(release): version packages",
    userLogin: "github-actions[bot]",
  },
  repository: "outfitter-dev/skillset",
  sha: "b25a221f4ddc98a7ab5def2c88e67f63e456e40e",
  sourcePullRequests: [
    {
      commitShas: ["26b2c3a"],
      hasChangeset: true,
      labels: ["stack:boundary"],
      number: 95,
      title: "fix(changes): report stacked change evidence",
    },
  ],
  tag: "latest",
  taggedVersion: "0.13.3",
  version: "0.13.4",
  ...overrides,
});

describe("release policy", () => {
  test("routes a generated stable release to auto when publish:auto is set", () => {
    const report = evaluateReleasePolicy(
      baseInput(["publish:auto", "channel:stable", "release:patch"])
    );

    expect(report.decision).toBe("auto");
    expect(report.autoEligible).toBe(true);
    expect(report.shouldPublish).toBe(true);
    expect(report.createGitHubRelease).toBe(true);
    expect(report.diagnostics).toEqual([]);
    expect(report.stack).toBe("stack:boundary");
  });

  test("defaults to manual when no publish intent is set", () => {
    const report = evaluateReleasePolicy(baseInput(["channel:stable"]));

    expect(report.decision).toBe("manual");
    expect(report.shouldPublish).toBe(true);
    expect(report.reasons).toContain("No publish:* label is set; routing to manual approval");
  });

  test("blocks explicit publish:block", () => {
    const report = evaluateReleasePolicy(baseInput(["publish:block", "channel:stable"]));

    expect(report.decision).toBe("block");
    expect(report.shouldPublish).toBe(false);
    expect(report.blockers).toContain("publish:block is set");
  });

  test("blocks conflicting label families", () => {
    const report = evaluateReleasePolicy(
      baseInput(["publish:auto", "publish:manual", "channel:stable"])
    );

    expect(report.decision).toBe("block");
    expect(report.blockers).toEqual([
      "Conflicting publish: labels: publish:auto, publish:manual",
    ]);
  });

  test("blocks unknown labels within policy families", () => {
    const report = evaluateReleasePolicy(
      baseInput(["publish:auto", "channel:stable", "release:tiny"])
    );

    expect(report.decision).toBe("block");
    expect(report.blockers).toEqual(["Unknown release: label: release:tiny"]);
  });

  test("allows publish:none only with an audit reason", () => {
    const missingReason = evaluateReleasePolicy(baseInput(["publish:none"]));
    expect(missingReason.decision).toBe("block");
    expect(missingReason.blockers).toContain(
      "publish:none requires an audit reason in the release PR body or comments"
    );

    const withReason = evaluateReleasePolicy(
      baseInput(["publish:none"], {
        releasePullRequest: {
          ...baseInput(["publish:none"]).releasePullRequest!,
          body: "publish:none because this version records intentionally skipped package state.",
        },
      })
    );
    expect(withReason.decision).toBe("none");
    expect(withReason.shouldPublish).toBe(false);
    expect(withReason.createGitHubRelease).toBe(false);
  });

  test("routes publish:auto to manual when channel is not stable", () => {
    const report = evaluateReleasePolicy(baseInput(["publish:auto", "channel:canary"]));

    expect(report.decision).toBe("manual");
    expect(report.diagnostics).toContain("publish:auto requires channel:stable in v1");
  });

  test("routes publish:auto to manual when source stack evidence is missing", () => {
    const input = baseInput(["publish:auto", "channel:stable", "release:patch"]);
    delete input.sourcePullRequests;

    const report = evaluateReleasePolicy(input);

    expect(report.decision).toBe("manual");
    expect(report.diagnostics).toContain(
      "Could not resolve source PR stack evidence for the generated release"
    );
  });

  test("routes publish:auto to manual when changeset source PRs lack stack boundary evidence", () => {
    const report = evaluateReleasePolicy(
      baseInput(["publish:auto", "channel:stable", "release:patch"], {
        sourcePullRequests: [
          {
            commitShas: ["26b2c3a"],
            hasChangeset: true,
            labels: [],
            number: 95,
            title: "fix(changes): report stacked change evidence",
          },
        ],
      })
    );

    expect(report.decision).toBe("manual");
    expect(report.diagnostics).toContain(
      "publish:auto requires stack:boundary on every changeset source PR in the release range; missing: #95"
    );
  });

  test("routes publish:auto to manual when an unrelated source PR has the boundary", () => {
    const report = evaluateReleasePolicy(
      baseInput(["publish:auto", "channel:stable", "release:patch"], {
        sourcePullRequests: [
          {
            commitShas: ["26b2c3a"],
            hasChangeset: true,
            labels: [],
            number: 95,
            title: "fix(changes): report stacked change evidence",
          },
          {
            commitShas: ["9c38db3"],
            hasChangeset: false,
            labels: ["stack:boundary"],
            number: 97,
            title: "ci(release): gate automatic npm publishes",
          },
        ],
      })
    );

    expect(report.decision).toBe("manual");
    expect(report.diagnostics).toContain(
      "publish:auto requires stack:boundary on every changeset source PR in the release range; missing: #95"
    );
  });

  test("blocks unknown stack labels on source PRs", () => {
    const report = evaluateReleasePolicy(
      baseInput(["publish:auto", "channel:stable", "release:patch"], {
        sourcePullRequests: [
          {
            commitShas: ["26b2c3a"],
            hasChangeset: true,
            labels: ["stack:top"],
            number: 95,
            title: "fix(changes): report stacked change evidence",
          },
        ],
      })
    );

    expect(report.decision).toBe("block");
    expect(report.blockers).toEqual(["Unknown stack: label: stack:top on #95"]);
  });

  test("routes publish:auto to manual when release shape touches workflow files", () => {
    const report = evaluateReleasePolicy(
      baseInput(["publish:auto", "channel:stable"], {
        changedFiles: [
          { path: ".changeset/example.md", status: "D" },
          { path: ".github/workflows/release.yml", status: "M" },
          { path: "apps/skillset/CHANGELOG.md", status: "M" },
          { path: "apps/skillset/package.json", status: "M" },
        ],
      })
    );

    expect(report.decision).toBe("manual");
    expect(report.diagnostics).toContain(
      "Unexpected release diff entry: M .github/workflows/release.yml"
    );
  });

  test("routes publish:auto to manual when release intent mismatches the version delta", () => {
    const report = evaluateReleasePolicy(
      baseInput(["publish:auto", "channel:stable", "release:minor"])
    );

    expect(report.decision).toBe("manual");
    expect(report.diagnostics).toContain(
      "release:minor is set, but 0.13.3 -> 0.13.4 looks like release:patch"
    );
  });

  test("routes publish:auto to manual when the version delta is missing or non-positive", () => {
    const inputWithMissingPrevious = baseInput(["publish:auto", "channel:stable"]);
    delete inputWithMissingPrevious.previousVersion;
    const missingPrevious = evaluateReleasePolicy(
      inputWithMissingPrevious
    );
    expect(missingPrevious.decision).toBe("manual");
    expect(missingPrevious.diagnostics).toContain(
      "Could not read previous apps/skillset/package.json version"
    );

    const sameVersion = evaluateReleasePolicy(
      baseInput(["publish:auto", "channel:stable"], {
        previousVersion: "0.13.4",
      })
    );
    expect(sameVersion.decision).toBe("manual");
    expect(sameVersion.diagnostics).toContain(
      "Expected 0.13.4 to be newer than previous version 0.13.4"
    );
  });

  test("routes publish:auto to manual until exact-SHA CI has passed", () => {
    const report = evaluateReleasePolicy(
      baseInput(["publish:auto", "channel:stable"], { ciPassed: false })
    );

    expect(report.decision).toBe("manual");
    expect(report.diagnostics).toContain("Exact-SHA CI checks have not passed");
  });
});

describe("npm dist-tag derivation", () => {
  test("uses latest for stable versions and prerelease prefix for prereleases", () => {
    expect(distTagForVersion("0.13.4")).toBe("latest");
    expect(distTagForVersion("0.14.0-beta.1")).toBe("beta");
    expect(distTagForVersion("0.14.0-canary.20260615")).toBe("canary");
  });
});

describe("release policy CI state", () => {
  const checkRuns = (
    runs: GitHubCheckRunsResponse["check_runs"]
  ): GitHubCheckRunsResponse => ({ check_runs: runs });
  const successRun = (name: string): GitHubCheckRunsResponse["check_runs"][number] => ({
    check_suite: {
      app: {
        slug: "github-actions",
      },
    },
    conclusion: "success",
    name,
    status: "completed",
  });
  const successRunWithTopLevelApp = (
    name: string
  ): GitHubCheckRunsResponse["check_runs"][number] => ({
    app: {
      slug: "github-actions",
    },
    conclusion: "success",
    name,
    status: "completed",
  });

  test("requires the named CI jobs to complete successfully", () => {
    expect(ciStateFromCheckRuns(checkRuns([successRun("check"), successRun("skillset-ci")]))).toBe(
      "passed"
    );
    expect(ciStateFromCheckRuns(checkRuns([successRun("check")]))).toBe("pending");
    expect(
      ciStateFromCheckRuns(
        checkRuns([
          successRun("check"),
          {
            ...successRun("skillset-ci"),
            conclusion: "skipped",
          },
        ])
      )
    ).toBe("failed");
  });

  test("accepts the live check-runs API shape with the app slug on the run", () => {
    expect(
      ciStateFromCheckRuns(
        checkRuns([successRunWithTopLevelApp("check"), successRunWithTopLevelApp("skillset-ci")])
      )
    ).toBe("passed");
  });

  test("skips exact-SHA CI polling when the registry already has the current version and tag", () => {
    expect(shouldReadExactShaCi(false)).toBe(true);
    expect(shouldReadExactShaCi(true)).toBe(false);
  });
});
