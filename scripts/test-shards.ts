/** Opt-in, exact-manifest experiment for Bun's duration-balanced test shards. */
import { type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  classifyResourceAccounting,
  parseResourceUsage,
  resolveTimeWrapper,
} from "./measure-gate";
import {
  assertRepoIdentity,
  loadShardContract,
  sha256,
  type ShardInputOptions,
} from "./test-shard-contract";
import { parseJunitEvidence, verifyShardUnion } from "./test-shard-evidence";
import { killActive, runProcess, runRequired } from "./test-shard-process";
import {
  prepareShardOutput,
  prepareShardWorkspace,
  removeOwnedRunRoot,
  writeFailedShardReceipt,
  writeRunAssets,
  type ShardWorkspace,
} from "./test-shard-workspace";

const scriptRepo = resolve(import.meta.dir, "..");
const TEST_TIMEOUT_MS = 12 * 60_000;
const SETUP_TIMEOUT_MS = 2 * 60_000;
interface Options extends ShardInputOptions {
  readonly out: string;
  readonly shards: 2 | 4;
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
    const contract = await loadShardContract(options);
    const {
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
    } = contract;
    const out = await prepareShardOutput(repo, options.out);
    safeOut = out;
    runRoot = await mkdtemp(join(await realpath(tmpdir()), "skillset-shards-"));
    const { timingCopy, timingSha256 } = await writeRunAssets(
      runRoot,
      invocationId,
      repo,
      out,
      head,
      timingBytes
    );
    const setupStart = performance.now();
    const shards: ShardWorkspace[] = [];
    for (let index = 1; index <= options.shards; index++) {
      assertRunning();
      const shard = await prepareShardWorkspace(runRoot, out, index, pinned);
      assertRunning();
      await runRequired(
        "git",
        ["clone", "--quiet", "--no-hardlinks", "--no-tags", repo, shard.repo],
        repo,
        shard.env,
        shard.setupLog,
        SETUP_TIMEOUT_MS,
        active
      );
      assertRunning();
      await runRequired(
        "git",
        ["checkout", "--quiet", "--detach", head],
        shard.repo,
        shard.env,
        shard.setupLog,
        SETUP_TIMEOUT_MS,
        active,
        true
      );
      assertRunning();
      await runRequired(
        pinned.binPath,
        ["install", "--frozen-lockfile", `--cache-dir=${shard.bunCache}`],
        shard.repo,
        shard.env,
        shard.setupLog,
        SETUP_TIMEOUT_MS,
        active,
        true
      );
      assertRunning();
      await assertRepoIdentity(
        shard.repo,
        contract,
        `shard ${index} during setup`
      );
      shards.push(shard);
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
    await assertRepoIdentity(repo, contract, "source during shards");
    for (const shard of shards) {
      await assertRepoIdentity(
        shard.repo,
        contract,
        `shard ${shard.index} during tests`
      );
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
      lockSha256,
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
    await removeOwnedRunRoot(runRoot, invocationId);
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
      await writeFailedShardReceipt(
        safeOut,
        startedAt,
        message(error),
        runRoot
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
