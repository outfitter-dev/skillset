import { describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

import { publishAtomicFile } from "../atomic-file-publication";
import { supportsGeneratedFileModes } from "../generated-file-mode";

describe("atomic file publication", () => {
  test("keeps the prior bytes readable until a flushed replacement is published", async () => {
    const path = await seededFile("prior\n");
    const before = await readFile(path);
    const beforePublish = deferred<void>();
    const release = deferred<void>();

    const published = publishAtomicFile(path, "next\n", {
      testHooks: {
        beforePublish: async () => {
          beforePublish.resolve();
          await release.promise;
        },
      },
    });
    await beforePublish.promise;
    expect(await readFile(path)).toEqual(before);
    release.resolve();
    await published;
    expect(await readFile(path, "utf8")).toBe("next\n");
    expect(await temporaryArtifacts(path)).toEqual([]);
  });

  test("leaves the previous destination byte-identical when write, flush, close, or pre-rename fails", async () => {
    const path = await seededFile("keep\n");
    const before = await readFile(path);

    for (const [hook, message] of failureHooks()) {
      await expect(publishAtomicFile(path, "lost\n", { testHooks: { [hook]: () => { throw new Error(message); } } }))
        .rejects.toThrow(message);
      expect(await readFile(path)).toEqual(before);
      expect(await temporaryArtifacts(path)).toEqual([]);
    }
  });

  test("leaves no published destination when the first write fails", async () => {
    const path = join(await createTestFixtureRoot("skillset-atomic-first-"), "state.json");

    for (const [hook, message] of failureHooks()) {
      await expect(publishAtomicFile(path, "lost\n", { testHooks: { [hook]: () => { throw new Error(message); } } }))
        .rejects.toThrow(message);
      expect(await Bun.file(path).exists()).toBe(false);
      expect(await temporaryArtifacts(path)).toEqual([]);
    }
  });

  test("applies the requested mode on Unix and still publishes bytes on Windows", async () => {
    const path = join(await createTestFixtureRoot("skillset-atomic-mode-"), "secret.json");
    await publishAtomicFile(path, '{"ok":true}\n', { mode: 0o600 });
    expect(await readFile(path, "utf8")).toBe('{"ok":true}\n');
    if (supportsGeneratedFileModes()) {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
    expect(await temporaryArtifacts(path)).toEqual([]);
  });

  test("replaces an existing file's mode with the requested mode on Unix", async () => {
    if (!supportsGeneratedFileModes()) return;
    const path = await seededFile("prior\n");
    await publishAtomicFile(path, "next\n", { mode: 0o600 });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).toBe("next\n");
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

async function seededFile(content: string): Promise<string> {
  const directory = await createTestFixtureRoot("skillset-atomic-pub-");
  const path = join(directory, "state.json");
  await mkdir(directory, { recursive: true });
  await writeFile(path, content);
  return path;
}

async function temporaryArtifacts(path: string): Promise<readonly string[]> {
  return (await readdir(join(path, ".."))).filter((file) => file.includes(".tmp-"));
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
