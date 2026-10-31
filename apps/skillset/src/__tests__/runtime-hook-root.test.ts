import { expect, test } from "bun:test";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createTestFixtureRoot } from "../../../../scripts/test-helpers/fixture-root";
import { discoverHookWorkspace } from "../runtime-hooks/workspace-root";

const input = (cwd: string) => JSON.stringify({ hook_event_name: "PreToolUse", cwd });

test("finds the nearest workspace from the provider cwd without running Git", async () => {
  const home = await createTestFixtureRoot("hook-root-");
  const root = join(home, "project");
  const nested = join(root, "src/deep");
  await mkdir(nested, { recursive: true });
  await Bun.write(join(root, "skillset.yaml"), "{}");
  await Bun.write(join(root, ".git"), "gitdir: /unread/external/metadata");
  expect(await discoverHookWorkspace(input(nested), home)).toBe(root);
  await mkdir(join(root, "src/.skillset"));
  expect(await discoverHookWorkspace(input(nested), home)).toBe(join(root, "src"));
});

test("does not cross repository, home, symlink-marker or invalid cwd boundaries", async () => {
  const home = await createTestFixtureRoot("hook-root-boundaries-");
  const root = join(home, "project");
  const nested = join(root, "nested");
  await mkdir(nested, { recursive: true });
  await Bun.write(join(home, "skillset.yaml"), "{}");
  expect(await discoverHookWorkspace(input(nested), home)).toBeUndefined();
  await Bun.write(join(root, "skillset.yaml"), "{}");
  await mkdir(join(nested, ".git"));
  expect(await discoverHookWorkspace(input(nested), home)).toBeUndefined();
  const other = join(root, "other");
  await mkdir(other);
  await symlink(join(root, "skillset.yaml"), join(other, "skillset.yaml"));
  expect(await discoverHookWorkspace(input(other), home)).toBeUndefined();
  for (const payload of ["{", "null", "{}", input("relative"), input(join(root, "missing")), input(join(root, "skillset.yaml")), JSON.stringify({ cwd: nested })]) {
    expect(await discoverHookWorkspace(payload, home)).toBeUndefined();
  }
});
