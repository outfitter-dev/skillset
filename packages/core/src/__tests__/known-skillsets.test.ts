import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  knownSkillsetsIndexPath,
  normalizeKnownSkillsetIdentity,
  readKnownSkillsetsIndex,
  recordKnownSkillsetWorkspace,
  resolveKnownSkillsetWorkspace,
  updateKnownSkillsetsIndexForTest,
  writeKnownSkillsetsIndex,
} from "../known-skillsets";

describe("known Skillsets index", () => {
  test("reads and writes the managed index under the XDG config location", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-index-"));
    const options = xdgOptions(root);
    const workspacePath = join(root, "workspace");
    await mkdir(workspacePath);

    await writeKnownSkillsetsIndex({
      schemaVersion: 1,
      skillsets: [{
        cacheKey: "docs-cli--local-abc123def456",
        identities: ["github:acme/docs-cli"],
        path: workspacePath,
        repository: "https://github.com/acme/docs-cli.git",
      }],
    }, options);

    expect(knownSkillsetsIndexPath(options)).toBe(join(root, "config", "skillset", "skillsets.json"));
    await expect(readKnownSkillsetsIndex(options)).resolves.toEqual({
      schemaVersion: 1,
      skillsets: [{
        cacheKey: "docs-cli--local-abc123def456",
        identities: ["github:acme/docs-cli"],
        path: workspacePath,
        repository: "https://github.com/acme/docs-cli.git",
      }],
    });
  });

  test("records a workspace without writing repo-local files", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-record-"));
    const options = xdgOptions(root);
    const workspacePath = join(root, "workspace");
    await mkdir(workspacePath);
    await writeFile(join(workspacePath, "skillset.yaml"), "workspace:\n  cacheKey: docs-cli\n");
    const before = await readdir(workspacePath);
    const canonicalWorkspacePath = await realpath(workspacePath);

    const entry = await recordKnownSkillsetWorkspace(workspacePath, {
      ...options,
      repository: "git@github.com:Acme/docs-cli.git",
    });

    expect(entry).toEqual({
      cacheKey: "docs-cli",
      identities: ["github:acme/docs-cli"],
      path: canonicalWorkspacePath,
      repository: "git@github.com:Acme/docs-cli.git",
    });
    await expect(readdir(workspacePath)).resolves.toEqual(before);
    await expect(readFile(knownSkillsetsIndexPath(options), "utf8")).resolves.toContain("github:acme/docs-cli");
  });

  test("resolves known GitHub identities and skips stale paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-resolve-"));
    const options = xdgOptions(root);
    const livePath = join(root, "live");
    await mkdir(livePath);

    await writeKnownSkillsetsIndex({
      schemaVersion: 1,
      skillsets: [
        {
          cacheKey: "stale",
          identities: ["github:acme/docs-cli"],
          path: join(root, "missing"),
        },
        {
          cacheKey: "live",
          identities: ["github:acme/docs-cli"],
          path: livePath,
        },
      ],
    }, options);

    await expect(resolveKnownSkillsetWorkspace("https://github.com/Acme/docs-cli.git", options)).resolves.toEqual({
      cacheKey: "live",
      identities: ["github:acme/docs-cli"],
      path: livePath,
    });
    await expect(resolveKnownSkillsetWorkspace("github:acme/unknown", options)).resolves.toBeUndefined();
  });

  test("normalizes supported repository identity spellings", () => {
    expect(normalizeKnownSkillsetIdentity("github:Acme/docs-cli")).toBe("github:acme/docs-cli");
    expect(normalizeKnownSkillsetIdentity("github.com/Acme/docs-cli.git")).toBe("github:acme/docs-cli");
    expect(normalizeKnownSkillsetIdentity("https://github.com/Acme/docs-cli.git")).toBe("github:acme/docs-cli");
    expect(normalizeKnownSkillsetIdentity("ssh://git@github.com/Acme/docs-cli.git")).toBe("github:acme/docs-cli");
    expect(normalizeKnownSkillsetIdentity("git@github.com:Acme/docs-cli.git")).toBe("github:acme/docs-cli");
  });

  test("serializes contending updates before either reads the index", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-serialized-"));
    const options = xdgOptions(root);
    const firstPath = join(root, "first");
    const secondPath = join(root, "second");
    await Promise.all([mkdir(firstPath), mkdir(secondPath)]);
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    const secondContended = deferred<void>();
    let secondEntered = false;

    const first = updateKnownSkillsetsIndexForTest(entry(firstPath, "first"), options, {
      afterLockAcquired: async () => {
        firstEntered.resolve();
        await releaseFirst.promise;
      },
    });
    await firstEntered.promise;
    const second = updateKnownSkillsetsIndexForTest(entry(secondPath, "second"), options, {
      afterLockAcquired: () => {
        secondEntered = true;
      },
      onLockContention: () => secondContended.resolve(),
    });
    await secondContended.promise;
    expect(secondEntered).toBe(false);

    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect((await readKnownSkillsetsIndex(options)).skillsets.map((item) => item.cacheKey)).toEqual(["first", "second"]);
    expect(await transactionArtifacts(options)).toEqual([]);
  });

  test("keeps the prior bytes readable until a flushed replacement is published", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-publish-"));
    const options = xdgOptions(root);
    const firstPath = join(root, "first");
    const secondPath = join(root, "second");
    await Promise.all([mkdir(firstPath), mkdir(secondPath)]);
    await writeKnownSkillsetsIndex({ schemaVersion: 1, skillsets: [entry(firstPath, "first")] }, options);
    const before = await readFile(knownSkillsetsIndexPath(options));
    const beforePublish = deferred<void>();
    const release = deferred<void>();

    const update = updateKnownSkillsetsIndexForTest(entry(secondPath, "second"), options, {
      beforePublish: async () => {
        beforePublish.resolve();
        await release.promise;
      },
    });
    await beforePublish.promise;
    expect(await readFile(knownSkillsetsIndexPath(options))).toEqual(before);
    await expect(readKnownSkillsetsIndex(options)).resolves.toEqual({ schemaVersion: 1, skillsets: [entry(firstPath, "first")] });
    release.resolve();
    await update;
    expect((await readKnownSkillsetsIndex(options)).skillsets.map((item) => item.cacheKey)).toEqual(["first", "second"]);
    expect(await transactionArtifacts(options)).toEqual([]);
  });

  test("leaves the prior valid index intact when publication fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-failure-"));
    const options = xdgOptions(root);
    const firstPath = join(root, "first");
    const secondPath = join(root, "second");
    await Promise.all([mkdir(firstPath), mkdir(secondPath)]);
    await writeKnownSkillsetsIndex({ schemaVersion: 1, skillsets: [entry(firstPath, "first")] }, options);
    const before = await readFile(knownSkillsetsIndexPath(options));

    await expect(updateKnownSkillsetsIndexForTest(entry(secondPath, "second"), options, {
      beforePublish: () => {
        throw new Error("injected late publication failure");
      },
    })).rejects.toThrow("injected late publication failure");
    expect(await readFile(knownSkillsetsIndexPath(options))).toEqual(before);
    expect(await transactionArtifacts(options)).toEqual([]);
  });

  test("cleans temporary files when writing or flushing a replacement fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-temporary-failure-"));
    const options = xdgOptions(root);
    const workspacePath = join(root, "workspace");
    await mkdir(workspacePath);

    for (const testOptions of [
      { beforeTemporaryWrite: () => { throw new Error("injected temporary write failure"); } },
      { beforeTemporarySync: () => { throw new Error("injected temporary sync failure"); } },
    ]) {
      await expect(updateKnownSkillsetsIndexForTest(entry(workspacePath, "failed"), options, testOptions)).rejects.toThrow(
        /injected temporary (write|sync) failure/
      );
      expect(await Bun.file(knownSkillsetsIndexPath(options)).exists()).toBe(false);
      expect(await transactionArtifacts(options)).toEqual([]);
    }
  });

  test("preserves malformed bytes before write-capable recovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-recovery-"));
    const options = xdgOptions(root);
    const workspacePath = join(root, "workspace");
    await mkdir(workspacePath);
    const malformed = Buffer.from('{"schemaVersion":1,"skillsets":[\0\0', "utf8");
    const indexPath = knownSkillsetsIndexPath(options);
    await mkdir(join(root, "config", "skillset"), { recursive: true });
    await writeFile(indexPath, malformed);

    await updateKnownSkillsetsIndexForTest(entry(workspacePath, "recovered"), options, {});

    const files = await readdir(join(root, "config", "skillset"));
    const backups = files.filter((file) => file.startsWith("skillsets.corrupt-") && file.endsWith(".json"));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(root, "config", "skillset", backups[0]!))).toEqual(malformed);
    expect((await readKnownSkillsetsIndex(options)).skillsets).toEqual([entry(workspacePath, "recovered")]);
    expect(await transactionArtifacts(options)).toEqual([]);
  });

  test("keeps the malformed active index when recovery publication fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-recovery-failure-"));
    const options = xdgOptions(root);
    const workspacePath = join(root, "workspace");
    await mkdir(workspacePath);
    const malformed = Buffer.from('{"schemaVersion":1,"skillsets":[\0\0', "utf8");
    const indexPath = knownSkillsetsIndexPath(options);
    const configPath = join(root, "config", "skillset");
    await mkdir(configPath, { recursive: true });
    await writeFile(indexPath, malformed);

    await expect(updateKnownSkillsetsIndexForTest(entry(workspacePath, "failed"), options, {
      beforePublish: () => { throw new Error("injected recovery publication failure"); },
    })).rejects.toThrow("injected recovery publication failure");

    const backups = (await readdir(configPath))
      .filter((file) => file.startsWith("skillsets.corrupt-") && file.endsWith(".json"));
    expect(backups).toHaveLength(1);
    expect(await readFile(indexPath)).toEqual(malformed);
    expect(await readFile(join(configPath, backups[0]!))).toEqual(malformed);
    expect(await transactionArtifacts(options)).toEqual([]);
  });

  test("keeps malformed lookup strict and read-only", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-readonly-"));
    const options = xdgOptions(root);
    const indexPath = knownSkillsetsIndexPath(options);
    const malformed = Buffer.from("{not-json\0", "utf8");
    await mkdir(join(root, "config", "skillset"), { recursive: true });
    await writeFile(indexPath, malformed);
    const beforeFiles = await readdir(join(root, "config", "skillset"));

    await expect(resolveKnownSkillsetWorkspace("github:acme/docs", options)).rejects.toBeInstanceOf(SyntaxError);
    expect(await readFile(indexPath)).toEqual(malformed);
    expect(await readdir(join(root, "config", "skillset"))).toEqual(beforeFiles);
  });

  test("reclaims an expired owner despite PID reuse but preserves a fresh lease", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-stale-lock-"));
    const options = xdgOptions(root);
    const workspacePath = join(root, "workspace");
    await mkdir(workspacePath);
    const lockPath = `${knownSkillsetsIndexPath(options)}.lock`;
    const token = "a".repeat(32);
    await seedLock(lockPath, { createdAt: 0, heartbeatAt: 0, pid: process.pid, token });

    await updateKnownSkillsetsIndexForTest(entry(workspacePath, "recovered"), options, {
      leaseMs: 10,
      now: () => 100,
      pollMs: 1,
      timeoutMs: 20,
    });
    expect((await readKnownSkillsetsIndex(options)).skillsets).toEqual([entry(workspacePath, "recovered")]);
    expect(await transactionArtifacts(options)).toEqual([]);

    await seedLock(lockPath, { createdAt: 100, heartbeatAt: 100, pid: 1234, token });
    await expect(updateKnownSkillsetsIndexForTest(entry(workspacePath, "blocked"), options, {
      leaseMs: 10,
      now: () => 100,
      pollMs: 1,
      timeoutMs: 5,
    })).rejects.toThrow("timed out waiting for known Skillsets index lock");
    expect(JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8"))).toMatchObject({ token });
    await rm(lockPath, { force: true, recursive: true });
  });

  test("renews the heartbeat so an over-lease live transaction is not reclaimed", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-heartbeat-"));
    const options = xdgOptions(root);
    const firstPath = join(root, "first");
    const secondPath = join(root, "second");
    await Promise.all([mkdir(firstPath), mkdir(secondPath)]);
    const entered = deferred<void>();
    const release = deferred<void>();
    let heartbeatTick: (() => Promise<void>) | undefined;
    let now = 0;
    const holder = updateKnownSkillsetsIndexForTest(entry(firstPath, "holder"), options, {
      afterLockAcquired: async () => {
        entered.resolve();
        await release.promise;
      },
      heartbeatMs: 1,
      leaseMs: 5,
      now: () => now,
      startHeartbeat: (heartbeat) => {
        heartbeatTick = heartbeat;
        return () => undefined;
      },
    });
    await entered.promise;
    now = 6;
    if (heartbeatTick === undefined) throw new Error("missing heartbeat test seam");
    await heartbeatTick();

    await expect(updateKnownSkillsetsIndexForTest(entry(secondPath, "contender"), options, {
      leaseMs: 5,
      now: () => now,
      pollMs: 1,
      timeoutMs: 5,
    })).rejects.toThrow("timed out waiting for known Skillsets index lock");
    release.resolve();
    await holder;
    expect((await readKnownSkillsetsIndex(options)).skillsets).toEqual([entry(firstPath, "holder")]);
    expect(await transactionArtifacts(options)).toEqual([]);
  });

  test("does not publish or remove a successor lock after fencing", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-fenced-"));
    const options = xdgOptions(root);
    const workspacePath = join(root, "workspace");
    await mkdir(workspacePath);
    const indexPath = knownSkillsetsIndexPath(options);
    const lockPath = `${indexPath}.lock`;
    const displacedPath = `${lockPath}.displaced`;
    const successorToken = "b".repeat(32);

    await expect(updateKnownSkillsetsIndexForTest(entry(workspacePath, "fenced"), options, {
      beforePublish: async () => {
        await rename(lockPath, displacedPath);
        await seedLock(lockPath, {
          createdAt: Date.now(),
          heartbeatAt: Date.now(),
          pid: process.pid,
          token: successorToken,
        });
      },
    })).rejects.toThrow("lost ownership of known Skillsets index lock");
    expect(await Bun.file(indexPath).exists()).toBe(false);
    expect(JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8"))).toMatchObject({ token: successorToken });
    await rm(lockPath, { force: true, recursive: true });
    await rm(displacedPath, { force: true, recursive: true });
  });

  test("serializes cross-process updates behind an acquired-lock barrier", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-processes-"));
    const options = xdgOptions(root);
    const firstPath = join(root, "workspace-first");
    const secondPath = join(root, "workspace-second");
    const firstAcquired = join(root, "first-acquired");
    const secondAcquired = join(root, "second-acquired");
    const secondContended = join(root, "second-contended");
    const releaseFirst = join(root, "release-first");
    await Promise.all([mkdir(firstPath), mkdir(secondPath)]);
    const script = [
      'import { updateKnownSkillsetsIndexForTest } from "./packages/core/src/known-skillsets.ts";',
      'const marker = async (path) => { await Bun.write(path, "ready\\n"); };',
      'const wait = async (path) => { while (!(await Bun.file(path).exists())) await Bun.sleep(1); };',
      'await updateKnownSkillsetsIndexForTest({ cacheKey: process.env.CACHE_KEY, identities: [], path: process.env.WORKSPACE }, { env: { XDG_CONFIG_HOME: process.env.XDG_ROOT }, homeDir: process.env.HOME_ROOT }, {',
      '  afterLockAcquired: async () => { await marker(process.env.ACQUIRED); if (process.env.RELEASE) await wait(process.env.RELEASE); },',
      '  onLockContention: process.env.CONTENDED ? async () => marker(process.env.CONTENDED) : undefined,',
      '});',
    ].join("\n");
    const spawnWorker = (
      cacheKey: string,
      workspacePath: string,
      acquired: string,
      release?: string,
      contended?: string
    ) => Bun.spawn({
        cmd: [
          "bun",
          "-e",
          script,
        ],
        cwd: join(import.meta.dir, "../../../.."),
        env: {
          ...process.env,
          ACQUIRED: acquired,
          CACHE_KEY: cacheKey,
          ...(contended === undefined ? {} : { CONTENDED: contended }),
          HOME_ROOT: join(root, "home"),
          ...(release === undefined ? {} : { RELEASE: release }),
          WORKSPACE: workspacePath,
          XDG_ROOT: join(root, "config"),
        },
        stderr: "pipe",
        stdout: "pipe",
      });
    const first = spawnWorker("first", firstPath, firstAcquired, releaseFirst);
    await waitForFile(firstAcquired);
    const second = spawnWorker("second", secondPath, secondAcquired, undefined, secondContended);
    await waitForFile(secondContended);
    expect(await Bun.file(secondAcquired).exists()).toBe(false);
    await Bun.write(releaseFirst, "release\n");
    for (const proc of [first, second]) {
      const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
      expect(exitCode, stderr).toBe(0);
    }
    expect((await readKnownSkillsetsIndex(options)).skillsets.map((item) => item.cacheKey)).toEqual(["first", "second"]);
    expect(await transactionArtifacts(options)).toEqual([]);
  });

  test("probes at most 128 path-sorted entries and resumes after the compatible cursor", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-bounded-sweep-"));
    const options = xdgOptions(root);
    const currentPath = join(root, "workspace-current");
    await mkdir(currentPath);
    const seeded = Array.from({ length: 300 }, (_, index) =>
      entry(join(root, `workspace-${index.toString().padStart(3, "0")}`), `seed-${index}`)
    );
    await writeKnownSkillsetsIndex({ schemaVersion: 1, skillsets: seeded }, options);
    const firstProbes: string[] = [];
    await updateKnownSkillsetsIndexForTest(entry(currentPath, "current"), options, {
      inspectPath: async (path) => {
        firstProbes.push(path);
        return "directory";
      },
    });
    expect(firstProbes).toEqual(seeded.slice(0, 128).map((item) => item.path));
    expect((await readKnownSkillsetsIndex(options)).maintenance).toEqual({ staleSweepAfter: seeded[127]!.path });

    const secondProbes: string[] = [];
    await updateKnownSkillsetsIndexForTest(entry(currentPath, "current"), options, {
      inspectPath: async (path) => {
        secondProbes.push(path);
        return "directory";
      },
    });
    expect(secondProbes).toEqual(seeded.slice(128, 256).map((item) => item.path));
    expect((await readKnownSkillsetsIndex(options)).skillsets).toHaveLength(301);
  });

  test("converges over a large stale index and becomes byte-idempotent", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-convergence-"));
    const options = xdgOptions(root);
    const currentPath = join(root, "zz-current");
    await mkdir(currentPath);
    const seeded = Array.from({ length: 300 }, (_, index) =>
      entry(join(root, `stale-${index.toString().padStart(3, "0")}`), `stale-${index}`)
    );
    await writeKnownSkillsetsIndex({ schemaVersion: 1, skillsets: seeded }, options);

    for (let registration = 0; registration < 3; registration += 1) {
      let probes = 0;
      await updateKnownSkillsetsIndexForTest(entry(currentPath, "current"), options, {
        inspectPath: async (path) => {
          probes += 1;
          return path === currentPath ? "directory" : "stale";
        },
      });
      expect(probes).toBeLessThanOrEqual(128);
    }
    expect((await readKnownSkillsetsIndex(options)).skillsets).toEqual([entry(currentPath, "current")]);
    const converged = await readFile(knownSkillsetsIndexPath(options));
    await updateKnownSkillsetsIndexForTest(entry(currentPath, "current"), options, {
      inspectPath: async () => "directory",
    });
    expect(await readFile(knownSkillsetsIndexPath(options))).toEqual(converged);
  });

  test("prunes confirmed stale paths while retaining live and symlinked directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-mixed-sweep-"));
    const options = xdgOptions(root);
    const livePath = join(root, "live");
    const symlinkPath = join(root, "linked-live");
    const currentPath = join(root, "current");
    const stalePath = join(root, "missing");
    const filePath = join(root, "regular-file");
    await Promise.all([mkdir(livePath), mkdir(currentPath)]);
    await symlink(livePath, symlinkPath, "dir");
    await writeFile(filePath, "not a directory\n", "utf8");
    await writeKnownSkillsetsIndex({
      schemaVersion: 1,
      skillsets: [
        entry(filePath, "file"),
        entry(livePath, "live"),
        entry(stalePath, "stale"),
        entry(symlinkPath, "symlink"),
      ],
    }, options);

    await updateKnownSkillsetsIndexForTest(entry(currentPath, "current"), options, {});

    expect((await readKnownSkillsetsIndex(options)).skillsets.map((item) => item.cacheKey)).toEqual([
      "current",
      "symlink",
      "live",
    ]);
  });

  test("retains ambiguous inspection failures without failing registration", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-ambiguous-sweep-"));
    const options = xdgOptions(root);
    const currentPath = join(root, "current");
    const ambiguousPath = join(root, "ambiguous");
    await mkdir(currentPath);
    await writeKnownSkillsetsIndex({
      schemaVersion: 1,
      skillsets: [entry(ambiguousPath, "ambiguous")],
    }, options);

    await updateKnownSkillsetsIndexForTest(entry(currentPath, "current"), options, {
      inspectPath: async () => "unknown",
    });

    expect((await readKnownSkillsetsIndex(options)).skillsets.map((item) => item.cacheKey)).toEqual([
      "ambiguous",
      "current",
    ]);
  });

  test("converges moved and re-registered identities onto the current workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-moved-sweep-"));
    const options = xdgOptions(root);
    const oldPath = join(root, "old-workspace");
    const currentPath = join(root, "current-workspace");
    await mkdir(currentPath);
    await writeKnownSkillsetsIndex({
      schemaVersion: 1,
      skillsets: [{
        cacheKey: "shared",
        identities: ["github:acme/docs"],
        path: oldPath,
        repository: "https://github.com/acme/docs.git",
      }],
    }, options);

    await recordKnownSkillsetWorkspace(currentPath, {
      ...options,
      cacheKey: "shared",
      repository: "git@github.com:Acme/docs.git",
    });

    expect((await readKnownSkillsetsIndex(options)).skillsets).toEqual([{
      cacheKey: "shared",
      identities: ["github:acme/docs"],
      path: await realpath(currentPath),
      repository: "git@github.com:Acme/docs.git",
    }]);
  });

  test("keeps schema-v1 files without maintenance readable and round-trips an optional cursor", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-known-cursor-schema-"));
    const options = xdgOptions(root);
    const workspacePath = join(root, "workspace");
    await mkdir(workspacePath);
    await writeKnownSkillsetsIndex({ schemaVersion: 1, skillsets: [entry(workspacePath, "legacy")] }, options);
    await expect(readKnownSkillsetsIndex(options)).resolves.toEqual({
      schemaVersion: 1,
      skillsets: [entry(workspacePath, "legacy")],
    });
    await writeKnownSkillsetsIndex({
      maintenance: { staleSweepAfter: workspacePath },
      schemaVersion: 1,
      skillsets: [entry(workspacePath, "cursor")],
    }, options);
    await expect(readKnownSkillsetsIndex(options)).resolves.toEqual({
      maintenance: { staleSweepAfter: workspacePath },
      schemaVersion: 1,
      skillsets: [entry(workspacePath, "cursor")],
    });
  });
});

function entry(path: string, cacheKey: string) {
  return { cacheKey, identities: [], path } as const;
}

async function transactionArtifacts(options: ReturnType<typeof xdgOptions>): Promise<readonly string[]> {
  const directory = dirname(knownSkillsetsIndexPath(options));
  return (await readdir(directory)).filter((file) => file.includes("skillsets.json.lock") || file.includes(".tmp-"));
}

async function seedLock(
  lockPath: string,
  owner: { readonly createdAt: number; readonly heartbeatAt: number; readonly pid: number; readonly token: string }
): Promise<void> {
  await mkdir(lockPath, { recursive: true });
  await writeFile(join(lockPath, "owner.json"), `${JSON.stringify(owner)}\n`, "utf8");
  await writeFile(
    join(lockPath, `heartbeat-${owner.token}.json`),
    `${JSON.stringify({ heartbeatAt: owner.heartbeatAt, token: owner.token })}\n`,
    "utf8"
  );
  const old = new Date(0);
  await utimes(lockPath, old, old);
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

function xdgOptions(root: string): { env: Record<string, string>; homeDir: string } {
  return {
    env: {
      XDG_CONFIG_HOME: join(root, "config"),
    },
    homeDir: join(root, "home"),
  };
}
