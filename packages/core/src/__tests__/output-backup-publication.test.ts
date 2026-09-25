import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, readdir, readFile, rename, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

import {
  inspectOutputBackups,
  persistOutputBackupPlan,
  restoreOutputBackup,
  type OutputBackupPlan,
} from "../output-safety";

describe("output backup manifest publication", () => {
  test("publishes a first snapshot manifest only after payload storage completes", async () => {
    const root = await createTestFixtureRoot("skillset-backup-manifest-");
    const afterPayloads = deferred<void>();
    const release = deferred<void>();

    const persisted = persistOutputBackupPlan(root, backupPlan("AGENTS.md", "authored\n"), {
      afterPayloadStorage: async () => {
        afterPayloads.resolve();
        await release.promise;
      },
    });
    await afterPayloads.promise;

    const snapshotRoot = join(root, ".skillset/snapshots");
    const runIds = await snapshotRunIds(root);
    const runId = runIds[0];
    if (runId === undefined) throw new Error("expected an interrupted snapshot directory");
    expect(runIds).toHaveLength(1);
    expect(await Bun.file(join(snapshotRoot, runId, "git/config")).exists()).toBe(true);
    expect(await Bun.file(join(snapshotRoot, runId, "manifest.json")).exists()).toBe(false);
    expect(await inspectOutputBackups(root)).toEqual({
      runs: [{
        detail: "incomplete snapshot: backup manifest has not been published",
        manifestPath: `.skillset/snapshots/${runId}/manifest.json`,
        records: [],
        runId,
        state: "corrupt-or-unavailable",
      }],
    });

    release.resolve();
    const result = await persisted;
    expect(result.backup?.manifestPath).toBe(`.skillset/snapshots/${result.backup?.runId}/manifest.json`);
    expect(await Bun.file(join(root, result.backup?.manifestPath ?? "")).exists()).toBe(true);
    expect((await inspectOutputBackups(root)).runs).toContainEqual(expect.objectContaining({
      runId: result.backup?.runId,
      state: "restorable-now",
    }));
    expect(await publicationArtifacts(join(root, result.backup?.manifestPath ?? ""))).toEqual([]);
  });

  test("treats an interrupted first snapshot as incomplete and removes temporary files", async () => {
    const root = await createTestFixtureRoot("skillset-backup-incomplete-");

    await expect(persistOutputBackupPlan(root, backupPlan("AGENTS.md", "authored\n"), {
      afterPayloadStorage: () => {
        throw new Error("injected payload-complete failure");
      },
    })).rejects.toThrow("injected payload-complete failure");

    const runIds = await snapshotRunIds(root);
    expect(runIds).toHaveLength(1);
    expect(await Bun.file(join(root, ".skillset/snapshots", runIds[0]!, "manifest.json")).exists()).toBe(false);
    expect(await inspectOutputBackups(root)).toMatchObject({
      runs: [{
        detail: "incomplete snapshot: backup manifest has not been published",
        runId: runIds[0],
        state: "corrupt-or-unavailable",
      }],
    });
    expect(await publicationArtifacts(join(root, ".skillset/snapshots", runIds[0]!, "manifest.json"))).toEqual([]);
  });

  test("leaves the previous destination byte-identical when write, flush, close, or pre-rename fails", async () => {
    const root = await createTestFixtureRoot("skillset-backup-replace-");
    const first = await persistOutputBackupPlan(root, backupPlan("AGENTS.md", "first\n"));
    const manifestPath = join(root, first.backup?.manifestPath ?? "");
    const before = await readFile(manifestPath);

    for (const [hook, message] of failureHooks()) {
      await expect(persistOutputBackupPlan(root, backupPlan("AGENTS.md", "second\n"), {
        [hook]: () => { throw new Error(message); },
      })).rejects.toThrow(message);
      expect(await readFile(manifestPath)).toEqual(before);
      expect((await inspectOutputBackups(root)).runs.filter((run) => run.runId === first.backup?.runId))
        .toContainEqual(expect.objectContaining({
          runId: first.backup?.runId,
          state: "restorable-now",
        }));
    }

    const incomplete = (await inspectOutputBackups(root)).runs.filter((run) => run.runId !== first.backup?.runId);
    expect(incomplete.length).toBeGreaterThan(0);
    expect(incomplete.every((run) => run.state === "corrupt-or-unavailable")).toBe(true);
    expect(await publicationArtifacts(manifestPath)).toEqual([]);
  });

  test("refuses to publish the manifest through a snapshot run directory replaced by a symlink", async () => {
    if (process.platform === "win32") return;

    const root = await createTestFixtureRoot("skillset-backup-symlink-parent-");
    const outside = await createTestFixtureRoot("skillset-backup-symlink-outside-");
    const redirected = join(outside, "run");

    await expect(persistOutputBackupPlan(root, backupPlan("AGENTS.md", "authored\n"), {
      afterPayloadStorage: async () => {
        const runId = (await snapshotRunIds(root))[0];
        if (runId === undefined) throw new Error("expected a snapshot run directory");
        const runDirectory = join(root, ".skillset/snapshots", runId);
        await rename(runDirectory, redirected);
        await symlink(redirected, runDirectory, "dir");
      },
    })).rejects.toThrow("refusing to traverse symbolic link");

    expect(await Bun.file(join(redirected, "manifest.json")).exists()).toBe(false);
    expect(await publicationArtifacts(join(redirected, "manifest.json"))).toEqual([]);
  });

  test("refuses to store backup payloads through a pre-existing symlinked snapshot root", async () => {
    if (process.platform === "win32") return;

    const root = await createTestFixtureRoot("skillset-backup-symlink-snapshots-");
    const outside = await createTestFixtureRoot("skillset-backup-symlink-snapshots-outside-");
    await mkdir(join(root, ".skillset"));
    await symlink(outside, join(root, ".skillset/snapshots"), "dir");

    await expect(persistOutputBackupPlan(root, backupPlan("AGENTS.md", "authored\n")))
      .rejects.toThrow("refusing to traverse symbolic link: .skillset/snapshots");

    expect(await readdir(outside)).toEqual([]);
  });

  test("refuses to restore a backup through a symlinked target parent", async () => {
    if (process.platform === "win32") return;

    const root = await createTestFixtureRoot("skillset-backup-restore-symlink-");
    const outside = await createTestFixtureRoot("skillset-backup-restore-symlink-outside-");
    const persisted = await persistOutputBackupPlan(root, backupPlan("nested/AGENTS.md", "authored\n"));
    const runId = persisted.backup?.runId;
    if (runId === undefined) throw new Error("expected a persisted backup");
    await symlink(outside, join(root, "nested"), "dir");

    await expect(restoreOutputBackup(root, runId, { write: true }))
      .rejects.toThrow("refusing to traverse symbolic link: nested");

    expect(await readdir(outside)).toEqual([]);
  });

  test("keeps sibling inspection isolated when a snapshot directory is unreadable", async () => {
    if (process.platform === "win32" || process.getuid?.() === 0) return;

    const root = await createTestFixtureRoot("skillset-backup-isolate-");
    const first = await persistOutputBackupPlan(root, backupPlan("AGENTS.md", "authored\n"));
    const unreadable = join(root, ".skillset/snapshots", "deadbeef12");
    await mkdir(unreadable, { recursive: true });
    await chmod(unreadable, 0o000);
    try {
      const inspection = await inspectOutputBackups(root);
      expect(inspection.runs).toContainEqual(expect.objectContaining({
        runId: first.backup?.runId,
        state: "restorable-now",
      }));
      expect(inspection.runs).toContainEqual(expect.objectContaining({
        runId: "deadbeef12",
        state: "corrupt-or-unavailable",
      }));
    } finally {
      await chmod(unreadable, 0o700);
    }
  });
});

function backupPlan(targetPath: string, text: string): OutputBackupPlan {
  const content = new TextEncoder().encode(text);
  return {
    preflightDiagnostics: [],
    preimages: [{ content, mode: "0644", state: "present", targetPath }],
    records: [{
      action: "overwrite",
      content,
      originalHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      originalMode: "0644",
      reason: "unmanaged-collision",
      targetPath,
    }],
  };
}

function failureHooks(): readonly [string, string][] {
  return [
    ["beforeTemporaryWrite", "injected temporary write failure"],
    ["beforeTemporarySync", "injected temporary sync failure"],
    ["beforeTemporaryClose", "injected temporary close failure"],
    ["beforePublish", "injected pre-rename failure"],
  ];
}

async function snapshotRunIds(root: string): Promise<readonly string[]> {
  try {
    return (await readdir(join(root, ".skillset/snapshots"))).toSorted();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

async function publicationArtifacts(path: string): Promise<readonly string[]> {
  try {
    return (await readdir(dirname(path))).filter((file) => file.includes(".tmp-"));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
