import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

import {
  writeRetainedRunLatest,
  type RetainedRunRootPaths,
} from "../retained-runs";
import {
  deferred,
  publicationArtifacts,
  publicationFailureHooks,
  seedPublishedFile,
} from "./publication-test-helpers";

describe("retained-run pointer publication", () => {
  test("keeps the prior latest.json readable until a flushed replacement is published", async () => {
    const paths = await seededLatest({ runId: "prior-run", schemaVersion: 1 });
    const before = await readFile(paths.absolute.latestJsonPath);
    const beforePublish = deferred<void>();
    const release = deferred<void>();

    const published = writeRetainedRunLatest(paths, { runId: "next-run", schemaVersion: 1 }, {
      beforePublish: async () => {
        beforePublish.resolve();
        await release.promise;
      },
    });
    await beforePublish.promise;
    expect(await readFile(paths.absolute.latestJsonPath)).toEqual(before);
    expect(JSON.parse(before.toString("utf8"))).toMatchObject({ runId: "prior-run" });
    release.resolve();
    await published;
    expect(JSON.parse(await readFile(paths.absolute.latestJsonPath, "utf8"))).toMatchObject({
      runId: "next-run",
    });
    expect(await publicationArtifacts(paths.absolute.latestJsonPath)).toEqual([]);
  });

  test("leaves the previous pointer byte-identical when write, flush, close, or pre-rename fails", async () => {
    const paths = await seededLatest({ runId: "keep-run", schemaVersion: 1 });
    const before = await readFile(paths.absolute.latestJsonPath);

    for (const [hook, message] of publicationFailureHooks()) {
      await expect(writeRetainedRunLatest(paths, { runId: "lost-run", schemaVersion: 1 }, {
        [hook]: () => { throw new Error(message); },
      })).rejects.toThrow(message);
      expect(await readFile(paths.absolute.latestJsonPath)).toEqual(before);
      expect(await publicationArtifacts(paths.absolute.latestJsonPath)).toEqual([]);
    }
  });

  test("leaves no published latest.json when the first pointer write fails", async () => {
    const paths = latestPaths(await createTestFixtureRoot("skillset-retained-first-"));

    for (const [hook, message] of publicationFailureHooks()) {
      await expect(writeRetainedRunLatest(paths, { runId: "lost-run", schemaVersion: 1 }, {
        [hook]: () => { throw new Error(message); },
      })).rejects.toThrow(message);
      expect(await Bun.file(paths.absolute.latestJsonPath).exists()).toBe(false);
      expect(await publicationArtifacts(paths.absolute.latestJsonPath)).toEqual([]);
    }
  });

  test("latest-run selection still reads the published pointer", async () => {
    const paths = latestPaths(await createTestFixtureRoot("skillset-retained-read-"));
    await writeRetainedRunLatest(paths, {
      reportPath: ".skillset/cache/tests/latest/report.json",
      runId: "selected-run",
      runPath: ".skillset/cache/tests/runs/selected-run",
      schemaVersion: 1,
    });
    const latest = JSON.parse(await readFile(paths.absolute.latestJsonPath, "utf8")) as {
      readonly runId: string;
    };
    expect(latest.runId).toBe("selected-run");
    expect(await publicationArtifacts(paths.absolute.latestJsonPath)).toEqual([]);
  });
});

async function seededLatest(record: { readonly runId: string; readonly schemaVersion: number }): Promise<RetainedRunRootPaths> {
  const paths = latestPaths(await createTestFixtureRoot("skillset-retained-seed-"));
  await seedPublishedFile(paths.absolute.latestJsonPath, `${JSON.stringify(record)}\n`);
  return paths;
}

function latestPaths(rootPath: string): RetainedRunRootPaths {
  return {
    absolute: {
      latestJsonPath: join(rootPath, "latest.json"),
      rootPath,
      runsRoot: join(rootPath, "runs"),
    },
    logical: {
      latestJsonPath: ".skillset/cache/tests/latest.json",
      rootPath: ".skillset/cache/tests",
      runsRoot: ".skillset/cache/tests/runs",
    },
  };
}
