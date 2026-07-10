import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  acquireRemoteRepository,
  parseRemoteRepositoryReference,
  resolveRemoteRepositoryCache,
} from "../remote-repository-cache";

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
  const root = await mkdtemp(join(tmpdir(), "skillset-remote-cache-"));
  const work = join(root, "work");
  const remote = join(root, "origin.git");
  const repository = "https://git.example/acme/plugin.git";
  await git(root, "init", "--initial-branch=main", work);
  await git(work, "config", "user.email", "skillset@example.test");
  await git(work, "config", "user.name", "Skillset Tests");
  await writeFile(join(work, "README.md"), "first\n");
  await git(work, "add", "README.md");
  await git(work, "commit", "-m", "first");
  const firstSha = await git(work, "rev-parse", "HEAD");
  await git(root, "clone", "--bare", work, remote);

  return {
    firstSha,
    remote,
    repository,
    work,
    xdg: {
      env: {
        GIT_ALLOW_PROTOCOL: "file",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: `url.file://${remote}/.insteadOf`,
        GIT_CONFIG_VALUE_0: repository,
        XDG_CACHE_HOME: join(root, "cache"),
      },
      homeDir: join(root, "home"),
    },
  };
}

async function git(cwd: string, ...args: readonly string[]): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["git", "-C", cwd, ...args],
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${stdout}${stderr}`.trim());
  return stdout.trim();
}
