import { mkdir, readFile, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { writeAtomicFileSet } from "../atomic-file-set";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";

test("marketplace file transactions roll back every installed file after a late failure", async () => {
  const root = await createTestFixtureRoot("skillset-atomic-file-set-");
  const providerPath = join(root, ".claude-plugin", "marketplace.json");
  const lockPath = join(root, "skillset.lock");
  await Bun.write(providerPath, "provider-before\n");
  await writeFile(lockPath, "lock-before\n");

  await expect(writeAtomicFileSet(root, [
    { content: "provider-after\n", path: providerPath },
    { content: "lock-after\n", path: lockPath },
  ], {
    beforeInstall: (_path, index) => {
      if (index === 1) throw new Error("injected late lock failure");
    },
  })).rejects.toThrow("injected late lock failure");

  expect(await readFile(providerPath, "utf8")).toBe("provider-before\n");
  expect(await readFile(lockPath, "utf8")).toBe("lock-before\n");
  expect((await readdir(root)).filter((name) => name.startsWith(".skillset-marketplace-"))).toEqual([]);
  expect((await readdir(join(root, ".claude-plugin"))).filter((name) => name.startsWith(".skillset-marketplace-"))).toEqual([]);
});

for (const kind of ["parent", "dangling-parent", "leaf"] as const) {
  test(`atomic file set preflights a ${kind} symlink before any staging`, async () => {
    const fixture = await createTestFixtureRoot("atomic-containment-");
    const root = join(fixture, "workspace");
    const sentinel = join(fixture, "sentinel");
    await mkdir(root);
    await mkdir(sentinel);
    const first = join(root, "first.json");
    await writeFile(first, "first-before");
    const outside = join(sentinel, "target.json");
    await writeFile(outside, "outside-before");
    const link = join(root, "redirect");
    await symlink(kind === "leaf" ? outside : kind === "parent" ? sentinel : join(fixture, "missing"), link);
    const path = kind === "leaf" ? link : join(link, "target.json");
    await expect(writeAtomicFileSet(root, [
      { path: first, content: "first-after" }, { path, content: "outside-after" },
    ])).rejects.toThrow("symbolic link");
    expect(await readFile(first, "utf8")).toBe("first-before");
    expect(await readFile(outside, "utf8")).toBe("outside-before");
    expect((await readdir(root)).sort()).toEqual(["first.json", "redirect"]);
    expect(await readdir(sentinel)).toEqual(["target.json"]);
    expect((await readdir(fixture)).sort()).toEqual(["sentinel", "workspace"]);
  });
}

test("atomic file set creates real parents through a supported symlinked workspace root", async () => {
  const fixture = await createTestFixtureRoot("atomic-root-alias-");
  const root = join(fixture, "workspace");
  const alias = join(fixture, "alias");
  await mkdir(root);
  await symlink(root, alias, "dir");
  await writeAtomicFileSet(alias, [{ path: join(alias, "new", "nested", "file.json"), content: "new" }]);
  expect(await readFile(join(root, "new", "nested", "file.json"), "utf8")).toBe("new");
  expect(await readdir(join(root, "new", "nested"))).toEqual(["file.json"]);
});

test("a parent replaced after staging is refused without changing the sentinel", async () => {
  const fixture = await createTestFixtureRoot("atomic-stage-parent-");
  const root = join(fixture, "workspace");
  const parent = join(root, "catalog");
  const sentinel = join(fixture, "sentinel");
  await mkdir(parent, { recursive: true });
  await mkdir(sentinel);
  await writeFile(join(parent, "file.json"), "before");
  await writeFile(join(sentinel, "file.json"), "sentinel");
  await expect(writeAtomicFileSet(root, [{ path: join(parent, "file.json"), content: "after" }], {
    beforeInstall: async () => {
      await rename(parent, join(root, "saved"));
      await symlink(sentinel, parent, "dir");
    },
  })).rejects.toThrow("symbolic link");
  expect(await readFile(join(sentinel, "file.json"), "utf8")).toBe("sentinel");
  expect(await readdir(sentinel)).toEqual(["file.json"]);
  expect(await readFile(join(root, "saved", "file.json"), "utf8")).toBe("before");
});


test("rollback refuses a replaced parent and preserves recovery files", async () => {
  const fixture = await createTestFixtureRoot("atomic-rollback-parent-");
  const root = join(fixture, "workspace");
  const parent = join(root, "catalog");
  const sentinel = join(fixture, "sentinel");
  await mkdir(parent, { recursive: true });
  await mkdir(sentinel);
  await writeFile(join(parent, "file.json"), "before");
  await writeFile(join(sentinel, "file.json"), "sentinel");
  const lock = join(root, "skillset.lock");
  await writeFile(lock, "lock-before");
  await expect(writeAtomicFileSet(root, [
    { path: join(parent, "file.json"), content: "after" },
    { path: lock, content: "lock-after" },
  ], {
    beforeInstall: async (_path, index) => {
      if (index !== 1) return;
      await rename(parent, join(root, "saved"));
      await symlink(sentinel, parent, "dir");
      throw new Error("injected failure after parent replacement");
    },
  })).rejects.toThrow("rollback failed");
  expect(await readFile(join(sentinel, "file.json"), "utf8")).toBe("sentinel");
  expect(await readdir(sentinel)).toEqual(["file.json"]);
  expect(await readFile(lock, "utf8")).toBe("lock-before");
  const recovery = (await readdir(join(root, "saved"))).find((name) => name.startsWith(".skillset-marketplace-"));
  expect(recovery).toBeDefined();
  expect(await readFile(join(root, "saved", recovery!, "file.json.previous"), "utf8")).toBe("before");
});
