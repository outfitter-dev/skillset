import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { distTagForVersion, writeGitHubOutput } from "./publish";

type DistTags = Record<string, string | undefined>;

type RegistryDocument = {
  "dist-tags"?: DistTags;
  versions?: Record<string, unknown>;
};

type PackageJson = {
  name?: string;
  version?: string;
};

export type PublishIntent =
  | "publish:auto"
  | "publish:block"
  | "publish:manual"
  | "publish:none";
export type ChannelIntent = "channel:canary" | "channel:preview" | "channel:stable";
export type ReleaseIntent = "release:major" | "release:minor" | "release:patch";
export type ReleasePolicyDecision = "auto" | "block" | "manual" | "none";

export type ChangedFile = {
  path: string;
  status: string;
};

export type ReleasePullRequest = {
  baseRefName: string;
  body: string;
  comments: readonly string[];
  headRefName: string;
  labels: readonly string[];
  number: number;
  title: string;
  userLogin: string;
};

export type CommitInfo = {
  authorEmail: string;
  authorName: string;
  committerEmail: string;
  committerName: string;
  subject: string;
};

export type ReleasePolicyInput = {
  changelogText: string;
  changedFiles: readonly ChangedFile[];
  ciPassed: boolean;
  commit: CommitInfo;
  packageName: string;
  published: boolean;
  ref: string;
  registryComplete: boolean;
  repository: string;
  releasePullRequest?: ReleasePullRequest;
  sha: string;
  tag: string;
  taggedVersion?: string;
  version: string;
  previousVersion?: string;
};

export type ReleasePolicyReport = {
  autoEligible: boolean;
  blockers: readonly string[];
  channel: ChannelIntent | undefined;
  createGitHubRelease: boolean;
  decision: ReleasePolicyDecision;
  diagnostics: readonly string[];
  publish: PublishIntent | undefined;
  reasons: readonly string[];
  release: ReleaseIntent | undefined;
  shouldPublish: boolean;
};

type FamilyResult<T extends string> = {
  conflicts: readonly string[];
  unknown: readonly string[];
  value?: T;
};

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packageDir = join(rootDir, "apps", "skillset");
const packageJsonPath = join(packageDir, "package.json");
const changelogPath = join(packageDir, "CHANGELOG.md");
const registryUrl = "https://registry.npmjs.org";

const publishIntents = new Set<PublishIntent>([
  "publish:auto",
  "publish:block",
  "publish:manual",
  "publish:none",
]);
const channelIntents = new Set<ChannelIntent>([
  "channel:canary",
  "channel:preview",
  "channel:stable",
]);
const releaseIntents = new Set<ReleaseIntent>([
  "release:major",
  "release:minor",
  "release:patch",
]);

export function evaluateReleasePolicy(input: ReleasePolicyInput): ReleasePolicyReport {
  const labels = input.releasePullRequest?.labels ?? [];
  const publish = readLabelFamily(labels, "publish:", publishIntents);
  const channel = readLabelFamily(labels, "channel:", channelIntents);
  const release = readLabelFamily(labels, "release:", releaseIntents);
  const blockers = [
    ...publish.conflicts,
    ...channel.conflicts,
    ...release.conflicts,
    ...publish.unknown,
    ...channel.unknown,
    ...release.unknown,
  ];
  const diagnostics: string[] = [];
  const reasons: string[] = [];

  if (input.published && !input.registryComplete) {
    blockers.push(
      `${input.packageName}@${input.version} exists, but ${input.tag} points to ${input.taggedVersion ?? "nothing"}`
    );
  }

  if (publish.value === "publish:block") {
    blockers.push("publish:block is set");
  }

  if (blockers.length > 0) {
    return makeReport(input, {
      blockers,
      channel: channel.value,
      decision: "block",
      diagnostics,
      publish: publish.value,
      reasons,
      release: release.value,
    });
  }

  if (publish.value === "publish:none") {
    if (!hasPublishNoneReason(input.releasePullRequest)) {
      blockers.push("publish:none requires an audit reason in the release PR body or comments");
      return makeReport(input, {
        blockers,
        channel: channel.value,
        decision: "block",
        diagnostics,
        publish: publish.value,
        reasons,
        release: release.value,
      });
    }

    reasons.push("publish:none is set, so npm publish and GitHub release creation are skipped");
    return makeReport(input, {
      blockers,
      channel: channel.value,
      decision: "none",
      diagnostics,
      publish: publish.value,
      reasons,
      release: release.value,
    });
  }

  if (!publish.value) {
    reasons.push("No publish:* label is set; routing to manual approval");
    return makeReport(input, {
      blockers,
      channel: channel.value,
      decision: "manual",
      diagnostics,
      reasons,
      release: release.value,
    });
  }

  if (publish.value === "publish:manual") {
    reasons.push("publish:manual is set");
    return makeReport(input, {
      blockers,
      channel: channel.value,
      decision: "manual",
      diagnostics,
      publish: publish.value,
      reasons,
      release: release.value,
    });
  }

  const autoChecks = evaluateAutoChecks(input, channel.value, release.value);
  diagnostics.push(...autoChecks.diagnostics);

  if (!autoChecks.ok) {
    reasons.push("publish:auto requested, but one or more low-risk checks failed; routing to manual approval");
    return makeReport(input, {
      blockers,
      channel: channel.value,
      decision: "manual",
      diagnostics,
      publish: publish.value,
      reasons,
      release: release.value,
    });
  }

  reasons.push("publish:auto and channel:stable are set, and low-risk generated release checks passed");
  return makeReport(input, {
    autoEligible: true,
    blockers,
    channel: channel.value,
    decision: "auto",
    diagnostics,
    publish: publish.value,
    reasons,
    release: release.value,
  });
}

function makeReport(
  input: ReleasePolicyInput,
  options: {
    autoEligible?: boolean;
    blockers: readonly string[];
    channel: ChannelIntent | undefined;
    decision: ReleasePolicyDecision;
    diagnostics: readonly string[];
    publish?: PublishIntent | undefined;
    reasons: readonly string[];
    release: ReleaseIntent | undefined;
  }
): ReleasePolicyReport {
  const canPublish = options.decision === "auto" || options.decision === "manual";
  return {
    autoEligible: options.autoEligible ?? false,
    blockers: options.blockers,
    channel: options.channel,
    createGitHubRelease: canPublish,
    decision: options.decision,
    diagnostics: options.diagnostics,
    publish: options.publish,
    reasons: options.reasons,
    release: options.release,
    shouldPublish: canPublish && !input.published,
  };
}

function readLabelFamily<T extends string>(
  labels: readonly string[],
  prefix: string,
  allowed: ReadonlySet<T>
): FamilyResult<T> {
  const values = labels.filter((label) => label.startsWith(prefix));
  const known = values.filter((label): label is T => allowed.has(label as T));
  const unknown = values.filter((label) => !allowed.has(label as T));
  const result: { conflicts: string[]; unknown: string[]; value?: T } = {
    conflicts: [],
    unknown: unknown.map((label) => `Unknown ${prefix} label: ${label}`),
  };

  if (known.length > 1) {
    result.conflicts.push(`Conflicting ${prefix} labels: ${known.join(", ")}`);
    return result;
  }

  const [value] = known;
  if (value) result.value = value;
  return result;
}

function evaluateAutoChecks(
  input: ReleasePolicyInput,
  channel: ChannelIntent | undefined,
  release: ReleaseIntent | undefined
) {
  const diagnostics: string[] = [];
  const generatedDiff = evaluateGeneratedReleaseDiff(input.changedFiles);
  diagnostics.push(...generatedDiff.diagnostics);

  if (input.repository !== "outfitter-dev/skillset") {
    diagnostics.push(`Expected repository outfitter-dev/skillset, found ${input.repository}`);
  }

  if (input.ref !== "refs/heads/main") {
    diagnostics.push(`Expected refs/heads/main, found ${input.ref}`);
  }

  if (channel !== "channel:stable") {
    diagnostics.push("publish:auto requires channel:stable in v1");
  }

  if (input.tag !== "latest") {
    diagnostics.push(`channel:stable must publish with npm dist-tag latest, found ${input.tag}`);
  }

  if (!input.releasePullRequest) {
    diagnostics.push("Could not resolve the release pull request for the current commit");
  } else {
    if (input.releasePullRequest.headRefName !== "changeset-release/main") {
      diagnostics.push(`Expected release PR head changeset-release/main, found ${input.releasePullRequest.headRefName}`);
    }
    if (input.releasePullRequest.baseRefName !== "main") {
      diagnostics.push(`Expected release PR base main, found ${input.releasePullRequest.baseRefName}`);
    }
    if (input.releasePullRequest.title !== "chore(release): version packages") {
      diagnostics.push(`Expected release PR title "chore(release): version packages", found "${input.releasePullRequest.title}"`);
    }
    if (input.releasePullRequest.userLogin !== "github-actions[bot]") {
      diagnostics.push(`Expected release PR author github-actions[bot], found ${input.releasePullRequest.userLogin}`);
    }
  }

  if (!/^chore\(release\): version packages \(#\d+\)$/.test(input.commit.subject)) {
    diagnostics.push(`Expected squash commit subject chore(release): version packages (#<pr>), found "${input.commit.subject}"`);
  }

  if (!isGitHubActionsIdentity(input.commit.authorName, input.commit.authorEmail)) {
    diagnostics.push(`Expected GitHub Actions bot author, found ${input.commit.authorName} <${input.commit.authorEmail}>`);
  }

  if (!isGitHubCommitter(input.commit.committerName, input.commit.committerEmail)) {
    diagnostics.push(`Expected GitHub committer, found ${input.commit.committerName} <${input.commit.committerEmail}>`);
  }

  if (!hasChangelogHeading(input.changelogText, input.version)) {
    diagnostics.push(`apps/skillset/CHANGELOG.md does not contain a ${input.version} release heading`);
  }

  const expectedRelease = input.previousVersion
    ? releaseIntentForVersionDelta(input.previousVersion, input.version)
    : undefined;
  if (!input.previousVersion) {
    diagnostics.push("Could not read previous apps/skillset/package.json version");
  } else if (!expectedRelease) {
    diagnostics.push(`Expected ${input.version} to be newer than previous version ${input.previousVersion}`);
  } else if (release && expectedRelease !== release) {
    diagnostics.push(`${release} is set, but ${input.previousVersion} -> ${input.version} looks like ${expectedRelease}`);
  }

  if (input.taggedVersion && compareSemver(input.version, input.taggedVersion) <= 0 && !input.registryComplete) {
    diagnostics.push(
      `${input.packageName}@${input.version} is not newer than current ${input.tag} dist-tag ${input.taggedVersion}`
    );
  }

  if (!input.ciPassed) {
    diagnostics.push("Exact-SHA CI checks have not passed");
  }

  return { diagnostics, ok: diagnostics.length === 0 };
}

function evaluateGeneratedReleaseDiff(changedFiles: readonly ChangedFile[]) {
  const diagnostics: string[] = [];
  let hasPackageJson = false;
  let hasChangelog = false;
  let hasChangesetDeletion = false;

  for (const file of changedFiles) {
    if (file.path === "apps/skillset/package.json" && file.status === "M") {
      hasPackageJson = true;
      continue;
    }

    if (file.path === "apps/skillset/CHANGELOG.md" && file.status === "M") {
      hasChangelog = true;
      continue;
    }

    if (/^\.changeset\/[^/]+\.md$/.test(file.path) && file.status === "D") {
      hasChangesetDeletion = true;
      continue;
    }

    diagnostics.push(`Unexpected release diff entry: ${file.status} ${file.path}`);
  }

  if (!hasPackageJson) diagnostics.push("Generated release diff did not modify apps/skillset/package.json");
  if (!hasChangelog) diagnostics.push("Generated release diff did not modify apps/skillset/CHANGELOG.md");
  if (!hasChangesetDeletion) diagnostics.push("Generated release diff did not delete a consumed .changeset/*.md file");

  return { diagnostics, ok: diagnostics.length === 0 };
}

function hasPublishNoneReason(pr: ReleasePullRequest | undefined) {
  if (!pr) return false;
  const texts = [pr.body, ...pr.comments].map((text) => text.toLowerCase());
  return texts.some((text) => text.includes("publish:none") && /(because|intentional|reason|skip|no publish)/.test(text));
}

function isGitHubActionsIdentity(name: string, email: string) {
  return name === "github-actions[bot]" && email === "41898282+github-actions[bot]@users.noreply.github.com";
}

function isGitHubCommitter(name: string, email: string) {
  return name === "GitHub" && email === "noreply@github.com";
}

function hasChangelogHeading(changelog: string, version: string) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^##\\s+${escaped}(?:\\s|$)`, "m").test(changelog);
}

function releaseIntentForVersionDelta(previousVersion: string, nextVersion: string): ReleaseIntent | undefined {
  const previous = parseSemver(previousVersion);
  const next = parseSemver(nextVersion);
  if (!previous || !next) return undefined;
  if (compareSemver(nextVersion, previousVersion) <= 0) return undefined;
  if (next.major !== previous.major) return "release:major";
  if (next.minor !== previous.minor) return "release:minor";
  if (next.patch !== previous.patch || next.prerelease !== previous.prerelease) return "release:patch";
  return undefined;
}

function compareSemver(leftVersion: string, rightVersion: string) {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);
  if (!left || !right) return leftVersion.localeCompare(rightVersion);

  for (const key of ["major", "minor", "patch"] as const) {
    const delta = left[key] - right[key];
    if (delta !== 0) return delta;
  }

  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

function parseSemver(version: string) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return undefined;
  const [, major, minor, patch, prerelease] = match;
  if (!major || !minor || !patch) return undefined;
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
    prerelease,
  };
}

async function commandPolicy() {
  const input = await readPolicyInput();
  const report = evaluateReleasePolicy(input);

  printReport(report);
  await writeGitHubOutput({
    channel: report.channel ?? "",
    create_github_release: report.createGitHubRelease,
    decision: report.decision,
    name: input.packageName,
    publish: report.publish ?? "",
    registry_complete: input.registryComplete,
    release: report.release ?? "",
    should_publish: report.shouldPublish,
    tag: input.tag,
    version: input.version,
  });

  if (report.decision === "block") {
    throw new Error(`Release policy blocked publish: ${report.blockers.join("; ")}`);
  }
}

async function readPolicyInput(): Promise<ReleasePolicyInput> {
  const packageInfo = await readPackageInfo();
  const registry = await readRegistryState(packageInfo.name, packageInfo.version, packageInfo.tag);
  const repository = process.env.GITHUB_REPOSITORY ?? (await runText(["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]));
  const ref = process.env.GITHUB_REF ?? `refs/heads/${await runText(["git", "branch", "--show-current"])}`;
  const sha = process.env.GITHUB_SHA ?? (await runText(["git", "rev-parse", "HEAD"]));
  const [releasePullRequest, commit, changedFiles, previousVersion, changelogText, ciPassed] = await Promise.all([
    readReleasePullRequest(repository, sha),
    readCommitInfo(),
    readChangedFiles(),
    readPreviousVersion(),
    readFile(changelogPath, "utf8"),
    readCiPassed(repository, sha),
  ]);
  const input: ReleasePolicyInput = {
    changelogText,
    changedFiles,
    ciPassed,
    commit,
    packageName: packageInfo.name,
    published: registry.published,
    ref,
    registryComplete: registry.published && registry.taggedVersion === packageInfo.version,
    repository,
    sha,
    tag: packageInfo.tag,
    version: packageInfo.version,
  };

  if (releasePullRequest) input.releasePullRequest = releasePullRequest;
  if (registry.taggedVersion) input.taggedVersion = registry.taggedVersion;
  if (previousVersion) input.previousVersion = previousVersion;
  return input;
}

async function readPackageInfo() {
  const raw = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(raw) as PackageJson;

  if (!packageJson.name || !packageJson.version) {
    throw new Error(`Missing name or version in ${packageJsonPath}`);
  }

  return {
    name: packageJson.name,
    tag: distTagForVersion(packageJson.version),
    version: packageJson.version,
  };
}

async function readRegistryState(name: string, version: string, tag: string) {
  const response = await fetch(`${registryUrl}/${encodeURIComponent(name)}`, {
    headers: { accept: "application/json" },
  });

  if (response.status === 404) {
    return { published: false, taggedVersion: undefined };
  }

  if (!response.ok) {
    throw new Error(`Registry lookup failed for ${name}: ${response.status} ${response.statusText}`);
  }

  const document = (await response.json()) as RegistryDocument;
  return {
    published: Boolean(document.versions?.[version]),
    taggedVersion: document["dist-tags"]?.[tag],
  };
}

async function readReleasePullRequest(repository: string, sha: string): Promise<ReleasePullRequest | undefined> {
  const pulls = await githubJson<GitHubPullRequest[]>(repository, `/commits/${sha}/pulls`);
  const [pull] = pulls.filter((candidate) => candidate.base.ref === "main");
  if (!pull) return undefined;

  const comments = await githubJson<GitHubComment[]>(repository, `/issues/${pull.number}/comments`);
  return {
    baseRefName: pull.base.ref,
    body: pull.body ?? "",
    comments: comments.map((comment) => comment.body ?? ""),
    headRefName: pull.head.ref,
    labels: pull.labels.map((label) => label.name),
    number: pull.number,
    title: pull.title,
    userLogin: pull.user.login,
  };
}

async function readCommitInfo(): Promise<CommitInfo> {
  const output = await runText(["git", "log", "-1", "--format=%an%n%ae%n%cn%n%ce%n%s"]);
  const [authorName, authorEmail, committerName, committerEmail, ...subjectParts] = output.split("\n");
  if (!authorName || !authorEmail || !committerName || !committerEmail) {
    throw new Error("Could not read current commit identity");
  }

  return {
    authorEmail,
    authorName,
    committerEmail,
    committerName,
    subject: subjectParts.join("\n"),
  };
}

async function readChangedFiles(): Promise<ChangedFile[]> {
  const parentExists = await runText(["git", "rev-parse", "--verify", "HEAD^"], { allowFailure: true });
  if (!parentExists) return [];

  const output = await runText(["git", "diff", "--name-status", "HEAD^", "HEAD"]);
  if (!output) return [];

  return output.split("\n").map((line) => {
    const [status, path] = line.split(/\s+/, 2);
    if (!status || !path) throw new Error(`Could not parse git diff entry: ${line}`);
    return { path, status };
  });
}

async function readPreviousVersion() {
  const raw = await runText(["git", "show", "HEAD^:apps/skillset/package.json"], {
    allowFailure: true,
  });
  if (!raw) return undefined;

  const packageJson = JSON.parse(raw) as PackageJson;
  return packageJson.version;
}

async function readCiPassed(repository: string, sha: string) {
  if (process.env.SKILLSET_RELEASE_POLICY_ASSUME_CI_PASSED === "1") return true;

  const maxAttempts = Number.parseInt(process.env.SKILLSET_RELEASE_POLICY_CI_ATTEMPTS ?? "1", 10);
  const waitMs = Number.parseInt(process.env.SKILLSET_RELEASE_POLICY_CI_WAIT_MS ?? "0", 10);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const state = await readCiState(repository, sha);
    if (state === "passed") return true;
    if (state === "failed") return false;
    if (attempt < maxAttempts && waitMs > 0) {
      console.error(`skillset: waiting for exact-SHA CI checks (${attempt}/${maxAttempts})`);
      await Bun.sleep(waitMs);
    }
  }

  return false;
}

export function ciStateFromCheckRuns(response: GitHubCheckRunsResponse) {
  const requiredRuns = new Map(
    response.check_runs
      .filter((run) => run.check_suite?.app?.slug === "github-actions")
      .filter((run) => run.name === "check" || run.name === "skillset-ci")
      .map((run) => [run.name, run])
  );
  const relevantRuns = ["check", "skillset-ci"].map((name) => requiredRuns.get(name));

  if (relevantRuns.some((run) => !run || run.status !== "completed")) return "pending";
  if (relevantRuns.some((run) => run?.conclusion !== "success")) return "failed";

  return "passed";
}

async function readCiState(repository: string, sha: string) {
  const response = await githubJson<GitHubCheckRunsResponse>(repository, `/commits/${sha}/check-runs?per_page=100`);
  return ciStateFromCheckRuns(response);
}

async function githubJson<T>(repository: string, path: string): Promise<T> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed for ${path}: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

async function runText(command: readonly string[], options: { allowFailure?: boolean } = {}) {
  const subprocess = Bun.spawn([...command], {
    cwd: rootDir,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);

  if (exitCode !== 0) {
    if (options.allowFailure) return "";
    throw new Error(`${command.join(" ")} failed: ${stderr.trim()}`);
  }

  return stdout.trim();
}

function printReport(report: ReleasePolicyReport) {
  console.error(`skillset: release policy decision is ${report.decision}`);

  for (const reason of report.reasons) {
    console.error(`skillset: ${reason}`);
  }

  for (const diagnostic of report.diagnostics) {
    console.error(`skillset: policy diagnostic: ${diagnostic}`);
  }

  for (const blocker of report.blockers) {
    console.error(`skillset: policy blocker: ${blocker}`);
  }
}

type GitHubPullRequest = {
  base: { ref: string };
  body?: string | null;
  head: { ref: string };
  labels: { name: string }[];
  number: number;
  title: string;
  user: { login: string };
};

type GitHubComment = {
  body?: string | null;
};

export type GitHubCheckRunsResponse = {
  check_runs: {
    check_suite?: {
      app?: {
        slug?: string;
      };
    };
    conclusion?: string | null;
    name: string;
    status: string;
  }[];
};

if (import.meta.main) {
  const [command = "policy"] = Bun.argv.slice(2);

  try {
    switch (command) {
      case "policy":
        await commandPolicy();
        break;
      default:
        throw new Error(`Unknown release-policy command: ${command}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
