import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  startDefaultDirectoryLockHeartbeat,
  withOwnedDirectoryLock,
  type DirectoryLockHeartbeatScheduler,
  type DirectoryLockStaleOwnerPolicy,
  type DirectoryLockTiming,
} from "../directory-lock";
import { createTestGitFixtureRoot } from "../../../../scripts/test-helpers/git-remote";

const SUCCESSOR_TOKEN = "b".repeat(32);

describe("owner-fenced directory lock", () => {
  test("SET-645 only the current token holder can release a lock", async () => {
    const root = await createTestGitFixtureRoot("skillset-directory-lock-release-");
    const lockPath = join(root, "resource.lock");
    const displacedPath = `${lockPath}.displaced`;
    await withOwnedDirectoryLock(
      lockOptions(lockPath, {
        afterAcquired: async () => {
          await rename(lockPath, displacedPath);
          await seedLock(lockPath, SUCCESSOR_TOKEN, 1_000);
        },
      }),
      async (lock) => {
        await expect(lock.assertOwned()).rejects.toThrow(
          "lost ownership of directory lock"
        );
      }
    );
    expect(await currentOwner(lockPath)).toMatchObject({
      token: SUCCESSOR_TOKEN,
    });
    expect(await lockArtifacts(root)).toContain("resource.lock.displaced");
    await rm(lockPath, { force: true, recursive: true });
    await rm(displacedPath, { force: true, recursive: true });
  });

  test("SET-645 lease-only reclaim ignores a live PID once the lease expires", async () => {
    const root = await createTestGitFixtureRoot("skillset-directory-lock-lease-only-");
    const lockPath = join(root, "resource.lock");
    await seedLock(lockPath, "a".repeat(32), 0, process.pid);

    const acquired = await withOwnedDirectoryLock(lockOptions(lockPath, {
      now: () => 100,
      staleOwner: { kind: "lease-only" },
    }), async (lock) => {
      await lock.assertOwned();
      return lock.token;
    });

    expect(acquired).toMatch(/^[0-9a-f]{32}$/);
    expect(await lockArtifacts(root)).toEqual([]);
  });

  test("SET-645 lease-and-dead-process will not reclaim a live over-lease owner", async () => {
    const root = await createTestGitFixtureRoot("skillset-directory-lock-live-pid-");
    const lockPath = join(root, "resource.lock");
    await seedLock(lockPath, "a".repeat(32), 0, process.pid);

    await expect(
      withOwnedDirectoryLock(
        lockOptions(lockPath, {
          now: () => 100,
          staleOwner: {
            isProcessAlive: () => true,
            kind: "lease-and-dead-process",
          },
          timeoutMs: 5,
        }),
        async () => "should-not-run"
      )
    ).rejects.toThrow("timed out waiting for directory lock");
    expect(await currentOwner(lockPath)).toMatchObject({
      token: "a".repeat(32),
    });
    await rm(lockPath, { force: true, recursive: true });
  });

  test("SET-645 lease-and-dead-process reclaims a dead stale owner", async () => {
    const root = await createTestGitFixtureRoot("skillset-directory-lock-dead-pid-");
    const lockPath = join(root, "resource.lock");
    await seedLock(lockPath, "a".repeat(32), 0, 999_999);

    await withOwnedDirectoryLock(lockOptions(lockPath, {
      now: () => 100,
      staleOwner: { isProcessAlive: () => false, kind: "lease-and-dead-process" },
    }), async (lock) => lock.assertOwned());
    expect(await lockArtifacts(root)).toEqual([]);
  });

  test("SET-645 a heartbeat keeps an over-lease live holder from being reclaimed", async () => {
    const root = await createTestGitFixtureRoot("skillset-directory-lock-heartbeat-");
    const lockPath = join(root, "resource.lock");
    const entered = deferred<void>();
    const release = deferred<void>();
    let heartbeatTick: (() => Promise<void>) | undefined;
    let now = 0;
    const holder = withOwnedDirectoryLock(lockOptions(lockPath, {
      afterAcquired: async () => {
        entered.resolve();
        await release.promise;
      },
      now: () => now,
      startHeartbeat: (heartbeat) => {
        heartbeatTick = heartbeat;
        return () => undefined;
      },
    }), async (lock) => lock.assertOwned());
    await entered.promise;
    now = 20;
    if (heartbeatTick === undefined) throw new Error("missing heartbeat test seam");
    await utimes(lockPath, new Date(0), new Date(0));
    await heartbeatTick();
    expect((await stat(lockPath)).mtimeMs).toBeGreaterThan(0);

    await expect(withOwnedDirectoryLock(lockOptions(lockPath, {
      now: () => now,
      timeoutMs: 5,
    }), async () => "should-not-run")).rejects.toThrow("timed out waiting for directory lock");
    release.resolve();
    await holder;
    expect(await lockArtifacts(root)).toEqual([]);
  });

  test("SET-645 an active legacy root lock blocks claim-protocol entry", async () => {
    const root = await createTestGitFixtureRoot("skillset-directory-lock-legacy-live-");
    const lockPath = join(root, "resource.lock");
    const token = "a".repeat(32);
    await seedLegacyLock(lockPath, token, 100, process.pid);
    let entered = false;

    await expect(
      withOwnedDirectoryLock(
        lockOptions(lockPath, {
          now: () => 100,
          timeoutMs: 5,
        }),
        async () => {
          entered = true;
        }
      )
    ).rejects.toThrow("timed out waiting for directory lock");

    expect(entered).toBe(false);
    expect(
      JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8"))
    ).toMatchObject({ token });
    expect((await readdir(lockPath)).some((name) => name.startsWith("claim-"))).toBe(false);
    await rm(lockPath, { force: true, recursive: true });
  });

  test("SET-645 a stale legacy root lock fails closed until offline cleanup", async () => {
    const root = await createTestGitFixtureRoot("skillset-directory-lock-legacy-stale-");
    const lockPath = join(root, "resource.lock");
    const token = "a".repeat(32);
    await seedLegacyLock(lockPath, token, 0, 999_999);
    let entered = false;

    await expect(withOwnedDirectoryLock(lockOptions(lockPath, {
      now: () => 100,
      timeoutMs: 5,
    }), async () => {
      entered = true;
    })).rejects.toThrow("timed out waiting for directory lock");

    expect(entered).toBe(false);
    expect(JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8"))).toMatchObject({ token });
    expect((await readdir(lockPath)).some((name) => name.startsWith("claim-"))).toBe(false);
    await rm(lockPath, { force: true, recursive: true });
  });

  test("SET-645 stale fencing revalidates a heartbeat read during publication", async () => {
    const root = await createTestGitFixtureRoot("skillset-directory-lock-revalidate-");
    const lockPath = join(root, "resource.lock");
    const token = "a".repeat(32);
    await seedLock(lockPath, token, 0);
    await writeFile(join(lockPath, `claim-${token}`, `heartbeat-${token}.json`), "{", "utf8");
    let fenced = 0;

    await expect(withOwnedDirectoryLock(lockOptions(lockPath, {
      afterStaleClaimFenced: async (fencedPath) => {
        fenced += 1;
        await writeFile(
          join(fencedPath, `heartbeat-${token}.json`),
          `${JSON.stringify({ heartbeatAt: 100, token })}\n`,
          "utf8"
        );
      },
      now: () => 100,
      timeoutMs: 5,
    }), async () => "should-not-run")).rejects.toThrow("timed out waiting for directory lock");

    expect(fenced).toBe(1);
    expect(await currentOwner(lockPath)).toMatchObject({ token });
    await rm(lockPath, { force: true, recursive: true });
  });

  test("SET-645 stale takeover survives delayed cleanup by a competing former owner", async () => {
    const root = await createTestGitFixtureRoot("skillset-directory-lock-processes-");
    const lockPath = join(root, "resource.lock");
    const holderAcquired = join(root, "holder-acquired");
    const successorAcquired = join(root, "successor-acquired");
    const successorContended = join(root, "successor-contended");
    const thirdAcquired = join(root, "third-acquired");
    const thirdContended = join(root, "third-contended");
    const releaseHolder = join(root, "release-holder");
    const releaseSuccessor = join(root, "release-successor");
    const script = [
      'import { withOwnedDirectoryLock } from "./packages/core/src/directory-lock.ts";',
      "const marker = async (path) => { await Bun.write(path, \"ready\\n\"); };",
      "const wait = async (path) => { while (!(await Bun.file(path).exists())) await Bun.sleep(1); };",
      "await withOwnedDirectoryLock({",
      "  afterAcquired: async () => { await marker(process.env.ACQUIRED); if (process.env.RELEASE) await wait(process.env.RELEASE); },",
      "  lockPath: process.env.LOCK_PATH,",
      "  lostOwnershipError: () => new Error(\"lost ownership of directory lock\"),",
      "  onContention: process.env.CONTENDED ? async () => marker(process.env.CONTENDED) : undefined,",
      "  ownerPid: process.pid,",
      "  staleOwner: { kind: \"lease-only\" },",
      "  startHeartbeat: process.env.HEARTBEAT === \"off\" ? () => () => undefined : (heartbeat, ms) => { const timer = setInterval(() => { void heartbeat(); }, ms); timer.unref(); return () => clearInterval(timer); },",
      "  timeoutError: () => new Error(\"timed out waiting for directory lock\"),",
      "  timing: { heartbeatMs: 1000, leaseMs: Number(process.env.LEASE_MS), now: () => Number(process.env.NOW), pollMs: 1, timeoutMs: Number(process.env.TIMEOUT_MS) },",
      "}, async () => undefined);",
    ].join("\n");
    const spawnWorker = (env: Record<string, string>) => Bun.spawn({
      cmd: ["bun", "-e", script],
      cwd: join(import.meta.dir, "../../../.."),
      env: { ...process.env, LOCK_PATH: lockPath, ...env },
      stderr: "pipe",
      stdout: "pipe",
    });

    const holder = spawnWorker({
      ACQUIRED: holderAcquired,
      HEARTBEAT: "off",
      LEASE_MS: "10",
      NOW: "0",
      RELEASE: releaseHolder,
      TIMEOUT_MS: "2000",
    });
    await waitForFile(holderAcquired);

    const successor = spawnWorker({
      ACQUIRED: successorAcquired,
      CONTENDED: successorContended,
      LEASE_MS: "10",
      NOW: "100",
      RELEASE: releaseSuccessor,
      TIMEOUT_MS: "2000",
    });
    await waitForFile(successorContended);
    await waitForFile(successorAcquired);
    expect(await Bun.file(holderAcquired).exists()).toBe(true);

    const third = spawnWorker({
      ACQUIRED: thirdAcquired,
      CONTENDED: thirdContended,
      LEASE_MS: "10",
      NOW: "100",
      TIMEOUT_MS: "2000",
    });
    await waitForFile(thirdContended);
    expect(await Bun.file(thirdAcquired).exists()).toBe(false);

    await Bun.write(releaseHolder, "release\n");
    const [holderStderr, holderExit] = await Promise.all([
      new Response(holder.stderr).text(),
      holder.exited,
    ]);
    expect(holderExit, holderStderr).toBe(0);
    expect((await currentOwner(lockPath)).token).toMatch(/^[0-9a-f]{32}$/);
    expect(await Bun.file(thirdAcquired).exists()).toBe(false);

    await Bun.write(releaseSuccessor, "release\n");
    const [successorStderr, successorExit, thirdStderr, thirdExit] =
      await Promise.all([
        new Response(successor.stderr).text(),
        successor.exited,
        new Response(third.stderr).text(),
        third.exited,
      ]);
    expect(successorExit, successorStderr).toBe(0);
    expect(thirdExit, thirdStderr).toBe(0);
    expect(await Bun.file(thirdAcquired).exists()).toBe(true);
    expect(await lockArtifacts(root)).toEqual([]);
  });

  test("SET-645 a crashed claim is recovered without displacing its successor", async () => {
    const root = await createTestGitFixtureRoot(
      "skillset-directory-lock-crash-"
    );
    const lockPath = join(root, "resource.lock");
    const holderAcquired = join(root, "holder-acquired");
    const successorAcquired = join(root, "successor-acquired");
    const releaseHolder = join(root, "release-holder");
    const script = [
      'import { withOwnedDirectoryLock } from "./packages/core/src/directory-lock.ts";',
      "const wait = async (path) => { while (!(await Bun.file(path).exists())) await Bun.sleep(1); };",
      "await withOwnedDirectoryLock({",
      '  afterAcquired: async () => { await Bun.write(process.env.ACQUIRED, "ready\\n"); if (process.env.RELEASE) await wait(process.env.RELEASE); },',
      "  lockPath: process.env.LOCK_PATH,",
      '  lostOwnershipError: () => new Error("lost ownership"),',
      "  ownerPid: process.pid,",
      '  staleOwner: { kind: "lease-only" },',
      "  startHeartbeat: () => () => undefined,",
      '  timeoutError: () => new Error("timeout"),',
      "  timing: { heartbeatMs: 1000, leaseMs: 10, now: () => Number(process.env.NOW), pollMs: 1, timeoutMs: 2000 },",
      "}, async () => undefined);",
    ].join("\n");
    const spawnWorker = (env: Record<string, string>) =>
      Bun.spawn({
        cmd: ["bun", "-e", script],
        cwd: join(import.meta.dir, "../../../.."),
        env: { ...process.env, LOCK_PATH: lockPath, ...env },
        stderr: "pipe",
        stdout: "pipe",
      });

    const holder = spawnWorker({
      ACQUIRED: holderAcquired,
      NOW: "0",
      RELEASE: releaseHolder,
    });
    await waitForFile(holderAcquired);
    holder.kill();
    await holder.exited;

    const successor = spawnWorker({ ACQUIRED: successorAcquired, NOW: "100" });
    const [successorStderr, successorExit] = await Promise.all([
      new Response(successor.stderr).text(),
      successor.exited,
    ]);
    expect(successorExit, successorStderr).toBe(0);
    expect(await Bun.file(successorAcquired).exists()).toBe(true);
    expect(await lockArtifacts(root)).toEqual([]);
  });
});

function lockOptions(
  lockPath: string,
  overrides: {
    readonly afterAcquired?: () => Promise<void> | void;
    readonly afterStaleClaimFenced?: (claimPath: string) => Promise<void> | void;
    readonly now?: () => number;
    readonly staleOwner?: DirectoryLockStaleOwnerPolicy;
    readonly startHeartbeat?: DirectoryLockHeartbeatScheduler;
    readonly timeoutMs?: number;
  } = {}
) {
  const timing: DirectoryLockTiming = {
    heartbeatMs: 1_000,
    leaseMs: 10,
    now: overrides.now ?? Date.now,
    pollMs: 1,
    timeoutMs: overrides.timeoutMs ?? 50,
  };
  return {
    afterAcquired: overrides.afterAcquired,
    afterStaleClaimFenced: overrides.afterStaleClaimFenced,
    lockPath,
    lostOwnershipError: () => new Error("lost ownership of directory lock"),
    staleOwner: overrides.staleOwner ?? { kind: "lease-only" as const },
    startHeartbeat: overrides.startHeartbeat ?? startDefaultDirectoryLockHeartbeat,
    timeoutError: () => new Error("timed out waiting for directory lock"),
    timing,
    ownerPid: process.pid,
  };
}

async function seedLegacyLock(
  lockPath: string,
  token: string,
  heartbeatAt: number,
  pid: number
): Promise<void> {
  await mkdir(lockPath, { recursive: true });
  await writeFile(
    join(lockPath, "owner.json"),
    `${JSON.stringify({ createdAt: heartbeatAt, pid, token })}\n`,
    "utf8"
  );
  await writeFile(
    join(lockPath, `heartbeat-${token}.json`),
    `${JSON.stringify({ heartbeatAt, token })}\n`,
    "utf8"
  );
}

async function seedLock(
  lockPath: string,
  token: string,
  heartbeatAt: number,
  pid = 1_234
): Promise<void> {
  const claimPath = join(lockPath, `claim-${token}`);
  await mkdir(claimPath, { recursive: true });
  await writeFile(
    join(claimPath, "owner.json"),
    `${JSON.stringify({ createdAt: heartbeatAt, pid, ticket: 1, token })}\n`,
    "utf8"
  );
  await writeFile(
    join(claimPath, `heartbeat-${token}.json`),
    `${JSON.stringify({ heartbeatAt, token })}\n`,
    "utf8"
  );
}

async function currentOwner(
  lockPath: string
): Promise<{ readonly token: string }> {
  const claims = (await readdir(lockPath))
    .filter((name) => name.startsWith("claim-"))
    .toSorted();
  const owners = await Promise.all(
    claims.map(
      async (claim) =>
        JSON.parse(
          await readFile(join(lockPath, claim, "owner.json"), "utf8")
        ) as {
          readonly ticket: number;
          readonly token: string;
        }
    )
  );
  const owner = owners.toSorted(
    (left, right) =>
      left.ticket - right.ticket || left.token.localeCompare(right.token)
  )[0];
  if (owner === undefined)
    throw new Error(`missing current owner for ${lockPath}`);
  return owner;
}

async function lockArtifacts(root: string): Promise<readonly string[]> {
  return (await readdir(root)).filter((file) => file.includes("resource.lock"));
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5_000; attempt += 1) {
    if (await Bun.file(path).exists()) return;
    await Bun.sleep(1);
  }
  throw new Error(`timed out waiting for test marker ${path}`);
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
