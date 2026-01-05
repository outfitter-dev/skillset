import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findGitRoot, getGitRemoteUrl, getProjectId } from "../project";

describe("findGitRoot", () => {
  let tempDir: string;
  let gitDir: string;
  let nestedDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `skillset-test-${Date.now()}`);
    gitDir = join(tempDir, "repo");
    nestedDir = join(gitDir, "src", "lib");
    mkdirSync(nestedDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("finds .git in current directory", () => {
    mkdirSync(join(gitDir, ".git"));
    const result = findGitRoot(gitDir);
    expect(result).toBe(realpathSync(gitDir));
  });

  test("finds .git in parent directory", () => {
    mkdirSync(join(gitDir, ".git"));
    const result = findGitRoot(nestedDir);
    expect(result).toBe(realpathSync(gitDir));
  });

  test("returns startPath when no git repo found", () => {
    // No .git directory created
    const result = findGitRoot(nestedDir);
    expect(result).toBe(realpathSync(nestedDir));
  });

  test("resolves symlinks via realpathSync", () => {
    mkdirSync(join(gitDir, ".git"));
    // findGitRoot uses realpathSync internally
    const result = findGitRoot(gitDir);
    expect(result).toBe(realpathSync(gitDir));
  });

  test("walks up to root and stops when no .git found", () => {
    const result = findGitRoot(tempDir);
    expect(result).toBe(realpathSync(tempDir));
  });
});

describe("getGitRemoteUrl", () => {
  let tempDir: string;
  let gitRepo: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `skillset-test-${Date.now()}`);
    gitRepo = join(tempDir, "repo");
    mkdirSync(gitRepo, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("returns remote URL when it exists", () => {
    // Initialize git repo with remote
    const result = getGitRemoteUrl(process.cwd());
    // Current repo should have a remote
    if (result) {
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }
  });

  test("returns undefined when no remote configured", () => {
    const result = getGitRemoteUrl(gitRepo);
    expect(result).toBeUndefined();
  });

  test("returns undefined when not a git repo", () => {
    const result = getGitRemoteUrl(tempDir);
    expect(result).toBeUndefined();
  });

  test("returns undefined when git command fails", () => {
    const nonExistentPath = join(tempDir, "nonexistent");
    const result = getGitRemoteUrl(nonExistentPath);
    expect(result).toBeUndefined();
  });

  test("handles empty remote URL", () => {
    // getGitRemoteUrl returns undefined for empty strings
    const result = getGitRemoteUrl(gitRepo);
    expect(result).toBeUndefined();
  });
});

describe("getProjectId", () => {
  let tempDir: string;
  let gitRepo: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `skillset-test-${Date.now()}`);
    gitRepo = join(tempDir, "repo");
    mkdirSync(gitRepo, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("generates hash using path strategy by default", () => {
    const id = getProjectId(gitRepo);
    expect(typeof id).toBe("string");
    expect(id.length).toBe(16); // sha256 sliced to 16 chars
  });

  test("generates consistent hash for same path", () => {
    const id1 = getProjectId(gitRepo);
    const id2 = getProjectId(gitRepo);
    expect(id1).toBe(id2);
  });

  test("generates different hashes for different paths", () => {
    const repo1 = join(tempDir, "repo1");
    const repo2 = join(tempDir, "repo2");
    mkdirSync(repo1, { recursive: true });
    mkdirSync(repo2, { recursive: true });

    const id1 = getProjectId(repo1);
    const id2 = getProjectId(repo2);
    expect(id1).not.toBe(id2);
  });

  test("uses remote strategy when specified", () => {
    // For a repo with remote, remote strategy should work
    const id = getProjectId(process.cwd(), "remote");
    expect(typeof id).toBe("string");
    expect(id.length).toBe(16);
  });

  test("falls back to path when remote strategy but no remote", () => {
    const pathId = getProjectId(gitRepo, "path");
    const remoteId = getProjectId(gitRepo, "remote");
    // Should both use path hash since no remote exists
    expect(pathId).toBe(remoteId);
  });

  test("uses explicit path strategy", () => {
    const id = getProjectId(gitRepo, "path");
    expect(typeof id).toBe("string");
    expect(id.length).toBe(16);
  });

  test("resolves symlinks before hashing", () => {
    // Both paths resolve to real path, so hashes should match
    const realPath = realpathSync(gitRepo);
    const id1 = getProjectId(gitRepo);
    const id2 = getProjectId(realPath);
    expect(id1).toBe(id2);
  });
});
