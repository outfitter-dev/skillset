import { expect, test } from "bun:test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { withWorkspaceReadBoundary } from "../workspace-read-boundary";
import * as reads from "../workspace-fs";

async function fixture() {
  const parent = await createTestFixtureRoot("workspace-read-boundary-");
  const root = join(parent, "workspace");
  const outside = join(parent, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(root, "local.txt"), "Local bytes");
  await writeFile(join(outside, "secret.txt"), "Outside sentinel");
  await symlink(join(outside, "secret.txt"), join(root, "leaf"));
  await symlink(outside, join(root, "ancestor"));
  await symlink(join(root, "local.txt"), join(root, "contained-link"));
  return { parent, root, outside };
}

test("scoped reads reject outside paths and descendant links before reading", async () => {
  const { root, outside } = await fixture();
  for (const path of [join(outside, "secret.txt"), join(root, "leaf"), join(root, "ancestor/secret.txt"), join(root, "contained-link")]) {
    await expect(withWorkspaceReadBoundary(root, () => reads.readFile(path, "utf8"))).rejects.toThrow("workspace inspection");
    await expect(withWorkspaceReadBoundary(root, async () => reads.readFileSync(path, "utf8"))).rejects.toThrow("workspace inspection");
  }
});

test("scope permits ordinary paths and a selected symlinked workspace root", async () => {
  const { root, parent } = await fixture();
  const selected = join(parent, "selected");
  await symlink(root, selected);
  const result = await withWorkspaceReadBoundary(selected, async () => {
    expect(await reads.readFile(join(selected, "local.txt"), "utf8")).toBe("Local bytes");
    expect(reads.readFileSync(join(selected, "local.txt"), "utf8")).toBe("Local bytes");
    expect(await reads.realpath(selected)).toBe(root);
    expect((await reads.readdir(selected)).includes("local.txt")).toBe(true);
    expect((await reads.stat(join(selected, "local.txt"))).isFile()).toBe(true);
    return 42;
  });
  expect(result).toBe(42);
});

test("no-scope callers retain existing symbolic-link and missing-path behavior", async () => {
  const { root } = await fixture();
  expect(await reads.readFile(join(root, "leaf"), "utf8")).toBe("Outside sentinel");
  expect(reads.readFileSync(join(root, "leaf"), "utf8")).toBe("Outside sentinel");
  expect(reads.existsSync(join(root, "missing"))).toBe(false);
  await expect(reads.readFile(join(root, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("caught boundary rejection still fails the whole inspection", async () => {
  const { root } = await fixture();
  await expect(withWorkspaceReadBoundary(root, async () => {
    try { await reads.readFile(join(root, "leaf")); } catch { /* An existing caller may suppress a read failure. */ }
    return "apparently successful";
  })).rejects.toThrow("workspace inspection");
  await expect(withWorkspaceReadBoundary(root, async () => reads.existsSync(join(root, "leaf")))).rejects.toThrow("workspace inspection");
});

test("parallel and nested inspections isolate roots and restore their parent scope", async () => {
  const one = await fixture();
  const two = await fixture();
  const results = await Promise.all([one, two].map(({ root }) => withWorkspaceReadBoundary(root, async () => {
    await Promise.resolve();
    return reads.readFile(join(root, "local.txt"), "utf8");
  })));
  expect(results).toEqual(["Local bytes", "Local bytes"]);
  await withWorkspaceReadBoundary(one.root, async () => {
    expect(await withWorkspaceReadBoundary(two.root, () => reads.readFile(join(two.root, "local.txt"), "utf8"))).toBe("Local bytes");
    expect(await reads.readFile(join(one.root, "local.txt"), "utf8")).toBe("Local bytes");
  });
  const failure = new Error("callback failed");
  await expect(withWorkspaceReadBoundary(one.root, async () => { throw failure; })).rejects.toBe(failure);
  expect(await reads.readFile(join(two.root, "leaf"), "utf8")).toBe("Outside sentinel");
});

test("missing paths keep their normal absence contract inside scope", async () => {
  const { root } = await fixture();
  await withWorkspaceReadBoundary(root, async () => {
    expect(reads.existsSync(join(root, "absent/leaf"))).toBe(false);
    await expect(reads.readFile(join(root, "absent/leaf"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});


test("scoped wrappers preserve binary, URL, directory and descriptor read options", async () => {
  const { root } = await fixture();
  await withWorkspaceReadBoundary(root, async () => {
    const path = join(root, "local.txt");
    expect(await reads.readFile(path)).toEqual(Buffer.from("Local bytes"));
    expect(await reads.readFile(pathToFileURL(path), { encoding: "utf8" })).toBe("Local bytes");
    expect(reads.readFileSync(path)).toEqual(Buffer.from("Local bytes"));
    expect(typeof (await reads.stat(path, { bigint: true })).size).toBe("bigint");
    expect(typeof reads.statSync(path, { bigint: true }).size).toBe("bigint");
    expect((await reads.readdir(root, { withFileTypes: true })).find(entry => entry.name === "local.txt")?.isFile()).toBe(true);
    expect(reads.readdirSync(root, { withFileTypes: true }).find(entry => entry.name === "local.txt")?.isFile()).toBe(true);
    expect((await reads.lstat(path)).isFile()).toBe(true);
    expect(reads.lstatSync(path).isFile()).toBe(true);
    expect(reads.realpathSync(path)).toBe(path);
    await reads.access(path);
    const handle = await reads.open(path, "r");
    try { expect(await handle.readFile("utf8")).toBe("Local bytes"); } finally { await handle.close(); }
  });
});
