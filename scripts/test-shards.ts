/** Opt-in, exact-manifest experiment for Bun's duration-balanced test shards. */
import { type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { loadavg, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

import { gitSafeEnv } from "../apps/skillset/src/git-env";
import {
  classifyResourceAccounting,
  parseResourceUsage,
  resolveTimeWrapper,
} from "./measure-gate";
import { prependExecutablePath, resolvePinnedBun } from "./pinned-bun";
import { parseJunitEvidence, verifyShardUnion } from "./test-shard-evidence";
import { killActive, runProcess, runRequired } from "./test-shard-process";

const scriptRepo = resolve(import.meta.dir, "..");
const TEST_TIMEOUT_MS = 12 * 60_000;
const SETUP_TIMEOUT_MS = 2 * 60_000;
const MARKER = "owner.json";

interface Options {
  readonly repo: string;
  readonly timings: string;
  readonly baselineJunit: string;
  readonly baselineReport: string;
  readonly out: string;
  readonly shards: 2 | 4;
}

interface Shard {
  readonly index: number;
  readonly repo: string;
  readonly temp: string;
  readonly env: NodeJS.ProcessEnv;
  readonly log: string;
  readonly junit: string;
  readonly rusage: string;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));

async function main(argv: readonly string[]): Promise<number> {
  let options: Options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    console.error(`test-shards: ${message(error)}`);
    console.error(
      "usage: bun scripts/test-shards.ts --timings <json> --baseline-junit <xml> --baseline-report <json> --out <dir> [--repo <dir>] [--shards 2|4]"
    );
    return 2;
  }

  const startedAt = new Date().toISOString();
  const totalStart = performance.now();
  const invocationId = randomUUID();
  let runRoot: string | undefined;
  let safeOut: string | undefined;
  const active = new Set<ChildProcess>();
  let interrupted: NodeJS.Signals | undefined;
  const interrupt = (signal: NodeJS.Signals) => {
    interrupted ??= signal;
    killActive(active, signal);
  };
  const onInterrupt = () => interrupt("SIGINT");
  const onTerminate = () => interrupt("SIGTERM");
  const assertRunning = () => {
    if (interrupted) throw new Error(`interrupted by ${interrupted}`);
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);

  try {
    const repo = await realpath(options.repo);
    const requestedOut = resolve(options.out);
    const out = join(
      await realpath(dirname(requestedOut)),
      basename(requestedOut)
    );
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
      git(
        repo,
        "ls-files",
        "-z",
        "apps/**/*.test.ts",
        "packages/**/*.test.ts",
        "scripts/**/*.test.ts"
      ),
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
    if (manifest.length === 0)
      throw new Error("tracked test manifest is empty");
    const timingMap = JSON.parse(timingBytes.toString("utf8")) as {
      readonly version?: number;
      readonly files?: Record<string, number>;
    };
    if (timingMap.version !== 1 || !timingMap.files) {
      throw new Error("timing map is not Bun's version-1 file map");
    }
    const timedFiles = Object.keys(timingMap.files).sort();
    if (
      timedFiles.length !== manifest.length ||
      timedFiles.some((file, index) => file !== [...manifest].sort()[index]) ||
      Object.values(timingMap.files).some(
        (ms) => !Number.isFinite(ms) || ms < 0
      )
    ) {
      throw new Error("timing map does not cover the exact tracked manifest");
    }
    const baselineReport = JSON.parse(baselineReportBytes.toString("utf8")) as {
      readonly attributable?: boolean;
      readonly commandSucceeded?: boolean;
      readonly command?: readonly string[];
      readonly revision?: {
        readonly repoRoot?: string;
        readonly head?: string;
        readonly headTree?: string;
        readonly lockfileSha256?: string;
        readonly dirty?: boolean;
      };
      readonly revisionAfter?: {
        readonly head?: string;
        readonly headTree?: string;
        readonly lockfileSha256?: string;
        readonly dirty?: boolean;
      };
      readonly toolchainBefore?: { readonly resolvedBunVersion?: string };
      readonly toolchainAfter?: { readonly resolvedBunVersion?: string };
    };
    if (
      !baselineReport.attributable ||
      !baselineReport.commandSucceeded ||
      baselineReport.revision?.head !== head ||
      baselineReport.revision?.headTree !== tree ||
      baselineReport.revision?.lockfileSha256 !== sha256(lock) ||
      baselineReport.revision.dirty ||
      !baselineReport.revision.repoRoot ||
      baselineReport.revisionAfter?.head !== head ||
      baselineReport.revisionAfter.headTree !== tree ||
      baselineReport.revisionAfter.lockfileSha256 !== sha256(lock) ||
      baselineReport.revisionAfter.dirty ||
      baselineReport.toolchainBefore?.resolvedBunVersion !== pinned.version ||
      baselineReport.toolchainAfter?.resolvedBunVersion !== pinned.version ||
      !baselineReport.command?.includes(
        `--reporter-outfile=${resolve(options.baselineJunit)}`
      )
    ) {
      throw new Error(
        "baseline report does not prove this revision, toolchain, and JUnit output"
      );
    }
    const baseline = parseJunitEvidence(
      baselineBytes.toString("utf8"),
      await realpath(baselineReport.revision.repoRoot ?? "")
    );
    if (baseline.failures !== 0 || !sameItems(baseline.files, manifest)) {
      throw new Error(
        "baseline JUnit is not a clean report of the tracked manifest"
      );
    }

    if (overlap(out, repo))
      throw new Error("output directory overlaps the source checkout");
    if ((await lstat(out).catch(() => null))?.isSymbolicLink()) {
      throw new Error("output directory is a symlink");
    }
    await mkdir(out, { recursive: true });
    if ((await realpath(out)) !== out)
      throw new Error("output directory changed identity");
    if ((await readdir(out)).length !== 0) {
      throw new Error(
        "output directory is not empty; refusing stale shard reports"
      );
    }
    safeOut = out;
    const tempRoot = await realpath(tmpdir());
    runRoot = await mkdtemp(join(tempRoot, "skillset-shards-"));
    if (overlap(runRoot, repo) || overlap(runRoot, out)) {
      throw new Error("shard run root overlaps source or report output");
    }
    await writeFile(
      join(runRoot, MARKER),
      JSON.stringify({ invocationId, repo, head })
    );
    const timingCopy = join(runRoot, "timings.json");
    await writeFile(timingCopy, timingBytes);
    await chmod(timingCopy, 0o444);
    const timingSha256 = sha256(timingBytes);
    const setupStart = performance.now();
    const shards: Shard[] = [];
    for (let index = 1; index <= options.shards; index++) {
      assertRunning();
      const checkout = join(runRoot, `checkout-${index}`);
      const setupLog = join(out, `shard-${index}-setup.log`);
      const shardRoot = join(runRoot, `state-${index}`);
      const temp = join(shardRoot, "tmp");
      const xdg = join(shardRoot, "xdg");
      const gitConfig = join(shardRoot, "git-global-config");
      const gitSystem = join(shardRoot, "git-system-config");
      await mkdir(shardRoot, { recursive: true });
      await Promise.all([
        mkdir(temp, { recursive: true }),
        mkdir(join(xdg, "cache"), { recursive: true }),
        mkdir(join(xdg, "config"), { recursive: true }),
        mkdir(join(xdg, "data"), { recursive: true }),
        mkdir(join(xdg, "state"), { recursive: true }),
        writeFile(gitConfig, ""),
        writeFile(gitSystem, ""),
      ]);
      const env: NodeJS.ProcessEnv = {
        ...safeGitEnv(),
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        GIT_CONFIG_GLOBAL: gitConfig,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_SYSTEM: gitSystem,
        GIT_TERMINAL_PROMPT: "0",
        PATH: prependExecutablePath(dirname(pinned.binPath), process.env.PATH),
        TMPDIR: temp,
        XDG_CACHE_HOME: join(xdg, "cache"),
        XDG_CONFIG_HOME: join(xdg, "config"),
        XDG_DATA_HOME: join(xdg, "data"),
        XDG_STATE_HOME: join(xdg, "state"),
      };
      delete env.SKILLSET_TEST_SANDBOX;
      assertRunning();
      await runRequired(
        "git",
        ["clone", "--quiet", "--no-hardlinks", "--no-tags", repo, checkout],
        repo,
        env,
        setupLog,
        SETUP_TIMEOUT_MS,
        active
      );
      assertRunning();
      await runRequired(
        "git",
        ["checkout", "--quiet", "--detach", head],
        checkout,
        env,
        setupLog,
        SETUP_TIMEOUT_MS,
        active,
        true
      );
      assertRunning();
      await runRequired(
        pinned.binPath,
        [
          "install",
          "--frozen-lockfile",
          `--cache-dir=${join(shardRoot, "bun-cache")}`,
        ],
        checkout,
        env,
        setupLog,
        SETUP_TIMEOUT_MS,
        active,
        true
      );
      assertRunning();
      if (
        (await git(checkout, "rev-parse", "HEAD")) !== head ||
        (await git(checkout, "rev-parse", "HEAD^{tree}")) !== tree ||
        (
          await git(
            checkout,
            "status",
            "--porcelain",
            "--untracked-files=normal"
          )
        ).length !== 0 ||
        !sameItems(
          (
            await git(
              checkout,
              "ls-files",
              "-z",
              "apps/**/*.test.ts",
              "packages/**/*.test.ts",
              "scripts/**/*.test.ts"
            )
          )
            .split("\0")
            .filter(Boolean),
          manifest
        ) ||
        sha256(await readFile(join(checkout, "bun.lock"))) !== sha256(lock)
      ) {
        throw new Error(
          `shard ${index} checkout identity changed during setup`
        );
      }
      shards.push({
        env,
        index,
        junit: join(out, `shard-${index}.xml`),
        log: join(out, `shard-${index}.log`),
        repo: checkout,
        rusage: join(out, `shard-${index}.rusage.txt`),
        temp,
      });
    }
    const setupMs = performance.now() - setupStart;
    const testStart = performance.now();
    const loadBefore = loadavg();
    const wrappers = await Promise.all(
      shards.map((shard) => resolveTimeWrapper(shard.rusage))
    );
    assertRunning();
    const results = await Promise.all(
      shards.map(async (shard) => {
        assertRunning();
        const wrapper = wrappers[shard.index - 1] ?? [];
        const result = await runProcess(
          wrapper[0] ?? pinned.binPath,
          [
            ...wrapper.slice(1),
            ...(wrapper.length > 0 ? [pinned.binPath] : []),
            "run",
            "test:sandbox",
            "--",
            "bun",
            "test",
            // Do not add Bun's --no-orphans: SET-272 intentionally detaches a
            // worker from a short-lived CLI and times out if Bun kills it.
            "--timeout",
            "15000",
            `--shard=${shard.index}/${options.shards}`,
            `--timings=${timingCopy}`,
            "--reporter=junit",
            `--reporter-outfile=${shard.junit}`,
            ...manifest,
          ],
          shard.repo,
          shard.env,
          shard.log,
          TEST_TIMEOUT_MS,
          active
        );
        if (result.exitCode !== 0 || result.timedOut || result.signal)
          killActive(active, "SIGTERM");
        return result;
      })
    );
    const testMs = performance.now() - testStart;
    const loadAfter = loadavg();
    assertRunning();
    if (
      results.some(
        (result) => result.exitCode !== 0 || result.timedOut || result.signal
      )
    ) {
      throw new Error("one or more shards failed, timed out, or were canceled");
    }
    if (sha256(await readFile(timingCopy)) !== timingSha256) {
      throw new Error("a shard changed the frozen timing-map snapshot");
    }
    if (
      (await git(repo, "rev-parse", "HEAD")) !== head ||
      (await git(repo, "rev-parse", "HEAD^{tree}")) !== tree ||
      (await git(repo, "status", "--porcelain", "--untracked-files=normal"))
        .length !== 0 ||
      sha256(await readFile(join(repo, "bun.lock"))) !== sha256(lock)
    ) {
      throw new Error("source checkout identity changed during shards");
    }
    for (const shard of shards) {
      if (
        (await git(shard.repo, "rev-parse", "HEAD")) !== head ||
        (await git(shard.repo, "rev-parse", "HEAD^{tree}")) !== tree ||
        (
          await git(
            shard.repo,
            "status",
            "--porcelain",
            "--untracked-files=normal"
          )
        ).length !== 0 ||
        sha256(await readFile(join(shard.repo, "bun.lock"))) !== sha256(lock)
      ) {
        throw new Error(
          `shard ${shard.index} checkout identity changed during tests`
        );
      }
    }
    const evidence = await Promise.all(
      shards.map(async (shard) =>
        parseJunitEvidence(await readFile(shard.junit, "utf8"), shard.repo)
      )
    );
    const union = verifyShardUnion(manifest, baseline, evidence);
    assertRunning();
    const resourceRows = await Promise.all(
      shards.map(async (shard, index) => {
        const wrapperMissing = (wrappers[index]?.length ?? 0) === 0;
        const resources = wrapperMissing
          ? {}
          : parseResourceUsage(await readFile(shard.rusage, "utf8"));
        return {
          index: shard.index,
          result: results[index],
          resourceAccounting: classifyResourceAccounting(
            wrapperMissing,
            resources,
            results[index]?.wallMs ?? 0
          ),
          resources,
          testRootEntries: (await readdir(shard.temp)).length,
          leakedSandboxRoots: (await readdir(shard.temp)).filter((entry) =>
            entry.startsWith("skillset-")
          ).length,
        };
      })
    );
    if (resourceRows.some((row) => row.leakedSandboxRoots !== 0)) {
      throw new Error(
        "one or more shards left a sandbox or fixture root behind"
      );
    }
    assertRunning();
    const report = {
      schemaVersion: 1,
      startedAt,
      endedAt: new Date().toISOString(),
      head,
      tree,
      lockSha256: sha256(lock),
      bunVersion: pinned.version,
      timingSha256,
      baselineJunitSha256: sha256(baselineBytes),
      baselineReportSha256: sha256(baselineReportBytes),
      manifestSha256: sha256(manifest.join("\n")),
      shards: options.shards,
      setupMs,
      testMs,
      totalMs: performance.now() - totalStart,
      loadBefore,
      loadAfter,
      union,
      resourceRows,
    };
    await removeRunRoot(runRoot, invocationId);
    runRoot = undefined;
    assertRunning();
    await writeFile(
      join(out, "aggregate.json"),
      `${JSON.stringify(report, null, 2)}\n`
    );
    assertRunning();
    console.log(
      `test-shards: ${union.tests} tests / ${union.fileCount} files passed in ${(testMs / 1000).toFixed(2)}s (${options.shards} isolated shards); report=${join(out, "aggregate.json")}`
    );
    return 0;
  } catch (error) {
    console.error(`test-shards: ${message(error)}`);
    if (runRoot) console.error(`test-shards: retained failed run ${runRoot}`);
    if (safeOut) {
      await writeFile(
        join(safeOut, "aggregate.json"),
        `${JSON.stringify({ schemaVersion: 1, status: "failed", startedAt, endedAt: new Date().toISOString(), reason: message(error), retainedRunRoot: runRoot ?? null }, null, 2)}\n`
      ).catch((reportError) =>
        console.error(
          `test-shards: could not write failure report: ${message(reportError)}`
        )
      );
    }
    return interrupted === "SIGINT" ? 130 : interrupted === "SIGTERM" ? 143 : 1;
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  }
}

function parseOptions(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value || values.has(key))
      throw new Error("invalid or duplicate option");
    values.set(key, value);
  }
  for (const key of values.keys()) {
    if (
      ![
        "--repo",
        "--timings",
        "--baseline-junit",
        "--baseline-report",
        "--out",
        "--shards",
      ].includes(key)
    ) {
      throw new Error(`unknown option ${key}`);
    }
  }
  const timings = values.get("--timings");
  const baselineJunit = values.get("--baseline-junit");
  const baselineReport = values.get("--baseline-report");
  const out = values.get("--out");
  const shards = Number(values.get("--shards") ?? "2");
  if (
    !timings ||
    !baselineJunit ||
    !baselineReport ||
    !out ||
    (shards !== 2 && shards !== 4)
  ) {
    throw new Error(
      "timings, baseline JUnit/report, output and two or four shards are required"
    );
  }
  return {
    baselineJunit,
    baselineReport,
    out,
    repo: values.get("--repo") ?? scriptRepo,
    shards,
    timings,
  };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const child = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    env: safeGitEnv(),
    stderr: "pipe",
    stdout: "pipe",
  });
  if (child.exitCode !== 0)
    throw new Error(
      `git ${args[0]} failed: ${new TextDecoder().decode(child.stderr).trim()}`
    );
  return new TextDecoder().decode(child.stdout).trimEnd();
}

function safeGitEnv(): Record<string, string> {
  const env = gitSafeEnv();
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

async function removeRunRoot(
  root: string,
  invocationId: string
): Promise<void> {
  const tempRoot = await realpath(tmpdir());
  const stat = await lstat(root);
  const canonical = await realpath(root);
  const marker = JSON.parse(await readFile(join(root, MARKER), "utf8")) as {
    invocationId?: string;
  };
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    canonical !== root ||
    dirname(root) !== tempRoot ||
    !basename(root).startsWith("skillset-shards-") ||
    marker.invocationId !== invocationId
  ) {
    throw new Error(`refusing to remove unowned shard root ${root}`);
  }
  await rm(root, { recursive: true });
}

function sameItems(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function overlap(left: string, right: string): boolean {
  if (!isAbsolute(left) || !isAbsolute(right)) return true;
  return (
    left === right ||
    left.startsWith(`${right}${sep}`) ||
    right.startsWith(`${left}${sep}`)
  );
}

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
