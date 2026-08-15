import { afterEach, expect, test } from "bun:test";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createOperationReport } from "@skillset/core/internal/report";
import {
  createReportBundle,
  resolveReportStoreRoot,
} from "@skillset/core/internal/report-store";

import {
  importRequestedSandboxReports,
  registerSandboxReportExportRequest,
  REPORT_EXPORT_REQUESTS_DIR,
  REPORT_EXPORT_REQUEST_SCHEMA_VERSION,
} from "../report-export-request";
import {
  TEST_SANDBOX_SCHEMA_VERSION,
  testSandboxGit,
  testSandboxXdg,
} from "../verification-sandbox";

const FIRST_ID = "6ba7b810-9dad-4c8e-8a46-7e8dd6f4e6d5";
const SECOND_ID = "8f4ff612-f753-49da-a350-bf22e52ca0b8";
const fixtureRoots = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...fixtureRoots].map((root) => rm(root, { force: true, recursive: true }))
  );
  fixtureRoots.clear();
});

test("SET-445: parent imports only explicit create-only report requests", async () => {
  const fixture = await createSandboxFixture();
  await writeChildReport(fixture, FIRST_ID, "requested");
  await writeChildReport(fixture, SECOND_ID, "unrequested");

  expect(
    await registerSandboxReportExportRequest({
      env: fixture.env,
      expectedRepoRoot: process.cwd(),
      reportId: FIRST_ID,
    })
  ).toBeTrue();
  await expect(
    registerSandboxReportExportRequest({
      env: fixture.env,
      expectedRepoRoot: process.cwd(),
      reportId: FIRST_ID,
    })
  ).rejects.toThrow();

  const requestPath = join(
    fixture.sandboxPath,
    REPORT_EXPORT_REQUESTS_DIR,
    `${FIRST_ID}.json`
  );
  expect(JSON.parse(await readFile(requestPath, "utf8"))).toEqual({
    reportId: FIRST_ID,
    schemaVersion: REPORT_EXPORT_REQUEST_SCHEMA_VERSION,
  });
  if (process.platform !== "win32") {
    expect((await stat(dirname(requestPath))).mode & 0o777).toBe(0o700);
    expect((await stat(requestPath)).mode & 0o777).toBe(0o600);
  }

  const imported = await importRequestedSandboxReports({
    childEnv: fixture.env,
    expectedRepoRoot: process.cwd(),
    parentXdg: { state: fixture.parentState },
  });

  expect(imported.map((bundle) => bundle.report.id)).toEqual([FIRST_ID]);
  expect(imported[0]?.report.workspace.name).toBe("requested");
  await expect(
    pathExists(join(parentReportRoot(fixture), FIRST_ID, "report.json"))
  ).resolves.toBeTrue();
  await expect(
    pathExists(join(parentReportRoot(fixture), SECOND_ID, "report.json"))
  ).resolves.toBeFalse();
});

test("SET-445: direct global producers do not register a parent request", async () => {
  expect(
    await registerSandboxReportExportRequest({
      env: {},
      expectedRepoRoot: process.cwd(),
      reportId: FIRST_ID,
    })
  ).toBeFalse();
});

test("SET-445: request enumeration rejects forged shapes and identity mismatches before import", async () => {
  for (const forge of [
    async (fixture: SandboxFixture) => {
      await writeRequest(fixture, FIRST_ID, {
        reportId: FIRST_ID,
        schemaVersion: REPORT_EXPORT_REQUEST_SCHEMA_VERSION,
        surprise: true,
      });
    },
    async (fixture: SandboxFixture) => {
      await writeRequest(fixture, FIRST_ID, {
        reportId: SECOND_ID,
        schemaVersion: REPORT_EXPORT_REQUEST_SCHEMA_VERSION,
      });
    },
    async (fixture: SandboxFixture) => {
      await writeRequest(fixture, FIRST_ID, {
        reportId: FIRST_ID,
        schemaVersion: "skillset.report-export-request@future",
      });
    },
  ]) {
    const fixture = await createSandboxFixture();
    await writeChildReport(fixture, FIRST_ID, "workspace");
    await forge(fixture);
    await expect(
      importRequestedSandboxReports({
        childEnv: fixture.env,
        expectedRepoRoot: process.cwd(),
        parentXdg: { state: fixture.parentState },
      })
    ).rejects.toThrow();
    await expect(pathExists(parentReportRoot(fixture))).resolves.toBeFalse();
  }
});

test("SET-445: request enumeration rejects malformed JSON and loose permissions", async () => {
  const malformedFixture = await createSandboxFixture();
  const malformedDirectory = await createRequestDirectory(malformedFixture);
  await writeFile(join(malformedDirectory, `${FIRST_ID}.json`), "{\n", {
    mode: 0o600,
  });
  await expect(
    importRequestedSandboxReports({
      childEnv: malformedFixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: malformedFixture.parentState },
    })
  ).rejects.toThrow("invalid report export request JSON");

  if (process.platform === "win32") return;
  const permissionsFixture = await createSandboxFixture();
  await writeChildReport(permissionsFixture, FIRST_ID, "workspace");
  await writeRequest(permissionsFixture, FIRST_ID, {
    reportId: FIRST_ID,
    schemaVersion: REPORT_EXPORT_REQUEST_SCHEMA_VERSION,
  });
  await chmod(
    join(
      permissionsFixture.sandboxPath,
      REPORT_EXPORT_REQUESTS_DIR,
      `${FIRST_ID}.json`
    ),
    0o644
  );
  await expect(
    importRequestedSandboxReports({
      childEnv: permissionsFixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: permissionsFixture.parentState },
    })
  ).rejects.toThrow("must use mode 600");
  await expect(
    pathExists(parentReportRoot(permissionsFixture))
  ).resolves.toBeFalse();

  const sizeFixture = await createSandboxFixture();
  const sizeDirectory = await createRequestDirectory(sizeFixture);
  const oversizedPath = join(sizeDirectory, `${FIRST_ID}.json`);
  await writeFile(oversizedPath, "x".repeat(4097), { mode: 0o600 });
  await chmod(oversizedPath, 0o600);
  await expect(
    importRequestedSandboxReports({
      childEnv: sizeFixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: sizeFixture.parentState },
    })
  ).rejects.toThrow("too large");
  await expect(pathExists(parentReportRoot(sizeFixture))).resolves.toBeFalse();
});

test("SET-445: no-follow request reads reject pathname substitution", async () => {
  if (process.platform === "win32" || !constants.O_NOFOLLOW) return;
  const fixture = await createSandboxFixture();
  await writeChildReport(fixture, FIRST_ID, "workspace");
  await writeRequest(fixture, FIRST_ID, {
    reportId: FIRST_ID,
    schemaVersion: REPORT_EXPORT_REQUEST_SCHEMA_VERSION,
  });
  const foreignPath = join(fixture.sandboxPath, "foreign-request.json");
  await writeFile(
    foreignPath,
    `${JSON.stringify({
      reportId: FIRST_ID,
      schemaVersion: REPORT_EXPORT_REQUEST_SCHEMA_VERSION,
    })}\n`,
    { mode: 0o600 }
  );

  await expect(
    importRequestedSandboxReports({
      childEnv: fixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: fixture.parentState },
      testHooks: {
        async beforeRequestOpen({ requestPath }) {
          await rename(requestPath, `${requestPath}.original`);
          await symlink(foreignPath, requestPath);
        },
      },
    })
  ).rejects.toThrow("must not be a symlink");
  await expect(pathExists(parentReportRoot(fixture))).resolves.toBeFalse();
});

test("SET-445: request directory identity cannot change after enumeration", async () => {
  if (process.platform === "win32") return;
  const fixture = await createSandboxFixture();
  await writeChildReport(fixture, FIRST_ID, "workspace");
  await writeRequest(fixture, FIRST_ID, {
    reportId: FIRST_ID,
    schemaVersion: REPORT_EXPORT_REQUEST_SCHEMA_VERSION,
  });
  const requestDirectory = join(
    fixture.sandboxPath,
    REPORT_EXPORT_REQUESTS_DIR
  );
  const replacementDirectory = join(
    fixture.sandboxPath,
    "replacement-requests"
  );
  await mkdir(replacementDirectory, { mode: 0o700 });
  await chmod(replacementDirectory, 0o700);

  await expect(
    importRequestedSandboxReports({
      childEnv: fixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: fixture.parentState },
      testHooks: {
        async afterRequestEnumeration() {
          await rename(requestDirectory, `${requestDirectory}.original`);
          await rename(replacementDirectory, requestDirectory);
        },
      },
    })
  ).rejects.toThrow("changed during validation");
  await expect(pathExists(parentReportRoot(fixture))).resolves.toBeFalse();
});

test("SET-445: request directories reject foreign ownership", async () => {
  if (process.platform === "win32" || process.getuid === undefined) return;
  const fixture = await createSandboxFixture();
  await createRequestDirectory(fixture);

  await expect(
    importRequestedSandboxReports({
      childEnv: fixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: fixture.parentState },
      testHooks: {
        transformOwnershipUid({ label, uid }) {
          return label === "report export request directory" ? uid + 1 : uid;
        },
      },
    })
  ).rejects.toThrow("must be owned by the current user");

  const fileFixture = await createSandboxFixture();
  await writeChildReport(fileFixture, FIRST_ID, "workspace");
  await writeRequest(fileFixture, FIRST_ID, {
    reportId: FIRST_ID,
    schemaVersion: REPORT_EXPORT_REQUEST_SCHEMA_VERSION,
  });
  await expect(
    importRequestedSandboxReports({
      childEnv: fileFixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: fileFixture.parentState },
      testHooks: {
        transformOwnershipUid({ label, uid }) {
          return label === "report export request file" ? uid + 1 : uid;
        },
      },
    })
  ).rejects.toThrow("must be owned by the current user");
  await expect(pathExists(parentReportRoot(fileFixture))).resolves.toBeFalse();
});

test("SET-445: request enumeration rejects symlinks and unexpected entries", async () => {
  const directoryFixture = await createSandboxFixture();
  const requestDirectory = await createRequestDirectory(directoryFixture);
  await mkdir(join(requestDirectory, "unexpected"));
  await expect(
    importRequestedSandboxReports({
      childEnv: directoryFixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: directoryFixture.parentState },
    })
  ).rejects.toThrow("invalid report export request entry");

  if (process.platform === "win32") return;
  const fileFixture = await createSandboxFixture();
  await writeChildReport(fileFixture, FIRST_ID, "workspace");
  const fileRequestDirectory = await createRequestDirectory(fileFixture);
  const target = join(fileFixture.sandboxPath, "foreign-request.json");
  await writeFile(
    target,
    JSON.stringify({
      reportId: FIRST_ID,
      schemaVersion: REPORT_EXPORT_REQUEST_SCHEMA_VERSION,
    })
  );
  await symlink(target, join(fileRequestDirectory, `${FIRST_ID}.json`));
  await expect(
    importRequestedSandboxReports({
      childEnv: fileFixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: fileFixture.parentState },
    })
  ).rejects.toThrow("invalid report export request entry");

  const linkFixture = await createSandboxFixture();
  const foreignDirectory = join(linkFixture.sandboxPath, "foreign-requests");
  await mkdir(foreignDirectory);
  await symlink(
    foreignDirectory,
    join(linkFixture.sandboxPath, REPORT_EXPORT_REQUESTS_DIR)
  );
  await expect(
    importRequestedSandboxReports({
      childEnv: linkFixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: linkFixture.parentState },
    })
  ).rejects.toThrow("plain directory");
});

test("SET-445: request enumeration is bounded before parent state is created", async () => {
  const fixture = await createSandboxFixture();
  const requestDirectory = await createRequestDirectory(fixture);
  for (let index = 0; index < 101; index += 1) {
    const id = crypto.randomUUID();
    const path = join(requestDirectory, `${id}.json`);
    await writeFile(
      path,
      `${JSON.stringify({
        reportId: id,
        schemaVersion: REPORT_EXPORT_REQUEST_SCHEMA_VERSION,
      })}\n`,
      { mode: 0o600 }
    );
    if (process.platform !== "win32") await chmod(path, 0o600);
  }

  await expect(
    importRequestedSandboxReports({
      childEnv: fixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: fixture.parentState },
    })
  ).rejects.toThrow("100 request limit");
  await expect(pathExists(parentReportRoot(fixture))).resolves.toBeFalse();
});

test("SET-445: optional CI export atomically publishes exact two-file UUID bundles", async () => {
  const fixture = await createSandboxFixture();
  await writeChildReport(fixture, FIRST_ID, "first");
  await writeChildReport(fixture, SECOND_ID, "second");
  await Promise.all(
    [FIRST_ID, SECOND_ID].map((reportId) =>
      registerSandboxReportExportRequest({
        env: fixture.env,
        expectedRepoRoot: process.cwd(),
        reportId,
      })
    )
  );
  const artifactParent = join(fixture.root, "artifact-parent");
  const artifactDirectory = join(artifactParent, "skillset-reports");
  await mkdir(artifactParent);

  const imported = await importRequestedSandboxReports({
    artifactDirectory,
    childEnv: fixture.env,
    expectedRepoRoot: process.cwd(),
    parentXdg: { state: fixture.parentState },
  });

  expect(imported.map((bundle) => bundle.report.id)).toEqual([
    FIRST_ID,
    SECOND_ID,
  ]);
  expect((await readdir(artifactDirectory)).toSorted()).toEqual(
    [FIRST_ID, SECOND_ID].toSorted()
  );
  for (const bundle of imported) {
    const bundlePath = join(artifactDirectory, bundle.report.id);
    expect(await readdir(bundlePath)).toEqual(["report.json", "report.md"]);
    expect(await readFile(join(bundlePath, "report.json"), "utf8")).toBe(
      `${JSON.stringify(bundle.report, null, 2)}\n`
    );
    expect(await readFile(join(bundlePath, "report.md"), "utf8")).toBe(
      bundle.markdown
    );
    if (process.platform !== "win32") {
      expect((await stat(bundlePath)).mode & 0o777).toBe(0o700);
      expect((await stat(join(bundlePath, "report.json"))).mode & 0o777).toBe(
        0o600
      );
      expect((await stat(join(bundlePath, "report.md"))).mode & 0o777).toBe(
        0o600
      );
    }
  }
});

test("SET-445: artifact export rejects collisions, symlink ancestry, and overlap", async () => {
  const collisionFixture = await createSandboxFixture();
  await writeChildReport(collisionFixture, FIRST_ID, "workspace");
  await registerRequests(collisionFixture, [FIRST_ID]);
  const artifactParent = join(collisionFixture.root, "artifact-parent");
  const collision = join(artifactParent, "collision");
  await mkdir(collision, { recursive: true });
  await expect(
    importRequestedSandboxReports({
      artifactDirectory: collision,
      childEnv: collisionFixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: collisionFixture.parentState },
    })
  ).rejects.toThrow("already exists");

  const overlapFixture = await createSandboxFixture();
  await writeChildReport(overlapFixture, FIRST_ID, "workspace");
  await registerRequests(overlapFixture, [FIRST_ID]);
  await expect(
    importRequestedSandboxReports({
      artifactDirectory: join(overlapFixture.sandboxPath, "artifacts"),
      childEnv: overlapFixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: overlapFixture.parentState },
    })
  ).rejects.toThrow("must not overlap");
  await expect(
    pathExists(parentReportRoot(overlapFixture))
  ).resolves.toBeFalse();

  if (process.platform === "win32") return;
  const symlinkFixture = await createSandboxFixture();
  await writeChildReport(symlinkFixture, FIRST_ID, "workspace");
  await registerRequests(symlinkFixture, [FIRST_ID]);
  const realParent = join(symlinkFixture.root, "real-parent");
  const linkedParent = join(symlinkFixture.root, "linked-parent");
  await mkdir(realParent);
  await symlink(realParent, linkedParent);
  await expect(
    importRequestedSandboxReports({
      artifactDirectory: join(linkedParent, "skillset-reports"),
      childEnv: symlinkFixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: symlinkFixture.parentState },
    })
  ).rejects.toThrow();
});

test("SET-445: artifact destination cannot overlap parent report authorities", async () => {
  for (const artifactPath of [
    (fixture: SandboxFixture) => join(fixture.parentState, "ci-artifacts"),
    (fixture: SandboxFixture) =>
      join(parentReportRoot(fixture), "ci-artifacts"),
  ]) {
    const fixture = await createSandboxFixture();
    await writeChildReport(fixture, FIRST_ID, "workspace");
    await registerRequests(fixture, [FIRST_ID]);
    await expect(
      importRequestedSandboxReports({
        artifactDirectory: artifactPath(fixture),
        childEnv: fixture.env,
        expectedRepoRoot: process.cwd(),
        parentXdg: { state: fixture.parentState },
      })
    ).rejects.toThrow("must not overlap");
    await expect(pathExists(parentReportRoot(fixture))).resolves.toBeFalse();
  }

  const fixture = await createSandboxFixture();
  await writeChildReport(fixture, FIRST_ID, "first");
  await registerRequests(fixture, [FIRST_ID]);
  await importRequestedSandboxReports({
    childEnv: fixture.env,
    expectedRepoRoot: process.cwd(),
    parentXdg: { state: fixture.parentState },
  });
  const completedBundle = join(parentReportRoot(fixture), FIRST_ID);
  const originalEntries = await readdir(completedBundle);
  const originalJson = await readFile(join(completedBundle, "report.json"));
  const originalMarkdown = await readFile(join(completedBundle, "report.md"));
  await rm(
    join(fixture.sandboxPath, REPORT_EXPORT_REQUESTS_DIR, `${FIRST_ID}.json`)
  );

  await writeChildReport(fixture, SECOND_ID, "second");
  await registerRequests(fixture, [SECOND_ID]);
  await expect(
    importRequestedSandboxReports({
      artifactDirectory: join(completedBundle, "ci-artifacts"),
      childEnv: fixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: fixture.parentState },
    })
  ).rejects.toThrow("must not overlap");
  expect(await readdir(completedBundle)).toEqual(originalEntries);
  expect(await readFile(join(completedBundle, "report.json"))).toEqual(
    originalJson
  );
  expect(await readFile(join(completedBundle, "report.md"))).toEqual(
    originalMarkdown
  );
  await expect(
    pathExists(join(parentReportRoot(fixture), SECOND_ID))
  ).resolves.toBeFalse();
});

test("SET-445: artifact parent and lock reject foreign ownership", async () => {
  if (process.platform === "win32" || process.getuid === undefined) return;
  const parentFixture = await createSandboxFixture();
  await writeChildReport(parentFixture, FIRST_ID, "workspace");
  await registerRequests(parentFixture, [FIRST_ID]);
  const artifactParent = join(parentFixture.root, "artifact-parent");
  await mkdir(artifactParent);

  await expect(
    importRequestedSandboxReports({
      artifactDirectory: join(artifactParent, "foreign-parent"),
      childEnv: parentFixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: parentFixture.parentState },
      testHooks: {
        transformOwnershipUid({ label, uid }) {
          return label === "report artifact parent" ? uid + 1 : uid;
        },
      },
    })
  ).rejects.toThrow("must be owned by the current user");

  const lockFixture = await createSandboxFixture();
  await writeChildReport(lockFixture, FIRST_ID, "workspace");
  await registerRequests(lockFixture, [FIRST_ID]);
  const lockArtifactParent = join(lockFixture.root, "artifact-parent");
  await mkdir(lockArtifactParent);
  await expect(
    importRequestedSandboxReports({
      artifactDirectory: join(lockArtifactParent, "foreign-lock"),
      childEnv: lockFixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: lockFixture.parentState },
      testHooks: {
        transformOwnershipUid({ label, uid }) {
          return label === "report artifact lock" ? uid + 1 : uid;
        },
      },
    })
  ).rejects.toThrow("must be owned by the current user");
  expect(await readdir(artifactParent)).toEqual([]);
  expect(await readdir(lockArtifactParent)).toEqual([]);
});

test("SET-445: artifact write failure leaves neither final nor staged output", async () => {
  const fixture = await createSandboxFixture();
  await writeChildReport(fixture, FIRST_ID, "first");
  await writeChildReport(fixture, SECOND_ID, "second");
  await registerRequests(fixture, [FIRST_ID, SECOND_ID]);
  const artifactParent = join(fixture.root, "artifact-parent");
  const artifactDirectory = join(artifactParent, "skillset-reports");
  await mkdir(artifactParent);

  await expect(
    importRequestedSandboxReports({
      artifactDirectory,
      childEnv: fixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: fixture.parentState },
      testHooks: {
        beforeBundleWrite: ({ index }) => {
          if (index === 1) throw new Error("injected artifact failure");
        },
      },
    })
  ).rejects.toThrow("injected artifact failure");

  await expect(pathExists(artifactDirectory)).resolves.toBeFalse();
  expect(
    (await readdir(artifactParent)).filter((entry) =>
      entry.startsWith(".stage-")
    )
  ).toEqual([]);
});

test("SET-445: artifact publication never replaces a late collision", async () => {
  const fixture = await createSandboxFixture();
  await writeChildReport(fixture, FIRST_ID, "workspace");
  await registerRequests(fixture, [FIRST_ID]);
  const artifactParent = join(fixture.root, "artifact-parent");
  const artifactDirectory = join(artifactParent, "skillset-reports");
  await mkdir(artifactParent);

  await expect(
    importRequestedSandboxReports({
      artifactDirectory,
      childEnv: fixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: fixture.parentState },
      testHooks: {
        beforePublication: async ({ finalPath }) => {
          await mkdir(finalPath);
          await writeFile(join(finalPath, "owner-sentinel"), "keep\n");
        },
      },
    })
  ).rejects.toThrow("already exists");

  expect(
    await readFile(join(artifactDirectory, "owner-sentinel"), "utf8")
  ).toBe("keep\n");
  expect(
    (await readdir(artifactParent)).filter(
      (entry) => entry.startsWith(".stage-") || entry.endsWith(".lock")
    )
  ).toEqual([]);
});

type SandboxFixture = Awaited<ReturnType<typeof createSandboxFixture>>;

async function createSandboxFixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "skillset-export-request-"))
  );
  fixtureRoots.add(root);
  const sandboxPath = join(root, "skillset-test-owned");
  const parentState = join(root, "parent-state");
  const git = testSandboxGit(sandboxPath);
  const xdg = testSandboxXdg(sandboxPath);
  await Promise.all([
    ...Object.values(xdg).map((path) => mkdir(path, { recursive: true })),
    mkdir(join(sandboxPath, "git"), { recursive: true }),
    mkdir(parentState),
  ]);
  await Promise.all(Object.values(git).map((path) => writeFile(path, "")));
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
    env: {
      GIT_CONFIG_GLOBAL: git.global,
      GIT_CONFIG_SYSTEM: git.system,
      GIT_TERMINAL_PROMPT: "0",
      HOME: process.env.HOME,
      NODE_ENV: "test",
      SKILLSET_TEST_SANDBOX: descriptorPath,
      XDG_CACHE_HOME: xdg.cache,
      XDG_CONFIG_HOME: xdg.config,
      XDG_DATA_HOME: xdg.data,
      XDG_STATE_HOME: xdg.state,
    },
    parentState,
    root,
    sandboxPath,
    xdg,
  };
}

async function registerRequests(
  fixture: SandboxFixture,
  reportIds: readonly string[]
): Promise<void> {
  for (const reportId of reportIds) {
    await registerSandboxReportExportRequest({
      env: fixture.env,
      expectedRepoRoot: process.cwd(),
      reportId,
    });
  }
}

async function writeChildReport(
  fixture: SandboxFixture,
  id: string,
  workspaceName: string
) {
  const report = createOperationReport(
    {
      command: "check",
      exitCode: 0,
      skillsetVersion: "0.23.0",
      workspace: {
        id: "skillset--local-export-request",
        name: workspaceName,
      },
    },
    {
      testHooks: {
        createdAt: "2026-08-14T21:30:00.000Z",
        id,
      },
    }
  );
  return createReportBundle(report, {
    boundary: {
      reportRoot: resolveReportStoreRoot({
        env: { XDG_STATE_HOME: fixture.xdg.state },
      }),
      trustedBase: fixture.xdg.state,
    },
  });
}

async function createRequestDirectory(
  fixture: SandboxFixture
): Promise<string> {
  const path = join(fixture.sandboxPath, REPORT_EXPORT_REQUESTS_DIR);
  await mkdir(path, { mode: 0o700 });
  if (process.platform !== "win32") await chmod(path, 0o700);
  return path;
}

async function writeRequest(
  fixture: SandboxFixture,
  filenameId: string,
  value: unknown
): Promise<void> {
  const directory = await createRequestDirectory(fixture);
  const path = join(directory, `${filenameId}.json`);
  await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") await chmod(path, 0o600);
}

function parentReportRoot(fixture: SandboxFixture): string {
  return resolveReportStoreRoot({
    env: { XDG_STATE_HOME: fixture.parentState },
  });
}

async function pathExists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  );
}
