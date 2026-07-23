import { expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { validateTestSandbox } from "../../apps/skillset/src/verification-sandbox";
import {
  createTestGitFixtureRoot,
  createTestGitRemote,
  runTestGit,
} from "../test-helpers/git-remote";

test("SET-389: fixture root prefixes cannot escape the owned sandbox", async () => {
  const sandbox = await validateTestSandbox();
  const parent = dirname(sandbox.descriptor.sandboxPath);
  const token = `set389-escape-${crypto.randomUUID()}-`;

  await expect(createTestGitFixtureRoot(`../${token}`)).rejects.toThrow(
    "safe basename"
  );
  expect((await readdir(parent)).filter((entry) => entry.startsWith(token))).toEqual(
    []
  );
  for (const prefix of [
    "",
    ".",
    "..",
    "/absolute-",
    "nested/path-",
    "nested\\path-",
  ]) {
    await expect(createTestGitFixtureRoot(prefix)).rejects.toThrow(
      "safe basename"
    );
  }
});

test("SET-389: disposable fixtures commit with only their deterministic local identity", async () => {
  const root = await createTestGitFixtureRoot();
  const work = await mkdtemp(join(root, "work-"));
  await writeFile(join(work, "README.md"), "fixture\n");

  const remote = await createTestGitRemote(work, { disposableRoot: root });

  expect(await runTestGit(work, "branch", "--show-current")).toBe("main");
  expect(await runTestGit(work, "show", "-s", "--format=%an <%ae>", remote.sha)).toBe(
    "Skillset Tests <skillset@example.test>"
  );
  expect(await runTestGit(work, "config", "--local", "user.name")).toBe(
    "Skillset Tests"
  );
  expect(await runTestGit(work, "config", "--local", "user.email")).toBe(
    "skillset@example.test"
  );
});

test("SET-389: fixture initialization rejects unowned, symlinked, and existing repositories", async () => {
  const root = await createTestGitFixtureRoot();
  await expect(
    createTestGitRemote(process.cwd(), { disposableRoot: root })
  ).rejects.toThrow("inside the owned test sandbox");

  const outside = await createTestGitFixtureRoot("skillset-test-git-outside-");
  const outsideWork = await mkdtemp(join(outside, "work-"));
  const linked = join(root, "linked");
  await symlink(outsideWork, linked);
  await expect(
    createTestGitRemote(linked, { disposableRoot: root })
  ).rejects.toThrow("real directory");

  const existing = await mkdtemp(join(root, "existing-"));
  await runTestGit(existing, "init", "--initial-branch=main");
  await expect(
    createTestGitRemote(existing, { disposableRoot: root })
  ).rejects.toThrow("existing repository");

  const bare = await mkdtemp(join(root, "bare-"));
  await runTestGit(bare, "init", "--bare");
  await expect(
    createTestGitRemote(bare, { disposableRoot: root })
  ).rejects.toThrow("existing repository");
});

test("SET-389: linked worktrees and caller-owned remote roots are rejected before mutation", async () => {
  const root = await createTestGitFixtureRoot();
  const work = await mkdtemp(join(root, "work-"));
  await writeFile(join(work, "README.md"), "fixture\n");
  await createTestGitRemote(work, { disposableRoot: root });

  const linked = join(root, "linked-worktree");
  await runTestGit(work, "worktree", "add", "-q", "-b", "linked", linked);
  await expect(
    createTestGitRemote(linked, { disposableRoot: root })
  ).rejects.toThrow("linked worktree");

  const shared = await mkdtemp(join(root, "shared-common-dir-"));
  await writeFile(
    join(shared, ".git"),
    `gitdir: ${await realpath(join(process.cwd(), ".git"))}\n`
  );
  await expect(
    createTestGitRemote(shared, { disposableRoot: root })
  ).rejects.toThrow("common Git directory");

  await expect(
    createTestGitRemote(await mkdtemp(join(root, "second-work-")), {
      disposableRoot: root,
      rootPath: root,
    })
  ).rejects.toThrow("inside the owned test sandbox");

  const unrelatedRemote = await mkdtemp(join(root, "unrelated-remote-"));
  await runTestGit(unrelatedRemote, "init", "--bare");
  const freshWork = await mkdtemp(join(root, "fresh-work-"));
  await mkdir(join(freshWork, "content"));
  await expect(
    createTestGitRemote(freshWork, {
      disposableRoot: root,
      rootPath: unrelatedRemote,
    })
  ).rejects.toThrow("remote root must not be an existing repository");
});
