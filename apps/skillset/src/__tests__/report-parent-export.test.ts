import { expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
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

import { exportSandboxReportToParent } from "../report-parent-export";
import {
  TEST_SANDBOX_SCHEMA_VERSION,
  testSandboxGit,
  testSandboxXdg,
} from "../verification-sandbox";

const FIRST_ID = "6ba7b810-9dad-4c8e-8a46-7e8dd6f4e6d5";
const SECOND_ID = "8f4ff612-f753-49da-a350-bf22e52ca0b8";

test("SET-453: parent export derives the child bundle and preserves its UUID", async () => {
  const fixture = await createSandboxFixture();
  const sentinel = "private-workspace-sentinel";
  await writeChildReport(fixture, FIRST_ID, sentinel);
  await writeChildReport(fixture, SECOND_ID, "unrequested");

  const stored = await exportSandboxReportToParent({
    childEnv: fixture.env,
    expectedRepoRoot: process.cwd(),
    parentXdg: { state: fixture.parentState },
    reportId: FIRST_ID,
    sensitiveValues: [sentinel],
  });

  expect(stored.report.id).toBe(FIRST_ID);
  expect(stored.report.workspace.name).toBe("[REDACTED]");
  expect(stored.resolvedPath).toBe(
    join(
      resolveReportStoreRoot({
        env: { XDG_STATE_HOME: fixture.parentState },
      }),
      FIRST_ID
    )
  );
  expect(
    await readFile(join(stored.resolvedPath, "report.md"), "utf8")
  ).not.toContain(sentinel);
  expect(
    Bun.file(
      join(
        resolveReportStoreRoot({
          env: { XDG_STATE_HOME: fixture.parentState },
        }),
        SECOND_ID,
        "report.json"
      )
    ).exists()
  ).resolves.toBe(false);

  if (process.platform !== "win32") {
    const reportRoot = resolveReportStoreRoot({
      env: { XDG_STATE_HOME: fixture.parentState },
    });
    const [rootStat, bundleStat, jsonStat, markdownStat] = await Promise.all([
      stat(reportRoot),
      stat(stored.resolvedPath),
      stat(join(stored.resolvedPath, "report.json")),
      stat(join(stored.resolvedPath, "report.md")),
    ]);
    expect(rootStat.mode & 0o777).toBe(0o700);
    expect(bundleStat.mode & 0o777).toBe(0o700);
    expect(jsonStat.mode & 0o777).toBe(0o600);
    expect(markdownStat.mode & 0o777).toBe(0o600);
    if (process.getuid !== undefined) {
      expect([
        rootStat.uid,
        bundleStat.uid,
        jsonStat.uid,
        markdownStat.uid,
      ]).toEqual([
        process.getuid(),
        process.getuid(),
        process.getuid(),
        process.getuid(),
      ]);
    }
  }
});

test("SET-453: parent export rejects invalid IDs, foreign child state, and overlap", async () => {
  const fixture = await createSandboxFixture();
  const reportRoot = parentReportRoot(fixture);

  await expect(
    exportSandboxReportToParent({
      childEnv: fixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: fixture.parentState },
      reportId: "6ba7b810",
    })
  ).rejects.toThrow("full UUIDv4");
  expect(pathExists(reportRoot)).resolves.toBe(false);

  const malformedDescriptor = join(fixture.xdg.config, "malformed.json");
  await writeFile(malformedDescriptor, "{");
  await expect(
    exportSandboxReportToParent({
      childEnv: {
        ...fixture.env,
        SKILLSET_TEST_SANDBOX: malformedDescriptor,
      },
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: fixture.parentState },
      reportId: FIRST_ID,
    })
  ).rejects.toThrow("descriptor JSON");
  expect(pathExists(reportRoot)).resolves.toBe(false);

  await expect(
    exportSandboxReportToParent({
      childEnv: {
        ...fixture.env,
        XDG_STATE_HOME: fixture.parentState,
      },
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: fixture.parentState },
      reportId: FIRST_ID,
    })
  ).rejects.toThrow("XDG_STATE_HOME");
  expect(pathExists(reportRoot)).resolves.toBe(false);

  await expect(
    exportSandboxReportToParent({
      childEnv: fixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: fixture.xdg.state },
      reportId: FIRST_ID,
    })
  ).rejects.toThrow("child and parent report state must not overlap");
  expect(pathExists(reportRoot)).resolves.toBe(false);
  expect(
    pathExists(
      resolveReportStoreRoot({ env: { XDG_STATE_HOME: fixture.xdg.state } })
    )
  ).resolves.toBe(false);
});

test("SET-453: parent export rejects a symlinked parent state ancestor", async () => {
  if (process.platform === "win32") return;
  const fixture = await createSandboxFixture();
  await writeChildReport(fixture, FIRST_ID, "workspace");
  const linkedParentState = join(
    fixture.parentState,
    "..",
    "parent-state-link"
  );
  await symlink(fixture.parentState, linkedParentState);

  await expect(
    exportSandboxReportToParent({
      childEnv: fixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: linkedParentState },
      reportId: FIRST_ID,
    })
  ).rejects.toThrow("must not contain symlinks");
  expect(pathExists(parentReportRoot(fixture))).resolves.toBe(false);
});

test("SET-453: first parent export rejects a symlink above its discovered base", async () => {
  if (process.platform === "win32") return;
  const fixture = await createSandboxFixture();
  await writeChildReport(fixture, FIRST_ID, "workspace");
  const authority = dirname(fixture.parentState);
  const real = join(authority, "linked-real");
  const existing = join(real, "existing");
  const link = join(authority, "linked-authority");
  await mkdir(existing, { recursive: true });
  await symlink(real, link);
  const capturedState = join(link, "existing/new-state");

  await expect(
    exportSandboxReportToParent({
      childEnv: fixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: capturedState },
      reportId: FIRST_ID,
    })
  ).rejects.toThrow("must not contain symlinks");
  expect(pathExists(join(existing, "new-state"))).resolves.toBe(false);
});

test("SET-453: first parent export creates an absent private state hierarchy", async () => {
  const fixture = await createSandboxFixture();
  await writeChildReport(fixture, FIRST_ID, "workspace");
  const absentParentState = join(
    dirname(fixture.parentState),
    "first-use-parent-state"
  );

  const stored = await exportSandboxReportToParent({
    childEnv: fixture.env,
    expectedRepoRoot: process.cwd(),
    parentXdg: { state: absentParentState },
    reportId: FIRST_ID,
  });

  expect(stored.resolvedPath).toBe(
    join(absentParentState, "skillset/reports", FIRST_ID)
  );
  expect(await readdir(absentParentState)).toEqual(["skillset"]);
  expect(await readdir(join(absentParentState, "skillset"))).toEqual([
    "reports",
  ]);
  expect(await readdir(join(absentParentState, "skillset/reports"))).toEqual([
    FIRST_ID,
  ]);
  if (process.platform !== "win32") {
    expect((await stat(absentParentState)).mode & 0o777).toBe(0o700);
    expect((await stat(join(absentParentState, "skillset"))).mode & 0o777).toBe(
      0o700
    );
  }
});

test("SET-453: parent export rejects a non-private child report root", async () => {
  if (process.platform === "win32") return;
  const fixture = await createSandboxFixture();
  await writeChildReport(fixture, FIRST_ID, "workspace");
  const childReportRoot = resolveReportStoreRoot({
    env: { XDG_STATE_HOME: fixture.xdg.state },
  });
  await chmod(childReportRoot, 0o755);

  await expect(
    exportSandboxReportToParent({
      childEnv: fixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: fixture.parentState },
      reportId: FIRST_ID,
    })
  ).rejects.toThrow("mode 700");
  expect(pathExists(parentReportRoot(fixture))).resolves.toBe(false);
});

test("SET-453: parent export rejects an extra-entry child bundle before creating parent state", async () => {
  const fixture = await createSandboxFixture();
  const child = await writeChildReport(fixture, FIRST_ID, "workspace");
  await writeFile(join(child.resolvedPath, "unexpected.txt"), "unexpected\n");

  await expect(
    exportSandboxReportToParent({
      childEnv: fixture.env,
      expectedRepoRoot: process.cwd(),
      parentXdg: { state: fixture.parentState },
      reportId: FIRST_ID,
    })
  ).rejects.toThrow("exactly report.json and report.md");
  expect(pathExists(parentReportRoot(fixture))).resolves.toBe(false);
});

test("SET-453: parent export keeps destination bundles create-only", async () => {
  const fixture = await createSandboxFixture();
  const child = await writeChildReport(fixture, FIRST_ID, "workspace");
  const childJsonPath = join(child.resolvedPath, "report.json");
  const childMarkdownPath = join(child.resolvedPath, "report.md");
  const childBefore = await Promise.all([
    readFile(childJsonPath),
    readFile(childMarkdownPath),
  ]);
  const input = {
    childEnv: fixture.env,
    expectedRepoRoot: process.cwd(),
    parentXdg: { state: fixture.parentState },
    reportId: FIRST_ID,
  } as const;

  const first = await exportSandboxReportToParent(input);
  const parentJsonPath = join(first.resolvedPath, "report.json");
  const parentMarkdownPath = join(first.resolvedPath, "report.md");
  const parentBefore = await Promise.all([
    readFile(parentJsonPath),
    readFile(parentMarkdownPath),
  ]);
  await expect(exportSandboxReportToParent(input)).rejects.toThrow();
  const [childAfter, parentAfter] = await Promise.all([
    Promise.all([readFile(childJsonPath), readFile(childMarkdownPath)]),
    Promise.all([readFile(parentJsonPath), readFile(parentMarkdownPath)]),
  ]);
  expect(childAfter).toEqual(childBefore);
  expect(parentAfter).toEqual(parentBefore);
});

async function writeChildReport(
  fixture: Awaited<ReturnType<typeof createSandboxFixture>>,
  id: string,
  workspaceName: string
) {
  const report = createOperationReport(
    {
      command: "check",
      exitCode: 0,
      skillsetVersion: "0.23.0",
      workspace: { id: "skillset--local-parent-export", name: workspaceName },
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

async function createSandboxFixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "skillset-parent-export-"))
  );
  const sandboxPath = join(root, "skillset-test-owned");
  const parentState = join(root, "parent-state");
  const git = testSandboxGit(sandboxPath);
  const xdg = testSandboxXdg(sandboxPath);
  await Promise.all([
    ...Object.values(xdg).map((path) => mkdir(path, { recursive: true })),
    mkdir(join(sandboxPath, "git"), { recursive: true }),
    mkdir(parentState, { recursive: true }),
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
    xdg,
  };
}

function parentReportRoot(
  fixture: Awaited<ReturnType<typeof createSandboxFixture>>
): string {
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
