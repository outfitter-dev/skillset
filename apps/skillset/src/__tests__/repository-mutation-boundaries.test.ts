import { describe, expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { buildSkillset } from "@skillset/core";
import { writeReleaseState } from "@skillset/core/internal/release-state";

import {
  createTestGitFixtureRoot,
  initializeTestGitRepository,
} from "../../../../scripts/test-helpers/git-remote";
import { addChangeEntry } from "../change-workflow";
import { importSource } from "../import";
import { scaffoldSourceUnit } from "../new-source";
import { applyRelease } from "../release";
import { initSkillset } from "../setup";

const withBoundary = async (
  operation: (root: string, outside: string) => Promise<void>
): Promise<void> => {
  const parent = await createTestGitFixtureRoot("skillset-mutation-boundary-");
  const root = join(parent, "repo");
  const outside = join(parent, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(outside, "sentinel.txt"), "outside\n");
  try {
    await operation(root, outside);
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
};

const commitWorkspace = async (root: string): Promise<void> => {
  await initializeTestGitRepository(root, {
    disposableRoot: join(root, ".."),
  });
};

const initWorkspace = async (root: string): Promise<void> => {
  await initSkillset({
    cwd: root,
    rootPath: root,
    useGitRoot: false,
    write: true,
  });
};

const assertSentinelUnchanged = async (outside: string, escaped: string): Promise<void> => {
  expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe("outside\n");
  await expect(lstat(join(outside, escaped))).rejects.toHaveProperty("code", "ENOENT");
};

describe("SET-637 repository mutation boundaries", () => {
  test("setup, new-source, and a valid in-repository layout still write", async () => {
    await withBoundary(async (root) => {
      await initWorkspace(root);
      expect(await readFile(join(root, "skillset.yaml"), "utf8")).toContain("skillset:");
      expect((await lstat(join(root, ".skillset"))).isDirectory()).toBe(true);

      const created = await scaffoldSourceUnit(root, {
        kind: "skill",
        name: "demo",
        write: true,
      });
      expect(created.files.map((file) => file.path)).toContain(
        ".skillset/skills/demo/SKILL.md"
      );
      expect(await readFile(join(root, ".skillset/skills/demo/SKILL.md"), "utf8")).toContain(
        "name: demo"
      );
    });
  });

  test("setup refuses a symlinked .skillset parent before outside bytes change", async () => {
    await withBoundary(async (root, outside) => {
      await symlink(outside, join(root, ".skillset"));
      await expect(initWorkspace(root)).rejects.toThrow(
        "refusing to traverse symbolic link: .skillset"
      );
      await assertSentinelUnchanged(outside, "skillset.yaml");
    });
  });

  test("new-source refuses a symlinked skills parent", async () => {
    await withBoundary(async (root, outside) => {
      await initWorkspace(root);
      await rm(join(root, ".skillset/skills"), { force: true, recursive: true });
      await symlink(outside, join(root, ".skillset/skills"));
      await expect(
        scaffoldSourceUnit(root, { kind: "skill", name: "escaped", write: true })
      ).rejects.toThrow("refusing to traverse symbolic link: .skillset/skills");
      await assertSentinelUnchanged(outside, "escaped");
    });
  });

  test("import refuses a symlinked plugin parent", async () => {
    await withBoundary(async (root, outside) => {
      await initWorkspace(root);
      const source = join(outside, "imported-plugin");
      await mkdir(source);
      await writeFile(
        join(source, "skillset.yaml"),
        "skillset:\n  name: escaped-plugin\n  description: Imported plugin for mutation ancestry.\n"
      );
      await rm(join(root, ".skillset/plugins"), { force: true, recursive: true });
      await symlink(outside, join(root, ".skillset/plugins"));
      await expect(
        importSource({
          kind: "plugin",
          name: "escaped-plugin",
          rootPath: root,
          sourcePath: source,
        })
      ).rejects.toThrow("refusing to traverse symbolic link: .skillset/plugins");
      await assertSentinelUnchanged(outside, "escaped-plugin");
    });
  });

  test("change add and release-state writes refuse a symlinked changes parent", async () => {
    await withBoundary(async (root, outside) => {
      await initWorkspace(root);
      await scaffoldSourceUnit(root, { kind: "skill", name: "demo", write: true });
      await commitWorkspace(root);
      const preserved = await replaceWithSymlink(join(root, ".skillset/changes"), outside);
      await expect(
        addChangeEntry(root, {
          bump: "patch",
          reason: {
            kind: "inline",
            value: "Document a source change that must stay inside the workspace.",
          },
          scopes: ["skill:demo"],
        })
      ).rejects.toThrow("refusing to traverse symbolic link: .skillset/changes");
      await expect(writeReleaseState(root, { scopes: {} })).rejects.toThrow(
        "refusing to traverse symbolic link: .skillset/changes"
      );
      expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe("outside\n");
      await expect(lstat(join(preserved, "state.json"))).resolves.toBeDefined();
    });
  });

  test("release restore refuses a swapped changes parent and keeps the outside sentinel", async () => {
    await withBoundary(async (root, outside) => {
      await initWorkspace(root);
      await scaffoldSourceUnit(root, { kind: "skill", name: "demo", write: true });
      await commitWorkspace(root);
      const added = await addChangeEntry(root, {
        bump: "patch",
        reason: {
          kind: "inline",
          value: "Cover the demo skill so release restore can be exercised.",
        },
        scopes: ["skill:demo"],
      });
      const preserved = await replaceWithSymlink(join(root, ".skillset/changes"), outside);
      expect(added.entry.id.length).toBeGreaterThan(0);
      await expect(applyRelease(root)).rejects.toThrow(
        "refusing to traverse symbolic link: .skillset/changes"
      );
      expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe("outside\n");
      await expect(lstat(join(preserved, "history.jsonl"))).rejects.toHaveProperty(
        "code",
        "ENOENT"
      );
      await expect(lstat(join(preserved, "releases.jsonl"))).rejects.toHaveProperty(
        "code",
        "ENOENT"
      );
    });
  });

  test("generated-output writes refuse a symlinked .agents parent", async () => {
    await withBoundary(async (root, outside) => {
      await initWorkspace(root);
      await scaffoldSourceUnit(root, { kind: "skill", name: "demo", write: true });
      await symlink(outside, join(root, ".agents"));
      await expect(buildSkillset(root)).rejects.toThrow(
        "refusing to traverse symbolic link"
      );
      await assertSentinelUnchanged(outside, "skills");
    });
  });
});

async function replaceWithSymlink(path: string, outside: string): Promise<string> {
  const preserved = join(outside, "preserved");
  await mkdir(preserved);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    await writeFile(join(preserved, entry.name), await readFile(join(path, entry.name)));
  }
  await rm(path, { force: true, recursive: true });
  await symlink(preserved, path);
  return preserved;
}
