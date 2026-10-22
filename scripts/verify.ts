/**
 * Run the full repository gate against exact commits and record receipts.
 *
 * The full gate used to run inside `git push` through the lefthook pre-push
 * hook. Under `gh stack submit` that held the clone-wide stack lock for the
 * whole run, checked only the working tree at `HEAD`, and left no record of
 * which commit had actually been verified. This runner moves the full gate
 * out of the push path:
 *
 * - each requested ref resolves once to a commit;
 * - the commit is checked out into a disposable clone, so the working tree,
 *   other worktrees and uncommitted edits cannot leak into the result;
 * - dependencies install from the frozen lockfile with the pinned Bun;
 * - the gates in `VERIFY_GATES` run in order;
 * - on success a receipt keyed by the commit's tree lands in the shared Git
 *   directory, where every worktree of the clone can read it.
 *
 * Receipts are keyed by tree, not commit, so a reworded commit or a restack
 * that changes nothing keeps its receipt. A receipt is valid only when its
 * gate list matches `VERIFY_GATES` exactly; changing the gates retires every
 * older receipt. A failed or interrupted gate writes no receipt and keeps its
 * logs under `<git-common-dir>/skillset/verify/<tree>/`.
 *
 * Usage:
 *   bun scripts/verify.ts [--jobs <n>] [--force] [--keep] [<ref>...]
 *   bun scripts/verify.ts --status [<ref>...]
 *
 * Refs default to `HEAD`. `--status` reports receipts without running gates
 * and exits non-zero when any ref lacks a valid one.
 */
import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { arch, availableParallelism, platform, release, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { gitSafeEnv } from "../apps/skillset/src/git-env";
import { TEST_SANDBOX_ENV } from "../apps/skillset/src/verification-sandbox";
import { prependExecutablePath, resolvePinnedBun } from "./pinned-bun";

export const VERIFY_RECEIPT_SCHEMA_VERSION = 1;

/**
 * The full gate, in order. This is what a receipt certifies, and what CI's
 * required `check` and `skillset-ci` jobs run on a pull request.
 */
export const VERIFY_GATES: readonly (readonly string[])[] = [
  ["bun", "run", "check"],
  ["bun", "run", "skillset:check:ci:report"],
];

export interface GateResult {
  readonly argv: readonly string[];
  readonly exitCode: number;
  readonly durationMs: number;
}

export interface VerifyReceipt {
  readonly schemaVersion: typeof VERIFY_RECEIPT_SCHEMA_VERSION;
  readonly tree: string;
  readonly commit: string;
  readonly trunk: { readonly ref: string; readonly commit: string };
  readonly mergeBase: string | null;
  readonly gates: readonly GateResult[];
  readonly bunVersion: string;
  readonly lockfileSha256: string;
  readonly host: {
    readonly platform: string;
    readonly arch: string;
    readonly release: string;
  };
  readonly startedAt: string;
  readonly endedAt: string;
}

/** Why a stored receipt does or does not certify a tree. */
export type ReceiptStatus =
  | { readonly valid: true; readonly receipt: VerifyReceipt }
  | { readonly valid: false; readonly reason: string };

/** Decide whether a parsed receipt certifies `tree` under the current gates. */
export function checkReceipt(value: unknown, tree: string): ReceiptStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, reason: "receipt is not an object" };
  }
  const receipt = value as Partial<VerifyReceipt>;
  if (receipt.schemaVersion !== VERIFY_RECEIPT_SCHEMA_VERSION) {
    return { valid: false, reason: "receipt schema version changed" };
  }
  if (receipt.tree !== tree) {
    return { valid: false, reason: "receipt names a different tree" };
  }
  const gates = Array.isArray(receipt.gates) ? receipt.gates : [];
  const argvs = gates.map((gate) => gate?.argv);
  if (JSON.stringify(argvs) !== JSON.stringify(VERIFY_GATES)) {
    return { valid: false, reason: "gate list changed since this receipt" };
  }
  if (gates.some((gate) => gate.exitCode !== 0)) {
    return { valid: false, reason: "receipt records a failed gate" };
  }
  return { valid: true, receipt: receipt as VerifyReceipt };
}

/** Where receipts live: the shared Git directory, visible to every worktree. */
export function receiptPath(gitCommonDir: string, tree: string): string {
  return join(gitCommonDir, "skillset", "receipts", `${tree}.json`);
}

export async function readReceiptStatus(
  gitCommonDir: string,
  tree: string
): Promise<ReceiptStatus> {
  let raw: string;
  try {
    raw = await readFile(receiptPath(gitCommonDir, tree), "utf8");
  } catch {
    return { valid: false, reason: "no receipt" };
  }
  try {
    return checkReceipt(JSON.parse(raw), tree);
  } catch {
    return { valid: false, reason: "receipt is not valid JSON" };
  }
}

/** Write a receipt only when every gate passed; never certify a failure. */
export async function writeReceipt(
  gitCommonDir: string,
  receipt: VerifyReceipt
): Promise<string> {
  const status = checkReceipt(receipt, receipt.tree);
  if (!status.valid) {
    throw new Error(`refusing to write receipt: ${status.reason}`);
  }
  const path = receiptPath(gitCommonDir, receipt.tree);
  await mkdir(join(gitCommonDir, "skillset", "receipts"), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(receipt, null, 2)}\n`);
  // Rename so a concurrent reader never sees a half-written receipt.
  await rename(temp, path);
  return path;
}

/** Runs one gate in a checkout and resolves to its exit code. */
export type GateRunner = (
  argv: readonly string[],
  cwd: string,
  logPath: string
) => Promise<number>;

export interface VerifyTarget {
  readonly ref: string;
  readonly commit: string;
  readonly tree: string;
}

export interface VerifyContext {
  readonly repoRoot: string;
  readonly gitCommonDir: string;
  readonly trunk: { readonly ref: string; readonly commit: string };
  readonly originUrl: string | null;
  readonly bunVersion: string;
  /** Prepares the disposable checkout; returns its path. */
  readonly prepare: (target: VerifyTarget, logDir: string) => Promise<string>;
  readonly runGate: GateRunner;
  readonly keep: boolean;
}

export type VerifyOutcome =
  | {
      readonly kind: "passed";
      readonly receiptPath: string;
      readonly ms: number;
    }
  | {
      readonly kind: "failed";
      readonly gate: readonly string[];
      readonly logDir: string;
      readonly checkout: string | null;
    };

/** Verify one target: prepare a checkout, run every gate, write a receipt. */
export async function verifyTarget(
  target: VerifyTarget,
  context: VerifyContext
): Promise<VerifyOutcome> {
  const logDir = join(context.gitCommonDir, "skillset", "verify", target.tree);
  await rm(logDir, { force: true, recursive: true });
  await mkdir(logDir, { recursive: true });
  const startedAt = new Date();
  let checkout: string | null = null;
  let keepCheckout = context.keep;
  try {
    checkout = await context.prepare(target, logDir);
    const gates: GateResult[] = [];
    for (const [index, argv] of VERIFY_GATES.entries()) {
      const begin = performance.now();
      const exitCode = await context.runGate(
        argv,
        checkout,
        join(logDir, `${index + 1}-${argv.at(-1)?.replaceAll(":", "-")}.log`)
      );
      gates.push({
        argv,
        exitCode,
        durationMs: Math.round(performance.now() - begin),
      });
      if (exitCode !== 0) {
        keepCheckout = true;
        return { kind: "failed", gate: argv, logDir, checkout };
      }
    }
    const receipt: VerifyReceipt = {
      schemaVersion: VERIFY_RECEIPT_SCHEMA_VERSION,
      tree: target.tree,
      commit: target.commit,
      trunk: context.trunk,
      mergeBase: await mergeBase(
        context.repoRoot,
        target.commit,
        context.trunk.commit
      ),
      gates,
      bunVersion: context.bunVersion,
      lockfileSha256: await lockfileDigest(checkout),
      host: { platform: platform(), arch: arch(), release: release() },
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
    };
    const path = await writeReceipt(context.gitCommonDir, receipt);
    return {
      kind: "passed",
      receiptPath: path,
      ms: Date.now() - startedAt.getTime(),
    };
  } finally {
    if (checkout && !keepCheckout) {
      await rm(checkout, { force: true, recursive: true });
    }
  }
}

async function lockfileDigest(checkout: string): Promise<string> {
  try {
    const bytes = await readFile(join(checkout, "bun.lock"));
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    return "missing";
  }
}

async function mergeBase(
  repoRoot: string,
  commit: string,
  trunk: string
): Promise<string | null> {
  const result = await git(["merge-base", commit, trunk], repoRoot, true);
  return result.code === 0 ? result.stdout : null;
}

interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function git(
  args: readonly string[],
  cwd: string,
  allowFailure = false
): Promise<GitResult> {
  const child = Bun.spawn({
    cmd: ["git", ...args],
    cwd,
    env: { ...gitSafeEnv(), GIT_PAGER: "cat" },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(" ")} exited ${code}: ${stderr.trim()}`);
  }
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

/** Environment for gates: no inherited sandbox and no Git repository targeting. */
function gateEnv(binDir: string): Record<string, string> {
  const { [TEST_SANDBOX_ENV]: _inherited, ...env } = gitSafeEnv();
  env.GIT_PAGER = "cat";
  env.PATH = prependExecutablePath(binDir, env.PATH);
  return env;
}

async function spawnLogged(
  cmd: readonly string[],
  cwd: string,
  env: Record<string, string>,
  logPath: string
): Promise<number> {
  const child = Bun.spawn({
    cmd: [...cmd],
    cwd,
    env,
    stdin: "ignore",
    stdout: Bun.file(logPath),
    stderr: "pipe",
  });
  // Bun cannot point two streams at one file, so append stderr after exit.
  const [stderr, code] = await Promise.all([
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (stderr.length > 0) {
    await appendFile(logPath, `\n--- stderr ---\n${stderr}`);
  }
  return code;
}

/**
 * Clone the source repository without a working tree, then check out the
 * target commit. `--shared` borrows the source object store, so the clone is
 * cheap and needs no network; the remote URL and trunk ref are rewritten so
 * trunk-relative gates see the same trunk the source checkout does.
 */
function clonePreparer(
  context: Pick<VerifyContext, "repoRoot" | "trunk" | "originUrl">,
  pinned: { readonly binPath: string; readonly binDir: string }
): VerifyContext["prepare"] {
  return async (target, logDir) => {
    const dir = await mkdtemp(
      join(tmpdir(), `skillset-verify-${target.tree.slice(0, 12)}-`)
    );
    try {
      await git(
        [
          "clone",
          "--quiet",
          "--shared",
          "--no-checkout",
          context.repoRoot,
          dir,
        ],
        context.repoRoot
      );
      await git(["checkout", "--quiet", "--detach", target.commit], dir);
      const trunkName = context.trunk.ref.replace(/^origin\//u, "");
      await git(
        [
          "update-ref",
          `refs/remotes/origin/${trunkName}`,
          context.trunk.commit,
        ],
        dir
      );
      await git(
        [
          "symbolic-ref",
          "refs/remotes/origin/HEAD",
          `refs/remotes/origin/${trunkName}`,
        ],
        dir
      );
      if (context.originUrl) {
        await git(["remote", "set-url", "origin", context.originUrl], dir);
      }
      const code = await spawnLogged(
        [pinned.binPath, "install", "--frozen-lockfile"],
        dir,
        gateEnv(pinned.binDir),
        join(logDir, "0-install.log")
      );
      if (code !== 0) {
        throw new Error(
          `bun install --frozen-lockfile exited ${code}; see ${join(logDir, "0-install.log")}`
        );
      }
      return dir;
    } catch (error) {
      await rm(dir, { force: true, recursive: true });
      throw error;
    }
  };
}

interface Options {
  readonly refs: readonly string[];
  readonly jobs: number;
  readonly force: boolean;
  readonly keep: boolean;
  readonly status: boolean;
}

export function parseOptions(argv: readonly string[]): Options {
  const refs: string[] = [];
  let jobs = Math.max(1, Math.floor(availableParallelism() / 2));
  let force = false;
  let keep = false;
  let status = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") force = true;
    else if (arg === "--keep") keep = true;
    else if (arg === "--status") status = true;
    else if (arg === "--jobs") {
      const value = Number(argv[index + 1]);
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error("--jobs needs a positive integer");
      }
      jobs = value;
      index += 1;
    } else if (arg?.startsWith("-")) {
      throw new Error(`unknown option ${arg}`);
    } else if (arg) refs.push(arg);
  }
  return { refs: refs.length > 0 ? refs : ["HEAD"], jobs, force, keep, status };
}

async function resolveTarget(
  repoRoot: string,
  ref: string
): Promise<VerifyTarget> {
  const commit = (
    await git(["rev-parse", "--verify", `${ref}^{commit}`], repoRoot)
  ).stdout;
  const tree = (await git(["rev-parse", `${commit}^{tree}`], repoRoot)).stdout;
  return { ref, commit, tree };
}

async function resolveTrunk(
  repoRoot: string
): Promise<{ readonly ref: string; readonly commit: string }> {
  const symbolic = await git(
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    repoRoot,
    true
  );
  const ref =
    symbolic.code === 0 && symbolic.stdout ? symbolic.stdout : "origin/main";
  const commit = (
    await git(["rev-parse", "--verify", `${ref}^{commit}`], repoRoot)
  ).stdout;
  return { ref, commit };
}

async function pool<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await work(items[index] as T);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function short(sha: string): string {
  return sha.slice(0, 12);
}

function minutes(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

async function main(argv: readonly string[]): Promise<number> {
  let options: Options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    console.error(`verify: ${error instanceof Error ? error.message : error}`);
    console.error(
      "usage: bun scripts/verify.ts [--jobs <n>] [--force] [--keep] [--status] [<ref>...]"
    );
    return 2;
  }
  const cwd = process.cwd();
  const repoRoot = (await git(["rev-parse", "--show-toplevel"], cwd)).stdout;
  const commonRaw = (await git(["rev-parse", "--git-common-dir"], repoRoot))
    .stdout;
  const gitCommonDir = isAbsolute(commonRaw)
    ? commonRaw
    : resolve(repoRoot, commonRaw);
  const targets = await Promise.all(
    options.refs.map((ref) => resolveTarget(repoRoot, ref))
  );

  const pending: VerifyTarget[] = [];
  let missing = 0;
  for (const target of targets) {
    const status = await readReceiptStatus(gitCommonDir, target.tree);
    const label = `${target.ref} (${short(target.commit)}, tree ${short(target.tree)})`;
    if (status.valid && !options.force) {
      console.log(`verify: ${label}: verified ${status.receipt.endedAt}`);
      continue;
    }
    if (options.status) {
      const reason = status.valid ? "re-verification forced" : status.reason;
      console.log(`verify: ${label}: not verified (${reason})`);
      missing += 1;
      continue;
    }
    pending.push(target);
  }
  if (options.status) return missing === 0 ? 0 : 1;
  if (pending.length === 0) return 0;

  const dirty = await git(["status", "--porcelain"], repoRoot);
  if (dirty.stdout.length > 0) {
    console.log(
      "verify: the working tree has uncommitted changes; they are not verified. Only committed trees get receipts."
    );
  }

  const pinned = await resolvePinnedBun(repoRoot);
  const trunk = await resolveTrunk(repoRoot);
  const origin = await git(["remote", "get-url", "origin"], repoRoot, true);
  const env = gateEnv(pinned.binDir);
  const base = {
    repoRoot,
    trunk,
    originUrl: origin.code === 0 ? origin.stdout : null,
  };
  const context: VerifyContext = {
    ...base,
    gitCommonDir,
    bunVersion: pinned.version,
    keep: options.keep,
    prepare: clonePreparer(base, pinned),
    runGate: (gateArgv, checkout, logPath) =>
      spawnLogged(
        [pinned.binPath, ...gateArgv.slice(1)],
        checkout,
        env,
        logPath
      ),
  };

  console.log(
    `verify: ${pending.length} ref(s) against ${trunk.ref} (${short(trunk.commit)}), up to ${options.jobs} at a time`
  );
  let failures = 0;
  await pool(pending, options.jobs, async (target) => {
    const label = `${target.ref} (${short(target.commit)}, tree ${short(target.tree)})`;
    try {
      const outcome = await verifyTarget(target, context);
      if (outcome.kind === "passed") {
        console.log(`verify: ${label}: passed in ${minutes(outcome.ms)}`);
      } else {
        failures += 1;
        console.error(
          `verify: ${label}: ${outcome.gate.join(" ")} failed; logs in ${outcome.logDir}` +
            (outcome.checkout ? `, checkout kept at ${outcome.checkout}` : "")
        );
      }
    } catch (error) {
      failures += 1;
      console.error(
        `verify: ${label}: ${error instanceof Error ? error.message : error}`
      );
    }
  });
  return failures === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
