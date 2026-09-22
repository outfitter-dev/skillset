import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  acquireRemoteRepository,
  parseRemoteRepositoryReference,
  resolveRemoteRepositoryCache,
} from "../remote-repository-cache";
import {
  createTestGitFixtureRoot,
  createTestGitRemote,
  runTestGit as git,
} from "../../../../scripts/test-helpers/git-remote";

describe("remote repository cache", () => {
  test("normalizes supported references and derives deterministic XDG paths", () => {
    expect(parseRemoteRepositoryReference("github:Outfitter-Dev/Skillset")).toEqual({
      canonical: "github:outfitter-dev/skillset",
      fetchUrl: "https://github.com/Outfitter-Dev/Skillset.git",
    });
    expect(parseRemoteRepositoryReference("git@github.com:Outfitter-Dev/Skillset.git")).toEqual({
      canonical: "github:outfitter-dev/skillset",
      fetchUrl: "git@github.com:Outfitter-Dev/Skillset.git",
    });
    expect(() => parseRemoteRepositoryReference("https://token@github.com/outfitter-dev/skillset.git")).toThrow(
      "must not contain credentials"
    );
    expect(() => parseRemoteRepositoryReference("https://user:SENTINEL@git.example:443/acme/plugin.git")).toThrow(
      "must not contain credentials"
    );
    expect(() => parseRemoteRepositoryReference("file:///tmp/skillset.git")).toThrow("unsupported remote repository protocol");
    expect(parseRemoteRepositoryReference("https://git.example:8443/acme/plugin.git").canonical).toBe(
      "https://git.example:8443/acme/plugin"
    );
    const relativeScp = parseRemoteRepositoryReference("git@git.example:acme/plugin.git");
    const absoluteScp = parseRemoteRepositoryReference("git@git.example:/acme/plugin.git");
    expect(relativeScp.canonical).not.toBe(absoluteScp.canonical);
    expect(resolveRemoteRepositoryCache(relativeScp.fetchUrl, { kind: "ref", ref: "main" }, {
      env: { XDG_CACHE_HOME: "/xdg/cache" },
      homeDir: "/home/matt",
    }).path).not.toBe(resolveRemoteRepositoryCache(absoluteScp.fetchUrl, { kind: "ref", ref: "main" }, {
      env: { XDG_CACHE_HOME: "/xdg/cache" },
      homeDir: "/home/matt",
    }).path);

    const first = resolveRemoteRepositoryCache(
      "github:Outfitter-Dev/Skillset",
      { kind: "ref", ref: "main" },
      { env: { XDG_CACHE_HOME: "/xdg/cache" }, homeDir: "/home/matt" }
    );
    const second = resolveRemoteRepositoryCache(
      "https://github.com/outfitter-dev/skillset.git",
      { kind: "ref", ref: "main" },
      { env: { XDG_CACHE_HOME: "/xdg/cache" }, homeDir: "/home/matt" }
    );
    const pinned = resolveRemoteRepositoryCache(
      "github:outfitter-dev/skillset",
      { kind: "sha", sha: "a".repeat(40) },
      { env: { XDG_CACHE_HOME: "/xdg/cache" }, homeDir: "/home/matt" }
    );

    expect(first).toEqual(second);
    expect(first.path).toStartWith("/xdg/cache/skillset/remotes/");
    expect(first.cacheKey).toMatch(/^github-outfitter-dev-skillset--[0-9a-f]{24}\/ref-main--[0-9a-f]{16}$/);
    expect(pinned.path).not.toBe(first.path);
  });

  test("acquires exact commits, reuses a verified cache offline, and never writes the remote", async () => {
    const fixture = await gitRemoteFixture();
    const before = await git(fixture.remote, "show-ref");

    const first = await acquireRemoteRepository({
      repository: fixture.repository,
      revision: { kind: "sha", sha: fixture.firstSha },
      xdg: fixture.xdg,
    });
    const second = await acquireRemoteRepository({
      repository: fixture.repository,
      revision: { kind: "sha", sha: fixture.firstSha },
      xdg: {
        ...fixture.xdg,
        env: {
          ...fixture.xdg.env,
          GIT_CONFIG_VALUE_0: "file:///definitely-unavailable/",
        },
      },
    });

    expect(first).toMatchObject({
      cacheHit: false,
      repository: "https://git.example/acme/plugin",
      sha: fixture.firstSha,
    });
    expect(second).toMatchObject({ cacheHit: true, sha: fixture.firstSha });
    expect(second.rootPath).toBe(first.rootPath);
    expect(await git(first.rootPath, "status", "--porcelain")).toBe("");
    expect(await git(fixture.remote, "show-ref")).toBe(before);
  });

  test("isolated cache verification ignores inherited global and system Git config", async () => {
    const fixture = await gitRemoteFixture();
    const acquired = await acquireRemoteRepository({
      repository: fixture.repository,
      revision: { kind: "sha", sha: fixture.firstSha },
      xdg: fixture.xdg,
    });
    const root = dirname(fixture.remote);
    const hooks = join(root, "hostile-hooks");
    const hookSentinel = join(root, "hook-ran");
    const credentialSentinel = join(root, "credential-ran");
    const attributes = join(root, "hostile-attributes");
    const excludes = join(root, "hostile-excludes");
    const template = join(root, "hostile-template");
    const included = join(root, "hostile-include");
    const global = join(root, "hostile-global");
    const system = join(root, "hostile-system");
    await mkdir(hooks);
    await mkdir(template);
    await writeFile(
      join(hooks, "post-checkout"),
      `#!/bin/sh\ntouch ${JSON.stringify(hookSentinel)}\n`
    );
    await chmod(join(hooks, "post-checkout"), 0o755);
    await writeFile(attributes, "* hostile=true\n");
    await writeFile(excludes, "*.hostile\n");
    await writeFile(
      included,
      `[core]\n  bare = true\n  hooksPath = ${hooks}\n  attributesFile = ${attributes}\n  excludesFile = ${excludes}\n[credential]\n  helper = "!touch ${credentialSentinel}"\n[commit]\n  gpgSign = true\n[init]\n  defaultBranch = hostile\n  templateDir = ${template}\n`
    );
    await writeFile(global, `[include]\n  path = ${included}\n`);
    await writeFile(system, `[include]\n  path = ${included}\n`);

    for (const inherited of [
      {
        GIT_CONFIG_GLOBAL: global,
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
      {
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: system,
      },
    ]) {
      const junk = join(acquired.rootPath, `ambient-${crypto.randomUUID()}`);
      await writeFile(junk, "remove me\n");
      const reused = await acquireRemoteRepository({
        repository: fixture.repository,
        revision: { kind: "sha", sha: fixture.firstSha },
        xdg: {
          ...fixture.xdg,
          env: { ...fixture.xdg.env, ...inherited },
        },
      });

      expect(reused).toMatchObject({
        cacheHit: true,
        sha: fixture.firstSha,
      });
      await expect(access(junk)).rejects.toThrow();
      await expect(access(hookSentinel)).rejects.toThrow();
      await expect(access(credentialSentinel)).rejects.toThrow();
    }
  });

  test("refreshes floating refs in place and resolves version tags", async () => {
    const fixture = await gitRemoteFixture();
    const refFirst = await acquireRemoteRepository({
      repository: fixture.repository,
      revision: { kind: "ref", ref: "main" },
      xdg: fixture.xdg,
    });

    await writeFile(join(fixture.work, "README.md"), "second\n");
    await git(fixture.work, "add", "README.md");
    await git(fixture.work, "commit", "-m", "second");
    const secondSha = await git(fixture.work, "rev-parse", "HEAD");
    await git(fixture.work, "tag", "v1.2.3");
    await git(fixture.work, "push", "--tags", fixture.remote, "main");

    const refSecond = await acquireRemoteRepository({
      repository: fixture.repository,
      revision: { kind: "ref", ref: "main" },
      xdg: fixture.xdg,
    });
    const version = await acquireRemoteRepository({
      repository: fixture.repository,
      revision: { kind: "version", version: "1.2.3" },
      xdg: fixture.xdg,
    });

    expect(refFirst).toMatchObject({ cacheHit: false, ref: "main", sha: fixture.firstSha });
    expect(refSecond).toMatchObject({ cacheHit: true, ref: "main", sha: secondSha });
    expect(refSecond.rootPath).toBe(refFirst.rootPath);
    expect(version).toMatchObject({ cacheHit: false, ref: "refs/tags/v1.2.3", sha: secondSha });
  });

  test("serializes concurrent acquisition for the same cache entry", async () => {
    const fixture = await gitRemoteFixture();

    const [first, second] = await Promise.all([
      acquireRemoteRepository({
        repository: fixture.repository,
        revision: { kind: "ref", ref: "main" },
        xdg: fixture.xdg,
      }),
      acquireRemoteRepository({
        repository: fixture.repository,
        revision: { kind: "ref", ref: "main" },
        xdg: fixture.xdg,
      }),
    ]);

    expect(first.rootPath).toBe(second.rootPath);
    expect(first.sha).toBe(fixture.firstSha);
    expect(second.sha).toBe(fixture.firstSha);
    expect([first.cacheHit, second.cacheHit].sort()).toEqual([false, true]);
  });

  test("fails loudly for unavailable refs, wrong origins, and corrupt cache entries", async () => {
    const fixture = await gitRemoteFixture();
    await expect(acquireRemoteRepository({
      repository: fixture.repository,
      revision: { kind: "ref", ref: "missing" },
      xdg: fixture.xdg,
    })).rejects.toThrow("could not resolve ref missing");

    const acquired = await acquireRemoteRepository({
      repository: fixture.repository,
      revision: { kind: "ref", ref: "main" },
      xdg: fixture.xdg,
    });
    await git(acquired.rootPath, "remote", "set-url", "origin", "https://example.invalid/wrong/repo.git");
    await expect(acquireRemoteRepository({
      repository: fixture.repository,
      revision: { kind: "ref", ref: "main" },
      xdg: fixture.xdg,
    })).rejects.toThrow(`origin mismatch in remote cache ${acquired.cacheKey}`);

    const corrupt = resolveRemoteRepositoryCache(
      fixture.repository,
      { kind: "sha", sha: "f".repeat(40) },
      fixture.xdg
    );
    await Bun.write(corrupt.path, "not a repository\n");
    await expect(acquireRemoteRepository({
      repository: fixture.repository,
      revision: { kind: "sha", sha: "f".repeat(40) },
      xdg: fixture.xdg,
    })).rejects.toThrow(`corrupt remote cache ${corrupt.cacheKey}`);
  });

  test("rejects symlinked cache entries and Git directories before checkout cleanup", async () => {
    const fixture = await gitRemoteFixture();
    const pinned = await acquireRemoteRepository({
      repository: fixture.repository,
      revision: { kind: "sha", sha: fixture.firstSha },
      xdg: fixture.xdg,
    });
    const outside = join(dirname(fixture.remote), "outside");
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "keep\n");
    await rm(pinned.rootPath, { force: true, recursive: true });
    await symlink(outside, pinned.rootPath);

    await expect(acquireRemoteRepository({
      repository: fixture.repository,
      revision: { kind: "sha", sha: fixture.firstSha },
      xdg: fixture.xdg,
    })).rejects.toThrow(`corrupt remote cache ${pinned.cacheKey}`);
    await expect(readFile(join(outside, "keep.txt"), "utf8")).resolves.toBe("keep\n");

    await rm(pinned.rootPath);
    const safe = await acquireRemoteRepository({
      repository: fixture.repository,
      revision: { kind: "sha", sha: fixture.firstSha },
      xdg: fixture.xdg,
    });
    const externalGit = join(dirname(fixture.remote), "external.git");
    await rename(join(safe.rootPath, ".git"), externalGit);
    await writeFile(join(safe.rootPath, ".git"), `gitdir: ${externalGit}\n`);

    await expect(acquireRemoteRepository({
      repository: fixture.repository,
      revision: { kind: "sha", sha: fixture.firstSha },
      xdg: fixture.xdg,
    })).rejects.toThrow(`corrupt remote cache ${safe.cacheKey}`);
    await expect(readFile(join(safe.rootPath, "README.md"), "utf8")).resolves.toBe("first\n");
  });

  test("SET-645 a delayed former owner cannot remove a successor cache lock", async () => {
    const fixture = await gitRemoteFixture();
    const location = resolveRemoteRepositoryCache(
      fixture.repository,
      { kind: "sha", sha: fixture.firstSha },
      fixture.xdg
    );
    const lockPath = `${location.path}.lock`;
    const displacedPath = `${lockPath}.displaced`;
    const successorToken = "c".repeat(32);

    await expect(acquireRemoteRepository({
      repository: fixture.repository,
      revision: { kind: "sha", sha: fixture.firstSha },
      xdg: fixture.xdg,
      lock: {
        afterLockAcquired: async () => {
          await rename(lockPath, displacedPath);
          await mkdir(lockPath);
          await writeFile(
            join(lockPath, "owner.json"),
            `${JSON.stringify({ createdAt: Date.now(), pid: process.pid, token: successorToken })}\n`,
            "utf8"
          );
        },
      },
    })).rejects.toThrow("lost ownership of remote cache lock");
    expect(JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8"))).toMatchObject({
      token: successorToken,
    });
    expect(await Bun.file(displacedPath).exists()).toBe(true);
    await rm(lockPath, { force: true, recursive: true });
    await rm(displacedPath, { force: true, recursive: true });
  });

  test("SET-645 cache heartbeats keep a live over-lease acquisition from being reclaimed by age", async () => {
    const fixture = await gitRemoteFixture();
    const entered = deferred<void>();
    const release = deferred<void>();
    let heartbeatTick: (() => Promise<void>) | undefined;
    let now = 0;
    const holder = acquireRemoteRepository({
      repository: fixture.repository,
      revision: { kind: "sha", sha: fixture.firstSha },
      xdg: fixture.xdg,
      lock: {
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
      },
    });
    await entered.promise;
    now = 6;
    if (heartbeatTick === undefined) throw new Error("missing remote cache heartbeat tick");
    await heartbeatTick();

    await expect(acquireRemoteRepository({
      repository: fixture.repository,
      revision: { kind: "sha", sha: fixture.firstSha },
      xdg: fixture.xdg,
      lock: {
        leaseMs: 5,
        now: () => now,
        pollMs: 1,
        timeoutMs: 5,
      },
    })).rejects.toThrow("timed out waiting for the remote cache lock");
    release.resolve();
    expect((await holder).sha).toBe(fixture.firstSha);
  });

  test("SET-645 stale cache takeover survives delayed cleanup by a competing former owner", async () => {
    const fixture = await gitRemoteFixture();
    const holderAcquired = join(dirname(fixture.remote), "holder-acquired");
    const successorAcquired = join(dirname(fixture.remote), "successor-acquired");
    const successorContended = join(dirname(fixture.remote), "successor-contended");
    const holderResult = join(dirname(fixture.remote), "holder-result");
    const successorResult = join(dirname(fixture.remote), "successor-result");
    const releaseHolder = join(dirname(fixture.remote), "release-holder");
    const releaseSuccessor = join(dirname(fixture.remote), "release-successor");
    const script = [
      'import { acquireRemoteRepository } from "./packages/core/src/remote-repository-cache.ts";',
      "const marker = async (path) => { await Bun.write(path, \"ready\\n\"); };",
      "const wait = async (path) => { while (!(await Bun.file(path).exists())) await Bun.sleep(1); };",
      "try {",
      "  await acquireRemoteRepository({",
      "    repository: process.env.REPOSITORY,",
      "    revision: { kind: \"sha\", sha: process.env.SHA },",
      "    xdg: { env: { GIT_ALLOW_PROTOCOL: \"file\", GIT_CONFIG_COUNT: \"1\", GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0, GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }, homeDir: process.env.HOME_DIR },",
      "    lock: {",
      "      afterLockAcquired: async () => { await marker(process.env.ACQUIRED); if (process.env.RELEASE) await wait(process.env.RELEASE); },",
      "      heartbeatMs: 1000,",
      "      leaseMs: Number(process.env.LEASE_MS),",
      "      now: () => Number(process.env.NOW),",
      "      onLockContention: process.env.CONTENDED ? async () => marker(process.env.CONTENDED) : undefined,",
      "      pollMs: 1,",
      "      startHeartbeat: process.env.HEARTBEAT === \"off\" ? () => () => undefined : undefined,",
      "      timeoutMs: Number(process.env.TIMEOUT_MS),",
      "    },",
      "  });",
      "  await Bun.write(process.env.RESULT, \"ok\\n\");",
      "} catch (error) {",
      "  await Bun.write(process.env.RESULT, error instanceof Error ? error.message : String(error));",
      "}",
    ].join("\n");
    const spawnWorker = (env: Record<string, string>) => Bun.spawn({
      cmd: ["bun", "-e", script],
      cwd: join(import.meta.dir, "../../../.."),
      env: {
        ...process.env,
        GIT_CONFIG_KEY_0: fixture.xdg.env.GIT_CONFIG_KEY_0!,
        GIT_CONFIG_VALUE_0: fixture.xdg.env.GIT_CONFIG_VALUE_0!,
        HOME_DIR: fixture.xdg.homeDir,
        REPOSITORY: fixture.repository,
        SHA: fixture.firstSha,
        XDG_CACHE_HOME: fixture.xdg.env.XDG_CACHE_HOME!,
        XDG_CONFIG_HOME: fixture.xdg.env.XDG_CONFIG_HOME!,
        ...env,
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    const holder = spawnWorker({
      ACQUIRED: holderAcquired,
      HEARTBEAT: "off",
      LEASE_MS: "10",
      NOW: "0",
      RELEASE: releaseHolder,
      RESULT: holderResult,
      TIMEOUT_MS: "2000",
    });
    await waitForFile(holderAcquired);

    const successor = spawnWorker({
      ACQUIRED: successorAcquired,
      CONTENDED: successorContended,
      LEASE_MS: "10",
      NOW: "100",
      RELEASE: releaseSuccessor,
      RESULT: successorResult,
      TIMEOUT_MS: "2000",
    });
    await waitForFile(successorContended);
    await waitForFile(successorAcquired);

    await Bun.write(releaseHolder, "release\n");
    const [holderStderr, holderExit] = await Promise.all([
      new Response(holder.stderr).text(),
      holder.exited,
    ]);
    expect(holderExit, holderStderr).toBe(0);
    expect(await readFile(holderResult, "utf8")).toContain("lost ownership of remote cache lock");

    await Bun.write(releaseSuccessor, "release\n");
    const [successorStderr, successorExit] = await Promise.all([
      new Response(successor.stderr).text(),
      successor.exited,
    ]);
    expect(successorExit, successorStderr).toBe(0);
    expect(await readFile(successorResult, "utf8")).toBe("ok\n");
  });
});

interface GitRemoteFixture {
  readonly firstSha: string;
  readonly remote: string;
  readonly repository: string;
  readonly work: string;
  readonly xdg: {
    readonly env: Record<string, string>;
    readonly homeDir: string;
  };
}

async function gitRemoteFixture(): Promise<GitRemoteFixture> {
  const root = await createTestGitFixtureRoot("skillset-remote-cache-");
  const work = await mkdtemp(join(root, "work-"));
  await writeFile(join(work, "README.md"), "first\n");
  const fixture = await createTestGitRemote(work, { disposableRoot: root });

  return {
    firstSha: fixture.sha,
    remote: fixture.remotePath,
    repository: fixture.repository,
    work,
    xdg: fixture.xdg,
  };
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
