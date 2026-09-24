import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

import { type PinnedBun, prependExecutablePath } from "./pinned-bun";
import { safeGitEnv, sha256 } from "./test-shard-contract";

const MARKER = "owner.json";

export interface ShardWorkspace {
  readonly index: number;
  readonly repo: string;
  readonly temp: string;
  readonly env: NodeJS.ProcessEnv;
  readonly log: string;
  readonly junit: string;
  readonly rusage: string;
  readonly setupLog: string;
  readonly bunCache: string;
}

export async function prepareShardOutput(
  repo: string,
  requested: string
): Promise<string> {
  const requestedOut = resolve(requested);
  const out = join(
    await realpath(dirname(requestedOut)),
    basename(requestedOut)
  );
  if (pathsOverlap(out, repo))
    throw new Error("output directory overlaps the source checkout");
  if ((await lstat(out).catch(() => null))?.isSymbolicLink())
    throw new Error("output directory is a symlink");
  await mkdir(out, { recursive: true });
  if ((await realpath(out)) !== out)
    throw new Error("output directory changed identity");
  if ((await readdir(out)).length !== 0)
    throw new Error(
      "output directory is not empty; refusing stale shard reports"
    );
  return out;
}

export async function writeRunAssets(
  root: string,
  invocationId: string,
  repo: string,
  out: string,
  head: string,
  timingBytes: Uint8Array
): Promise<{ timingCopy: string; timingSha256: string }> {
  const tempRoot = await realpath(tmpdir());
  const stat = await lstat(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (await realpath(root)) !== root ||
    dirname(root) !== tempRoot ||
    !basename(root).startsWith("skillset-shards-") ||
    pathsOverlap(root, repo) ||
    pathsOverlap(root, out)
  )
    throw new Error("shard run root is not an owned OS-temp directory");
  await writeFile(
    join(root, MARKER),
    JSON.stringify({ invocationId, repo, head })
  );
  const timingCopy = join(root, "timings.json");
  await writeFile(timingCopy, timingBytes);
  await chmod(timingCopy, 0o444);
  return { timingCopy, timingSha256: sha256(timingBytes) };
}

export async function prepareShardWorkspace(
  runRoot: string,
  out: string,
  index: number,
  pinned: PinnedBun
): Promise<ShardWorkspace> {
  const repo = join(runRoot, `checkout-${index}`);
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
    PATH: prependExecutablePath(pinned.binDir, process.env.PATH),
    TMPDIR: temp,
    XDG_CACHE_HOME: join(xdg, "cache"),
    XDG_CONFIG_HOME: join(xdg, "config"),
    XDG_DATA_HOME: join(xdg, "data"),
    XDG_STATE_HOME: join(xdg, "state"),
  };
  delete env.SKILLSET_TEST_SANDBOX;
  return {
    bunCache: join(shardRoot, "bun-cache"),
    env,
    index,
    junit: join(out, `shard-${index}.xml`),
    log: join(out, `shard-${index}.log`),
    repo,
    rusage: join(out, `shard-${index}.rusage.txt`),
    setupLog: join(out, `shard-${index}-setup.log`),
    temp,
  };
}

export async function removeOwnedRunRoot(
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
  )
    throw new Error(`refusing to remove unowned shard root ${root}`);
  await rm(root, { recursive: true });
}

export async function writeFailedShardReceipt(
  out: string,
  startedAt: string,
  reason: string,
  runRoot?: string
): Promise<void> {
  await writeFile(
    join(out, "aggregate.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        status: "failed",
        startedAt,
        endedAt: new Date().toISOString(),
        reason,
        retainedRunRoot: runRoot ?? null,
      },
      null,
      2
    )}\n`
  );
}

function pathsOverlap(left: string, right: string): boolean {
  if (!isAbsolute(left) || !isAbsolute(right)) return true;
  return (
    left === right ||
    left.startsWith(`${right}${sep}`) ||
    right.startsWith(`${left}${sep}`)
  );
}
