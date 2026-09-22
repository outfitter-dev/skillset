import { mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  assignErrorPath,
  directoryExists,
  falseIfMissingPath,
  isMissingPathError,
  MISSING_PATH_ENOENT,
  MISSING_PATH_ENOENT_OR_ENOTDIR,
  pathExists,
  readOptionalText,
} from "../fs-existence";

describe("fs-existence", () => {
  test("treats only the declared missing codes as absence", () => {
    expect(isMissingPathError(fsError("ENOENT", "/missing"))).toBe(true);
    expect(
      isMissingPathError(fsError("ENOTDIR", "/file/child"), MISSING_PATH_ENOENT)
    ).toBe(false);
    expect(
      isMissingPathError(
        fsError("ENOTDIR", "/file/child"),
        MISSING_PATH_ENOENT_OR_ENOTDIR
      )
    ).toBe(true);

    for (const code of ["EACCES", "EIO", "ELOOP"] as const) {
      expect(isMissingPathError(fsError(code, "/blocked"))).toBe(false);
      expectThrown(() => falseIfMissingPath(fsError(code, "/blocked"), "/blocked"), {
        code,
        path: "/blocked",
      });
    }
  });

  test("attaches the inspected path when the error omits it", () => {
    const error = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    expect(assignErrorPath(error, "/secret")).toMatchObject({
      code: "EACCES",
      path: "/secret",
    });
  });

  test("returns false for ordinary absence and keeps ENOTDIR caller-specific", async () => {
    await withTempRoot(async (root) => {
      const missing = join(root, "missing");
      const file = join(root, "file.txt");
      const throughFile = join(file, "child");
      await writeFile(file, "present\n");

      await expect(
        pathExists(missing, { missing: MISSING_PATH_ENOENT, probe: "stat" })
      ).resolves.toBe(false);
      await expect(
        pathExists(file, { missing: MISSING_PATH_ENOENT, probe: "stat" })
      ).resolves.toBe(true);
      await expect(
        directoryExists(missing, { missing: MISSING_PATH_ENOENT, probe: "stat" })
      ).resolves.toBe(false);
      await expect(
        directoryExists(file, { missing: MISSING_PATH_ENOENT, probe: "stat" })
      ).resolves.toBe(false);
      await expect(readOptionalText(missing, { missing: MISSING_PATH_ENOENT })).resolves.toBeUndefined();
      await expect(readOptionalText(file, { missing: MISSING_PATH_ENOENT })).resolves.toBe(
        "present\n"
      );

      await expect(
        pathExists(throughFile, { missing: MISSING_PATH_ENOENT, probe: "stat" })
      ).rejects.toMatchObject({ code: "ENOTDIR", path: throughFile });
      await expect(
        pathExists(throughFile, {
          missing: MISSING_PATH_ENOENT_OR_ENOTDIR,
          probe: "stat",
        })
      ).resolves.toBe(false);
    });
  });

  test("propagates symlink loops from following probes and keeps lstat on the named entry", async () => {
    await withTempRoot(async (root) => {
      const loop = join(root, "loop");
      await writeSymlinkLoop(loop);

      await expect(
        pathExists(loop, { missing: MISSING_PATH_ENOENT, probe: "stat" })
      ).rejects.toMatchObject({ code: "ELOOP", path: loop });
      await expect(
        pathExists(loop, { missing: MISSING_PATH_ENOENT, probe: "access" })
      ).rejects.toMatchObject({ code: "ELOOP", path: loop });
      await expect(
        directoryExists(loop, { missing: MISSING_PATH_ENOENT, probe: "stat" })
      ).rejects.toMatchObject({ code: "ELOOP", path: loop });
      await expect(readOptionalText(loop, { missing: MISSING_PATH_ENOENT })).rejects.toMatchObject({
        code: "ELOOP",
        path: loop,
      });
      await expect(
        pathExists(loop, { missing: MISSING_PATH_ENOENT, probe: "lstat" })
      ).resolves.toBe(true);
      await expect(stat(loop)).rejects.toMatchObject({ code: "ELOOP" });
    });
  });

  test("propagates injected permission failures instead of treating them as absence", () => {
    const path = "/unreadable";
    expectThrown(
      () => falseIfMissingPath(fsError("EACCES", path), path, MISSING_PATH_ENOENT),
      { code: "EACCES", path }
    );
    expect(falseIfMissingPath(fsError("ENOENT", path), path)).toBe(false);
  });
});

function fsError(code: string, path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: ${path}`), { code, path });
}

async function writeSymlinkLoop(path: string): Promise<void> {
  await symlink(basename(path), path);
}

function expectThrown(
  operation: () => unknown,
  expected: { readonly code: string; readonly path: string }
): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject(expected);
}

async function withTempRoot(
  operation: (root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "skillset-fs-existence-"));
  try {
    await operation(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}
