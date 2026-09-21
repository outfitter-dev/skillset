/**
 * Measure one repository gate invocation and write attributable evidence.
 *
 * Performance claims about this repository's gates are only usable when the
 * run they came from can be attributed to an exact revision, interpreter, and
 * host. `bun run check` spans installation, the Bun test corpus, generated
 * output verification, and packaging, so a bare wall-clock number cannot say
 * which phase moved or whether the interpreter silently changed underneath the
 * sample.
 *
 * This wrapper runs one labeled command and records the surrounding facts:
 * revision and working-tree cleanliness, the pinned and ambient Bun, the
 * lockfile hash, host capacity, load average, and the child's resource usage
 * from `/usr/bin/time -l`. It samples the toolchain before and after the timed
 * region and marks the sample invalid when the interpreter changed, because
 * the machine's global Bun is written by tools outside this repository.
 *
 * It deliberately does not instrument the gates themselves. Phases are
 * separated by measuring distinct commands (`bun install`, `bun run test`,
 * `bun run check`) and comparing labeled reports, so the canonical gates keep
 * running exactly as a contributor runs them.
 *
 * Usage:
 *   bun scripts/measure-gate.ts --label <label> [--lead-in <seconds>]
 *     [--out <dir>] [--note <text>] [--cold] [--repo <dir>]
 *     -- <command> [args...]
 *
 * `--repo` measures a checkout other than this one. The baseline for a goal
 * must come from a clean tree at the revision it claims, and the harness
 * itself is an uncommitted or added file in the working checkout, so the
 * honest baseline runs against a disposable clone at that exact revision.
 */
import { createHash, randomUUID } from "node:crypto";
import { openSync, closeSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { arch, cpus, loadavg, platform, release, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  type PinnedBunSource,
  readPin,
  resolvePinnedBun,
} from "./pinned-bun";

/** Resource usage parsed from `/usr/bin/time -l`. Fields absent on a platform stay undefined. */
export interface ResourceUsage {
  readonly realSeconds?: number;
  readonly userSeconds?: number;
  readonly systemSeconds?: number;
  readonly maxRssBytes?: number;
  readonly peakMemoryFootprintBytes?: number;
  readonly involuntaryContextSwitches?: number;
  readonly voluntaryContextSwitches?: number;
  readonly instructionsRetired?: number;
  readonly cyclesElapsed?: number;
}

/** Toolchain identity sampled on both sides of the timed region. */
export interface ToolchainSnapshot {
  readonly pinnedVersion: string;
  readonly resolvedBunPath: string;
  readonly resolvedBunVersion: string;
  readonly resolvedBunSource: PinnedBunSource;
  readonly ambientBunPath: string | null;
  readonly ambientBunVersion: string | null;
}

/** Revision identity of the tree the command ran against. */
export interface RevisionSnapshot {
  readonly repoRoot: string;
  readonly head: string;
  readonly headTree: string;
  readonly branch: string;
  readonly dirty: boolean;
  readonly dirtyEntries: readonly string[];
  readonly lockfileSha256: string;
}

/** Host capacity and contention, both of which move wall time on a shared machine. */
export interface HostSnapshot {
  readonly platform: string;
  readonly arch: string;
  readonly release: string;
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly totalMemoryBytes: number;
  readonly loadAverage: readonly number[];
}

/**
 * How far the recorded CPU totals can be trusted.
 *
 * This judges CPU only. `maxRssBytes` is sampled directly by the wrapper and
 * stays usable whatever this says.
 *
 * `complete` means the wrapper ran and its CPU totals are plausible for the
 * elapsed time. `suspect` means they are not: nested `bun run` wrappers lose
 * descendant accounting and report fractions of a second for a multi-minute
 * gate. A genuinely idle, I/O-bound or network-bound run can also land here, so
 * `suspect` means "do not quote these CPU figures", not "the harness is
 * broken". `unavailable` means no usable wrapper existed on this host.
 */
export type ResourceAccounting = "complete" | "suspect" | "unavailable";

/** One measured gate invocation. */
export interface MeasurementReport {
  readonly schemaVersion: 2;
  readonly label: string;
  readonly note: string | null;
  readonly thermalCondition: "cold" | "warm";
  readonly command: readonly string[];
  readonly startedAt: string;
  readonly endedAt: string;
  readonly leadInSeconds: number;
  readonly wallMs: number;
  readonly exitCode: number;
  readonly signal: string | null;
  /**
   * Whether the sample can be attributed to the revision and toolchain it
   * names. It says nothing about whether the measured gate passed; read
   * `commandSucceeded` for that. The two were conflated once already.
   */
  readonly attributable: boolean;
  readonly attributabilityIssues: readonly string[];
  /** Whether the measured command itself exited zero. */
  readonly commandSucceeded: boolean;
  readonly resourceAccounting: ResourceAccounting;
  readonly revision: RevisionSnapshot;
  readonly toolchainBefore: ToolchainSnapshot;
  readonly toolchainAfter: ToolchainSnapshot;
  readonly hostBefore: HostSnapshot;
  readonly hostAfter: HostSnapshot;
  readonly resources: ResourceUsage;
  readonly logPath: string;
  readonly rusagePath: string;
}

interface Options {
  readonly label: string;
  readonly repoRoot: string;
  readonly note: string | null;
  readonly cold: boolean;
  readonly leadInSeconds: number;
  readonly outDir: string;
  readonly command: readonly string[];
}

/** The checkout this script lives in; the default measurement target. */
const scriptRepoRoot = resolve(import.meta.dir, "..");

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}

async function main(argv: readonly string[]): Promise<number> {
  let options: Options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    console.error(`measure-gate: ${message(error)}`);
    console.error(
      "usage: bun scripts/measure-gate.ts --label <label> [--lead-in <seconds>] [--out <dir>] [--note <text>] [--cold] -- <command> [args...]"
    );
    return 2;
  }

  const repoCheck = await git(["rev-parse", "--git-dir"], options.repoRoot);
  if (repoCheck.length === 0) {
    console.error(
      `measure-gate: --repo ${options.repoRoot} is not a git repository; refusing to start a run whose revision cannot be recorded`
    );
    return 2;
  }

  await mkdir(options.outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const base = join(options.outDir, `${options.label}-${stamp}`);
  const logPath = `${base}.log`;
  const rusagePath = `${base}.rusage.txt`;
  const reportPath = `${base}.json`;

  // The lead-in absorbs harness activity that would otherwise land inside the
  // timed region: this session's turn-end hook runs a Skillset check, and an
  // editor-triggered hook can still be finishing when the sample starts.
  if (options.leadInSeconds > 0) {
    await Bun.sleep(options.leadInSeconds * 1000);
  }

  const revision = await readRevision(options.repoRoot);
  const toolchainBefore = await readToolchain(options.repoRoot);
  const hostBefore = readHost();

  // `/usr/bin/time -l` is BSD. GNU time, which is what Linux CI has when it
  // has one at all, rejects -l with a usage error, so probing beats assuming:
  // the harness must still measure wall time on a host without it.
  const wrapper = await resolveTimeWrapper(rusagePath);

  const logFd = openSync(logPath, "w");
  const startedAt = new Date();
  const startNs = Bun.nanoseconds();
  let exitCode: number;
  let signal: string | null;
  try {
    const child = Bun.spawn({
      cmd: [...wrapper, ...options.command],
      cwd: options.repoRoot,
      env: process.env,
      stderr: logFd,
      stdin: "ignore",
      stdout: logFd,
    });
    exitCode = await child.exited;
    signal = child.signalCode ?? null;
  } finally {
    closeSync(logFd);
  }
  const wallMs = (Bun.nanoseconds() - startNs) / 1e6;
  const endedAt = new Date();

  const hostAfter = readHost();
  const toolchainAfter = await readToolchain(options.repoRoot);
  const resources =
    wrapper.length === 0
      ? {}
      : parseResourceUsage(await readFile(rusagePath, "utf8").catch(() => ""));
  const resourceAccounting = classifyResourceAccounting(
    wrapper.length === 0,
    resources,
    wallMs
  );

  const attributabilityIssues = collectAttributabilityIssues(
    revision,
    toolchainBefore,
    toolchainAfter
  );
  const report: MeasurementReport = {
    attributabilityIssues,
    attributable: attributabilityIssues.length === 0,
    command: options.command,
    commandSucceeded: exitCode === 0,
    endedAt: endedAt.toISOString(),
    exitCode,
    hostAfter,
    hostBefore,
    label: options.label,
    leadInSeconds: options.leadInSeconds,
    logPath,
    note: options.note,
    resourceAccounting,
    resources,
    revision,
    rusagePath,
    schemaVersion: 2,
    signal,
    startedAt: startedAt.toISOString(),
    thermalCondition: options.cold ? "cold" : "warm",
    toolchainAfter,
    toolchainBefore,
    wallMs,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.error(
    `measure-gate: ${options.label} ${(wallMs / 1000).toFixed(2)}s exit=${exitCode}${
      signal === null ? "" : ` signal=${signal}`
    } attributable=${report.attributable} resources=${resourceAccounting} report=${reportPath}`
  );
  for (const reason of attributabilityIssues) {
    console.error(`measure-gate: not attributable: ${reason}`);
  }
  if (resourceAccounting !== "complete") {
    console.error(
      `measure-gate: CPU accounting is ${resourceAccounting}; do not quote CPU totals from this sample (memory is measured directly and is unaffected)`
    );
  }
  // The gate's own exit code is the measurement's correctness result. A sample
  // that failed its gate is still recorded; the caller decides what it means.
  return exitCode;
}

function parseOptions(argv: readonly string[]): Options {
  let label: string | undefined;
  let note: string | null = null;
  let cold = false;
  let leadInSeconds = 0;
  let measuredRepoRoot = scriptRepoRoot;
  let outDir = join(scriptRepoRoot, ".skillset", "cache", "measure");
  const command: string[] = [];
  let index = 0;
  for (; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--") {
      index += 1;
      break;
    }
    const value = argv[index + 1];
    switch (flag) {
      case "--label":
        label = requireValue(flag, value);
        index += 1;
        break;
      case "--note":
        note = requireValue(flag, value);
        index += 1;
        break;
      case "--out":
        outDir = resolve(requireValue(flag, value));
        index += 1;
        break;
      case "--repo":
        measuredRepoRoot = resolve(requireValue(flag, value));
        index += 1;
        break;
      case "--lead-in":
        leadInSeconds = requireNumber(flag, requireValue(flag, value));
        index += 1;
        break;
      case "--cold":
        cold = true;
        break;
      default:
        throw new Error(`unknown flag ${JSON.stringify(flag)}`);
    }
  }
  command.push(...argv.slice(index));
  if (label === undefined) throw new Error("--label is required");
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(label)) {
    throw new Error(
      `--label must be a filename-safe slug; found ${JSON.stringify(label)}`
    );
  }
  if (command.length === 0) {
    throw new Error("a command is required after --");
  }
  return {
    cold,
    command,
    label,
    leadInSeconds,
    note,
    outDir,
    repoRoot: measuredRepoRoot,
  };
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function requireNumber(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a non-negative number`);
  }
  return parsed;
}

async function readRevision(repoRoot: string): Promise<RevisionSnapshot> {
  const [head, headTree, branch, status] = await Promise.all([
    git(["rev-parse", "HEAD"], repoRoot),
    git(["rev-parse", "HEAD^{tree}"], repoRoot),
    git(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot),
    git(["status", "--porcelain"], repoRoot),
  ]);
  const dirtyEntries = status.split("\n").filter((line) => line.length > 0);
  const lockfile = await readFile(join(repoRoot, "bun.lock")).catch(
    () => undefined
  );
  return {
    branch,
    dirty: dirtyEntries.length > 0,
    dirtyEntries,
    head,
    headTree,
    repoRoot,
    lockfileSha256:
      lockfile === undefined
        ? "absent"
        : createHash("sha256").update(lockfile).digest("hex"),
  };
}

async function readToolchain(repoRoot: string): Promise<ToolchainSnapshot> {
  const pinnedVersion = await readPin(repoRoot);
  const pinned = await resolvePinnedBun(repoRoot);
  const resolvedBunVersion = await versionOf(pinned.binPath);
  const ambientBunPath = await which("bun");
  const ambientBunVersion =
    ambientBunPath === null ? null : await versionOf(ambientBunPath);
  return {
    ambientBunPath,
    ambientBunVersion,
    pinnedVersion,
    resolvedBunPath: pinned.binPath,
    resolvedBunSource: pinned.source,
    resolvedBunVersion,
  };
}

function readHost(): HostSnapshot {
  const cpuList = cpus();
  return {
    arch: arch(),
    cpuCount: cpuList.length,
    cpuModel: cpuList[0]?.model ?? "unknown",
    loadAverage: loadavg(),
    platform: platform(),
    release: release(),
    totalMemoryBytes: totalmem(),
  };
}

export function collectAttributabilityIssues(
  revision: RevisionSnapshot,
  before: ToolchainSnapshot,
  after: ToolchainSnapshot
): string[] {
  const reasons: string[] = [];
  // The ambient interpreter launches the measured command: this harness spawns
  // with an unmodified environment, so `bun run ...` resolves through PATH.
  // Since SET-621 the *resolved* interpreter is a cache copy that cannot
  // change under a run, so comparing only that would make this guard vacuous
  // and would have let the swap that invalidated test-warm-2 pass as clean.
  if (before.ambientBunVersion !== after.ambientBunVersion) {
    reasons.push(
      `ambient interpreter version changed during the sample: ${before.ambientBunVersion} -> ${after.ambientBunVersion}`
    );
  }
  if (before.ambientBunPath !== after.ambientBunPath) {
    reasons.push(
      `ambient interpreter path changed during the sample: ${before.ambientBunPath} -> ${after.ambientBunPath}`
    );
  }
  if (before.resolvedBunVersion !== after.resolvedBunVersion) {
    reasons.push(
      `interpreter version changed during the sample: ${before.resolvedBunVersion} -> ${after.resolvedBunVersion}`
    );
  }
  if (before.resolvedBunPath !== after.resolvedBunPath) {
    reasons.push(
      `interpreter path changed during the sample: ${before.resolvedBunPath} -> ${after.resolvedBunPath}`
    );
  }
  if (before.resolvedBunVersion !== before.pinnedVersion) {
    reasons.push(
      `interpreter ${before.resolvedBunVersion} does not match the pin ${before.pinnedVersion}`
    );
  }
  if (revision.dirty) {
    reasons.push(
      `working tree is dirty (${revision.dirtyEntries.length} entries); the sample cannot claim revision ${revision.head}`
    );
  }
  return reasons;
}

/**
 * Probe for a resource-usage wrapper, returning its argv prefix.
 *
 * Returns an empty prefix when no usable wrapper exists, so the measured
 * command still runs and wall time is still recorded. Probing rather than
 * switching on platform keeps this honest on hosts where `/usr/bin/time` is
 * absent entirely, which is the default on many Linux images.
 */
async function resolveTimeWrapper(
  rusagePath: string
): Promise<readonly string[]> {
  // A fixed probe name collides when runs share an --out directory: concurrent
  // probes delete each other's file in their `finally`, and the loser reads an
  // empty probe and concludes the host has no wrapper. That records a capable
  // host as incapable, indistinguishable in the artifact from a real absence.
  const probe = join(dirname(rusagePath), `.time-probe-${randomUUID()}`);
  try {
    const child = Bun.spawn({
      cmd: ["/usr/bin/time", "-l", "-o", probe, "true"],
      stderr: "ignore",
      stdout: "ignore",
    });
    if ((await child.exited) !== 0) return [];
    const written = await readFile(probe, "utf8").catch(() => "");
    if (!/\breal\b/u.test(written)) return [];
    return ["/usr/bin/time", "-l", "-o", rusagePath];
  } catch {
    return [];
  } finally {
    await rm(probe, { force: true }).catch(() => {});
  }
}

/**
 * Decide whether recorded usage can be quoted.
 *
 * Nested `bun run` wrappers lose descendant accounting: an aggregate gate that
 * ran for 282 s reported 0.21 s of user time. Totals that cannot be true of the
 * elapsed wall time are marked suspect rather than published as measurements.
 */
export function classifyResourceAccounting(
  wrapperMissing: boolean,
  resources: ResourceUsage,
  wallMs: number
): ResourceAccounting {
  // Judges CPU totals only; memory is measured directly and is unaffected.
  if (wrapperMissing) return "unavailable";
  const { userSeconds, systemSeconds } = resources;
  if (userSeconds === undefined || systemSeconds === undefined) {
    return "unavailable";
  }
  const wallSeconds = wallMs / 1000;
  // Below a few seconds the ratio is dominated by start-up noise, so only
  // sustained runs are judged.
  if (wallSeconds < 5) return "complete";
  return userSeconds + systemSeconds < wallSeconds * 0.05
    ? "suspect"
    : "complete";
}

/**
 * Parse the BSD `/usr/bin/time -l` report. Unknown or absent lines are skipped
 * rather than guessed, so a platform without a counter reports it as absent.
 */
export function parseResourceUsage(raw: string): ResourceUsage {
  const usage: {
    -readonly [K in keyof ResourceUsage]: ResourceUsage[K];
  } = {};
  const summary = /^\s*([\d.]+)\s+real\s+([\d.]+)\s+user\s+([\d.]+)\s+sys/mu.exec(
    raw
  );
  if (summary) {
    usage.realSeconds = Number(summary[1]);
    usage.userSeconds = Number(summary[2]);
    usage.systemSeconds = Number(summary[3]);
  }
  const counters: ReadonlyArray<[keyof ResourceUsage, string]> = [
    ["maxRssBytes", "maximum resident set size"],
    ["peakMemoryFootprintBytes", "peak memory footprint"],
    ["involuntaryContextSwitches", "involuntary context switches"],
    ["voluntaryContextSwitches", "voluntary context switches"],
    ["instructionsRetired", "instructions retired"],
    ["cyclesElapsed", "cycles elapsed"],
  ];
  for (const [key, labelText] of counters) {
    const match = new RegExp(
      `^\\s*(\\d+)\\s+${labelText.replace(/ /gu, "\\s+")}\\s*$`,
      "mu"
    ).exec(raw);
    if (match) usage[key] = Number(match[1]);
  }
  return usage;
}

async function git(args: readonly string[], cwd: string): Promise<string> {
  const child = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    stderr: "ignore",
    stdout: "pipe",
  });
  const text = await new Response(child.stdout).text();
  await child.exited;
  return text.trim();
}

async function which(binary: string): Promise<string | null> {
  // Runs again after the timed region, so a host without `which` must not
  // throw away a sample whose expensive work is already done.
  try {
    const child = Bun.spawn({
      cmd: ["which", binary],
      stderr: "ignore",
      stdout: "pipe",
    });
    const text = await new Response(child.stdout).text();
    const code = await child.exited;
    return code === 0 && text.trim().length > 0 ? text.trim() : null;
  } catch {
    return null;
  }
}

async function versionOf(binPath: string): Promise<string> {
  const child = Bun.spawn({
    cmd: [binPath, "--version"],
    stderr: "ignore",
    stdout: "pipe",
  });
  const text = await new Response(child.stdout).text();
  const code = await child.exited;
  return code === 0 ? text.trim() : "unknown";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
