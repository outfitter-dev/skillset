import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { resolveSkillsetXdgPaths, type SkillsetXdgOptions } from "./xdg";
import {
  parseRemoteRepositoryReference,
  validateRemoteRepositoryRevision,
  type ParsedRemoteRepositoryReference,
  type RemoteRepositoryRevision,
} from "./remote-repository-reference";

export {
  parseRemoteRepositoryReference,
  type ParsedRemoteRepositoryReference,
  type RemoteRepositoryRevision,
} from "./remote-repository-reference";

const execFileAsync = promisify(execFile);

export interface RemoteRepositoryCacheLocation {
  readonly cacheKey: string;
  readonly path: string;
}

export interface RemoteRepositoryCheckout {
  readonly cacheHit: boolean;
  readonly cacheKey: string;
  readonly ref?: string;
  readonly repository: string;
  readonly rootPath: string;
  readonly sha: string;
}

export interface AcquireRemoteRepositoryOptions {
  readonly repository: string;
  readonly revision: RemoteRepositoryRevision;
  readonly xdg?: SkillsetXdgOptions;
}

interface ResolvedRevision {
  readonly fetch: string;
  readonly ref?: string;
  readonly sha: string;
}

interface RemoteRefRecord {
  readonly ref: string;
  readonly sha: string;
}

export function resolveRemoteRepositoryCache(
  repository: string,
  revision: RemoteRepositoryRevision,
  xdg: SkillsetXdgOptions = {}
): RemoteRepositoryCacheLocation {
  const parsed = parseRemoteRepositoryReference(repository);
  validateRemoteRepositoryRevision(revision);
  const repositoryKey = `${slug(parsed.canonical)}--${digest(parsed.canonical, 24)}`;
  const revisionIdentity = stableRevisionIdentity(revision);
  const revisionKey = `${slug(revisionIdentity)}--${digest(revisionIdentity, 16)}`;
  const cacheKey = `${repositoryKey}/${revisionKey}`;
  return {
    cacheKey,
    path: join(resolveSkillsetXdgPaths(xdg).cache, "remotes", cacheKey),
  };
}

export async function acquireRemoteRepository(
  options: AcquireRemoteRepositoryOptions
): Promise<RemoteRepositoryCheckout> {
  const parsed = parseRemoteRepositoryReference(options.repository);
  const location = resolveRemoteRepositoryCache(options.repository, options.revision, options.xdg);
  await ensureCacheParent(location, options.xdg);
  return withCacheLock(location.path, () => acquireRemoteRepositoryUnlocked(options, parsed, location));
}

async function acquireRemoteRepositoryUnlocked(
  options: AcquireRemoteRepositoryOptions,
  parsed: ParsedRemoteRepositoryReference,
  location: RemoteRepositoryCacheLocation
): Promise<RemoteRepositoryCheckout> {
  const existing = await pathKind(location.path);
  if (existing === "other") throw new Error(`skillset: corrupt remote cache ${location.cacheKey}`);
  if (existing === "directory") {
    return acquireExisting(location, parsed, options.revision, options.xdg);
  }

  const temporary = await mkdtemp(join(dirname(location.path), ".acquire-"));
  try {
    await runGit(temporary, ["init", "--quiet"], options.xdg, "initialize");
    await runGit(temporary, ["remote", "add", "origin", parsed.fetchUrl], options.xdg, "configure origin");
    const resolved = await synchronizeRevision(temporary, parsed.canonical, options.revision, options.xdg);
    try {
      await rename(temporary, location.path);
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      await rm(temporary, { force: true, recursive: true });
      return acquireExisting(location, parsed, options.revision, options.xdg);
    }
    return checkout(location, parsed.canonical, resolved, false);
  } catch (error) {
    await rm(temporary, { force: true, recursive: true });
    throw error;
  }
}

async function withCacheLock<T>(cachePath: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${cachePath}.lock`;
  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      const lock = await stat(lockPath).catch(() => undefined);
      if (lock !== undefined && Date.now() - lock.mtimeMs > 10 * 60_000) {
        await rm(lockPath, { force: true, recursive: true });
        continue;
      }
      if (Date.now() - startedAt > 30_000) {
        throw new Error("skillset: timed out waiting for the remote cache lock");
      }
      await sleep(50);
    }
  }

  try {
    return await operation();
  } finally {
    await rm(lockPath, { force: true, recursive: true });
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireExisting(
  location: RemoteRepositoryCacheLocation,
  parsed: ParsedRemoteRepositoryReference,
  revision: RemoteRepositoryRevision,
  xdg: SkillsetXdgOptions | undefined
): Promise<RemoteRepositoryCheckout> {
  if (!(await isGitRepository(location.path, xdg))) {
    throw new Error(`skillset: corrupt remote cache ${location.cacheKey}`);
  }
  const origin = await runGit(
    location.path,
    ["config", "--get", "remote.origin.url"],
    xdg,
    "read origin",
    true
  );
  let cached: ParsedRemoteRepositoryReference;
  try {
    cached = parseRemoteRepositoryReference(origin);
  } catch {
    throw new Error(`skillset: origin mismatch in remote cache ${location.cacheKey}`);
  }
  if (cached.canonical !== parsed.canonical) {
    throw new Error(`skillset: origin mismatch in remote cache ${location.cacheKey}`);
  }
  const resolved = await synchronizeRevision(location.path, parsed.canonical, revision, xdg);
  return checkout(location, parsed.canonical, resolved, true);
}

async function synchronizeRevision(
  rootPath: string,
  repository: string,
  revision: RemoteRepositoryRevision,
  xdg: SkillsetXdgOptions | undefined
): Promise<ResolvedRevision> {
  validateRemoteRepositoryRevision(revision);
  if (revision.kind === "sha" && await hasCommit(rootPath, revision.sha, xdg)) {
    await checkoutCommit(rootPath, revision.sha, xdg);
    return { fetch: revision.sha, sha: revision.sha };
  }

  const resolved = await resolveRevision(rootPath, revision, xdg);
  try {
    await runGit(rootPath, ["fetch", "--force", "--depth=1", "--no-tags", "origin", resolved.fetch], xdg, "fetch");
  } catch {
    throw new Error(`skillset: remote acquisition failed for ${repository} during fetch`);
  }
  await checkoutCommit(rootPath, "FETCH_HEAD", xdg);
  const sha = await runGit(
    rootPath,
    ["rev-parse", "--verify", "HEAD^{commit}"],
    xdg,
    "verify checkout",
    true
  );
  if (sha !== resolved.sha) {
    throw new Error(`skillset: resolved remote commit changed during acquisition for ${repository}`);
  }
  return resolved;
}

async function resolveRevision(
  rootPath: string,
  revision: RemoteRepositoryRevision,
  xdg: SkillsetXdgOptions | undefined
): Promise<ResolvedRevision> {
  if (revision.kind === "sha") return { fetch: revision.sha, sha: revision.sha };
  if (revision.kind === "default") {
    const output = await lsRemote(rootPath, ["--symref", "origin", "HEAD"], xdg);
    const records = parseRemoteRefs(output);
    const head = records.find((record) => record.ref === "HEAD");
    const symbolic = parseSymbolicHead(output);
    if (head === undefined) throw new Error("skillset: could not resolve the remote default branch");
    return { fetch: symbolic ?? "HEAD", ...(symbolic === undefined ? {} : { ref: symbolic }), sha: head.sha };
  }
  if (revision.kind === "ref") {
    const candidates = revision.ref.startsWith("refs/")
      ? [revision.ref, `${revision.ref}^{}`]
      : [`refs/heads/${revision.ref}`, `refs/tags/${revision.ref}`, `refs/tags/${revision.ref}^{}`];
    const records = parseRemoteRefs(await lsRemote(rootPath, ["origin", ...candidates], xdg));
    const selected = selectRequestedRef(records, revision.ref);
    if (selected === undefined) throw new Error(`skillset: could not resolve ref ${revision.ref}`);
    return { fetch: selected.ref.replace(/\^\{\}$/u, ""), ref: revision.ref, sha: selected.sha };
  }

  const tagNames = [`refs/tags/v${revision.version}`, `refs/tags/${revision.version}`];
  const records = parseRemoteRefs(await lsRemote(
    rootPath,
    ["origin", ...tagNames.flatMap((tag) => [tag, `${tag}^{}`])],
    xdg
  ));
  const selected = selectVersionTag(records, tagNames);
  if (selected === undefined) throw new Error(`skillset: could not resolve version ${revision.version}`);
  return {
    fetch: selected.ref.replace(/\^\{\}$/u, ""),
    ref: selected.ref.replace(/\^\{\}$/u, ""),
    sha: selected.sha,
  };
}

async function lsRemote(
  rootPath: string,
  args: readonly string[],
  xdg: SkillsetXdgOptions | undefined
): Promise<string> {
  try {
    return await runGit(rootPath, ["ls-remote", ...args], xdg, "resolve remote");
  } catch {
    throw new Error("skillset: remote repository could not be reached");
  }
}

function selectRequestedRef(records: readonly RemoteRefRecord[], requested: string): RemoteRefRecord | undefined {
  if (requested.startsWith("refs/")) return peeledRecord(records, requested);
  const branch = peeledRecord(records, `refs/heads/${requested}`);
  const tag = peeledRecord(records, `refs/tags/${requested}`);
  if (branch !== undefined && tag !== undefined && branch.sha !== tag.sha) {
    throw new Error(`skillset: ref ${requested} is ambiguous between a branch and tag`);
  }
  return branch ?? tag;
}

function selectVersionTag(
  records: readonly RemoteRefRecord[],
  tagNames: readonly string[]
): RemoteRefRecord | undefined {
  const matches = tagNames.flatMap((tag) => {
    const record = peeledRecord(records, tag);
    return record === undefined ? [] : [record];
  });
  const distinct = new Set(matches.map((record) => record.sha));
  if (distinct.size > 1) throw new Error("skillset: version tags resolve to different commits");
  return matches[0];
}

function peeledRecord(records: readonly RemoteRefRecord[], ref: string): RemoteRefRecord | undefined {
  return records.find((record) => record.ref === `${ref}^{}`) ?? records.find((record) => record.ref === ref);
}

function parseRemoteRefs(output: string): readonly RemoteRefRecord[] {
  const records: RemoteRefRecord[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^([0-9a-f]{40})\s+(.+)$/u);
    if (match === null || match[1] === undefined || match[2] === undefined) continue;
    records.push({ ref: match[2], sha: match[1] });
  }
  return records;
}

function parseSymbolicHead(output: string): string | undefined {
  const line = output.split("\n").find((candidate) => candidate.startsWith("ref: ") && candidate.endsWith("\tHEAD"));
  return line?.slice("ref: ".length, -"\tHEAD".length);
}

async function checkoutCommit(
  rootPath: string,
  commit: string,
  xdg: SkillsetXdgOptions | undefined
): Promise<void> {
  await assertSafeWorktree(rootPath, xdg);
  await runGit(
    rootPath,
    ["-c", "core.hooksPath=/dev/null", "checkout", "--quiet", "--detach", "--force", commit],
    xdg,
    "checkout",
    true
  );
  await runGit(rootPath, ["clean", "-fdx", "--quiet"], xdg, "clean checkout", true);
}

async function hasCommit(
  rootPath: string,
  sha: string,
  xdg: SkillsetXdgOptions | undefined
): Promise<boolean> {
  try {
    await runGit(
      rootPath,
      ["cat-file", "-e", `${sha}^{commit}`],
      xdg,
      "verify cached commit",
      true
    );
    return true;
  } catch {
    return false;
  }
}

async function isGitRepository(rootPath: string, xdg: SkillsetXdgOptions | undefined): Promise<boolean> {
  try {
    await assertSafeWorktree(rootPath, xdg);
    return true;
  } catch {
    return false;
  }
}

async function assertSafeWorktree(rootPath: string, xdg: SkillsetXdgOptions | undefined): Promise<void> {
  const expectedRoot = await realpath(rootPath);
  const worktree = await runGit(
    rootPath,
    ["rev-parse", "--show-toplevel"],
    xdg,
    "inspect worktree",
    true
  );
  const gitDirectory = await runGit(
    rootPath,
    ["rev-parse", "--absolute-git-dir"],
    xdg,
    "inspect git directory",
    true
  );
  const [actualWorktree, actualGitDirectory] = await Promise.all([
    realpath(worktree),
    realpath(gitDirectory),
  ]);
  if (actualWorktree !== expectedRoot || !isContainedPath(expectedRoot, actualGitDirectory)) {
    throw new Error("skillset: remote cache Git paths escape their cache entry");
  }
  const unsafeConfig = await runGitOptional(
    rootPath,
    ["config", "--local", "--name-only", "--get-regexp", "^(core\\.(attributesfile|hookspath|worktree)|filter\\.)"],
    xdg,
    true
  );
  if (unsafeConfig !== undefined) {
    throw new Error("skillset: remote cache contains unsafe local Git configuration");
  }
}

async function runGit(
  rootPath: string,
  args: readonly string[],
  xdg: SkillsetXdgOptions | undefined,
  operation: string,
  isolatedConfig = false
): Promise<string> {
  try {
    const result = await execFileAsync("git", ["-C", rootPath, ...args], {
      env: gitCommandEnv(xdg, isolatedConfig),
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
    });
    return String(result.stdout).trim();
  } catch {
    throw new Error(`skillset: git ${operation} failed`);
  }
}

async function runGitOptional(
  rootPath: string,
  args: readonly string[],
  xdg: SkillsetXdgOptions | undefined,
  isolatedConfig = false
): Promise<string | undefined> {
  try {
    return await runGit(rootPath, args, xdg, "inspect optional config", isolatedConfig);
  } catch {
    return undefined;
  }
}

function checkout(
  location: RemoteRepositoryCacheLocation,
  repository: string,
  revision: ResolvedRevision,
  cacheHit: boolean
): RemoteRepositoryCheckout {
  return {
    cacheHit,
    cacheKey: location.cacheKey,
    ...(revision.ref === undefined ? {} : { ref: revision.ref }),
    repository,
    rootPath: location.path,
    sha: revision.sha,
  };
}

function stableRevisionIdentity(revision: RemoteRepositoryRevision): string {
  if (revision.kind === "default") return "default";
  if (revision.kind === "ref") return `ref-${revision.ref}`;
  if (revision.kind === "sha") return `sha-${revision.sha}`;
  return `version-${revision.version}`;
}

function slug(value: string): string {
  const result = value.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return result.slice(0, 80) || "remote";
}

function digest(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function gitCommandEnv(
  xdg: SkillsetXdgOptions | undefined,
  isolatedConfig: boolean
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(xdg?.env ?? {}), GIT_TERMINAL_PROMPT: "0" };
  for (const key of Object.keys(env)) {
    if (isGitRepositoryEnv(key)) delete env[key];
  }
  if (isolatedConfig) {
    env.GIT_CONFIG_GLOBAL = "/dev/null";
    env.GIT_CONFIG_NOSYSTEM = "1";
    for (const key of Object.keys(env)) {
      if (/^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/u.test(key)) delete env[key];
    }
  }
  return env;
}

function isGitRepositoryEnv(key: string): boolean {
  return key === "GIT_DIR" ||
    key === "GIT_WORK_TREE" ||
    key === "GIT_INDEX_FILE" ||
    key === "GIT_OBJECT_DIRECTORY" ||
    key === "GIT_COMMON_DIR" ||
    key === "GIT_NAMESPACE" ||
    key.startsWith("GIT_ALTERNATE_OBJECT");
}

async function pathKind(path: string): Promise<"directory" | "missing" | "other"> {
  try {
    const entry = await lstat(path);
    return !entry.isSymbolicLink() && entry.isDirectory() ? "directory" : "other";
  } catch (error) {
    if (isNotFoundError(error)) return "missing";
    throw error;
  }
}

async function ensureCacheParent(
  location: RemoteRepositoryCacheLocation,
  xdg: SkillsetXdgOptions | undefined
): Promise<void> {
  const cacheBase = resolveSkillsetXdgPaths(xdg).cache;
  await mkdir(cacheBase, { recursive: true });
  const trustedBase = await realpath(cacheBase);
  const parent = dirname(location.path);
  const relativeParent = relative(resolve(cacheBase), resolve(parent));
  if (!isContainedRelativePath(relativeParent)) {
    throw new Error(`skillset: remote cache ${location.cacheKey} escapes the XDG cache`);
  }

  let current = cacheBase;
  for (const segment of relativeParent.split(/[\\/]+/u)) {
    current = join(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
    const entry = await lstat(current);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`skillset: corrupt remote cache ${location.cacheKey}`);
    }
  }
  if (!isContainedPath(trustedBase, await realpath(parent))) {
    throw new Error(`skillset: remote cache ${location.cacheKey} escapes the XDG cache`);
  }
}

function isContainedPath(parent: string, candidate: string): boolean {
  return isContainedRelativePath(relative(parent, candidate));
}

function isContainedRelativePath(path: string): boolean {
  return path === "" || (path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(path));
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "EEXIST" || error.code === "ENOTEMPTY");
}
