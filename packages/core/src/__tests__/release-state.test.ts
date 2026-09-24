import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { readReleaseState, writeReleaseState } from "../release-state";

const STATE_PATH = ".skillset/changes/state.json";

describe("release state publication", () => {
  test("writes a complete replacement that readers can parse", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-release-state-"));
    const relative = await writeReleaseState(root, {
      scopes: { "skill:demo": { updatedAt: "2026-09-22T00:00:00.000Z", version: "1.0.0" } },
    });

    expect(relative).toBe(STATE_PATH);
    expect(await readReleaseState(root)).toEqual({
      scopes: { "skill:demo": { updatedAt: "2026-09-22T00:00:00.000Z", version: "1.0.0" } },
    });
    expect(await publicationArtifacts(root)).toEqual([]);
  });

  test("keeps the prior bytes readable until a flushed replacement is published", async () => {
    const root = await seededState();
    const before = await readFile(statePath(root));
    const beforePublish = deferred<void>();
    const release = deferred<void>();

    const published = writeReleaseState(root, {
      scopes: { "skill:demo": { version: "2.0.0" } },
    }, {}, {
      beforePublish: async () => {
        beforePublish.resolve();
        await release.promise;
      },
    });
    await beforePublish.promise;
    expect(await readFile(statePath(root))).toEqual(before);
    release.resolve();
    await published;
    expect(JSON.parse(await readFile(statePath(root), "utf8"))).toMatchObject({
      schemaVersion: 2,
      scopes: { "skill:demo": { version: "2.0.0" } },
    });
    expect(await publicationArtifacts(root)).toEqual([]);
  });

  test("leaves the previous destination byte-identical when write, flush, close, or pre-rename fails", async () => {
    const root = await seededState();
    const before = await readFile(statePath(root));

    for (const [hook, message] of failureHooks()) {
      await expect(writeReleaseState(root, {
        scopes: { "skill:demo": { version: "9.0.0" } },
      }, {}, { [hook]: () => { throw new Error(message); } })).rejects.toThrow(message);
      expect(await readFile(statePath(root))).toEqual(before);
      expect(await publicationArtifacts(root)).toEqual([]);
    }
  });

  test("leaves no published state when the first write fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillset-release-state-first-"));

    for (const [hook, message] of failureHooks()) {
      await expect(writeReleaseState(root, {
        scopes: { "skill:demo": { version: "1.0.0" } },
      }, {}, { [hook]: () => { throw new Error(message); } })).rejects.toThrow(message);
      expect(await Bun.file(statePath(root)).exists()).toBe(false);
      expect(await publicationArtifacts(root)).toEqual([]);
    }
  });
});

function failureHooks(): readonly [string, string][] {
  return [
    ["beforeTemporaryWrite", "injected temporary write failure"],
    ["beforeTemporarySync", "injected temporary sync failure"],
    ["beforeTemporaryClose", "injected temporary close failure"],
    ["beforePublish", "injected pre-rename failure"],
  ];
}

async function seededState(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillset-release-state-seed-"));
  await writeReleaseState(root, {
    scopes: { "skill:demo": { updatedAt: "2026-09-22T00:00:00.000Z", version: "1.0.0" } },
  });
  return root;
}

function statePath(root: string): string {
  return join(root, STATE_PATH);
}

async function publicationArtifacts(root: string): Promise<readonly string[]> {
  const directory = dirname(statePath(root));
  if (!(await Bun.file(directory).exists())) return [];
  return (await readdir(directory)).filter((file) => file.includes(".tmp-"));
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
