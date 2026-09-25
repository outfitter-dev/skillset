import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

import { gitSafeEnv } from "../apps/skillset/src/git-env";
import { type PinnedBun, resolvePinnedBun } from "./pinned-bun";
import { type JunitEvidence, parseJunitEvidence } from "./test-shard-evidence";

const TEST_PATHS = [
  "apps/**/*.test.ts",
  "packages/**/*.test.ts",
  "scripts/**/*.test.ts",
];

export interface ShardInputOptions {
  readonly repo: string;
  readonly timings: string;
  readonly baselineJunit: string;
  readonly baselineReport: string;
}

export interface ShardContract {
  readonly repo: string;
  readonly head: string;
  readonly tree: string;
  readonly lockSha256: string;
  readonly manifest: readonly string[];
  readonly pinned: PinnedBun;
  readonly timingBytes: Uint8Array;
  readonly baselineBytes: Uint8Array;
  readonly baselineReportBytes: Uint8Array;
  readonly baseline: JunitEvidence;
}

export async function loadShardContract(
  options: ShardInputOptions
): Promise<ShardContract> {
  const repo = await realpath(options.repo);
  const [
    head,
    tree,
    status,
    lock,
    tracked,
    pinned,
    timingBytes,
    baselineBytes,
    baselineReportBytes,
  ] = await Promise.all([
    git(repo, "rev-parse", "HEAD"),
    git(repo, "rev-parse", "HEAD^{tree}"),
    git(repo, "status", "--porcelain", "--untracked-files=normal"),
    readFile(join(repo, "bun.lock")),
    git(repo, "ls-files", "-z", ...TEST_PATHS),
    resolvePinnedBun(repo),
    readFile(options.timings),
    readFile(options.baselineJunit),
    readFile(options.baselineReport),
  ]);
  if (status.length !== 0)
    throw new Error(
      "source checkout is dirty; shards would omit uncommitted work"
    );
  const manifest = tracked.split("\0").filter(Boolean);
  if (manifest.length === 0) throw new Error("tracked test manifest is empty");
  const timingMap = JSON.parse(timingBytes.toString("utf8")) as {
    version?: number;
    files?: Record<string, number>;
  };
  if (timingMap.version !== 1 || !timingMap.files)
    throw new Error("timing map is not Bun's version-1 file map");
  if (
    !sameItems(Object.keys(timingMap.files), manifest) ||
    Object.values(timingMap.files).some((ms) => !Number.isFinite(ms) || ms < 0)
  )
    throw new Error("timing map does not cover the exact tracked manifest");

  const lockSha256 = sha256(lock);
  const measuredRoot = await verifyBaselineReport(baselineReportBytes, {
    baselineBytes,
    baselineJunit: options.baselineJunit,
    bunVersion: pinned.version,
    head,
    lockSha256,
    tree,
  });
  const baseline = parseJunitEvidence(
    baselineBytes.toString("utf8"),
    measuredRoot
  );
  if (baseline.failures !== 0 || !sameItems(baseline.files, manifest)) {
    throw new Error(
      "baseline JUnit is not a clean report of the tracked manifest"
    );
  }
  return {
    repo,
    head,
    tree,
    lockSha256,
    manifest,
    pinned,
    timingBytes,
    baselineBytes,
    baselineReportBytes,
    baseline,
  };
}

export interface BaselineExpectation {
  readonly head: string;
  readonly tree: string;
  readonly lockSha256: string;
  readonly bunVersion: string;
  readonly baselineJunit: string;
  readonly baselineBytes: Uint8Array;
}

/**
 * Prove a measure-gate report describes a clean, attributable baseline run of
 * this revision and toolchain that produced the JUnit bytes being compared.
 * Returns the canonical root the measured command ran in.
 */
export async function verifyBaselineReport(
  reportBytes: Uint8Array,
  expected: BaselineExpectation
): Promise<string> {
  const report = JSON.parse(new TextDecoder().decode(reportBytes)) as {
    attributable?: boolean;
    commandSucceeded?: boolean;
    command?: readonly string[];
    revision?: {
      repoRoot?: string;
      head?: string;
      headTree?: string;
      lockfileSha256?: string;
      dirty?: boolean;
    };
    revisionAfter?: {
      head?: string;
      headTree?: string;
      lockfileSha256?: string;
      dirty?: boolean;
    };
    toolchainBefore?: { resolvedBunVersion?: string };
    toolchainAfter?: { resolvedBunVersion?: string } | null;
    outputs?: readonly { path?: string; sha256?: string | null }[];
  };
  const { head, tree, lockSha256 } = expected;
  const measuredRoot = report.revision?.repoRoot;
  // measure-gate keeps argv as typed, relative to the measured checkout, so
  // compare canonical files rather than spellings of a path.
  const junit = await realpath(expected.baselineJunit);
  const outfiles = measuredRoot
    ? await Promise.all(
        (report.command ?? [])
          .filter((arg) => arg.startsWith(REPORTER_OUTFILE))
          .map((arg) =>
            canonicalPath(
              resolve(measuredRoot, arg.slice(REPORTER_OUTFILE.length))
            )
          )
      )
    : [];
  // The digest binds the compared bytes to the measured run: an outfile
  // rewritten after the run keeps its name but not its hash.
  const digest = sha256(expected.baselineBytes);
  const measuredOutputs = await Promise.all(
    (report.outputs ?? []).map(async (output) => ({
      path: output.path ? await canonicalPath(output.path) : undefined,
      sha256: output.sha256,
    }))
  );
  if (
    !report.attributable ||
    !report.commandSucceeded ||
    report.revision?.head !== head ||
    report.revision.headTree !== tree ||
    report.revision.lockfileSha256 !== lockSha256 ||
    report.revision.dirty ||
    !report.revision.repoRoot ||
    report.revisionAfter?.head !== head ||
    report.revisionAfter.headTree !== tree ||
    report.revisionAfter.lockfileSha256 !== lockSha256 ||
    report.revisionAfter.dirty ||
    report.toolchainBefore?.resolvedBunVersion !== expected.bunVersion ||
    report.toolchainAfter?.resolvedBunVersion !== expected.bunVersion ||
    !outfiles.includes(junit) ||
    !measuredOutputs.some(
      (output) => output.path === junit && output.sha256 === digest
    )
  )
    throw new Error(
      "baseline report does not prove this revision, toolchain, and JUnit output (measure it with --output <junit>)"
    );
  return realpath(report.revision.repoRoot);
}

const REPORTER_OUTFILE = "--reporter-outfile=";

async function canonicalPath(path: string): Promise<string> {
  return realpath(path).catch(() => path);
}

export async function assertRepoIdentity(
  repo: string,
  contract: Pick<ShardContract, "head" | "tree" | "lockSha256" | "manifest">,
  label: string
): Promise<void> {
  const [head, tree, status, tracked, lock] = await Promise.all([
    git(repo, "rev-parse", "HEAD"),
    git(repo, "rev-parse", "HEAD^{tree}"),
    git(repo, "status", "--porcelain", "--untracked-files=normal"),
    git(repo, "ls-files", "-z", ...TEST_PATHS),
    readFile(join(repo, "bun.lock")),
  ]);
  if (
    head !== contract.head ||
    tree !== contract.tree ||
    status.length !== 0 ||
    !sameItems(tracked.split("\0").filter(Boolean), contract.manifest) ||
    sha256(lock) !== contract.lockSha256
  )
    throw new Error(`${label} checkout identity changed`);
}

export function safeGitEnv(
  sourceEnv: Record<string, string | undefined> = process.env
): Record<string, string> {
  return gitSafeEnv(withoutGitConfigInjection(sourceEnv));
}

function withoutGitConfigInjection(
  sourceEnv: Record<string, string | undefined>
): Record<string, string | undefined> {
  const env = { ...sourceEnv };
  for (const key of Object.keys(env)) {
    if (
      key === "GIT_CONFIG_PARAMETERS" ||
      key === "GIT_TEMPLATE_DIR" ||
      /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/u.test(key)
    )
      delete env[key];
  }
  return env;
}

export function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const child = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    // Same as safeGitEnv(), spelled at the spawn site so git-env:guard sees it.
    env: gitSafeEnv(withoutGitConfigInjection(process.env)),
    stderr: "pipe",
    stdout: "pipe",
  });
  if (child.exitCode !== 0)
    throw new Error(
      `git ${args[0]} failed: ${new TextDecoder().decode(child.stderr).trim()}`
    );
  return new TextDecoder().decode(child.stdout).trimEnd();
}

function sameItems(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
