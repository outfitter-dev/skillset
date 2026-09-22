import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import {
  assertRealPathInside,
  isPathInside,
  isRelativePathInside,
  resolveInside,
} from "../path";

const posix = nodePath.posix;
const win32 = nodePath.win32;

describe("isPathInside", () => {
  test("accepts a descendant and a name that begins with ..", () => {
    expect(isPathInside("/repo", "/repo/foo", { path: posix })).toBe(true);
    expect(isPathInside("/repo", "/repo/..foo", { path: posix })).toBe(true);
    expect(isPathInside("/repo", "/repo/..foo/bar", { path: posix })).toBe(true);
    expect(
      isPathInside("C:\\repo", "C:\\repo\\..foo", { path: win32 })
    ).toBe(true);
  });

  test("rejects the root itself unless allowEqual is set", () => {
    expect(isPathInside("/repo", "/repo", { path: posix })).toBe(false);
    expect(isPathInside("/repo", "/repo", { allowEqual: true, path: posix })).toBe(
      true
    );
    expect(isPathInside("C:\\repo", "C:\\repo", { path: win32 })).toBe(false);
    expect(
      isPathInside("C:\\repo", "C:\\repo", { allowEqual: true, path: win32 })
    ).toBe(true);
  });

  test("rejects parent traversal", () => {
    expect(isPathInside("/repo", "/repo/..", { path: posix })).toBe(false);
    expect(isPathInside("/repo", "/repo/../x", { path: posix })).toBe(false);
    expect(isPathInside("/repo", "/outside", { path: posix })).toBe(false);
    expect(isPathInside("C:\\repo", "C:\\repo\\..", { path: win32 })).toBe(false);
    expect(isPathInside("C:\\repo", "C:\\repo\\..\\x", { path: win32 })).toBe(
      false
    );
  });

  test("rejects a sibling that only shares a prefix", () => {
    expect(isPathInside("/a/b", "/a/bc", { path: posix })).toBe(false);
    expect(isPathInside("/a/b", "/a/bc", { allowEqual: true, path: posix })).toBe(
      false
    );
    expect(isPathInside("C:\\a\\b", "C:\\a\\bc", { path: win32 })).toBe(false);
  });

  test("rejects another Windows drive via path.win32", () => {
    expect(isPathInside("C:\\repo", "D:\\x", { path: win32 })).toBe(false);
    expect(
      isPathInside("C:\\repo", "D:\\x", { allowEqual: true, path: win32 })
    ).toBe(false);
    expect(isRelativePathInside("D:\\x", { path: win32 })).toBe(false);
  });

  test("rejects POSIX parent prefixes even when the path API is win32", () => {
    expect(isRelativePathInside("../x", { path: win32 })).toBe(false);
    expect(isRelativePathInside("..", { path: win32 })).toBe(false);
    expect(isRelativePathInside("..foo", { path: win32 })).toBe(true);
  });
});

describe("plugin-adoption and setup win32 realpaths", () => {
  test("accepts a descendant that a literal slash prefix would reject", () => {
    const realRoot = "C:\\Users\\matt\\repo";
    const realSource = "C:\\Users\\matt\\repo\\plugins\\demo";
    expect(realSource.startsWith(`${realRoot}/`)).toBe(false);
    expect(
      isPathInside(realRoot, realSource, { allowEqual: true, path: win32 })
    ).toBe(true);
    expect(isPathInside(realRoot, realRoot, { allowEqual: true, path: win32 })).toBe(
      true
    );
  });

  test("rejects an escaped win32 realpath the way setup skips candidates", () => {
    expect(
      isPathInside("C:\\repo", "D:\\plugins\\demo", { allowEqual: true, path: win32 })
    ).toBe(false);
    expect(
      isPathInside("C:\\repo", "C:\\other\\plugins\\demo", {
        allowEqual: true,
        path: win32,
      })
    ).toBe(false);
  });
});

describe("resolveInside", () => {
  test("resolves a descendant and refuses the root and escapes", () => {
    expect(resolveInside("/repo", "foo", { path: posix })).toBe(
      posix.resolve("/repo", "foo")
    );
    expect(resolveInside("/repo", "..foo", { path: posix })).toBe(
      posix.resolve("/repo", "..foo")
    );
    expect(() => resolveInside("/repo", ".", { path: posix })).toThrow(
      "refusing to operate outside repo root: ."
    );
    expect(() => resolveInside("/repo", "..", { path: posix })).toThrow(
      "refusing to operate outside repo root: .."
    );
    expect(() => resolveInside("/repo", "../x", { path: posix })).toThrow(
      "refusing to operate outside repo root: ../x"
    );
    expect(() => resolveInside("C:\\repo", "D:\\x", { path: win32 })).toThrow(
      "refusing to operate outside repo root: D:\\x"
    );
  });
});

describe("assertRealPathInside", () => {
  test("accepts a real descendant and refuses a path outside the root", async () => {
    const root = await mkdtemp(nodePath.join(tmpdir(), "skillset-path-inside-"));
    try {
      const child = nodePath.join(root, "nested", "file.txt");
      await mkdir(nodePath.dirname(child), { recursive: true });
      await writeFile(child, "ok\n");
      await expect(assertRealPathInside(root, child)).resolves.toBe(
        await realpath(child)
      );
      await expect(assertRealPathInside(root, root)).resolves.toBeDefined();

      const outside = await mkdtemp(
        nodePath.join(tmpdir(), "skillset-path-outside-")
      );
      try {
        await expect(assertRealPathInside(root, outside)).rejects.toThrow(
          "refusing to operate outside repo root"
        );
      } finally {
        await rm(outside, { force: true, recursive: true });
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("treats a symlink that escapes the root as outside", async () => {
    const root = await mkdtemp(nodePath.join(tmpdir(), "skillset-path-link-"));
    const outside = await mkdtemp(
      nodePath.join(tmpdir(), "skillset-path-link-out-")
    );
    try {
      const escape = nodePath.join(root, "escape");
      await symlink(outside, escape);
      await expect(assertRealPathInside(root, escape)).rejects.toThrow(
        "refusing to operate outside repo root"
      );
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });
});
