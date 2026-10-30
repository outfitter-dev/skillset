import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestGitFixtureRoot, createTestGitRemote, runTestGit } from "../../../../scripts/test-helpers/git-remote";
import { acquireRemoteRepository, parseRemoteRepositoryReference } from "../remote-repository-cache";

const pairs = [
  ["encoded slash", "https://git.example/acme/repo.git", "https://git.example/acme%2Frepo.git"],
  ["encoded semicolon", "https://git.example/acme/x;y.git", "https://git.example/acme/x%3By.git"],
  ["Git suffix", "https://git.example/acme/repo.git", "https://git.example/acme/repo"],
  ["leading slash", "https://git.example/acme/repo.git", "https://git.example//acme/repo.git"],
  ["SSH user", "ssh://git@git.example/acme/repo.git", "ssh://git.example/acme/repo.git"],
] as const;

async function fixture(first: string, second: string) {
  const root = await createTestGitFixtureRoot("skillset-fetch-identity-");
  const remotes = [];
  for (const [index, repository] of [first, second].entries()) {
    const work = join(root, `work-${index}`);
    await mkdir(work);
    await writeFile(join(work, "identity.txt"), `${index}\n`);
    remotes.push(await createTestGitRemote(work, { disposableRoot: root, repository }));
  }
  const [a, b] = remotes;
  if (a === undefined || b === undefined) throw new Error("Missing fixture remotes");
  return {
    a, b,
    xdg: {
      env: { ...a.env, GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_1: `url.file://${b.remotePath}/.insteadOf`, GIT_CONFIG_VALUE_1: second },
      homeDir: a.xdg.homeDir,
    },
  };
}

describe("remote fetch identity", () => {
  for (const [label, a, b] of pairs) {
    for (const reverse of [false, true]) {
      test(`${label} acquires each requested origin (${reverse ? "reverse" : "forward"})`, async () => {
        const first = reverse ? b : a;
        const second = reverse ? a : b;
        expect(parseRemoteRepositoryReference(first).canonical).toBe(parseRemoteRepositoryReference(second).canonical);
        const setup = await fixture(first, second);
        const acquired = [];
        for (const [index, repository] of [first, second].entries()) {
          const result = await acquireRemoteRepository({ repository, revision: { kind: "ref", ref: "main" }, xdg: setup.xdg });
          expect(result.cacheHit).toBe(false);
          expect(result.sha).toBe(index === 0 ? setup.a.sha : setup.b.sha);
          expect(await readFile(join(result.rootPath, "identity.txt"), "utf8")).toBe(`${index}\n`);
          acquired.push(result);
        }
        expect(acquired[0]?.rootPath).not.toBe(acquired[1]?.rootPath);
        const repeated = await acquireRemoteRepository({ repository: second, revision: { kind: "ref", ref: "main" }, xdg: setup.xdg });
        expect(repeated).toMatchObject({ cacheHit: true, sha: setup.b.sha });
      });
    }
  }

  test("does not reinterpret a stored Git origin as Skillset shorthand", async () => {
    const repository = "https://github.com/acme/repo.git";
    const shorthand = "github:acme/repo";
    const setup = await fixture(repository, shorthand);
    const acquired = await acquireRemoteRepository({ repository, revision: { kind: "sha", sha: setup.a.sha }, xdg: setup.xdg });
    await runTestGit(acquired.rootPath, "remote", "set-url", "origin", shorthand);
    await expect(acquireRemoteRepository({ repository, revision: { kind: "sha", sha: setup.a.sha }, xdg: setup.xdg })).rejects.toThrow("origin mismatch");
  });

  test("rejects a canonical-equal replacement of a cached origin", async () => {
    const first = pairs[0][1];
    const second = pairs[0][2];
    const setup = await fixture(first, second);
    const acquired = await acquireRemoteRepository({ repository: first, revision: { kind: "sha", sha: setup.a.sha }, xdg: setup.xdg });
    await runTestGit(acquired.rootPath, "remote", "set-url", "origin", second);
    await expect(acquireRemoteRepository({ repository: first, revision: { kind: "sha", sha: setup.a.sha }, xdg: setup.xdg })).rejects.toThrow("origin mismatch");
  });
});
