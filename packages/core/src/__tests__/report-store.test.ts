import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import type { SkillsetReport } from "@skillset/schema";

import {
  createOperationReport,
  renderSkillsetReportMarkdown,
  serializeSkillsetReport,
} from "../report";
import {
  createReportBundle,
  importReportBundle,
  readReportBundleAtBoundary as readReportBundle,
  ReportStoreError,
  type ReportStoreTestHooks,
} from "../report-store";

const roots: string[] = [];
const ID = "6ba7b810-9dad-4c8e-8a46-7e8dd6f4e6d5";
const OTHER_ID = "8f9a7c10-18c5-4f42-a614-8826fb848a14";
const THIRD_ID = "0de8fb2e-ece3-4ac2-9a54-a858476583e8";
const CREATED_AT = "2026-08-14T21:30:00.000Z";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      Bun.file(root)
        .exists()
        .then(async () => {
          const { rm } = await import("node:fs/promises");
          await rm(root, { force: true, recursive: true });
        })
    )
  );
});

describe("global immutable report store", () => {
  it("creates and reads one private, deterministic, immutable bundle", async () => {
    const root = await temporaryRoot();
    const reportRoot = join(root, "state/skillset/reports");
    const report = fixtureReport();
    const stored = await createReportBundle(report, {
      boundary: storeBoundary(reportRoot, root),
    });

    expect(stored.resolvedPath).toBe(join(reportRoot, ID));
    expect(
      await readFile(join(stored.resolvedPath, "report.json"), "utf8")
    ).toBe(`${JSON.stringify(report, null, 2)}\n`);
    expect(await readFile(join(stored.resolvedPath, "report.md"), "utf8")).toBe(
      renderSkillsetReportMarkdown(report)
    );
    if (process.platform !== "win32") {
      expect((await stat(reportRoot)).mode & 0o777).toBe(0o700);
      expect((await stat(stored.resolvedPath)).mode & 0o777).toBe(0o700);
      expect(
        (await stat(join(stored.resolvedPath, "report.json"))).mode & 0o777
      ).toBe(0o600);
      expect(
        (await stat(join(stored.resolvedPath, "report.md"))).mode & 0o777
      ).toBe(0o600);
    }

    expect(
      (
        await readReportBundle(ID, {
          boundary: storeBoundary(reportRoot, root),
        })
      ).report
    ).toEqual(report);
    expect(
      (
        await readReportBundle(stored.resolvedPath, {
          boundary: storeBoundary(reportRoot, root),
        })
      ).report
    ).toEqual(report);
    expect(
      (
        await readReportBundle(join(stored.resolvedPath, "report.md"), {
          boundary: storeBoundary(reportRoot, root),
        })
      ).markdown
    ).toBe(renderSkillsetReportMarkdown(report));
  });

  it("resolves relative paths only against the explicit cwd", async () => {
    const root = await temporaryRoot();
    const reportRoot = join(root, "reports");
    const stored = await createReportBundle(fixtureReport(), {
      boundary: storeBoundary(reportRoot, root),
    });
    const reference = relative(root, join(stored.resolvedPath, "report.json"));
    expect(
      (
        await readReportBundle(reference, {
          boundary: storeBoundary(reportRoot, root),
          cwd: root,
        })
      ).report.id
    ).toBe(ID);
  });

  it("distinguishes a missing full UUID from a missing path", async () => {
    const root = await temporaryRoot();
    const reportRoot = join(root, "reports");
    await createReportBundle(fixtureReport(), {
      boundary: storeBoundary(reportRoot, root),
    });
    await expect(
      readReportBundle("8f9a7c10-18c5-4f42-a614-8826fb848a14", {
        boundary: storeBoundary(reportRoot, root),
      })
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      readReportBundle(join(reportRoot, "missing", "report.json"), {
        boundary: storeBoundary(reportRoot, root),
      })
    ).rejects.toMatchObject({ code: "invalid_reference" });
  });

  it("refuses a duplicate ID without changing completed bytes", async () => {
    const root = await temporaryRoot();
    const reportRoot = join(root, "reports");
    const options = { boundary: storeBoundary(reportRoot, root) } as const;
    const stored = await createReportBundle(fixtureReport(), options);
    const before = await Promise.all([
      readFile(join(stored.resolvedPath, "report.json")),
      readFile(join(stored.resolvedPath, "report.md")),
    ]);
    await expect(
      createReportBundle(fixtureReport(), options)
    ).rejects.toMatchObject({
      code: "invalid_bundle",
    });
    const after = await Promise.all([
      readFile(join(stored.resolvedPath, "report.json")),
      readFile(join(stored.resolvedPath, "report.md")),
    ]);
    expect(after).toEqual(before);
  });

  it("publishes simultaneous distinct IDs as complete isolated bundles", async () => {
    const root = await temporaryRoot();
    const reportRoot = join(root, "reports");
    const first = fixtureReport(ID, "first workspace");
    const second = createOperationReport(
      {
        command: "check",
        exitCode: 0,
        skillsetVersion: "0.1.1",
        workspace: {
          id: "second--local-12abcdef3456",
          name: "second workspace",
        },
      },
      {
        testHooks: {
          createdAt: CREATED_AT,
          id: "8f9a7c10-18c5-4f42-a614-8826fb848a14",
        },
      }
    );
    const bundles = await Promise.all(
      [first, second].map((report) =>
        createReportBundle(report, {
          boundary: storeBoundary(reportRoot, root),
        })
      )
    );
    expect(bundles.map((bundle) => bundle.report.id).toSorted()).toEqual(
      [first.id, second.id].toSorted()
    );
    expect(await visibleReportRootEntries(reportRoot)).toEqual(
      [first.id, second.id].toSorted()
    );
    for (const bundle of bundles) {
      expect((await readdir(bundle.resolvedPath)).toSorted()).toEqual([
        "report.json",
        "report.md",
      ]);
    }
  });

  it("allows exactly one simultaneous same-ID writer without changing winner bytes", async () => {
    const root = await temporaryRoot();
    const reportRoot = join(root, "reports");
    const left = fixtureReport(ID, "left workspace");
    const right = fixtureReport(ID, "right workspace");
    const outcomes = await Promise.allSettled(
      [left, right].map((report) =>
        createReportBundle(report, {
          boundary: storeBoundary(reportRoot, root),
        })
      )
    );
    const winners = outcomes.filter(
      (
        outcome
      ): outcome is PromiseFulfilledResult<
        Awaited<ReturnType<typeof createReportBundle>>
      > => outcome.status === "fulfilled"
    );
    const losers = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected"
    );
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]?.reason).toBeInstanceOf(ReportStoreError);
    expect(losers[0]?.reason).toMatchObject({ code: "invalid_bundle" });
    const winner = winners[0]?.value;
    expect(winner).toBeDefined();
    if (winner === undefined) throw new Error("expected one report winner");
    const jsonBefore = await readFile(
      join(winner.resolvedPath, "report.json"),
      "utf8"
    );
    const markdownBefore = await readFile(
      join(winner.resolvedPath, "report.md"),
      "utf8"
    );
    expect(jsonBefore).toBe(`${JSON.stringify(winner.report, null, 2)}\n`);
    expect(markdownBefore).toBe(winner.markdown);
    expect(await visibleReportRootEntries(reportRoot)).toEqual([ID]);
    expect((await readdir(winner.resolvedPath)).toSorted()).toEqual([
      "report.json",
      "report.md",
    ]);
    expect(
      await readFile(join(winner.resolvedPath, "report.json"), "utf8")
    ).toBe(jsonBefore);
    expect(await readFile(join(winner.resolvedPath, "report.md"), "utf8")).toBe(
      markdownBefore
    );
  });

  it("publishes and imports with inode-zero identity across owned child mutations", async () => {
    const root = await temporaryRoot();
    const reportRoot = join(root, "reports");
    await mkdir(reportRoot, { mode: 0o700 });
    const testHooks = inodeZeroIdentityHooks();
    const [first, second] = await Promise.all([
      createReportBundle(fixtureReport(ID, "first inode-zero workspace"), {
        boundary: storeBoundary(reportRoot, root),
        testHooks,
      }),
      createReportBundle(
        fixtureReport(OTHER_ID, "second inode-zero workspace"),
        {
          boundary: storeBoundary(reportRoot, root),
          testHooks,
        }
      ),
    ]);
    expect(first.report.id).toBe(ID);
    expect(second.report.id).toBe(OTHER_ID);

    const sandbox = join(root, "child");
    const childReportRoot = join(sandbox, "state/skillset/reports");
    const parentReportRoot = join(root, "parent/state/skillset/reports");
    await createReportBundle(fixtureReport(THIRD_ID), {
      boundary: storeBoundary(childReportRoot, root),
    });
    const imported = await importReportBundle({
      destination: {
        boundary: storeBoundary(parentReportRoot, root),
        testHooks: inodeZeroIdentityHooks(),
      },
      sourceReference: THIRD_ID,
      sourceReportRoot: childReportRoot,
      sourceSandboxRoot: sandbox,
    });
    expect(imported.report.id).toBe(THIRD_ID);
  });

  it("fails closed when neither inode nor birth-time identity is available", async () => {
    const root = await temporaryRoot();
    const reportRoot = join(root, "reports");
    await expect(
      createReportBundle(fixtureReport(), {
        boundary: storeBoundary(reportRoot, root),
        testHooks: {
          transformDirectoryIdentity({ identity }) {
            return { ...identity, birthtimeMs: 0, ino: 0 };
          },
        },
      })
    ).rejects.toMatchObject({ code: "invalid_bundle" });
    expect(await visibleReportRootEntries(reportRoot)).toEqual([]);
  });

  it("does not retrieve staged or incomplete UUID bundles", async () => {
    const root = await temporaryRoot();
    const reportRoot = join(root, "reports");
    const complete = await createReportBundle(fixtureReport(), {
      boundary: storeBoundary(reportRoot, root),
    });
    const stagedPath = join(reportRoot, `.stage-${ID}-manual`);
    await mkdir(stagedPath, { mode: 0o700 });
    await expect(
      readReportBundle(stagedPath, {
        boundary: storeBoundary(reportRoot, root),
      })
    ).rejects.toMatchObject({ code: "invalid_reference" });

    const incompleteId = "8f9a7c10-18c5-4f42-a614-8826fb848a14";
    const incompletePath = join(reportRoot, incompleteId);
    await mkdir(incompletePath, { mode: 0o700 });
    await writeFile(
      join(incompletePath, "report.json"),
      await readFile(join(complete.resolvedPath, "report.json"), "utf8"),
      { mode: 0o600 }
    );
    await expect(
      readReportBundle(incompleteId, {
        boundary: storeBoundary(reportRoot, root),
      })
    ).rejects.toMatchObject({ code: "invalid_bundle" });
  });

  it("removes staging when publication fails before the final rename", async () => {
    const root = await temporaryRoot();
    const reportRoot = join(root, "reports");
    await expect(
      createReportBundle(fixtureReport(), {
        boundary: storeBoundary(reportRoot, root),
        testHooks: {
          afterStagingCreated() {
            throw new Error("injected staged-write failure");
          },
        },
      })
    ).rejects.toMatchObject({ code: "invariant" });
    expect(await visibleReportRootEntries(reportRoot)).toEqual([]);
  });

  it("keeps completed bytes and returns success after a post-rename hook error", async () => {
    const root = await temporaryRoot();
    const reportRoot = join(root, "reports");
    let bytesObservedAfterRename: readonly [Buffer, Buffer] | undefined;
    const stored = await createReportBundle(fixtureReport(), {
      boundary: storeBoundary(reportRoot, root),
      testHooks: {
        async afterFinalRename({ finalPath }) {
          bytesObservedAfterRename = await Promise.all([
            readFile(join(finalPath, "report.json")),
            readFile(join(finalPath, "report.md")),
          ]);
          throw new Error("injected post-rename failure");
        },
      },
    });
    const completedBytes = await Promise.all([
      readFile(join(stored.resolvedPath, "report.json")),
      readFile(join(stored.resolvedPath, "report.md")),
    ]);
    expect(bytesObservedAfterRename).toEqual(completedBytes);
    expect(await visibleReportRootEntries(reportRoot)).toEqual([ID]);

    await expect(
      createReportBundle(fixtureReport(), {
        boundary: storeBoundary(reportRoot, root),
      })
    ).rejects.toMatchObject({ code: "invalid_bundle" });
    expect(
      await Promise.all([
        readFile(join(stored.resolvedPath, "report.json")),
        readFile(join(stored.resolvedPath, "report.md")),
      ])
    ).toEqual(completedBytes);
  });

  it("rejects a valid manifest whose UUID disagrees with its directory", async () => {
    const root = await temporaryRoot();
    const reportRoot = join(root, "reports");
    const stored = await createReportBundle(fixtureReport(), {
      boundary: storeBoundary(reportRoot, root),
    });
    const mismatched = fixtureReport(OTHER_ID);
    await Promise.all([
      writeFile(
        join(stored.resolvedPath, "report.json"),
        serializeSkillsetReport(mismatched)
      ),
      writeFile(
        join(stored.resolvedPath, "report.md"),
        renderSkillsetReportMarkdown(mismatched)
      ),
    ]);

    await expect(
      readReportBundle(ID, { boundary: storeBoundary(reportRoot, root) })
    ).rejects.toMatchObject({ code: "invalid_bundle" });
  });

  it("rejects portable and POSIX non-regular expected entries without opening them", async () => {
    const root = await temporaryRoot();
    const reportRoot = join(root, "reports");
    const directoryBundle = await createReportBundle(fixtureReport(), {
      boundary: storeBoundary(reportRoot, root),
    });
    const directoryMarkdown = join(directoryBundle.resolvedPath, "report.md");
    await unlink(directoryMarkdown);
    await mkdir(directoryMarkdown);
    await expect(
      readReportBundle(ID, { boundary: storeBoundary(reportRoot, root) })
    ).rejects.toMatchObject({ code: "invalid_bundle" });

    if (process.platform === "win32") return;
    const socketBundle = await createReportBundle(fixtureReport(OTHER_ID), {
      boundary: storeBoundary(reportRoot, root),
    });
    const socketMarkdown = join(socketBundle.resolvedPath, "report.md");
    await unlink(socketMarkdown);
    const server = createServer();
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(socketMarkdown, resolveListen);
    });
    try {
      await expect(
        readReportBundle(OTHER_ID, {
          boundary: storeBoundary(reportRoot, root),
        })
      ).rejects.toMatchObject({ code: "invalid_bundle" });
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error === undefined) resolveClose();
          else rejectClose(error);
        });
      });
    }
  });

  it("rejects a bundle directory replaced between validation and file reads", async () => {
    const root = await temporaryRoot();
    const reportRoot = join(root, "reports");
    const replacementRoot = join(root, "replacement-reports");
    const stored = await createReportBundle(fixtureReport(), {
      boundary: storeBoundary(reportRoot, root),
    });
    const replacement = await createReportBundle(
      fixtureReport(ID, "replacement workspace"),
      { boundary: storeBoundary(replacementRoot, root) }
    );
    const originalPath = join(root, "original-bundle");
    const inodeZeroHooks = inodeZeroIdentityHooks();

    await expect(
      readReportBundle(ID, {
        boundary: storeBoundary(reportRoot, root),
        testHooks: {
          ...inodeZeroHooks,
          async beforeBundleFileRead({ bundlePath }) {
            await rename(bundlePath, originalPath);
            await rename(replacement.resolvedPath, bundlePath);
          },
        },
      })
    ).rejects.toMatchObject({ code: "invalid_bundle" });
    expect(stored.resolvedPath).toBe(join(reportRoot, ID));
  });

  it("rejects traversal, arbitrary files, symlinks, and extra bundle entries", async () => {
    const root = await temporaryRoot();
    const reportRoot = join(root, "reports");
    const stored = await createReportBundle(fixtureReport(), {
      boundary: storeBoundary(reportRoot, root),
    });
    await expect(
      readReportBundle(join(reportRoot, "..", "outside"), {
        boundary: storeBoundary(reportRoot, root),
      })
    ).rejects.toMatchObject({ code: "invalid_reference" });
    await expect(
      readReportBundle(join(stored.resolvedPath, "other.json"), {
        boundary: storeBoundary(reportRoot, root),
      })
    ).rejects.toMatchObject({ code: "invalid_reference" });

    await writeFile(join(stored.resolvedPath, "extra"), "nope", "utf8");
    await expect(
      readReportBundle(ID, { boundary: storeBoundary(reportRoot, root) })
    ).rejects.toMatchObject({
      code: "invalid_bundle",
    });

    const second = await createReportBundle(
      fixtureReport("8f9a7c10-18c5-4f42-a614-8826fb848a14"),
      {
        boundary: storeBoundary(reportRoot, root),
      }
    );
    const markdownPath = join(second.resolvedPath, "report.md");
    const { unlink } = await import("node:fs/promises");
    await unlink(markdownPath);
    await symlink(join(second.resolvedPath, "report.json"), markdownPath);
    await expect(
      readReportBundle(second.report.id, {
        boundary: storeBoundary(reportRoot, root),
      })
    ).rejects.toMatchObject({ code: "invalid_bundle" });
  });

  it("rejects an existing report root reached through any symlink ancestor", async () => {
    const root = await temporaryRoot();
    const target = join(root, "target-state");
    const link = join(root, "state-link");
    const realReportRoot = join(target, "skillset/reports");
    await mkdir(realReportRoot, { recursive: true, mode: 0o700 });
    const real = await createReportBundle(fixtureReport(), {
      boundary: storeBoundary(realReportRoot, root),
    });
    await symlink(target, link);
    const linkedReportRoot = join(link, "skillset/reports");
    await expect(
      createReportBundle(
        fixtureReport("8f9a7c10-18c5-4f42-a614-8826fb848a14"),
        {
          boundary: storeBoundary(linkedReportRoot, root),
        }
      )
    ).rejects.toMatchObject({ code: "invalid_reference" });
    await expect(
      readReportBundle(real.report.id, {
        boundary: storeBoundary(linkedReportRoot, root),
      })
    ).rejects.toMatchObject({ code: "invalid_reference" });
  });

  it("renders hostile Markdown and HTML as passive code and redacts sentinels", async () => {
    const root = await temporaryRoot();
    const reportRoot = join(root, "reports");
    const sentinel = "fixture-secret-value";
    const hostile =
      "<img src=x onerror=alert(1)> [go](https://evil.example) *em* ``ticks``";
    const stored = await createReportBundle(
      fixtureReport(ID, `${hostile} ${sentinel}`),
      {
        boundary: storeBoundary(reportRoot, root),
        sentinels: [sentinel],
      }
    );
    expect(stored.markdown).toContain(
      `- Workspace name: \`\`\`${hostile} [REDACTED]\`\`\``
    );
    expect(stored.markdown).not.toContain(sentinel);
    expect(stored.markdown).not.toContain(`- Workspace name: ${hostile}`);
    expect(
      await readFile(join(stored.resolvedPath, "report.json"), "utf8")
    ).not.toContain(sentinel);

    const edgePunctuation =
      " <b>html</b> [link](x) ![image](x) *em* _em_ [brackets] (parens) ``ticks`` \\ & ";
    const rendered = renderSkillsetReportMarkdown(
      fixtureReport(ID, edgePunctuation)
    );
    expect(rendered).toContain(
      `- Workspace name: \`\`\` ${edgePunctuation} \`\`\``
    );
  });

  it("rejects a report root whose POSIX mode is not private", async () => {
    if (process.platform === "win32") return;
    const root = await temporaryRoot();
    const reportRoot = join(root, "reports");
    await createReportBundle(fixtureReport(), {
      boundary: storeBoundary(reportRoot, root),
    });
    const { chmod } = await import("node:fs/promises");
    await chmod(reportRoot, 0o755);
    await expect(
      readReportBundle(ID, { boundary: storeBoundary(reportRoot, root) })
    ).rejects.toMatchObject({ code: "invalid_bundle" });
  });

  it("redacts sentinels during parent import and preserves the child UUID", async () => {
    const root = await temporaryRoot();
    const sandbox = join(root, "child");
    const childReportRoot = join(sandbox, "state/skillset/reports");
    const parentReportRoot = join(root, "parent/state/skillset/reports");
    const sentinel = "fixture-secret-value";
    const childReport = fixtureReport(ID, `workspace ${sentinel}`);
    await createReportBundle(childReport, {
      boundary: storeBoundary(childReportRoot, root),
    });

    const imported = await importReportBundle({
      destination: { boundary: storeBoundary(parentReportRoot, root) },
      sentinels: [sentinel],
      sourceReference: ID,
      sourceReportRoot: childReportRoot,
      sourceSandboxRoot: sandbox,
    });
    expect(imported.report.id).toBe(ID);
    expect(imported.report.workspace.name).toBe("workspace [REDACTED]");
    expect(imported.markdown).not.toContain(sentinel);
    expect(
      await readFile(join(imported.resolvedPath, "report.json"), "utf8")
    ).not.toContain(sentinel);
  });

  it("rejects a child bundle whose Markdown does not match its raw report", async () => {
    const root = await temporaryRoot();
    const sandbox = join(root, "child");
    const childReportRoot = join(sandbox, "state/skillset/reports");
    const child = await createReportBundle(fixtureReport(), {
      boundary: storeBoundary(childReportRoot, root),
    });
    await writeFile(
      join(child.resolvedPath, "report.md"),
      "# edited\n",
      "utf8"
    );
    await expect(
      importReportBundle({
        destination: {
          boundary: storeBoundary(join(root, "parent/reports"), root),
        },
        sentinels: ["irrelevant-sentinel"],
        sourceReference: ID,
        sourceReportRoot: childReportRoot,
        sourceSandboxRoot: sandbox,
      })
    ).rejects.toMatchObject({ code: "invalid_bundle" });
  });

  it("rejects a child report root outside the declared sandbox", async () => {
    const root = await temporaryRoot();
    await expect(
      importReportBundle({
        destination: {
          boundary: storeBoundary(join(root, "parent"), root),
        },
        sourceReference: ID,
        sourceReportRoot: join(root, "outside"),
        sourceSandboxRoot: join(root, "sandbox"),
      })
    ).rejects.toMatchObject({ code: "invalid_reference" });
  });

  it("keeps generated identity and time out of production input", () => {
    const first = createOperationReport({
      command: "check",
      exitCode: 0,
      skillsetVersion: "0.1.1",
      workspace: { id: "skillset--local-12abcdef3456" },
    });
    const second = createOperationReport({
      command: "check",
      exitCode: 0,
      skillsetVersion: "0.1.1",
      workspace: { id: "skillset--local-12abcdef3456" },
    });
    expect(first.id).not.toBe(second.id);
    expect(first.createdAt).toEndWith("Z");
  });
});

function fixtureReport(id = ID, workspaceName = "skillset"): SkillsetReport {
  return createOperationReport(
    {
      command: "check",
      exitCode: 0,
      skillsetVersion: "0.1.1",
      workspace: {
        id: "skillset--local-12abcdef3456",
        name: workspaceName,
        repository: {
          commit: "64618a42a23300b5cbbd308ed3fec0e64bae1a4e",
          dirty: false,
          identity: "github.com/outfitter-dev/skillset",
        },
      },
    },
    { testHooks: { createdAt: CREATED_AT, id } }
  );
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-report-store-"));
  roots.push(root);
  return root;
}

function storeBoundary(reportRoot: string, trustedBase: string) {
  return { reportRoot, trustedBase } as const;
}

function inodeZeroIdentityHooks(): ReportStoreTestHooks {
  return {
    transformDirectoryIdentity({ identity }) {
      return {
        ...identity,
        birthtimeMs: identity.ino === 0 ? identity.birthtimeMs : identity.ino,
        ino: 0,
      };
    },
  };
}

async function visibleReportRootEntries(reportRoot: string): Promise<string[]> {
  const entries = await readdir(reportRoot);
  expect(entries.filter((entry) => entry.startsWith(".stage-"))).toEqual([]);
  return entries.toSorted();
}
