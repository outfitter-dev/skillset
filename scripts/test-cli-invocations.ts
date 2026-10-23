/**
 * Count Skillset CLI invocations per test file, with each invocation's cwd
 * (SET-625, step 1).
 *
 * Every spawn lever's payoff scales with how many times the corpus starts the
 * CLI, so this records the number instead of estimating it from call sites.
 * Each test file runs alone under the owned test sandbox, so every recorded
 * process belongs to exactly one file. `BUN_OPTIONS` preloads a recorder into
 * every Bun process the run starts, including compiled skillset executables, and the
 * recorder writes one JSON file per process outside the sandbox.
 *
 * A child spawned with an environment that drops `BUN_OPTIONS` is not
 * counted, so the totals are a floor. Files that fail still report the
 * invocations they made, and the failure is listed in the report. On Bun
 * 1.4.0 a preload in `BUN_OPTIONS` breaks package resolution inside
 * `Bun.build`, so `standard-profile-bundle.test.ts` (which bundles the CLI
 * but never spawns it) always fails under the recorder.
 *
 * Usage:
 *   bun scripts/test-cli-invocations.ts [--out <dir>] [--jobs <n>] [test files...]
 */
import { mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

import { gitSafeEnv } from "@skillset/core/internal/git-env";
import { isPathInside } from "@skillset/core/internal/path";

const repoRoot = resolve(import.meta.dir, "..");
const RECORD_DIR_ENV = "SKILLSET_CLI_INVOCATION_DIR";
const SOURCE_CLI = join(repoRoot, "apps", "skillset", "src", "cli.ts");
const TEST_GLOBS = ["apps/**/*.test.ts", "packages/**/*.test.ts", "scripts/**/*.test.ts"];

// Preloaded into every Bun process of the run. Synchronous and silent so it
// cannot change a test's stdout, stderr, or exit code.
const RECORDER = `const dir = process.env.${RECORD_DIR_ENV};
if (dir) {
  const { writeFileSync } = require("node:fs");
  const { join } = require("node:path");
  writeFileSync(
    join(dir, \`\${process.pid}-\${crypto.randomUUID()}.json\`),
    JSON.stringify({ argv: process.argv.slice(1), cwd: process.cwd(), main: Bun.main })
  );
}
`;

/** One Bun process the test run started. */
export interface ProcessRecord {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly main: string;
}

export type InvocationKind = "compiled" | "other" | "source";
export type CwdBucket = "repo" | "sandbox" | "temp" | "other";

export interface FileReport {
  readonly cwds: Readonly<Record<CwdBucket, number>>;
  readonly durationMs: number;
  readonly exitCode: number;
  readonly file: string;
  readonly invocations: Readonly<Record<InvocationKind, number>>;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));

async function main(argv: readonly string[]): Promise<number> {
  let options: { files: string[]; jobs: number; out: string };
  try {
    options = parseOptions(argv);
  } catch (error) {
    console.error(`test-cli-invocations: ${message(error)}`);
    console.error(
      "usage: bun scripts/test-cli-invocations.ts [--out <dir>] [--jobs <n>] [test files...]"
    );
    return 2;
  }
  const files = options.files.length > 0 ? options.files : await listTestFiles();
  const rawRoot = join(options.out, "raw");
  await rm(rawRoot, { force: true, recursive: true });
  await mkdir(rawRoot, { recursive: true });
  const preload = join(options.out, "record-invocation.ts");
  await writeFile(preload, RECORDER);

  const roots = { repo: repoRoot, temp: await realpath(tmpdir()) };
  const startedAt = new Date().toISOString();
  const loadBefore = loadavg();
  const reports: FileReport[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(options.jobs, files.length) }, async () => {
      while (next < files.length) {
        const index = next++;
        const file = files[index] ?? "";
        const recordDir = join(rawRoot, String(index));
        await mkdir(recordDir);
        const started = performance.now();
        const exitCode = await runFile(file, preload, recordDir);
        const records = await readRecords(recordDir);
        reports.push(summarize(file, exitCode, performance.now() - started, records, roots));
        console.error(
          `test-cli-invocations: ${reports.length}/${files.length} ${file} cli=${cliCount(reports.at(-1))}${exitCode === 0 ? "" : ` (exit ${exitCode})`}`
        );
      }
    })
  );
  reports.sort((a, b) => cliCount(b) - cliCount(a) || a.file.localeCompare(b.file));

  const totals = {
    cwds: sumBy(reports, (report) => report.cwds),
    invocations: sumBy(reports, (report) => report.invocations),
  };
  const report = {
    failedFiles: reports.filter((entry) => entry.exitCode !== 0).map((entry) => entry.file),
    files: reports,
    host: { loadAfter: loadavg(), loadBefore, parallelism: availableParallelism() },
    jobs: options.jobs,
    note: "Counts are a floor: children spawned without BUN_OPTIONS in their environment are not recorded.",
    revision: await gitHead(),
    startedAt,
    totals,
  };
  const reportPath = join(options.out, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await rm(rawRoot, { force: true, recursive: true });

  const cli = totals.invocations.source + totals.invocations.compiled;
  console.log(`CLI invocations: ${cli} (source ${totals.invocations.source}, compiled ${totals.invocations.compiled}) across ${reports.filter((entry) => cliCount(entry) > 0).length} of ${reports.length} files`);
  console.log(`CLI cwd: ${Object.entries(totals.cwds).map(([bucket, count]) => `${bucket} ${count}`).join(", ")}`);
  console.log(`Other Bun processes: ${totals.invocations.other}`);
  for (const entry of reports.slice(0, 10)) console.log(`  ${cliCount(entry)}\t${entry.file}`);
  if (report.failedFiles.length > 0) console.log(`Failed files: ${report.failedFiles.join(", ")}`);
  console.log(`Report: ${relative(process.cwd(), reportPath)}`);
  return report.failedFiles.length === 0 ? 0 : 1;
}

/** Classify a recorded process: the CLI from source, the compiled CLI, or anything else. */
export function classifyProcess(record: ProcessRecord, sourceCli = SOURCE_CLI): InvocationKind {
  if (record.main === sourceCli) return "source";
  // Compiled executables report their entrypoint inside Bun's embedded filesystem.
  if (/^(?:\/\$bunfs\/root\/|[A-Z]:\\~BUN\\root\\)skillset(?:\.exe)?$/u.test(record.main)) {
    return "compiled";
  }
  return "other";
}

/** Where a CLI invocation ran, which matters for the temp-directory crowding cost (SET-626). */
export function bucketCwd(cwd: string, roots: { readonly repo: string; readonly temp: string }): CwdBucket {
  if (cwd === roots.repo || isPathInside(roots.repo, cwd)) return "repo";
  if (cwd === roots.temp) return "temp";
  if (isPathInside(roots.temp, cwd)) {
    return relative(roots.temp, cwd).split(sep)[0]?.startsWith("skillset-test-") ? "sandbox" : "temp";
  }
  return "other";
}

export function summarize(
  file: string,
  exitCode: number,
  durationMs: number,
  records: readonly ProcessRecord[],
  roots: { readonly repo: string; readonly temp: string }
): FileReport {
  const invocations = { compiled: 0, other: 0, source: 0 };
  const cwds = { other: 0, repo: 0, sandbox: 0, temp: 0 };
  for (const record of records) {
    const kind = classifyProcess(record);
    invocations[kind] += 1;
    if (kind !== "other") cwds[bucketCwd(record.cwd, roots)] += 1;
  }
  return { cwds, durationMs: Math.round(durationMs), exitCode, file, invocations };
}

function cliCount(report: FileReport | undefined): number {
  return report === undefined ? 0 : report.invocations.source + report.invocations.compiled;
}

async function runFile(file: string, preload: string, recordDir: string): Promise<number> {
  const env: Record<string, string | undefined> = {
    ...gitSafeEnv(),
    BUN_OPTIONS: [process.env.BUN_OPTIONS, `--preload=${preload}`].filter(Boolean).join(" "),
    [RECORD_DIR_ENV]: recordDir,
  };
  const child = Bun.spawn({
    cmd: ["bun", join(repoRoot, "scripts", "test-sandbox.ts"), "bun", "test", "--timeout", "15000", file],
    cwd: repoRoot,
    env,
    stderr: Bun.file(`${recordDir}.log`),
    stdout: "ignore",
  });
  return child.exited;
}

async function readRecords(dir: string): Promise<ProcessRecord[]> {
  const names = await readdir(dir);
  return Promise.all(
    names.map(async (name) => JSON.parse(await readFile(join(dir, name), "utf8")) as ProcessRecord)
  );
}

async function listTestFiles(): Promise<string[]> {
  const child = Bun.spawn({
    cmd: ["git", "ls-files", ...TEST_GLOBS],
    cwd: repoRoot,
    env: gitSafeEnv(),
    stdout: "pipe",
  });
  const [text, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (exitCode !== 0) throw new Error("git ls-files failed");
  return text.split("\n").filter(Boolean);
}

async function gitHead(): Promise<string> {
  const child = Bun.spawn({ cmd: ["git", "rev-parse", "HEAD"], cwd: repoRoot, env: gitSafeEnv(), stdout: "pipe" });
  return (await new Response(child.stdout).text()).trim();
}

function parseOptions(argv: readonly string[]) {
  const options = { files: [] as string[], jobs: 4, out: join(repoRoot, ".skillset", "cache", "cli-invocations") };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--out" || arg === "--jobs") {
      const value = argv[++index];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      if (arg === "--out") options.out = resolve(value);
      else {
        const jobs = Number(value);
        if (!Number.isInteger(jobs) || jobs < 1) throw new Error("--jobs must be a positive integer");
        options.jobs = jobs;
      }
    } else if (arg?.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else if (arg !== undefined) {
      options.files.push(arg);
    }
  }
  return options;
}

function sumBy<K extends string>(
  reports: readonly FileReport[],
  pick: (report: FileReport) => Readonly<Record<K, number>>
): Record<K, number> {
  const total: Partial<Record<K, number>> = {};
  for (const report of reports) {
    const counts = pick(report);
    for (const key of Object.keys(counts) as K[]) {
      total[key] = (total[key] ?? 0) + counts[key];
    }
  }
  return total as Record<K, number>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
