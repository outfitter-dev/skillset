import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RetainedRunPaths } from "../retained-runs";
import {
  refreshDeterministicTestLatest,
  writeDeterministicTestReport,
} from "../test-runner";
import {
  deferred,
  publicationArtifacts,
  publicationFailureHooks,
  seedPublishedFile,
} from "./publication-test-helpers";

describe("deterministic test-runner report publication", () => {
  test("keeps an old latest pointer readable while the latest snapshot refreshes", async () => {
    const repository = await mkdtemp(join(tmpdir(), "skillset-test-latest-"));
    const previous = retainedRunPaths(repository, "previous");
    const next = retainedRunPaths(repository, "next");
    const latestPath = join(previous.absolute.rootPath, "latest");
    const logicalLatestPath = ".skillset/cache/tests/latest";
    await mkdir(previous.absolute.runPath, { recursive: true });
    await mkdir(next.absolute.runPath, { recursive: true });
    await writeDeterministicTestReport(
      join(previous.absolute.runPath, "report.json"),
      join(previous.logical.runPath, "report.json"),
      join(previous.absolute.runPath, "report.md"),
      testReport(true, "previous")
    );
    await writeDeterministicTestReport(
      join(next.absolute.runPath, "report.json"),
      join(next.logical.runPath, "report.json"),
      join(next.absolute.runPath, "report.md"),
      testReport(false, "next")
    );
    await refreshDeterministicTestLatest(
      previous,
      latestPath,
      logicalLatestPath,
      testReport(true, "previous")
    );
    const latestRemoved = deferred<void>();
    const release = deferred<void>();
    const refreshing = refreshDeterministicTestLatest(
      next,
      latestPath,
      logicalLatestPath,
      testReport(false, "next"),
      {
        afterLatestRemoved: async () => {
          latestRemoved.resolve();
          await release.promise;
        },
      }
    );

    await latestRemoved.promise;
    try {
      const pointer = JSON.parse(
        await readFile(previous.absolute.latestJsonPath, "utf8")
      ) as { readonly reportPath: string; readonly runId: string };
      expect(pointer.runId).toBe("previous");
      expect(
        JSON.parse(await readFile(join(repository, pointer.reportPath), "utf8"))
      ).toMatchObject({ runId: "previous" });
    } finally {
      release.resolve();
      await refreshing;
    }
  });

  test("keeps the prior report.json readable until a flushed replacement is published", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-test-report-"));
    const reportPath = join(root, "report.json");
    const markdownPath = join(root, "report.md");
    await writeDeterministicTestReport(reportPath, logicalReport(root), markdownPath, testReport(true));
    const before = await readFile(reportPath);
    const beforePublish = deferred<void>();
    const release = deferred<void>();

    const published = writeDeterministicTestReport(
      reportPath,
      logicalReport(root),
      markdownPath,
      testReport(false),
      {
        beforePublish: async () => {
          beforePublish.resolve();
          await release.promise;
        },
      }
    );
    await beforePublish.promise;
    expect(await readFile(reportPath)).toEqual(before);
    release.resolve();
    await published;
    expect(JSON.parse(await readFile(reportPath, "utf8"))).toMatchObject({ ok: false });
    expect(await publicationArtifacts(reportPath)).toEqual([]);
    expect(await publicationArtifacts(markdownPath)).toEqual([]);
  });

  test("leaves the previous report byte-identical when write, flush, close, or pre-rename fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-test-report-keep-"));
    const reportPath = join(root, "report.json");
    const markdownPath = join(root, "report.md");
    await seedPublishedFile(reportPath, `${JSON.stringify(testReport(true))}\n`);
    await seedPublishedFile(markdownPath, "# prior\n");
    const beforeJson = await readFile(reportPath);
    const beforeMarkdown = await readFile(markdownPath);

    for (const [hook, message] of publicationFailureHooks()) {
      await expect(writeDeterministicTestReport(
        reportPath,
        logicalReport(root),
        markdownPath,
        testReport(false),
        { [hook]: () => { throw new Error(message); } }
      )).rejects.toThrow(message);
      expect(await readFile(reportPath)).toEqual(beforeJson);
      expect(await readFile(markdownPath)).toEqual(beforeMarkdown);
      expect(await publicationArtifacts(reportPath)).toEqual([]);
    }
  });

  test("leaves no published completion marker when the first report write fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-test-report-first-"));
    const reportPath = join(root, "report.json");
    const markdownPath = join(root, "report.md");

    for (const [hook, message] of publicationFailureHooks()) {
      await expect(writeDeterministicTestReport(
        reportPath,
        logicalReport(root),
        markdownPath,
        testReport(true),
        { [hook]: () => { throw new Error(message); } }
      )).rejects.toThrow(message);
      expect(await Bun.file(reportPath).exists()).toBe(false);
      expect(await Bun.file(markdownPath).exists()).toBe(false);
      expect(await publicationArtifacts(reportPath)).toEqual([]);
    }
  });
});

function logicalReport(_root: string): string {
  return ".skillset/cache/tests/runs/prior/report.json";
}

function testReport(ok: boolean, runId = "prior") {
  return {
    checks: [],
    generatedFiles: 0,
    name: "self",
    ok,
    proofReceipts: [],
    runId,
    runtimeTests: [],
    schemaVersion: 4,
    selection: { skills: { primary: ["demo"] } },
    source: "repo:.skillset",
    targets: ["claude"],
    workspacePath: ".skillset/cache/tests/latest/workspace",
  };
}

function retainedRunPaths(repository: string, runId: string): RetainedRunPaths {
  const absoluteRoot = join(repository, ".skillset/cache/tests");
  const logicalRoot = ".skillset/cache/tests";
  return {
    absolute: {
      latestJsonPath: join(absoluteRoot, "latest.json"),
      rootPath: absoluteRoot,
      runPath: join(absoluteRoot, "runs", runId),
      runsRoot: join(absoluteRoot, "runs"),
    },
    logical: {
      latestJsonPath: `${logicalRoot}/latest.json`,
      rootPath: logicalRoot,
      runPath: `${logicalRoot}/runs/${runId}`,
      runsRoot: `${logicalRoot}/runs`,
    },
  };
}
