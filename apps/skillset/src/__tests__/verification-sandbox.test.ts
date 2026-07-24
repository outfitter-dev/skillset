import { expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveWorkspaceRegistrationPolicy,
  TEST_SANDBOX_ENV,
  TEST_SANDBOX_SCHEMA_VERSION,
  testSandboxXdg,
  validateTestSandbox,
} from "../verification-sandbox";

test("SET-388: valid descriptors isolate all four XDG roots without changing HOME", async () => {
  const fixture = await createDescriptor();
  const home = join(fixture.root, "home");
  await mkdir(home);
  const env = fixtureEnv(fixture, { HOME: home });

  const validated = await validateTestSandbox(env, process.cwd());

  expect(validated.xdg).toEqual({
    cache: await realpath(fixture.xdg.cache),
    config: await realpath(fixture.xdg.config),
    data: await realpath(fixture.xdg.data),
    state: await realpath(fixture.xdg.state),
  });
  expect(env.HOME).toBe(home);
  expect(await resolveWorkspaceRegistrationPolicy(env)).toBe("isolated");
});

test("SET-388: nested validation rejects malformed, mismatched, and escaping state", async () => {
  const fixture = await createDescriptor();
  const malformed = join(fixture.sandboxPath, "malformed.json");
  await writeFile(malformed, "{");
  await expect(
    validateTestSandbox({
      ...fixtureEnv(fixture),
      [TEST_SANDBOX_ENV]: malformed,
    })
  ).rejects.toThrow("descriptor JSON");

  await expect(
    validateTestSandbox({
      ...fixtureEnv(fixture),
      XDG_CONFIG_HOME: join(fixture.root, "outside"),
    })
  ).rejects.toThrow("XDG_CONFIG_HOME");

  await expect(
    validateTestSandbox(fixtureEnv(fixture), fixture.root)
  ).rejects.toThrow("different repository root");
});

test("SET-388: descriptors reject foreign ownership and symlink escapes", async () => {
  const fixture = await createDescriptor();
  const linkedMarker = join(fixture.sandboxPath, "linked.json");
  await symlink(fixture.descriptorPath, linkedMarker);
  await expect(
    validateTestSandbox({
      ...fixtureEnv(fixture),
      SKILLSET_TEST_SANDBOX: linkedMarker,
    })
  ).rejects.toThrow("regular descriptor file");

  const foreignRoot = await mkdtemp(join(tmpdir(), "foreign-sandbox-"));
  const foreignXdg = testSandboxXdg(foreignRoot);
  await Promise.all(
    Object.values(foreignXdg).map((path) => mkdir(path, { recursive: true }))
  );
  const foreignMarker = join(foreignRoot, "descriptor.json");
  await writeFile(
    foreignMarker,
    JSON.stringify({
      createdAt: new Date().toISOString(),
      invocationId: crypto.randomUUID(),
      repoRoot: await realpath(process.cwd()),
      sandboxPath: await realpath(foreignRoot),
      schemaVersion: TEST_SANDBOX_SCHEMA_VERSION,
    })
  );
  await expect(
    validateTestSandbox({
      ...fixtureEnv(fixture),
      SKILLSET_TEST_SANDBOX: foreignMarker,
      XDG_CACHE_HOME: foreignXdg.cache,
      XDG_CONFIG_HOME: foreignXdg.config,
      XDG_DATA_HOME: foreignXdg.data,
      XDG_STATE_HOME: foreignXdg.state,
    })
  ).rejects.toThrow("owned sandbox");
});

test("SET-388: descriptors reject owned-looking sandboxes outside the OS temp root", async () => {
  const alternateTemp =
    process.platform === "darwin" ? "/private/var/tmp" : "/var/tmp";
  const sandboxPath = await mkdtemp(
    join(alternateTemp, "skillset-test-outside-")
  );
  try {
    const xdg = testSandboxXdg(sandboxPath);
    await Promise.all(
      Object.values(xdg).map((path) => mkdir(path, { recursive: true }))
    );
    const descriptorPath = join(sandboxPath, "descriptor.json");
    await writeFile(
      descriptorPath,
      JSON.stringify({
        createdAt: new Date().toISOString(),
        invocationId: crypto.randomUUID(),
        repoRoot: await realpath(process.cwd()),
        sandboxPath: await realpath(sandboxPath),
        schemaVersion: TEST_SANDBOX_SCHEMA_VERSION,
      })
    );

    await expect(
      validateTestSandbox({
        HOME: process.env.HOME,
        NODE_ENV: "test",
        SKILLSET_TEST_SANDBOX: descriptorPath,
        XDG_CACHE_HOME: xdg.cache,
        XDG_CONFIG_HOME: xdg.config,
        XDG_DATA_HOME: xdg.data,
        XDG_STATE_HOME: xdg.state,
      })
    ).rejects.toThrow("canonical OS temporary directory");
  } finally {
    await rm(sandboxPath, { recursive: true });
  }
});

test("SET-388: descriptors reject Git worktree roots and nested worktree paths", async () => {
  for (const nested of [false, true]) {
    const root = await mkdtemp(join(tmpdir(), nested
      ? "skillset-worktree-parent-"
      : "skillset-test-worktree-"));
    const sandboxPath = nested ? join(root, "skillset-test-nested") : root;
    if (nested) {
      await writeFile(join(root, ".git"), "gitdir: /tmp/linked-worktree\n");
    } else {
      await mkdir(join(root, ".git"), { recursive: true });
    }
    const xdg = testSandboxXdg(sandboxPath);
    await Promise.all(Object.values(xdg).map((path) => mkdir(path, { recursive: true })));
    const descriptorPath = join(sandboxPath, "descriptor.json");
    await writeFile(
      descriptorPath,
      JSON.stringify({
        createdAt: new Date().toISOString(),
        invocationId: crypto.randomUUID(),
        repoRoot: await realpath(process.cwd()),
        sandboxPath: await realpath(sandboxPath),
        schemaVersion: TEST_SANDBOX_SCHEMA_VERSION,
      })
    );

    await expect(
      validateTestSandbox({
        HOME: process.env.HOME,
        NODE_ENV: "test",
        SKILLSET_TEST_SANDBOX: descriptorPath,
        XDG_CACHE_HOME: xdg.cache,
        XDG_CONFIG_HOME: xdg.config,
        XDG_DATA_HOME: xdg.data,
        XDG_STATE_HOME: xdg.state,
      })
    ).rejects.toThrow("Git worktree");
    await rm(root, { recursive: true });
  }
});

test("SET-388: descriptors reject repository and HOME containment in either direction", async () => {
  const repositoryFixture = await createDescriptor();
  await writeFile(
    repositoryFixture.descriptorPath,
    JSON.stringify({
      createdAt: new Date().toISOString(),
      invocationId: crypto.randomUUID(),
      repoRoot: await realpath(repositoryFixture.root),
      sandboxPath: repositoryFixture.sandboxPath,
      schemaVersion: TEST_SANDBOX_SCHEMA_VERSION,
    })
  );

  await expect(
    validateTestSandbox(fixtureEnv(repositoryFixture))
  ).rejects.toThrow("overlaps a repository or HOME");

  const homeFixture = await createDescriptor();
  await expect(
    validateTestSandbox({
      ...fixtureEnv(homeFixture),
      HOME: homeFixture.root,
    })
  ).rejects.toThrow("overlaps a repository or HOME");

  const repositoryDescendant = await createDescriptor();
  const nestedRepository = join(repositoryDescendant.sandboxPath, "repository");
  await mkdir(nestedRepository);
  await writeFile(
    repositoryDescendant.descriptorPath,
    JSON.stringify({
      createdAt: new Date().toISOString(),
      invocationId: crypto.randomUUID(),
      repoRoot: await realpath(nestedRepository),
      sandboxPath: repositoryDescendant.sandboxPath,
      schemaVersion: TEST_SANDBOX_SCHEMA_VERSION,
    })
  );
  await expect(
    validateTestSandbox(fixtureEnv(repositoryDescendant))
  ).rejects.toThrow("overlaps a repository or HOME");

  const homeDescendant = await createDescriptor();
  const nestedHome = join(homeDescendant.sandboxPath, "home");
  await mkdir(nestedHome);
  await expect(
    validateTestSandbox({
      ...fixtureEnv(homeDescendant),
      HOME: nestedHome,
    })
  ).rejects.toThrow("overlaps a repository or HOME");
});

test("SET-388: test mode refuses registration without the canonical marker", async () => {
  await expect(
    resolveWorkspaceRegistrationPolicy({ NODE_ENV: "test" })
  ).rejects.toThrow("bun run test:sandbox");
  await expect(
    resolveWorkspaceRegistrationPolicy({ NODE_ENV: "development" })
  ).resolves.toBe("normal");
  await expect(
    resolveWorkspaceRegistrationPolicy({
      NODE_ENV: "test",
      SKILLSET_INTERNAL_SUPPRESS_WORKSPACE_REGISTRATION: "1",
    })
  ).resolves.toBe("suppressed");
});

async function createDescriptor() {
  const root = await mkdtemp(join(tmpdir(), "skillset-sandbox-contract-"));
  const sandboxPath = join(root, "skillset-test-owned");
  const xdg = testSandboxXdg(sandboxPath);
  await Promise.all(
    Object.values(xdg).map((path) => mkdir(path, { recursive: true }))
  );
  const descriptorPath = join(sandboxPath, "descriptor.json");
  await writeFile(
    descriptorPath,
    JSON.stringify({
      createdAt: new Date().toISOString(),
      invocationId: crypto.randomUUID(),
      repoRoot: await realpath(process.cwd()),
      sandboxPath: await realpath(sandboxPath),
      schemaVersion: TEST_SANDBOX_SCHEMA_VERSION,
    })
  );
  return {
    descriptorPath,
    root,
    sandboxPath: await realpath(sandboxPath),
    xdg,
  };
}

function fixtureEnv(
  fixture: Awaited<ReturnType<typeof createDescriptor>>,
  extra: Record<string, string> = {}
) {
  return {
    ...extra,
    HOME: extra.HOME ?? process.env.HOME,
    NODE_ENV: "test",
    SKILLSET_TEST_SANDBOX: fixture.descriptorPath,
    XDG_CACHE_HOME: fixture.xdg.cache,
    XDG_CONFIG_HOME: fixture.xdg.config,
    XDG_DATA_HOME: fixture.xdg.data,
    XDG_STATE_HOME: fixture.xdg.state,
  };
}
